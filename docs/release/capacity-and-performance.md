# Capacity and performance (NFR-010, NFR-011)

**Date:** 06 October 2026. **Where:** a developer laptop, not staging.
**Verdict:** within the proposed targets on this machine, after one measured
optimization. **This does not replace a measurement on staging hardware**,
which remains a release item.

## Conditions

| | |
| --- | --- |
| Machine | Intel Core i5-8365U (4 cores / 8 threads, 1.6 GHz base), 16 GB RAM, SSD, Windows 11 |
| Database | PostgreSQL 18.6 in Docker Desktop (8 vCPU, 7.7 GB VM), default settings |
| API | The real application (`createApp`, sessions in PostgreSQL, the restricted runtime role, database pool of 10) in one Node 24 process, via `scripts/capacity/server.ts` |
| Load generator | Same laptop (`scripts/capacity/load-test.ts`), loopback network |
| Differences from a deployment | Sign-in rate limit raised (30 users sign in from one address); the job worker off during measurement (a scan is timed separately); no TLS, no proxy |
| Run-to-run noise | Noticeable: the same notification scan took 2.8 s and 5.9 s in two runs. Single comparisons are run back to back from an identical, vacuumed dataset |

## Dataset (`npm run capacity:seed`)

Synthetic, generated to the requirements' envelope and every production
constraint (no record without its next action, no owner/section mismatch):

| Users | Opportunities | Activities | Follow-ups | Contacts / links | Tender cycles | Documents | Audit events | Open alerts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 (93 active; 4 management, 8 leads, 87 salespeople, 1 administrator) | 10 000 | 60 000 | 40 000 | 3 000 / 14 980 | 4 500 | 2 000 (metadata only) | 110 000 | ≈11 800 for 92 recipients |

Bangla appears in names, organizations, contacts and activity subjects.
Database size ≈100 MB.

## Workload

30 concurrent signed-in users — 3 management, 6 section leads, 21
salespeople — each running a weighted mix of the real screens' API calls:
dashboard, opportunity list (paging, stage filter, sort), text search,
board, detail and its tabs (follow-ups, activities, history, contacts,
tenders, documents), follow-up list, activity log, tender tracker, the six
reports, global search, notification count, contacts, directory — plus
writes (log an activity, edit an opportunity). Two phases:

- **paced** (180 s): 1–3 s between each user's requests — people reading screens;
- **saturation** (90 s): no pause — 30 requests always in flight, the worst case.

## Results (controlled before/after, `docs/evidence/capacity/`)

| | Before optimization | After optimization |
| --- | ---: | ---: |
| **Paced** — requests, server errors | 2 598, 0 | 2 575, 0 |
| Paced overall p50 / **p95** / p99 / max (ms) | 34 / **154** / 782 / 2 716 | 61 / **160** / 267 / 435 |
| Paced dashboard p95 / p99 / max (ms) | 317 / 1 930 / 2 716 | 214 / 275 / 435 |
| **Saturation** — requests (per second), server errors | 7 805 (86.7/s), 0 | 8 736 (97.1/s), 0 |
| Saturation overall p50 / **p95** / p99 / max (ms) | 278 / **698** / 1 150 / 2 527 | 257 / **626** / 811 / 1 854 |
| Saturation dashboard p95 / max (ms) | 1 758 / 2 527 | 872 / 1 854 |
| Sign-in (argon2id), 30 sequential | p95 66–106 ms | |
| Notification scan of the whole dataset | 2.8–5.9 s (hourly job) | |

**Against the proposed target (p95 below 2 s for ordinary list, detail and
dashboard requests):** met in both phases, before and after. Before the fix
individual dashboard requests exceeded 2 s (max 2.7 s); after it no request
in either phase did. The paced p50 moved from 34 to 61 ms between the two
runs; the code change does not touch those endpoints and the earlier
uncontrolled baseline (`load-baseline.md`, p50 32 ms) suggests machine noise
rather than a regression — to be confirmed on staging.

### The bottleneck that was fixed

Per-query profiling of the management dashboard (EXPLAIN ANALYZE of every
statement it runs) showed one query taking 269 ms of 332: the **team
workload** computed five correlated subqueries per person, each rescanning
all ≈7 800 open follow-ups for each of 95 people. It now aggregates once per
owner (grouped subqueries joined to the people) using the same shared metric
definitions and the same scope predicate: **269 → 16 ms**; the management
dashboard **332 → 116 ms** single-user. Correctness: the AT-12 reconciliation
tests pass, and a new test that completes tasks first (so closed tasks exist)
proves the open/overdue task columns still match the follow-up lists — the
earlier tests could not tell (a deliberately broken variant passed them).

### What limits throughput now

Under saturation every endpoint's p95 sits at 330–600 ms while single-user
times are 20–120 ms: requests queue for the 10-connection database pool.
This is acceptable inside the envelope (30 users never all click at once — the
paced phase is the realistic one). If staging shows the same, the levers are
pool size and database sizing, not code.

## First usable page (`npm run capacity:pages`, `page-load.md`)

Production web build served by `vite preview`, API on the capacity dataset,
Chromium, empty cache for every run, 5 runs. "Usable" = the screen's data is
on the page.

| Network | Role | Sign-in page | Dashboard after sign-in | Opportunity list | Opportunity detail |
| --- | --- | ---: | ---: | ---: | ---: |
| Loopback | Management | 854 (max **4 676**) | 1 196 (max 1 596) | 303 | 312 |
| Loopback | Salesperson | 816 | 707 | 326 | 309 |
| Office broadband (40 ms, 20/5 Mbit/s, emulated) | Management | 1 489 | 1 236 | 455 | 453 (max 1 154) |
| Office broadband | Salesperson | 1 514 | 767 | 454 | 428 |

Median ms (max where notable). **Against the proposed 3-second target:** every
median is within it. One run exceeded it: the very first sign-in page after
the preview server started (4.7 s; the next four were 0.83–0.89 s) — a cold
start of the local preview server, recorded rather than discarded.
Bandwidth is emulated in the browser; real office networks, TLS and a real
web server are not represented.

## Not measured, and why

- Staging hardware, a reverse proxy and TLS: no staging environment exists.
- CSV export generation at 10 000 rows: the export job runs in the
  background (NFR-011 allows queuing); timed only in the integration tests.
- Document upload/download throughput: production storage is undecided and
  the capacity documents have no file bytes.
- Multiple API instances: one process was measured.

## Reproducing

```bash
npm run capacity:seed      # creates and fills penta_crm_capacity (local only)
npm run capacity:load      # CAPACITY_PACED_SECONDS / CAPACITY_SATURATION_SECONDS
npm run build:web && npm run capacity:pages
```

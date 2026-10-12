# Capacity load test — 2026-10-12T09:24:54.284Z

Machine: Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz (8 logical CPUs), 16 GB, Windows_NT 10.0.26300, Node v24.13.0. API, PostgreSQL (Docker Desktop) and the load generator on the same laptop; loopback network.

Dataset: {"users":100,"opportunities":10000,"activities":60311,"follow_ups":40000,"audit_events":110501,"postgres":"PostgreSQL 18.6 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit"}

Notification scan before the run (whole dataset): 4396 ms, 11815 open alerts for 92 recipients.

Sign-in (argon2id, 30 users, sequential): p50 55 ms, p95 67 ms, max 163 ms.

## paced — 2629 requests in 180 s (14.6/s), 0 server errors

Overall: p50 33 ms · **p95 92 ms** · p99 292 ms · max 596 ms (target p95 < 2000 ms)

| Endpoint | n | p50 | p95 | p99 | max | 5xx | 4xx (not 409) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/notifications/unread-count | 148 | 27 | 229 | 271 | 292 | 0 | 0 |
| GET /api/dashboard | 237 | 69 | 138 | 283 | 470 | 0 | 0 |
| GET /api/opportunities/board | 104 | 52 | 110 | 173 | 351 | 0 | 0 |
| GET /api/search | 100 | 46 | 109 | 361 | 488 | 0 | 0 |
| GET …/:id/history | 99 | 25 | 98 | 333 | 333 | 0 | 0 |
| GET /api/follow-ups | 187 | 41 | 98 | 217 | 358 | 0 | 0 |
| GET /api/reports/:report | 93 | 31 | 89 | 317 | 317 | 0 | 0 |
| GET /api/opportunities?q= | 135 | 33 | 82 | 336 | 592 | 0 | 0 |
| GET /api/organizations | 52 | 26 | 78 | 277 | 277 | 0 | 0 |
| POST …/:id/activities | 79 | 42 | 76 | 378 | 378 | 0 | 0 |
| GET /api/opportunities (page, filter, sort) | 418 | 29 | 65 | 167 | 415 | 0 | 0 |
| GET /api/tenders | 99 | 28 | 65 | 318 | 318 | 0 | 0 |
| GET …/:id/activities | 93 | 27 | 64 | 313 | 313 | 0 | 0 |
| GET /api/activities | 97 | 31 | 64 | 95 | 95 | 0 | 0 |
| PATCH /api/opportunities/:id | 42 | 35 | 63 | 94 | 94 | 0 | 0 |
| GET …/:id/follow-ups | 88 | 30 | 63 | 103 | 103 | 0 | 0 |
| GET /api/opportunities/:id | 341 | 26 | 59 | 305 | 596 | 0 | 0 |
| GET …/:id/documents | 66 | 24 | 46 | 61 | 61 | 0 | 0 |
| GET /api/contacts | 39 | 29 | 45 | 46 | 46 | 0 | 0 |
| GET …/:id/tenders | 47 | 25 | 44 | 282 | 282 | 0 | 0 |
| GET …/:id/contacts | 65 | 22 | 44 | 83 | 83 | 0 | 0 |

## saturation — 8577 requests in 90 s (95.3/s), 0 server errors

Overall: p50 258 ms · **p95 658 ms** · p99 907 ms · max 1719 ms (target p95 < 2000 ms)

| Endpoint | n | p50 | p95 | p99 | max | 5xx | 4xx (not 409) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/dashboard | 838 | 631 | 1029 | 1437 | 1719 | 0 | 0 |
| GET /api/search | 272 | 366 | 629 | 766 | 1088 | 0 | 0 |
| GET /api/opportunities/board | 328 | 321 | 519 | 733 | 893 | 0 | 0 |
| PATCH /api/opportunities/:id | 148 | 332 | 517 | 670 | 722 | 0 | 0 |
| POST …/:id/activities | 232 | 309 | 496 | 706 | 1027 | 0 | 0 |
| GET /api/follow-ups | 571 | 260 | 470 | 629 | 759 | 0 | 0 |
| GET /api/reports/:report | 330 | 272 | 459 | 618 | 856 | 0 | 0 |
| GET /api/opportunities?q= | 441 | 259 | 426 | 656 | 837 | 0 | 0 |
| GET /api/opportunities/:id | 1054 | 249 | 413 | 605 | 874 | 0 | 0 |
| GET …/:id/activities | 348 | 250 | 411 | 694 | 848 | 0 | 0 |
| GET /api/opportunities (page, filter, sort) | 1368 | 246 | 404 | 596 | 907 | 0 | 0 |
| GET …/:id/history | 304 | 244 | 394 | 575 | 805 | 0 | 0 |
| GET …/:id/follow-ups | 340 | 248 | 392 | 694 | 818 | 0 | 0 |
| GET /api/activities | 333 | 228 | 381 | 497 | 705 | 0 | 0 |
| GET …/:id/documents | 174 | 205 | 362 | 573 | 730 | 0 | 0 |
| GET /api/tenders | 333 | 219 | 349 | 582 | 745 | 0 | 0 |
| GET …/:id/tenders | 185 | 216 | 349 | 398 | 429 | 0 | 0 |
| GET /api/contacts | 137 | 218 | 346 | 436 | 698 | 0 | 0 |
| GET /api/organizations | 172 | 217 | 336 | 544 | 600 | 0 | 0 |
| GET …/:id/contacts | 246 | 205 | 313 | 402 | 760 | 0 | 0 |
| GET /api/notifications/unread-count | 423 | 183 | 289 | 362 | 673 | 0 | 0 |


# Capacity load test — 2026-10-06T08:47:40.819Z

Machine: Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz (8 logical CPUs), 16 GB, Windows_NT 10.0.26200, Node v24.13.0. API, PostgreSQL (Docker Desktop) and the load generator on the same laptop; loopback network.

Dataset: {"users":100,"opportunities":10000,"activities":60299,"follow_ups":40000,"audit_events":110431,"postgres":"PostgreSQL 18.6 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit"}

Notification scan before the run (whole dataset): 2754 ms, 11825 open alerts for 92 recipients.

Sign-in (argon2id, 30 users, sequential): p50 50 ms, p95 59 ms, max 178 ms.

## paced — 2598 requests in 180 s (14.4/s), 0 server errors

Overall: p50 34 ms · **p95 154 ms** · p99 782 ms · max 2716 ms (target p95 < 2000 ms)

| Endpoint | n | p50 | p95 | p99 | max | 5xx | 4xx (not 409) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/tenders | 92 | 27 | 425 | 1045 | 1045 | 0 | 0 |
| GET /api/opportunities/board | 80 | 55 | 317 | 2204 | 2204 | 0 | 0 |
| GET /api/dashboard | 283 | 68 | 317 | 1930 | 2716 | 0 | 0 |
| POST …/:id/activities | 90 | 41 | 215 | 1678 | 1678 | 0 | 0 |
| GET /api/activities | 107 | 39 | 180 | 342 | 1613 | 0 | 0 |
| GET /api/opportunities?q= | 110 | 35 | 157 | 184 | 197 | 0 | 0 |
| GET /api/follow-ups | 154 | 50 | 137 | 965 | 1253 | 0 | 0 |
| GET /api/search | 101 | 48 | 120 | 298 | 317 | 0 | 0 |
| GET …/:id/follow-ups | 114 | 27 | 85 | 105 | 180 | 0 | 0 |
| GET /api/opportunities (page, filter, sort) | 403 | 29 | 84 | 717 | 1348 | 0 | 0 |
| GET /api/reports/:report | 103 | 31 | 78 | 184 | 1300 | 0 | 0 |
| GET …/:id/tenders | 52 | 24 | 74 | 932 | 932 | 0 | 0 |
| GET /api/notifications/unread-count | 130 | 25 | 70 | 1569 | 1825 | 0 | 0 |
| GET …/:id/documents | 47 | 23 | 69 | 178 | 178 | 0 | 0 |
| GET /api/opportunities/:id | 330 | 25 | 68 | 148 | 533 | 0 | 0 |
| PATCH /api/opportunities/:id | 41 | 31 | 68 | 109 | 109 | 0 | 0 |
| GET …/:id/activities | 94 | 27 | 66 | 187 | 187 | 0 | 0 |
| GET …/:id/history | 99 | 27 | 59 | 566 | 566 | 0 | 0 |
| GET …/:id/contacts | 66 | 22 | 57 | 121 | 121 | 0 | 0 |
| GET /api/contacts | 45 | 28 | 52 | 250 | 250 | 0 | 0 |
| GET /api/organizations | 57 | 28 | 51 | 1718 | 1718 | 0 | 0 |

## saturation — 7805 requests in 90 s (86.7/s), 0 server errors

Overall: p50 278 ms · **p95 698 ms** · p99 1150 ms · max 2527 ms (target p95 < 2000 ms)

| Endpoint | n | p50 | p95 | p99 | max | 5xx | 4xx (not 409) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/dashboard | 761 | 681 | 1758 | 2115 | 2527 | 0 | 0 |
| GET /api/search | 321 | 413 | 674 | 814 | 858 | 0 | 0 |
| PATCH /api/opportunities/:id | 91 | 355 | 618 | 809 | 809 | 0 | 0 |
| GET /api/opportunities/board | 311 | 344 | 548 | 762 | 1093 | 0 | 0 |
| POST …/:id/activities | 209 | 325 | 517 | 639 | 747 | 0 | 0 |
| GET /api/follow-ups | 546 | 292 | 495 | 645 | 1010 | 0 | 0 |
| GET /api/reports/:report | 301 | 283 | 490 | 620 | 1094 | 0 | 0 |
| GET /api/opportunities?q= | 367 | 283 | 482 | 662 | 1145 | 0 | 0 |
| GET /api/activities | 317 | 262 | 445 | 592 | 991 | 0 | 0 |
| GET …/:id/follow-ups | 318 | 266 | 439 | 551 | 1094 | 0 | 0 |
| GET /api/opportunities (page, filter, sort) | 1252 | 263 | 433 | 535 | 1078 | 0 | 0 |
| GET …/:id/activities | 310 | 264 | 428 | 550 | 1043 | 0 | 0 |
| GET /api/opportunities/:id | 908 | 268 | 421 | 538 | 1083 | 0 | 0 |
| GET …/:id/history | 289 | 264 | 413 | 548 | 1064 | 0 | 0 |
| GET /api/contacts | 164 | 237 | 394 | 477 | 516 | 0 | 0 |
| GET /api/tenders | 288 | 238 | 393 | 586 | 830 | 0 | 0 |
| GET …/:id/documents | 152 | 227 | 381 | 494 | 551 | 0 | 0 |
| GET …/:id/tenders | 171 | 223 | 374 | 589 | 697 | 0 | 0 |
| GET …/:id/contacts | 240 | 221 | 369 | 439 | 522 | 0 | 0 |
| GET /api/organizations | 152 | 228 | 345 | 500 | 575 | 0 | 0 |
| GET /api/notifications/unread-count | 337 | 189 | 310 | 436 | 653 | 0 | 0 |


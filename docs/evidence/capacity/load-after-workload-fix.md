# Capacity load test — 2026-10-06T08:53:56.939Z

Machine: Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz (8 logical CPUs), 16 GB, Windows_NT 10.0.26200, Node v24.13.0. API, PostgreSQL (Docker Desktop) and the load generator on the same laptop; loopback network.

Dataset: {"users":100,"opportunities":10000,"activities":60351,"follow_ups":40000,"audit_events":110524,"postgres":"PostgreSQL 18.6 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit"}

Notification scan before the run (whole dataset): 5904 ms, 11767 open alerts for 92 recipients.

Sign-in (argon2id, 30 users, sequential): p50 94 ms, p95 106 ms, max 379 ms.

## paced — 2575 requests in 180 s (14.3/s), 0 server errors

Overall: p50 61 ms · **p95 160 ms** · p99 267 ms · max 435 ms (target p95 < 2000 ms)

| Endpoint | n | p50 | p95 | p99 | max | 5xx | 4xx (not 409) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/dashboard | 240 | 115 | 214 | 275 | 435 | 0 | 0 |
| GET /api/search | 101 | 98 | 208 | 375 | 408 | 0 | 0 |
| GET /api/contacts | 55 | 47 | 199 | 290 | 290 | 0 | 0 |
| GET /api/follow-ups | 161 | 89 | 187 | 333 | 413 | 0 | 0 |
| GET /api/opportunities/board | 110 | 92 | 184 | 373 | 382 | 0 | 0 |
| GET /api/opportunities?q= | 145 | 63 | 178 | 232 | 267 | 0 | 0 |
| POST …/:id/activities | 86 | 74 | 147 | 174 | 174 | 0 | 0 |
| GET /api/reports/:report | 100 | 54 | 142 | 195 | 363 | 0 | 0 |
| GET /api/notifications/unread-count | 136 | 43 | 127 | 236 | 262 | 0 | 0 |
| GET /api/activities | 91 | 70 | 120 | 307 | 307 | 0 | 0 |
| GET /api/tenders | 102 | 47 | 116 | 141 | 149 | 0 | 0 |
| GET /api/opportunities (page, filter, sort) | 380 | 51 | 115 | 311 | 352 | 0 | 0 |
| PATCH /api/opportunities/:id | 49 | 60 | 106 | 112 | 112 | 0 | 0 |
| GET …/:id/documents | 57 | 42 | 104 | 149 | 149 | 0 | 0 |
| GET /api/organizations | 50 | 43 | 98 | 253 | 253 | 0 | 0 |
| GET …/:id/follow-ups | 96 | 46 | 98 | 319 | 319 | 0 | 0 |
| GET /api/opportunities/:id | 304 | 44 | 92 | 105 | 324 | 0 | 0 |
| GET …/:id/activities | 92 | 43 | 90 | 354 | 354 | 0 | 0 |
| GET …/:id/tenders | 61 | 39 | 88 | 133 | 133 | 0 | 0 |
| GET …/:id/history | 93 | 39 | 87 | 348 | 348 | 0 | 0 |
| GET …/:id/contacts | 66 | 32 | 81 | 162 | 162 | 0 | 0 |

## saturation — 8736 requests in 90 s (97.1/s), 0 server errors

Overall: p50 257 ms · **p95 626 ms** · p99 811 ms · max 1854 ms (target p95 < 2000 ms)

| Endpoint | n | p50 | p95 | p99 | max | 5xx | 4xx (not 409) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/dashboard | 839 | 606 | 872 | 1251 | 1854 | 0 | 0 |
| GET /api/search | 345 | 382 | 601 | 844 | 1067 | 0 | 0 |
| GET /api/opportunities/board | 358 | 324 | 491 | 745 | 861 | 0 | 0 |
| GET /api/opportunities?q= | 402 | 261 | 460 | 651 | 915 | 0 | 0 |
| POST …/:id/activities | 265 | 307 | 454 | 769 | 914 | 0 | 0 |
| PATCH /api/opportunities/:id | 124 | 333 | 445 | 589 | 706 | 0 | 0 |
| GET /api/follow-ups | 583 | 276 | 427 | 729 | 1074 | 0 | 0 |
| GET …/:id/history | 351 | 247 | 388 | 679 | 833 | 0 | 0 |
| GET /api/reports/:report | 317 | 262 | 355 | 558 | 654 | 0 | 0 |
| GET /api/opportunities/:id | 1015 | 246 | 353 | 570 | 745 | 0 | 0 |
| GET /api/opportunities (page, filter, sort) | 1401 | 243 | 351 | 588 | 900 | 0 | 0 |
| GET /api/organizations | 172 | 209 | 348 | 575 | 703 | 0 | 0 |
| GET …/:id/activities | 333 | 247 | 344 | 601 | 886 | 0 | 0 |
| GET …/:id/follow-ups | 334 | 251 | 343 | 446 | 585 | 0 | 0 |
| GET /api/activities | 365 | 240 | 333 | 605 | 800 | 0 | 0 |
| GET /api/tenders | 306 | 223 | 329 | 487 | 846 | 0 | 0 |
| GET …/:id/documents | 176 | 210 | 320 | 442 | 819 | 0 | 0 |
| GET …/:id/contacts | 283 | 207 | 308 | 583 | 712 | 0 | 0 |
| GET /api/contacts | 147 | 221 | 302 | 497 | 570 | 0 | 0 |
| GET …/:id/tenders | 160 | 204 | 290 | 354 | 377 | 0 | 0 |
| GET /api/notifications/unread-count | 460 | 178 | 266 | 378 | 505 | 0 | 0 |


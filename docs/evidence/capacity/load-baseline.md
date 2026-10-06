# Capacity load test — 2026-10-06T08:30:22.625Z

Machine: Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz (8 logical CPUs), 16 GB, Windows_NT 10.0.26200, Node v24.13.0. API, PostgreSQL (Docker Desktop) and the load generator on the same laptop; loopback network.

Dataset: {"users":100,"opportunities":10000,"activities":60437,"follow_ups":40000,"audit_events":110666,"postgres":"PostgreSQL 18.6 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit"}

Notification scan before the run (whole dataset): 2828 ms, 11870 open alerts for 92 recipients.

Sign-in (argon2id, 30 users, sequential): p50 49 ms, p95 72 ms, max 170 ms.

## paced — 2631 requests in 180 s (14.6/s), 0 server errors

Overall: p50 32 ms · **p95 92 ms** · p99 273 ms · max 592 ms (target p95 < 2000 ms)

| Endpoint | n | p50 | p95 | p99 | max | 5xx | 4xx (not 409) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/dashboard | 235 | 63 | 325 | 376 | 592 | 0 | 0 |
| GET /api/opportunities/board | 90 | 47 | 123 | 216 | 216 | 0 | 0 |
| GET /api/follow-ups | 176 | 45 | 97 | 163 | 189 | 0 | 0 |
| POST …/:id/activities | 76 | 46 | 96 | 382 | 382 | 0 | 0 |
| GET /api/reports/:report | 114 | 30 | 87 | 194 | 205 | 0 | 0 |
| GET /api/opportunities?q= | 127 | 33 | 84 | 158 | 187 | 0 | 0 |
| GET /api/search | 110 | 44 | 83 | 125 | 233 | 0 | 0 |
| GET /api/activities | 115 | 36 | 70 | 191 | 197 | 0 | 0 |
| GET /api/opportunities (page, filter, sort) | 410 | 28 | 68 | 164 | 357 | 0 | 0 |
| PATCH /api/opportunities/:id | 54 | 30 | 66 | 82 | 82 | 0 | 0 |
| GET …/:id/tenders | 52 | 23 | 62 | 174 | 174 | 0 | 0 |
| GET /api/opportunities/:id | 297 | 26 | 61 | 185 | 197 | 0 | 0 |
| GET /api/contacts | 42 | 29 | 61 | 65 | 65 | 0 | 0 |
| GET /api/tenders | 99 | 28 | 59 | 90 | 90 | 0 | 0 |
| GET …/:id/activities | 98 | 24 | 59 | 190 | 190 | 0 | 0 |
| GET …/:id/history | 108 | 26 | 57 | 80 | 180 | 0 | 0 |
| GET …/:id/documents | 50 | 24 | 55 | 168 | 168 | 0 | 0 |
| GET /api/notifications/unread-count | 143 | 26 | 55 | 142 | 214 | 0 | 0 |
| GET /api/organizations | 66 | 22 | 51 | 183 | 183 | 0 | 0 |
| GET …/:id/follow-ups | 92 | 26 | 50 | 185 | 185 | 0 | 0 |
| GET …/:id/contacts | 77 | 21 | 47 | 180 | 180 | 0 | 0 |

## saturation — 10335 requests in 90 s (114.8/s), 0 server errors

Overall: p50 216 ms · **p95 520 ms** · p99 735 ms · max 2235 ms (target p95 < 2000 ms)

| Endpoint | n | p50 | p95 | p99 | max | 5xx | 4xx (not 409) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /api/dashboard | 1003 | 518 | 1366 | 1570 | 2235 | 0 | 0 |
| GET /api/search | 382 | 333 | 492 | 578 | 707 | 0 | 0 |
| GET /api/opportunities/board | 422 | 271 | 377 | 435 | 667 | 0 | 0 |
| PATCH /api/opportunities/:id | 147 | 271 | 367 | 407 | 451 | 0 | 0 |
| POST …/:id/activities | 308 | 259 | 341 | 410 | 578 | 0 | 0 |
| GET /api/follow-ups | 673 | 227 | 334 | 500 | 645 | 0 | 0 |
| GET /api/opportunities?q= | 481 | 221 | 316 | 424 | 711 | 0 | 0 |
| GET /api/reports/:report | 390 | 220 | 308 | 405 | 613 | 0 | 0 |
| GET …/:id/follow-ups | 394 | 212 | 293 | 357 | 499 | 0 | 0 |
| GET /api/opportunities (page, filter, sort) | 1677 | 208 | 287 | 342 | 572 | 0 | 0 |
| GET …/:id/history | 414 | 210 | 282 | 360 | 532 | 0 | 0 |
| GET /api/opportunities/:id | 1177 | 208 | 281 | 363 | 596 | 0 | 0 |
| GET …/:id/activities | 403 | 210 | 274 | 310 | 374 | 0 | 0 |
| GET /api/activities | 423 | 204 | 272 | 344 | 421 | 0 | 0 |
| GET /api/contacts | 193 | 187 | 256 | 291 | 296 | 0 | 0 |
| GET /api/tenders | 400 | 185 | 253 | 284 | 414 | 0 | 0 |
| GET /api/organizations | 198 | 179 | 241 | 314 | 319 | 0 | 0 |
| GET …/:id/tenders | 199 | 178 | 239 | 279 | 375 | 0 | 0 |
| GET …/:id/documents | 208 | 176 | 235 | 283 | 405 | 0 | 0 |
| GET …/:id/contacts | 307 | 171 | 234 | 283 | 368 | 0 | 0 |
| GET /api/notifications/unread-count | 536 | 149 | 207 | 264 | 360 | 0 | 0 |


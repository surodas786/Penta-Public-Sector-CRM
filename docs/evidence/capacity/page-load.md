# First usable page — 2026-10-06T09:09:35.243Z

Production web build served by `vite preview`, API from scripts/capacity/server.ts on the capacity dataset, Chromium (Playwright), empty cache per run, 5 runs. Target: < 3000 ms.

| Network | Role | Screen | Median ms | Max ms | Runs |
| --- | --- | --- | ---: | ---: | --- |
| loopback | management | sign-in | 854 | 4676 | 4676, 849, 854, 832, 889 |
| loopback | management | dashboard | 1196 | 1596 | 1596, 1196, 1251, 1093, 1092 |
| loopback | management | list | 303 | 381 | 381, 275, 303, 363, 303 |
| loopback | management | detail | 312 | 348 | 348, 309, 308, 312, 320 |
| loopback | salesperson | sign-in | 816 | 845 | 816, 780, 839, 845, 807 |
| loopback | salesperson | dashboard | 707 | 786 | 707, 649, 736, 786, 684 |
| loopback | salesperson | list | 326 | 361 | 352, 294, 326, 361, 268 |
| loopback | salesperson | detail | 309 | 319 | 319, 301, 314, 309, 300 |
| office broadband (40 ms, 20/5 Mbit/s) | management | sign-in | 1489 | 1662 | 1662, 1378, 1489, 1168, 1521 |
| office broadband (40 ms, 20/5 Mbit/s) | management | dashboard | 1236 | 1283 | 1236, 1283, 1253, 999, 953 |
| office broadband (40 ms, 20/5 Mbit/s) | management | list | 455 | 517 | 511, 517, 445, 455, 436 |
| office broadband (40 ms, 20/5 Mbit/s) | management | detail | 453 | 1154 | 1154, 488, 421, 453, 422 |
| office broadband (40 ms, 20/5 Mbit/s) | salesperson | sign-in | 1514 | 1622 | 1444, 1560, 1514, 1477, 1622 |
| office broadband (40 ms, 20/5 Mbit/s) | salesperson | dashboard | 767 | 903 | 668, 685, 821, 767, 903 |
| office broadband (40 ms, 20/5 Mbit/s) | salesperson | list | 454 | 472 | 468, 432, 425, 454, 472 |
| office broadband (40 ms, 20/5 Mbit/s) | salesperson | detail | 428 | 483 | 422, 483, 386, 455, 428 |


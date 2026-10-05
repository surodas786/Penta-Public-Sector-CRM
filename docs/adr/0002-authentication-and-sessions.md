# ADR 0002 — Authentication, sessions, CSRF and idempotency

**Status:** Accepted for development (Milestone 1). Production identity is an
open decision — see "Open for Penta".
**Date:** 04 October 2026

## Context

SEC-030 requires Penta's identity provider where one is suitable, and otherwise
a *maintained authentication library* with modern password hashing. `Plan.md`
§4.3 adds: "Do not implement a new custom authentication/session protocol
simply to avoid dependencies."

The repository was inspected for an existing identity integration before
choosing: there is none. No SSO configuration, no identity environment
variables, no auth dependency in the original manifest.

## Decision

### Local authentication with maintained libraries

| Concern | Library | Why |
| --- | --- | --- |
| Authentication framework | `passport` + `passport-local` | The established Express authentication library; handles the strategy contract and `req.login`. |
| Session protocol | `express-session` | Cookie issue, signing, regeneration and expiry come from a maintained implementation, not from code written here. |
| Session storage | `connect-pg-simple` | Durable sessions in PostgreSQL. Survives a restart; revocable by deleting a row. |
| Password hashing | `@node-rs/argon2` | argon2id, the current OWASP recommendation. Ships prebuilt binaries, so no native toolchain on Windows or in CI. |
| CSRF | `csrf-csrf` | Maintained signed double-submit implementation (`csurf` is deprecated). |
| Rate limiting | `express-rate-limit` | Required by SEC-031 on sign-in. |

Argon2id parameters follow the OWASP Password Storage Cheat Sheet: 19 MiB
memory, time cost 2, parallelism 1.

### What this project adds on top

Deliberately small, and none of it reimplements a protocol:

- **Generic failure.** Unknown email, wrong password and deactivated account
  are indistinguishable. An unknown email still verifies against a real argon2
  hash so response timing does not disclose account existence.
- **Session fixation defence.** `req.session.regenerate()` before `req.login()`,
  so the authenticated session always has a fresh id.
- **Re-validation on every request.** Only the account id lives in the session.
  Role, section and active state are read from the database per request, so a
  deactivation or a role change takes effect on the account's *next* request
  (SEC-005).
- **`users.session_version`.** Incremented on deactivation and on material
  role or section changes. A session carrying an older value is destroyed on
  its next request. This is what makes revocation immediate without hunting
  for session rows.
- **Idle and absolute expiry tracked in session data** (30 minutes / 12 hours
  by default), evaluated against the injectable clock in `server/clock.ts`, so
  tests can prove both without waiting. The cookie `maxAge` is a second layer,
  not the only one.

### CSRF in three layers

SameSite alone is explicitly not treated as sufficient (`Plan.md` §4.3):

1. `SameSite=Strict; HttpOnly` on the session cookie.
2. A signed double-submit token bound to the session id, sent in
   `X-CSRF-Token`. Regenerated after sign-in, because the session id changes.
3. Trusted-origin validation on every state-changing request, registered
   *before* the token check.

Layer 3 rejects a **missing** `Origin` as well as a wrong one. A browser always
sends it on a cross-origin mutation, so its absence on a mutation is not
something to wave through. Integration tests cover missing, forged and invalid
cases, and assert that no write occurs.

Cookies are `Secure` in production, and `FORCE_SECURE_COOKIES=true` enables
that in any environment served over HTTPS.

### Durable idempotency

`idempotency_records` is keyed on `(actor_id, operation, idempotency_key)`:

- The claim is committed **before** the business transaction, so a genuinely
  concurrent duplicate collides on the unique index instead of racing through.
- A SHA-256 fingerprint of the canonical request body is stored. The same key
  with a different payload is `409 idempotency_key_reuse`.
- **No response body is stored.** A replay re-reads the entity through the
  normal scoped query, so a caller whose access was revoked between the
  original call and the replay gets a 404 rather than cached commercial data.
- A failed business transaction releases the claim, so a corrected retry is not
  blocked by a key that produced nothing.
- *(Milestone 2)* The claim is completed inside the business transaction, not
  after it, so there is no window in which the record exists but the key still
  reads "in progress". See `docs/adr/0003-stage-status-and-follow-up-lifecycle.md`.
- Records expire after 24 hours; `pruneExpiredIdempotencyRecords` exists for the
  scheduled cleanup that arrives with the background-jobs milestone. Until then
  the table is small and bounded by development traffic.

## Open for Penta

These are recorded decisions, not settled ones. They must be resolved before
launch (requirements §18):

1. **Identity provider.** If Penta has suitable SSO, it replaces local
   authentication. The policy layer is unaffected: it consumes an `Actor`
   derived from the session, not from any particular login mechanism.
2. **MFA for privileged roles**, where the chosen identity service supports it.
3. **Invitations and password recovery.** No public registration exists, and no
   recovery flow is implemented. Synthetic development accounts come from the
   seed script. Single-use expiring recovery tokens arrive with the
   administration milestone (`Plan.md` §4.3).
4. **Session lifetime confirmation.** 30-minute idle and 12-hour absolute are
   the proposed SEC-031 defaults, configurable per environment.

## Consequences

- Session revocation is a database write, not a cache invalidation, and is
  provable in tests.
- Every mutation requires a CSRF token, so any new client code must send it;
  `src/api/client.ts` does this centrally.
- Create-style endpoints require an `Idempotency-Key` header. The create dialog
  generates one per submission attempt and reuses it on retry, which is what
  makes "retry after an uncertain network result" safe.
- Argon2 verification is intentionally expensive. The integration suite hashes
  the shared fixture password once and reuses it, so reseeding between tests
  stays fast.

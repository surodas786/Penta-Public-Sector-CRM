# Security review — Milestone 8

**Date:** 06 October 2026 · **Branch:** `m8-release-preparation` · **Reviewer:** the
development assistant (Claude Code). **This is a developer self-review, not an
independent security assessment.** §6 lists what an independent human reviewer
must examine before production.

Method: code reading of every control below; the automated suites
(`npm test`, `npm run test:smoke`, `npm run test:browsers`); a production-mode
start of the compiled server (`npm run check:production-server`); the build-time
demo-exclusion check; `npm audit`; a scan of the Git history for credentials.

## 1. Summary

| Area | Status | Evidence |
| --- | --- | --- |
| Authentication (local accounts, argon2id) | Implemented and tested for development and pilot | `auth.test.ts`; ADR 0002 |
| Session lifetime and revocation | Implemented and tested | idle 30 min, absolute 12 h, logout, deactivation, role/section change (`auth.test.ts`, `administration.test.ts`); background polls do not extend sessions (`notifications.test.ts`) |
| CSRF | Implemented and tested | SameSite=Strict + signed double-submit token bound to the session + trusted-origin check, missing Origin refused (`auth.test.ts`, every mutation test sends both) |
| Server-side permissions | Implemented and tested | `server/policy/scope.ts`; role × channel isolation in `scope.test.ts`, `childScope.test.ts`, `search.test.ts`, `reports.test.ts`, `notifications.test.ts`, `m7MutationControls.test.ts` (transfer revocation on every channel) |
| Uploads and downloads | Implemented and tested **with the development TEST scanner only** | `documents.test.ts`: type/extension/magic checks, macro-enabled and executable refusal, 25 MB limit, generated keys, scan-before-download, scoped re-check on every download, safe headers |
| **Production document storage and malware scanning** | **Unresolved — release blocker** | Only a local private directory and a TEST scanner exist (ADR 0006). In production the TEST scanner is refused at start-up; with `DOCUMENT_SCANNER=none` files are stored but never downloadable (verified, §4) |
| Exports | Implemented and tested | Queued, audited, requester-only, formula injection neutralized, delivery re-checks every exported record (`reports.test.ts`, `m7MutationControls.test.ts`) |
| Secrets | No secret in the repository or its history | §3 |
| Logging | Request data never logged | `describeForLog` for errors (SEC-032, `create.test.ts`); new request log records id, method, path **without query string**, status and duration only |
| Production exclusion of demo, reset, seed and mock auth | Verified in the build and in a running production-mode server | §4 |
| **Identity provider and MFA** | **Unresolved — decision for Penta** | §5 |
| Dependencies | Runtime: 2 moderate advisories remain, not reachable from user input (§2); tooling advisories deferred to a reviewed upgrade | `npm audit` |

## 2. Dependencies

`npm audit` at the start of M8 reported, for runtime packages, a **high**
advisory in `@remix-run/router` (open redirect → XSS, GHSA-2w69-qvjg-hvjx) and
moderate React Router advisories. **Fixed:** `react-router-dom` 6.30.2 →
6.30.6 (patch release). Also updated (patch/minor, build tooling): `postcss`
8.5.6 → 8.5.29, `@typescript-eslint/*` 8.47.0 → 8.71.1. All suites re-run
after the update.

Remaining:

| Package | Severity | Why it is accepted for the pilot | Action |
| --- | --- | --- | --- |
| `react-router` 6.x (GHSA-wrjc-x8rr-h8h6 backslash open redirect; GHSA-337j-9hxr-rhxg SSR hydration) | moderate | Fixed only in React Router 7. The SPA does no server rendering. The only non-literal navigation targets are paths built by the server from record ids (search results, notification links); no user-supplied URL reaches `<Link>` or `navigate` | Plan a React Router 7 upgrade; reviewer to confirm the reachability analysis |
| `vite` 5, `esbuild` (dev server) | high/moderate | Development server only; nothing from Vite's dev server ships. Production serves the static `dist/` build | Major upgrade (Vite 8) as separate work |
| `vitest` 3 / `tinypool` | critical (prototype pollution → RCE in worker options) | Test runner only; never installed on a server (`npm ci --omit=dev` for production) | Major upgrade (Vitest 5) as separate work |
| `tailwindcss` 3 → `braces`/`micromatch`/`chokidar`; `drizzle-kit` → `@esbuild-kit/*` | high/moderate | Build-time CSS and migration-generation tooling; not in the runtime | Major upgrades as separate work |

Production installs must use `npm ci --omit=dev`; the runtime then contains no
test or build tooling.

## 3. Secrets

- `.env` is ignored; `git ls-files` contains no `.env`, key or certificate file.
- A scan of every commit (`git log --all -p`) for password/secret assignments
  finds only synthetic test values (`ci_only_*`, `penta_local_*`, the
  documented synthetic seed password, test fixtures).
- Production refuses placeholder or short `SESSION_SECRET`/`CSRF_SECRET`
  (`operations.test.ts`, `check-demo-exclusion.ts`).
- New in M8: `BACKUP_ENCRYPTION_KEY` (backups refuse to run without it; empty
  in `.env.example`; must live in the secret store, never beside backups).
- Health and readiness probes return only `ok`/`unavailable`
  (`check:production-server` asserts no connection detail).

## 4. Production behaviour, verified on the compiled server

`npm run build:server && npm run check:production-server` starts
`dist-server/server/index.js` with `NODE_ENV=production` and checks (19/19
passed on 06 Oct 2026):

- refuses to start with `DOCUMENT_SCANNER=test`; starts with `none` and warns
  that documents stay unavailable;
- sends HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`;
  no `X-Powered-By`;
- cookies `Secure; SameSite=Strict`; no session cookie over plain HTTP;
- `POST /api/demo/reset`, `/api/dev/seed`, `/api/auth/switch-user`,
  `/api/auth/demo-login`, `/api/reset` do not exist;
- an unauthenticated commercial request is 401;
- `/api/health/ready` reports the database without exposing anything.

Build-time: `npm run build` runs the demo-exclusion check before and after
bundling (no demo flag, no demo routes, no seed accounts or synthetic emails in
`dist/`). A grep of the built bundle for `@example.com`, the seed password,
`resetDemo`, `switchUser` and `DemoApp` finds nothing.

**Storage and scanning, as they actually behave:** files are written to a
private local directory under generated UUID keys (never the user's file
name), with a per-file SHA-256; a download is streamed only through the
authorized endpoint, only when the revision's scan verdict is `clean`. The
only scanner is a development TEST scanner that detects the EICAR test string
and nothing else. **No production malware scanning exists.** A deployment
with `DOCUMENT_SCANNER=none` keeps every upload unavailable. Penta must choose
private object storage (with encryption at rest and backup) and a scanning
service before documents are enabled anywhere beyond development.

## 5. MFA and identity readiness (SEC-030, SEC-031)

- Current: local accounts, argon2id (19 MiB, t=2), 12-character minimum,
  invitation and reset links (256-bit, hashed, single use, expiring), per-IP
  sign-in rate limit (10 per 15 min) and a separate limit for link
  redemption.
- **MFA is not implemented.** SEC-031 requires MFA for privileged roles
  (administrator, management) "where the chosen identity service supports
  it". The preferred path is Penta's identity provider (SSO with MFA
  enforced there); the passport-based design accepts a second strategy
  (OIDC/SAML) without changing the session, revocation or policy layers.
  If Penta has no identity provider, TOTP for privileged roles must be built
  and reviewed before launch.
- Rate limiting is per IP and in memory: it resets on restart and is not
  shared between instances, and there is no per-account lockout. Acceptable
  for a single-instance pilot behind Penta's network; an identity provider or
  a shared store is needed for multiple instances.

## 6. For independent human security review (before production)

1. Penetration test of the deployed staging environment (authentication,
   session handling, CSRF, IDOR across roles, upload/download, export).
2. The identity decision: SSO/MFA integration, or a reviewed local MFA design.
3. The production storage and scanning integration (ADR 0006) once chosen.
4. TLS termination, reverse-proxy `trust proxy` setting, HSTS preload policy,
   and the static-site Content-Security-Policy (the SPA is served by the web
   server, which must set it; the API sets JSON-only headers).
5. The React Router reachability analysis in §2, and the tooling upgrades.
6. Secret management (session, CSRF and backup keys), rotation and access.
7. Log handling: retention, access, and confirmation that request logs and
   job errors carry no personal or commercial data in the deployed form.
8. Database hardening on the production host (network exposure, TLS to the
   database, superuser access, backup access controls).

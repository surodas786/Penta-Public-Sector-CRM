/**
 * Recovery from shadowed authentication cookies.
 *
 * The app only ever sets its session and CSRF cookies host-only on Path=/.
 * A browser can still hold a second cookie of the same name with a longer
 * Path or a Domain attribute — left by an older build, a proxy, or another
 * app on the same host (cookies ignore ports, so every localhost dev server
 * shares one jar). Browsers send the longer path first and, at equal length,
 * the older cookie first, and the cookie parser keeps only the first value.
 * The stale copy then wins on every request: express-session opens a fresh
 * session each time, so a CSRF token minted on one request is bound to a
 * session id the next request never presents, and sign-in fails with
 * invalid_csrf until the person clears site data by hand.
 */
import type { Request, Response } from 'express';

/** Every value the browser sent for `name`, in the order it sent them. */
export function cookieValues(req: Request, name: string): string[] {
  const header = req.headers.cookie;
  if (!header) return [];
  const values: string[] = [];
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0 || pair.slice(0, index).trim() !== name) continue;
    const raw = pair.slice(index + 1).trim().replace(/^"(.*)"$/, '$1');
    try {
      values.push(decodeURIComponent(raw));
    } catch {
      values.push(raw);
    }
  }
  return values;
}

/**
 * Expires every copy of `names` that could shadow ours on this request: each
 * ancestor of the request path below "/", and a Domain cookie for this host.
 * Unconditional, because a stale copy only becomes a duplicate once this very
 * response issues ours. Call only from a response that then re-issues both
 * cookies on Path=/, so a browser that treats the Domain variant as our own
 * cookie gets it back in the same response.
 */
export function expireShadowingCookies(req: Request, res: Response, names: readonly string[]): void {
  const segments = req.originalUrl.split('?')[0]!.split('/').filter(Boolean);
  const paths = segments.map((_segment, index) => `/${segments.slice(0, index + 1).join('/')}`);

  for (const name of names) {
    for (const path of paths) res.clearCookie(name, { path });
    res.clearCookie(name, { path: '/', domain: req.hostname });
  }
}

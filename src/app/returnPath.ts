/**
 * Where to go after signing in (CR2, step 6): the in-app page someone was
 * sent to, e.g. by an email link, or the role-aware landing route. Only a
 * path inside this application is accepted, never another site. The page
 * itself still asks the server, which checks the person's access afresh.
 */
export function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (typeof from !== 'string') return '/';
  if (!from.startsWith('/') || from.startsWith('//') || from.includes('\\')) return '/';
  if (from === '/sign-in' || from.startsWith('/sign-in?')) return '/';
  return from;
}

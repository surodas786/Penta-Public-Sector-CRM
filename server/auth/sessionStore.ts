/**
 * The PostgreSQL session store, with one change: a save may only *create* a
 * session row when the application has just created that session on purpose.
 *
 * connect-pg-simple saves with INSERT … ON CONFLICT DO UPDATE. A request that
 * loaded a session before sign-out (a page still loading when "Sign out" is
 * pressed) refreshes the idle window, so express-session saves it when that
 * request finishes — after the logout deleted the row. The upsert put the
 * row back and the person was still signed in (SEC-031: logout must revoke
 * the session). The same race could revive a session that a password change
 * or sign-in had just replaced with a new id.
 *
 * Sessions are created on purpose in exactly two places: the CSRF bootstrap
 * for an anonymous visitor, and `establishSession` at sign-in or password
 * change. Those mark the session with `insertOnSave`; every other save is an
 * UPDATE that changes nothing once the row is gone.
 */
import type connectPgSimple from 'connect-pg-simple';
import type session from 'express-session';
import type pg from 'pg';

export function createSessionStore(
  PgSessionStore: ReturnType<typeof connectPgSimple>,
  options: { pool: pg.Pool; pruneSessionInterval: number | false },
): session.Store {
  class GuardedSessionStore extends PgSessionStore {
    override set(sid: string, sess: session.SessionData, callback?: (error?: unknown) => void): void {
      if (sess.insertOnSave) {
        // Cleared on the stored copy and on the live session object, which
        // express-session passes here, so later saves are updates only.
        delete sess.insertOnSave;
        super.set(sid, sess, callback);
        return;
      }
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires) : null;
      const expireSeconds = Math.ceil((expires?.getTime() ?? Date.now() + 86_400_000) / 1000);
      options.pool
        .query('UPDATE "session" SET sess = $1, expire = to_timestamp($2) WHERE sid = $3', [sess, expireSeconds, sid])
        .then(
          () => callback?.(),
          (error: unknown) => callback?.(error),
        );
    }
  }

  return new GuardedSessionStore({
    pool: options.pool,
    tableName: 'session',
    // The runtime role has no DDL rights; migration 0001 owns this table.
    createTableIfMissing: false,
    pruneSessionInterval: options.pruneSessionInterval,
  });
}

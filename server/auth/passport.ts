/**
 * Authentication via passport + passport-local, with sessions provided by
 * express-session and stored in PostgreSQL by connect-pg-simple (plan 4.3).
 *
 * The session protocol — cookie issue, signing, regeneration on login, store
 * persistence and expiry — comes from those maintained libraries. What this
 * module adds is the Penta-specific part: argon2id verification, generic
 * failure messages, and the account lookup.
 */
import { eq } from 'drizzle-orm';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';

import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import { verifyAgainstDummy, verifyPassword } from './password.js';

/**
 * One message for every failure mode: unknown email, wrong password and
 * deactivated account are indistinguishable to the caller (SEC-030).
 */
export const GENERIC_LOGIN_FAILURE = 'Email address or password is incorrect.';

/** The configured passport instance. Each app gets its own, never the global. */
export type ConfiguredPassport = InstanceType<typeof passport.Passport>;

export function configurePassport(db: Database): ConfiguredPassport {
  const instance = new passport.Passport();

  instance.use(
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password', session: true },
      (email, password, done) => {
        void (async () => {
          try {
            const normalised = email.trim().toLowerCase();
            const [account] = await db
              .select({
                id: users.id,
                passwordHash: users.passwordHash,
                active: users.active,
              })
              .from(users)
              .where(eq(users.email, normalised))
              .limit(1);

            // An invited account with no password yet fails exactly like an
            // unknown one, after the same work, so timing reveals neither.
            if (!account || account.passwordHash === null) {
              // Spend the same work as a real verification so timing does not
              // reveal whether the address exists.
              await verifyAgainstDummy(password);
              done(null, false, { message: GENERIC_LOGIN_FAILURE });
              return;
            }

            const passwordMatches = await verifyPassword(account.passwordHash, password);
            if (!passwordMatches || !account.active) {
              done(null, false, { message: GENERIC_LOGIN_FAILURE });
              return;
            }

            done(null, { id: account.id });
          } catch (error) {
            done(error as Error);
          }
        })();
      },
    ),
  );

  // Only the account id lives in the session. Role, section and active state
  // are re-read from the database on every request.
  instance.serializeUser<string>((user, done) => {
    done(null, (user as Express.User).id);
  });

  instance.deserializeUser<string>((id, done) => {
    done(null, { id });
  });

  return instance;
}

/**
 * Authenticated account state for API mode.
 *
 * Holds only the current account. No commercial data is cached here — screens
 * fetch what they display, so signing out cannot leave another account's
 * records in memory (plan 4.2, 7.5).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { CurrentUserDto } from '../../shared/api.js';
import { ApiRequestError, onUnauthenticated, setCsrfToken } from '../api/client.js';
import { fetchCurrentUser, signIn as apiSignIn, signOut as apiSignOut } from '../api/endpoints.js';

interface AuthContextValue {
  user: CurrentUserDto | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Bumped whenever the account changes, so screens drop cached results. */
  sessionKey: number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUserDto | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [sessionKey, setSessionKey] = useState(0);

  const clearSession = useCallback(() => {
    setUser(null);
    setStatus('anonymous');
    setCsrfToken(null);
    // Forces every mounted screen to discard what it fetched for the old account.
    setSessionKey((key) => key + 1);
  }, []);

  // Restore an existing session on first load.
  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUser(controller.signal)
      .then((current) => {
        setUser(current);
        setStatus('authenticated');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setStatus('anonymous');
      });
    return () => controller.abort();
  }, []);

  // Any 401 anywhere ends the session exactly once.
  useEffect(
    () =>
      onUnauthenticated(() => {
        setUser((previous) => {
          if (previous) {
            toast.info('Your session has ended', {
              description: 'Sign in again to continue. Nothing you had already saved is affected.',
            });
          }
          return null;
        });
        clearSession();
      }),
    [clearSession],
  );

  const handleSignIn = useCallback(async (email: string, password: string) => {
    await apiSignIn(email, password);
    const current = await fetchCurrentUser();
    setUser(current);
    setStatus('authenticated');
    setSessionKey((key) => key + 1);
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await apiSignOut();
    } catch (error) {
      // A session that is already gone is still a successful sign-out locally.
      if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, signIn: handleSignIn, signOut: handleSignOut, sessionKey }),
    [user, status, handleSignIn, handleSignOut, sessionKey],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

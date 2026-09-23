import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as authApi from '../api/auth';
import {
  clearAccessToken,
  refreshSession,
  setAccessToken,
  setSessionEndedHandler,
} from '../api/client';
import type { CurrentUser } from '../api/types';
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext';

/**
 * Owns the session for the whole app.
 *
 * Two things make this more than a `useState`:
 *
 * 1. **Restoring a session on page load.** The access token is in memory, so a
 *    reload loses it. The `HttpOnly` refresh cookie survives, so the provider's
 *    first act is to spend it for a new access token. Until that answers, the
 *    status is `loading` and the guards wait.
 * 2. **Losing a session in the background.** A request can discover the refresh
 *    token has expired or been revoked long after the page loaded. `client.ts`
 *    reports that through `setSessionEndedHandler`, and the provider drops the
 *    user, which the guards turn into a redirect.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const endSession = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setStatus('anonymous');
  }, []);

  // Let the HTTP client tell us when a refresh proved the session is gone.
  useEffect(() => {
    setSessionEndedHandler(endSession);
    return () => setSessionEndedHandler(null);
  }, [endSession]);

  // Restore a session from the refresh cookie, once, on mount.
  useEffect(() => {
    let active = true;

    async function restore(): Promise<void> {
      // `refreshSession` is single-flight, so StrictMode's second invocation
      // in development joins the first request rather than presenting the
      // same cookie twice — which the API would read as token reuse and
      // answer by revoking every session the user has.
      const session = await refreshSession();
      if (!active) {
        return;
      }
      if (!session) {
        setStatus('anonymous');
        return;
      }

      try {
        const { user: me } = await authApi.fetchMe();
        if (!active) {
          return;
        }
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (active) {
          endSession();
        }
      }
    }

    void restore();
    return () => {
      active = false;
    };
  }, [endSession]);

  const signIn = useCallback(async (email: string, password: string): Promise<CurrentUser> => {
    const session = await authApi.login({ email, password });
    setAccessToken(session.access_token);

    // Login returns a plain `UserRead`; the navigation needs the engineer
    // profile, so the session is only complete after `/auth/me`.
    const { user: me } = await authApi.fetchMe();
    setUser(me);
    setStatus('authenticated');
    return me;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch {
      // Revoking the refresh token server-side is best effort. An offline
      // browser or an already-expired session must still end here, and the
      // API takes the same view: logging out is never an error.
    } finally {
      endSession();
    }
  }, [endSession]);

  const changeOwnPassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      await authApi.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      // The API revoked every refresh token and cleared the cookie, so the
      // token in memory is the last thing left to drop.
      endSession();
    },
    [endSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, signIn, signOut, changeOwnPassword }),
    [user, status, signIn, signOut, changeOwnPassword],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

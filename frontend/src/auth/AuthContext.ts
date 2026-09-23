import { createContext, use } from 'react';

import type { CurrentUser } from '../api/types';

/**
 * The signed-in session, as the rest of the app sees it.
 *
 * Separate from `AuthProvider.tsx` on purpose: a module that exports both a
 * component and a hook defeats React Fast Refresh, and the guards and the
 * layout want the hook without pulling in the provider.
 */

/**
 * Where the session is in its lifecycle.
 *
 * `loading` is not a detail to gloss over: on every page load the app asks the
 * API whether the refresh cookie is still good, and until that answers, "no
 * user" and "not signed in" are different things. A guard that treated them
 * the same would bounce a signed-in user to the login screen on every refresh.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  /** The signed-in user, or null while loading or signed out. */
  user: CurrentUser | null;
  status: AuthStatus;
  /** Sign in and load the caller's full record. Throws on bad credentials. */
  signIn: (email: string, password: string) => Promise<CurrentUser>;
  /** Revoke the session server-side and forget it here. */
  signOut: () => Promise<void>;
  /**
   * Change the caller's own password.
   *
   * The API revokes every session in the act, so this ends the local one too
   * and the caller signs in again.
   */
  changeOwnPassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Read the session. Throws if used outside `AuthProvider`. */
export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return value;
}

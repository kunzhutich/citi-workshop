import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { FullPageProgress } from '../components/FullPageProgress';
import { paths } from '../routes';
import { useAuth } from './AuthContext';

/**
 * Gate for everything that needs a signed-in user.
 *
 * It enforces two rules in the order the API does:
 *
 * 1. No session → the login screen, remembering where the user was headed.
 * 2. `must_change_password` → the change-password screen, and nowhere else.
 *
 * The second is the frontend's half of the API's password-change gate: every
 * endpoint outside `/auth` answers 403 `PASSWORD_CHANGE_REQUIRED` while the
 * flag is set. Reading the flag from `/auth/me` rather than waiting to be
 * refused means the user meets a form instead of an error.
 */
export function RequireAuth({ skipPasswordGate = false }: { skipPasswordGate?: boolean }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageProgress label="Restoring your session…" />;
  }

  if (status === 'anonymous' || !user) {
    // `state.from` is what sends the user back to the page they asked for
    // once they have signed in.
    return <Navigate to={paths.login} state={{ from: location }} replace />;
  }

  if (user.must_change_password && !skipPasswordGate) {
    return <Navigate to={paths.changePassword} replace />;
  }

  return <Outlet />;
}

import { useAuth } from '../../auth/AuthContext';
import { FullPageProgress } from '../../components/FullPageProgress';
import { AdminDashboardPage } from '../dashboard/AdminDashboardPage';
import { EmployeeHomePage } from './EmployeeHomePage';
import { EngineerHomePage } from './EngineerHomePage';

/**
 * The `/` route, which is a different screen for each persona.
 *
 * One route rather than three redirects: "home" means the same thing to every
 * user — the page they land on — and a URL that changes with the role would
 * break a bookmark the day someone is promoted.
 *
 * M5 wired this to three placeholders so the shell was demoable; M7 replaces
 * each branch with the real screen. The branch is the only role check here:
 * each page is handed a `CurrentUser` that is definitely present, so none of
 * them has to render an optional user.
 */
export function HomePage() {
  const { user } = useAuth();

  // `RequireAuth` guarantees a session before this route renders, so this is
  // the narrowing TypeScript needs rather than a state a user can reach.
  if (!user) {
    return <FullPageProgress />;
  }

  if (user.role === 'FACILITY_ADMIN') {
    return <AdminDashboardPage />;
  }

  if (user.role === 'ENGINEER') {
    return <EngineerHomePage user={user} />;
  }

  return <EmployeeHomePage user={user} />;
}

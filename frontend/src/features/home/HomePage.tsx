import { useAuth } from '../../auth/AuthContext';
import { ComingSoonPage } from '../placeholder/ComingSoonPage';

/**
 * The `/` route, which is a different screen for each persona.
 *
 * One route rather than three redirects: "home" means the same thing to every
 * user — the page they land on — and a URL that changes with the role would
 * break a bookmark the day someone is promoted.
 *
 * M5 ships the shell; M6 and M7 replace each branch with the real page.
 */
export function HomePage() {
  const { user } = useAuth();

  if (user?.role === 'FACILITY_ADMIN') {
    return (
      <ComingSoonPage
        title="Dashboard"
        description="Open, unassigned, blocked and escalated counts, the tickets needing attention, and charts by status, priority, category and building."
        phase="M7"
      />
    );
  }

  if (user?.role === 'ENGINEER') {
    return (
      <ComingSoonPage
        title="Your work"
        description="Your assigned, in-progress and blocked tickets, and — for senior and lead engineers — unassigned tickets in your specialties, ready to pick up."
        phase="M7"
      />
    );
  }

  return (
    <ComingSoonPage
      title="Home"
      description="Your ticket counts, anything waiting for you to confirm as fixed, and your recent reports."
      phase="M7"
    />
  );
}

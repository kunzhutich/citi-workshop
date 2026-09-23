import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

import type { EngineerLevel, UserRole } from '../api/types';
import { NotPermittedPage } from '../features/placeholder/NotPermittedPage';
import { useAuth } from './AuthContext';

export interface RequireRoleProps {
  /** Roles admitted to these routes. */
  roles: UserRole[];
  /**
   * Engineer levels admitted, when a role alone is not the rule.
   *
   * Only meaningful alongside `ENGINEER`. Facility admins are never filtered
   * by level — they can do anything an engineer can, which is the same rule
   * `require_engineer_levels` applies on the API side.
   */
  levels?: EngineerLevel[];
  children?: ReactNode;
}

/**
 * Gate a route on role, and optionally on engineer level.
 *
 * Refusal renders an explanation rather than redirecting. A bookmarked or
 * shared URL that the current account may not open should say so; silently
 * landing somewhere else looks like a bug.
 *
 * This is a **convenience**, not the enforcement. The API refuses the same
 * requests with 403 whatever the browser renders.
 */
export function RequireRole({ roles, levels, children }: RequireRoleProps) {
  const { user } = useAuth();

  if (!user || !isPermitted(user.role, user.engineer_profile?.level, roles, levels)) {
    return <NotPermittedPage />;
  }

  return children ?? <Outlet />;
}

/** Decide whether this role and level may open the route. */
function isPermitted(
  role: UserRole,
  level: EngineerLevel | undefined,
  roles: UserRole[],
  levels: EngineerLevel[] | undefined,
): boolean {
  if (!roles.includes(role)) {
    return false;
  }
  if (!levels || role !== 'ENGINEER') {
    return true;
  }
  return level !== undefined && levels.includes(level);
}

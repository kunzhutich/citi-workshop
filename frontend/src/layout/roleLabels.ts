import type { CurrentUser, EngineerLevel, UserRole } from '../api/types';

/**
 * Plain-language names for the API's role and level enums.
 *
 * Users never see `FACILITY_ADMIN`. Keeping the mapping in one module means a
 * wording change lands everywhere at once.
 */
const ROLE_LABELS: Record<UserRole, string> = {
  EMPLOYEE: 'Employee',
  ENGINEER: 'Engineer',
  FACILITY_ADMIN: 'Facility admin',
};

const LEVEL_LABELS: Record<EngineerLevel, string> = {
  JUNIOR: 'Junior',
  SENIOR: 'Senior',
  LEAD: 'Lead',
};

/** Human-readable role name. */
export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

/** Human-readable engineer level. */
export function levelLabel(level: EngineerLevel): string {
  return LEVEL_LABELS[level];
}

/** Describe a user's role, including their level when they are an engineer. */
export function describeRole(user: CurrentUser): string {
  const level = user.engineer_profile?.level;
  if (user.role === 'ENGINEER' && level) {
    return `${levelLabel(level)} engineer`;
  }
  return roleLabel(user.role);
}

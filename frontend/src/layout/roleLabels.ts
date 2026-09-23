import type { CurrentUser, EngineerLevel, UserRole } from '../api/types';

/**
 * How a user is presented to other humans: role wording, and initials.
 *
 * Users never see `FACILITY_ADMIN`. Keeping the mapping in one module means a
 * wording change lands everywhere at once — and both places that draw an
 * avatar, the desktop top bar and the mobile drawer, abbreviate a name the
 * same way.
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

/** Build up to two initials from a full name, for an avatar. */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

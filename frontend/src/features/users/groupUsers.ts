import type { EngineerLevel, User } from '../../api/types';

/**
 * The order the Users page shows accounts in — §5.1 of the redesign brief:
 * admins, then engineers LEAD → SENIOR → JUNIOR, then employees.
 *
 * A pure function with the levels passed in, rather than a sort buried in the
 * page, because the ordering *is* the feature and it is the part worth a test.
 *
 * **Why levels arrive as an argument.** The users endpoint returns `User`,
 * which has a role and no level — an engineer's level lives on
 * `engineer_profiles`, a different table behind a different endpoint. The page
 * reads both and joins them here. Adding `level` to the users response would
 * be the tidier API and a wider change than this screen justifies; when
 * somebody makes it, this function keeps its shape and loses its second
 * argument.
 */

/** Sections in the order they are shown. */
export const USER_GROUPS = [
  { key: 'admins', heading: 'Facility admins' },
  { key: 'lead', heading: 'Engineers · Lead' },
  { key: 'senior', heading: 'Engineers · Senior' },
  { key: 'junior', heading: 'Engineers · Junior' },
  { key: 'employees', heading: 'Employees' },
] as const;

export type UserGroupKey = (typeof USER_GROUPS)[number]['key'];

export interface UserGroup {
  key: UserGroupKey;
  heading: string;
  users: User[];
}

const LEVEL_GROUP: Record<EngineerLevel, UserGroupKey> = {
  LEAD: 'lead',
  SENIOR: 'senior',
  JUNIOR: 'junior',
};

/**
 * Split accounts into the five sections, each sorted by name.
 *
 * Empty sections are dropped rather than shown empty: a heading with nothing
 * under it reads as something failing to load, and on a filtered list most of
 * them would be empty most of the time.
 *
 * An engineer whose level has not arrived yet — the roster is a second request
 * and may still be in flight — is grouped as JUNIOR rather than vanishing.
 * Being briefly in the wrong section is recoverable; being in no section at
 * all is a missing account.
 */
export function groupUsers(users: User[], levels: Map<string, EngineerLevel>): UserGroup[] {
  const buckets = new Map<UserGroupKey, User[]>(USER_GROUPS.map((group) => [group.key, []]));

  for (const user of users) {
    buckets.get(groupFor(user, levels))?.push(user);
  }

  return USER_GROUPS.map((group) => ({
    key: group.key,
    heading: group.heading,
    users: (buckets.get(group.key) ?? []).sort((left, right) =>
      left.full_name.localeCompare(right.full_name),
    ),
  })).filter((group) => group.users.length > 0);
}

function groupFor(user: User, levels: Map<string, EngineerLevel>): UserGroupKey {
  if (user.role === 'FACILITY_ADMIN') {
    return 'admins';
  }
  if (user.role === 'ENGINEER') {
    return LEVEL_GROUP[levels.get(user.id) ?? 'JUNIOR'];
  }
  return 'employees';
}

import { describe, expect, it } from 'vitest';

import type { EngineerLevel, User } from '../../api/types';
import { groupUsers } from './groupUsers';

/**
 * The order §5.1 asks for: admins, engineers LEAD → SENIOR → JUNIOR, then
 * employees. The ordering is the feature, so it is asserted rather than
 * described.
 */

function user(id: string, full_name: string, role: User['role']): User {
  return {
    id,
    full_name,
    email: `${id}@acme.inc`,
    role,
    is_active: true,
    must_change_password: false,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const levels = new Map<string, EngineerLevel>([
  ['e1', 'JUNIOR'],
  ['e2', 'LEAD'],
  ['e3', 'SENIOR'],
]);

describe('groupUsers', () => {
  it('puts admins first, then engineers by level, then employees', () => {
    const groups = groupUsers(
      [
        user('p1', 'Zoe Employee', 'EMPLOYEE'),
        user('e1', 'Junior Jo', 'ENGINEER'),
        user('a1', 'Ada Admin', 'FACILITY_ADMIN'),
        user('e2', 'Lead Lee', 'ENGINEER'),
        user('e3', 'Senior Sam', 'ENGINEER'),
      ],
      levels,
    );

    expect(groups.map((group) => group.key)).toEqual([
      'admins',
      'lead',
      'senior',
      'junior',
      'employees',
    ]);
  });

  it('sorts each section by name', () => {
    const groups = groupUsers(
      [
        user('p2', 'Bo Second', 'EMPLOYEE'),
        user('p1', 'Al First', 'EMPLOYEE'),
        user('p3', 'Cy Third', 'EMPLOYEE'),
      ],
      levels,
    );

    expect(groups[0].users.map((row) => row.full_name)).toEqual([
      'Al First',
      'Bo Second',
      'Cy Third',
    ]);
  });

  it('drops empty sections rather than showing a heading over nothing', () => {
    // A heading with no rows under it reads as something that failed to load,
    // and on a filtered list most sections are empty most of the time.
    const groups = groupUsers([user('a1', 'Ada Admin', 'FACILITY_ADMIN')], levels);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('admins');
  });

  it('keeps an engineer whose level has not arrived yet', () => {
    // The roster is a second request. Being briefly in the wrong section is
    // recoverable; being in no section at all is a missing account.
    const groups = groupUsers([user('e9', 'Unknown Level', 'ENGINEER')], new Map());

    expect(groups.map((group) => group.key)).toEqual(['junior']);
    expect(groups[0].users).toHaveLength(1);
  });
});

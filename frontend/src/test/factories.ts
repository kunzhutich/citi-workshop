import type { CurrentUser, EngineerLevel, UserRole } from '../api/types';

/**
 * Builders for the API shapes tests need.
 *
 * A test that only cares about a role should not have to spell out eight
 * unrelated fields, and the day `CurrentUser` grows one, only this file
 * changes.
 */

export interface UserOverrides {
  role?: UserRole;
  level?: EngineerLevel;
  must_change_password?: boolean;
  full_name?: string;
  email?: string;
}

/** Build a `CurrentUser`, engineer profile included when a level is given. */
export function makeUser({
  role = 'EMPLOYEE',
  level,
  must_change_password = false,
  full_name = 'Jordan Lee',
  email = 'jordan.lee@acme.inc',
}: UserOverrides = {}): CurrentUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email,
    full_name,
    role,
    is_active: true,
    must_change_password,
    last_login_at: null,
    created_at: '2026-01-01T09:00:00Z',
    last_building_id: null,
    last_floor_id: null,
    last_seat_id: null,
    engineer_profile:
      level === undefined
        ? null
        : {
            level,
            specialty_group_ids: [],
            home_building_id: null,
            phone: null,
            availability: 'AVAILABLE',
            max_active_tickets: 10,
          },
  };
}

/** Build an engineer of the given level. */
export function makeEngineer(level: EngineerLevel, overrides: UserOverrides = {}): CurrentUser {
  return makeUser({ role: 'ENGINEER', level, ...overrides });
}

/** Build a facility admin. */
export function makeAdmin(overrides: UserOverrides = {}): CurrentUser {
  return makeUser({ role: 'FACILITY_ADMIN', full_name: 'Henry Admin', ...overrides });
}

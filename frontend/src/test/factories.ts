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

/**
 * Builders for the incident shapes M6's screens render.
 *
 * `makeIncident` returns a ticket whose `can_*` flags are all false, because
 * that is what the API says for most viewers of most tickets — a test that
 * wants a permission turns exactly that one on, and the reader can see which
 * flag the behaviour under test depends on.
 */

import type {
  AllowedTransition,
  Engineer,
  Incident,
  IncidentListItem,
  IncidentPriority,
  IncidentStatus,
  LiveSuggestion,
  ResolvedSuggestion,
  SuggestionMatch,
} from '../api/types';

/** Build a list row. */
export function makeIncidentListItem(
  overrides: Partial<IncidentListItem> = {},
): IncidentListItem {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    ticket_number: 42,
    reference: 'INC-000042',
    title: 'Monitor flickers every few minutes',
    status: 'OPEN',
    priority: 'MEDIUM',
    is_escalated: false,
    category: {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Monitor',
      group_id: '44444444-4444-4444-8444-444444444444',
      group_name: 'Hardware',
      location_detail: 'FLOOR',
      // A monitor is one person's, so the default row takes no watchers.
      // Overridden by the tests that are about that.
      allows_watchers: false,
    },
    location: {
      building_id: '55555555-5555-4555-8555-555555555555',
      building_name: 'San Francisco HQ',
      building_code: 'SFO-1',
      floor_id: '66666666-6666-4666-8666-666666666666',
      floor_name: 'Level 3',
      seat_id: null,
      seat_code: null,
      seat_type: null,
      path: 'SFO-1 › Level 3',
    },
    reporter: {
      id: '11111111-1111-4111-8111-111111111111',
      full_name: 'Jordan Lee',
      email: 'jordan.lee@acme.inc',
      role: 'EMPLOYEE',
    },
    assignee: null,
    reopen_count: 0,
    created_at: '2026-06-15T09:00:00Z',
    updated_at: '2026-06-15T09:00:00Z',
    ...overrides,
  };
}

/** Build a full ticket. Every `can_*` starts false; switch on what you need. */
export function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    ...makeIncidentListItem(),
    description: 'It blanks for a second every few minutes and comes back.',
    escalation_reason: null,
    escalated_at: null,
    escalated_by: null,
    blocked_reason_type: null,
    blocked_reason: null,
    resolution_summary: null,
    close_reason: null,
    duplicate_of_id: null,
    duplicate_of_reference: null,
    assigned_at: null,
    acknowledged_at: null,
    resolved_at: null,
    closed_at: null,
    can_edit: false,
    can_change_priority: false,
    can_escalate: false,
    can_clear_escalation: false,
    can_assign: false,
    can_add_note: false,
    can_add_internal_note: false,
    can_give_feedback: false,
    is_watching: false,
    watcher_count: 0,
    ...overrides,
  };
}

/**
 * Build a live suggestion — an open ticket that might be the same problem.
 *
 * `match` leads the argument list because it is the field these tests are
 * about: everything else is an ordinary list row, and what a suggestion adds
 * is the claim about how close it is to where the reporter said they are.
 */
export function makeLiveSuggestion(
  match: SuggestionMatch,
  overrides: Partial<LiveSuggestion> = {},
): LiveSuggestion {
  return { ...makeIncidentListItem(), match, ...overrides };
}

/** Build a resolved suggestion. Its summary is the reason it is shown. */
export function makeResolvedSuggestion(
  match: SuggestionMatch,
  overrides: Partial<ResolvedSuggestion> = {},
): ResolvedSuggestion {
  const listItem = makeIncidentListItem();
  return {
    id: '88888888-8888-4888-8888-888888888888',
    reference: 'INC-000007',
    title: 'Monitor kept blanking on this floor',
    resolution_summary: 'Replaced the HDMI cable at the desk. Spares are in the 3rd floor store.',
    resolved_at: '2026-06-01T09:00:00Z',
    location: listItem.location,
    match,
    ...overrides,
  };
}

/** Build one entry of `GET /incidents/{id}/allowed-transitions`. */
export function makeTransition(
  toStatus: IncidentStatus,
  actionLabel: string,
  overrides: Partial<AllowedTransition> = {},
): AllowedTransition {
  return {
    to_status: toStatus,
    action_label: actionLabel,
    required_fields: [],
    close_reason_choices: [],
    ...overrides,
  };
}

/** Build an engineer row, as `GET /engineers` returns it. */
export function makeEngineerRow(overrides: Partial<Engineer> = {}): Engineer {
  return {
    user_id: '77777777-7777-4777-8777-777777777777',
    email: 'sam.senior@acme.inc',
    full_name: 'Sam Senior',
    is_active: true,
    level: 'SENIOR',
    specialty_group_ids: [],
    home_building_id: null,
    phone: null,
    availability: 'AVAILABLE',
    max_active_tickets: 10,
    active_ticket_count: 0,
    ...overrides,
  };
}

/** A priority, for a test that only cares that it differs from the default. */
export const OTHER_PRIORITY: IncidentPriority = 'CRITICAL';

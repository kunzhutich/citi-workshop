/**
 * Types mirroring the API's Pydantic schemas.
 *
 * These are hand-written rather than generated: the surface is small, and a
 * hand-written type can carry the same doc comments the Python schema does.
 * When a schema in `backend/v1/app/schemas/` changes, change its twin here.
 */

/** `app.models.enums.UserRole`. */
export type UserRole = 'EMPLOYEE' | 'ENGINEER' | 'FACILITY_ADMIN';

/** `app.models.enums.EngineerLevel`. Governs assignment rights. */
export type EngineerLevel = 'JUNIOR' | 'SENIOR' | 'LEAD';

/** `app.models.enums.AvailabilityStatus`. */
export type AvailabilityStatus = 'AVAILABLE' | 'BUSY' | 'OFF_DUTY' | 'ON_LEAVE';

/** Mirrors `EngineerProfileRead`. Present only on ENGINEER users. */
export interface EngineerProfile {
  level: EngineerLevel;
  specialty_group_ids: string[];
  home_building_id: string | null;
  phone: string | null;
  availability: AvailabilityStatus;
  max_active_tickets: number;
}

/** Mirrors `UserRead`. Never carries the password hash. */
export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  /** While true, every endpoint outside `/auth` answers 403. */
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

/**
 * Mirrors `CurrentUserRead` — the caller's own record, profile included.
 *
 * The `last_*_id` fields are where this user reported their previous problem.
 * The report questionnaire pre-fills them, which is why they are on the
 * caller's own record and not on `User`: it is only ever a question about
 * yourself.
 */
export interface CurrentUser extends User {
  engineer_profile: EngineerProfile | null;
  last_building_id: string | null;
  last_floor_id: string | null;
  last_seat_id: string | null;
}

/**
 * Mirrors `TokenResponse`, returned by login and refresh.
 *
 * The refresh token is deliberately absent from the body: it travels only in
 * the `HttpOnly` cookie, so no JavaScript on the page can read it.
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

/** Mirrors `MeResponse`. */
export interface MeResponse {
  user: CurrentUser;
}

/** Mirrors `RegisterResponse`. Registration issues no tokens. */
export interface RegisterResponse {
  user: User;
}

/** Mirrors `MessageResponse`. */
export interface MessageResponse {
  detail: string;
}

// --- Domain enums ------------------------------------------------------------

/** `app.models.enums.IncidentStatus`. */
export type IncidentStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'RESOLVED' | 'CLOSED';

/** `app.models.enums.IncidentPriority`, least to most urgent. */
export type IncidentPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** `app.models.enums.BlockedReasonType`. */
export type BlockedReasonType =
  | 'WAITING_ON_PARTS'
  | 'WAITING_ON_EMPLOYEE'
  | 'WAITING_ON_VENDOR'
  | 'ACCESS_REQUIRED'
  | 'OTHER';

/** `app.models.enums.CloseReason`. */
export type CloseReason =
  | 'CONFIRMED_FIXED'
  | 'CLOSED_BY_ENGINEER'
  | 'DUPLICATE'
  | 'INVALID'
  | 'CANCELLED_BY_REPORTER'
  | 'ADMIN_CLOSED';

/** `app.models.enums.NoteVisibility`. INTERNAL never reaches an employee. */
export type NoteVisibility = 'PUBLIC' | 'INTERNAL';

/** `app.models.enums.SeatType`. */
export type SeatType = 'DESK' | 'MEETING_ROOM' | 'COMMON_AREA' | 'OTHER';

/** `app.models.enums.LocationDetail` — how precise a location a group needs. */
export type LocationDetail = 'BUILDING' | 'FLOOR' | 'SEAT';

/** `app.models.enums.EventType` — the kinds of audit-log entry. */
export type EventType =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'ASSIGNED'
  | 'UNASSIGNED'
  | 'PRIORITY_CHANGED'
  | 'ESCALATED'
  | 'ESCALATION_CLEARED'
  | 'NOTE_ADDED'
  | 'MARKED_DUPLICATE'
  | 'REOPENED';

// --- Shared envelopes --------------------------------------------------------

/**
 * Mirrors `Page[T]` from `app/schemas/common.py`.
 *
 * `total` counts every matching row rather than the rows in `items`, which is
 * what lets a list render "25 of 312" without a second request.
 */
export interface Page<ItemT> {
  items: ItemT[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Mirrors `DeleteResult`.
 *
 * A referenced row is deactivated rather than removed, so the caller is told
 * which of the two happened instead of inferring it from a status code.
 */
export interface DeleteResult {
  id: string;
  deleted: boolean;
  deactivated: boolean;
  detail: string;
}

// --- Incidents ---------------------------------------------------------------

/** Mirrors `UserSummary` — enough of a user to name them on a ticket. */
export interface UserSummary {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
}

/** Mirrors `CategorySummary` — a subcategory together with its group. */
export interface CategorySummary {
  id: string;
  name: string;
  group_id: string | null;
  group_name: string | null;
  location_detail: LocationDetail;
}

/** Mirrors `LocationSummary` — where a ticket was reported, names resolved. */
export interface LocationSummary {
  building_id: string;
  building_name: string;
  building_code: string;
  floor_id: string | null;
  floor_name: string | null;
  seat_id: string | null;
  seat_code: string | null;
  seat_type: SeatType | null;
  /** Rendered path, for example `SFO-1 › Level 3 › 3-A-01`. */
  path: string;
}

/** Mirrors `IncidentListItem` — one ticket as a list row. */
export interface IncidentListItem {
  id: string;
  ticket_number: number;
  /** Display form of the ticket number, for example `INC-000123`. */
  reference: string;
  title: string;
  status: IncidentStatus;
  priority: IncidentPriority;
  is_escalated: boolean;
  category: CategorySummary;
  location: LocationSummary;
  reporter: UserSummary;
  assignee: UserSummary | null;
  reopen_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Mirrors `IncidentRead` — one ticket in full.
 *
 * The `can_*` flags cover every action that is **not** a status change. Status
 * changes come from `GET /incidents/{id}/allowed-transitions`, which is the
 * only thing the UI may build workflow buttons from.
 */
export interface Incident extends IncidentListItem {
  description: string;
  escalation_reason: string | null;
  escalated_at: string | null;
  escalated_by: UserSummary | null;
  blocked_reason_type: BlockedReasonType | null;
  blocked_reason: string | null;
  resolution_summary: string | null;
  close_reason: CloseReason | null;
  duplicate_of_id: string | null;
  duplicate_of_reference: string | null;
  assigned_at: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;

  can_edit: boolean;
  can_change_priority: boolean;
  can_escalate: boolean;
  can_clear_escalation: boolean;
  can_assign: boolean;
  can_add_note: boolean;
  can_add_internal_note: boolean;
}

/**
 * Mirrors `AllowedTransitionRead`.
 *
 * `action_label` is the button text and `required_fields` names exactly the
 * inputs the dialog must collect — the workflow is never restated in the UI.
 */
export interface AllowedTransition {
  to_status: IncidentStatus;
  action_label: string;
  required_fields: string[];
  close_reason_choices: CloseReason[];
}

/** Mirrors `AssignResult` — the new state plus any advisory warnings. */
export interface AssignResult {
  incident: Incident;
  warnings: string[];
}

/** Mirrors `ActivityEntry` — one entry of the merged timeline. */
export interface ActivityEntry {
  kind: 'event' | 'note';
  id: string;
  created_at: string;
  actor: UserSummary | null;

  event_type: EventType | null;
  from_value: string | null;
  to_value: string | null;
  reason: string | null;

  body: string | null;
  visibility: NoteVisibility | null;
  edited_at: string | null;
}

/** Mirrors `NoteRead`. */
export interface Note {
  id: string;
  incident_id: string;
  author: UserSummary;
  body: string;
  visibility: NoteVisibility;
  created_at: string;
  edited_at: string | null;
  can_edit: boolean;
}

// --- Categories --------------------------------------------------------------

/** Mirrors `CategoryRead` — a group or a subcategory, without children. */
export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  hint: string | null;
  /** Material UI icon name, for example `Computer`. Groups only. */
  icon: string | null;
  location_detail: LocationDetail;
  sort_order: number;
  is_active: boolean;
}

/** Mirrors `CategoryNode` — a group carrying its subcategories. */
export interface CategoryNode extends Category {
  children: Category[];
}

/** Mirrors `CategoryTree`. */
export interface CategoryTree {
  groups: CategoryNode[];
}

// --- Facilities --------------------------------------------------------------

/** Mirrors `BuildingRead`. */
export interface Building {
  id: string;
  name: string;
  code: string;
  address: string | null;
  is_active: boolean;
}

/** Mirrors `FloorRead`. */
export interface Floor {
  id: string;
  building_id: string;
  name: string;
  level_number: number;
  is_active: boolean;
}

/** Mirrors `SeatRead`. */
export interface Seat {
  id: string;
  floor_id: string;
  code: string;
  seat_type: SeatType;
  is_active: boolean;
}

/** Mirrors `FloorNode` — a floor inside the facility tree. */
export interface FloorNode extends Floor {
  seats: Seat[];
}

/** Mirrors `BuildingNode` — a building inside the facility tree. */
export interface BuildingNode extends Building {
  floors: FloorNode[];
}

/** Mirrors `FacilityTree` — the whole hierarchy in one response. */
export interface FacilityTree {
  buildings: BuildingNode[];
}

/** Mirrors `SeatBulkResult` — a partial success is the normal outcome. */
export interface SeatBulkResult {
  created: Seat[];
  skipped_codes: string[];
  created_count: number;
  skipped_count: number;
}

// --- Engineers ---------------------------------------------------------------

/** Mirrors `EngineerRead` — the profile flattened onto its user. */
export interface Engineer {
  user_id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  level: EngineerLevel;
  specialty_group_ids: string[];
  home_building_id: string | null;
  phone: string | null;
  availability: AvailabilityStatus;
  max_active_tickets: number;
  /** Assigned tickets in OPEN, IN_PROGRESS or BLOCKED. */
  active_ticket_count: number;
}

/** Mirrors `EngineerCreated` — carries the one-time temporary password. */
export interface EngineerCreated {
  engineer: Engineer;
  temporary_password: string;
}

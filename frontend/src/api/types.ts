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
  | 'ADMIN_CLOSED'
  | 'SYSTEM_CLOSED';

/** `app.models.enums.NoteVisibility`. INTERNAL never reaches an employee. */
export type NoteVisibility = 'PUBLIC' | 'INTERNAL';

/**
 * `app.models.enums.NotificationType`.
 *
 * Deliberately narrower than `EventType`: not everything worth recording in an
 * audit log is worth interrupting somebody with. Which capacity hears about
 * each is decided by `backend/v1/app/notifications.py`, never here.
 */
export type NotificationType =
  | 'STATUS_CHANGED'
  | 'ASSIGNED'
  | 'NOTE_ADDED'
  | 'ESCALATION_CLEARED'
  | 'WATCHED_RESOLVED'
  | 'FEEDBACK_RECEIVED';

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
  /**
   * Whether other people may subscribe to this ticket.
   *
   * The same flag as `Category.allows_watchers`, sent on the ticket so that a
   * screen holding one does not have to find its subcategory in the category
   * tree. That matters for more than convenience: the tree excludes
   * deactivated categories (`repositories/categories.py::load_tree`), so a
   * ticket filed against one that has since been retired is not in it — and a
   * lookup would answer "no watchers" for a ticket somebody may already be
   * watching.
   */
  allows_watchers: boolean;
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
  /**
   * Whether the caller may rate the current repair.
   *
   * The reporter only, once the work is resolved, within fourteen days of it,
   * and not twice for the same repair. All four parts are decided by
   * `backend/v1/app/services/feedback.py`; this flag is the whole of what the
   * button knows.
   */
  can_give_feedback: boolean;

  /** Whether the caller has subscribed to this ticket. */
  is_watching: boolean;
  /** How many people have said they are affected. Not the reporter, unless they said so too. */
  watcher_count: number;
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
  kind: 'event' | 'note' | 'feedback';
  id: string;
  created_at: string;
  actor: UserSummary | null;

  event_type: EventType | null;
  from_value: string | null;
  to_value: string | null;
  /**
   * Human-readable forms of the two values above, when they are ids.
   *
   * An ASSIGNED event records the assignee's id, which is right for an audit
   * row and unreadable on a screen. The API resolves the name; the raw value
   * stays alongside it.
   */
  from_label: string | null;
  to_label: string | null;
  reason: string | null;

  body: string | null;
  visibility: NoteVisibility | null;

  /** Set on `feedback` entries. 1 to 5, low to high. */
  rating: number | null;
  comment: string | null;
  /** The engineer the rating is about, who may not be the assignee now. */
  rated_user: UserSummary | null;
  /** Which repair it rates: 1 for the first, 2 after one reopen. */
  resolution_round: number | null;
  /** Whether the caller may still change this rating. Null on other kinds. */
  can_edit: boolean | null;

  /** Set on `note` and `feedback` entries alike. */
  edited_at: string | null;
}

/** Mirrors `FeedbackRead` — one rating of one repair. */
export interface Feedback {
  id: string;
  incident_id: string;
  author: UserSummary;
  rated_user: UserSummary;
  resolution_round: number;
  rating: number;
  comment: string;
  created_at: string;
  edited_at: string | null;
  can_edit: boolean;
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

// --- Suggestions and watchers ------------------------------------------------

/**
 * How close a suggestion's location is to the one being reported.
 *
 * The one field that keeps two different claims apart. "Someone reported this
 * exact desk an hour ago" and "something of this kind happened somewhere in
 * this building last week" are not the same statement, and a list that merges
 * them makes the strong one worthless. The API ranks by this and then by
 * recency; the panel says which band each card is in.
 */
export type SuggestionMatch = 'SEAT' | 'FLOOR' | 'BUILDING';

/** Mirrors `LiveSuggestion` — an open ticket that may be the same problem. */
export interface LiveSuggestion extends IncidentListItem {
  match: SuggestionMatch;
}

/**
 * Mirrors `ResolvedSuggestion` — a ticket already fixed, and what fixed it.
 *
 * Not an `IncidentListItem`: this list exists for `resolution_summary`, and
 * the status, priority and assignee of something already closed are noise on
 * a card whose job is to say "try this first". The API never puts a ticket in
 * this list without a summary, which is why the field is not nullable here
 * although it is on `Incident`.
 */
export interface ResolvedSuggestion {
  id: string;
  reference: string;
  title: string;
  resolution_summary: string;
  resolved_at: string;
  location: LocationSummary;
  match: SuggestionMatch;
}

/** Mirrors `IncidentSuggestions` — both lists, each ranked before it arrives. */
export interface IncidentSuggestions {
  /** Still open, in progress or blocked: possible duplicates. */
  live: LiveSuggestion[];
  /** Already fixed, with the note the engineer left. Self-service. */
  resolved: ResolvedSuggestion[];
}

/** What the two watcher endpoints answer with. */
export interface WatchState {
  watching: boolean;
  watcher_count: number;
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
  /**
   * Whether other people may subscribe to a ticket in this subcategory.
   *
   * The one thing that decides whether "I'm affected too" is offered, and the
   * frontend never derives it. `location_detail` looks as though it should
   * answer the same question and does not: Software is BUILDING-level but an
   * operating-system fault is one person's, Hardware is FLOOR-level but a
   * printer is shared and a keyboard is not. An admin sets this per
   * subcategory, and the UI reads it.
   *
   * Required, like every other field this mirror carries. A deploy-skew
   * window does exist — the two halves of this application go out through two
   * separate scripts, so a bundle can briefly meet a Lambda whose
   * `CategoryRead` predates a column — but that is true of every field added
   * in every phase, and hedging one of them would be a promise the other
   * thirty do not make. `allowsWatchers()` in `features/incidents/watchers.ts`
   * is the one place this is read and it treats anything but `true` as false,
   * so the window hides the control rather than offering one the API refuses.
   */
  allows_watchers: boolean;
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

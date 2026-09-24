import { apiClient } from './client';
import type {
  AvailabilityStatus,
  BlockedReasonType,
  EngineerLevel,
  IncidentPriority,
  IncidentStatus,
  UserRole,
} from './types';

/**
 * The reporting endpoints — every number the dashboards draw.
 *
 * **Two kinds of report, and the difference is load-bearing.** Six of them
 * cover a *period* and take `from`/`to`; two describe the *present* and do not
 * accept those parameters at all. The split is decision D9 in
 * `docs/DECISION-LOG.md`, and it is expressed here in the types rather than
 * left to each caller to remember:
 *
 * * a period report takes {@link ReportPeriodParams} and answers with a
 *   `window` echoing the dates it actually applied;
 * * a current-state report takes {@link ReportScopeParams} — a building and
 *   nothing else — and answers with a `scope` carrying the moment it describes.
 *
 * `fetchBlockedEscalated` and `fetchMyReport` therefore *cannot* be handed a
 * date range: `ReportScopeParams` has no such field, so a dashboard that tried
 * would not compile. That is the point. The failure D9 fixed was a
 * present-tense answer wearing a period's label, and a type is a cheaper guard
 * than a code review.
 */

// --- Parameters --------------------------------------------------------------

/** Query string of a report that covers a period. */
export interface ReportPeriodParams {
  /** Start of the period, inclusive, as an ISO-8601 string. */
  from?: string;
  /** End of the period, inclusive, as an ISO-8601 string. */
  to?: string;
  building_id?: string;
}

/**
 * Query string of a report that describes the present.
 *
 * Deliberately not `Omit<ReportPeriodParams, 'from' | 'to'>`: an optional
 * property set to `undefined` still type-checks against `Omit`, so a caller
 * could write `{ from: undefined }` and believe it meant something. A separate
 * interface with one field cannot be handed a date at all.
 */
export interface ReportScopeParams {
  building_id?: string;
}

// --- Response envelopes ------------------------------------------------------

/** Mirrors `ReportWindow` — the period a report actually measured. */
export interface ReportWindow {
  from: string;
  to: string;
  building_id: string | null;
}

/** Mirrors `ReportScope` — the instant a current-state report describes. */
export interface ReportScope {
  as_of: string;
  building_id: string | null;
}

// --- /reports/summary --------------------------------------------------------

export interface StatusCount {
  status: IncidentStatus;
  count: number;
}

export interface PriorityCount {
  priority: IncidentPriority;
  count: number;
}

export interface AssigneeCount {
  assignee_id: string | null;
  assignee_name: string | null;
  count: number;
}

/** One day of the created-versus-closed series. Every day appears, zeroes included. */
export interface DayCount {
  day: string;
  created: number;
  closed: number;
}

/**
 * Mirrors `SummaryReport`.
 *
 * Every count here is over **incidents created in the window** — that is what
 * the backend's window filters, per decision D5 — with one exception named on
 * the field: `per_day.closed` counts by the day a ticket closed, whenever it
 * was reported. `blocked_total` and `escalated_total` are therefore *not* the
 * live figures on `/reports/blocked-escalated`, and a screen must not present
 * them as if they were.
 */
export interface SummaryReport {
  window: ReportWindow;
  total: number;
  active_total: number;
  unassigned_total: number;
  blocked_total: number;
  escalated_total: number;
  by_status: StatusCount[];
  by_priority: PriorityCount[];
  by_assignee: AssigneeCount[];
  per_day: DayCount[];
}

// --- /reports/categories -----------------------------------------------------

export interface SubcategoryCount {
  category_id: string;
  category_name: string;
  count: number;
}

export interface CategoryGroupCount {
  group_id: string | null;
  group_name: string | null;
  count: number;
  subcategories: SubcategoryCount[];
}

export interface CategoriesReport {
  window: ReportWindow;
  total: number;
  groups: CategoryGroupCount[];
}

// --- /reports/locations ------------------------------------------------------

export interface BuildingCount {
  building_id: string;
  building_name: string;
  building_code: string;
  count: number;
}

export interface FloorCount {
  floor_id: string;
  floor_name: string;
  building_id: string;
  building_code: string;
  count: number;
}

export interface SeatCount {
  seat_id: string;
  seat_code: string;
  seat_type: string;
  floor_id: string;
  floor_name: string;
  building_id: string;
  building_code: string;
  count: number;
}

export interface LocationsReport {
  window: ReportWindow;
  total: number;
  buildings: BuildingCount[];
  floors: FloorCount[];
  seats: SeatCount[];
}

// --- /reports/response-times -------------------------------------------------

/**
 * Milestone times for one population.
 *
 * **Medians, not averages.** BUILD-PLAN section 10 says "average
 * time-to-assign"; the endpoint computes `percentile_cont(0.5)` so that one
 * ticket left over a long weekend cannot move the headline. The field names
 * say `median_`, and so must every label drawn from them.
 */
export interface ResponseTimes {
  priority: IncidentPriority | null;
  total: number;
  assigned_count: number;
  acknowledged_count: number;
  resolved_count: number;
  median_assign_hours: number | null;
  median_acknowledge_hours: number | null;
  median_resolve_hours: number | null;
}

export interface ResponseTimesReport {
  window: ReportWindow;
  overall: ResponseTimes;
  by_priority: ResponseTimes[];
}

// --- /reports/engineer-workload ----------------------------------------------

/**
 * One engineer's load and output.
 *
 * Mixed scope, on purpose and documented in the schema: the four counts are a
 * snapshot of **now**, because "how busy is this person" is a question about
 * today, while `resolved_in_period` alone is scoped to the window. A table
 * showing both has to say which column is which.
 */
export interface EngineerWorkload {
  user_id: string;
  full_name: string;
  level: EngineerLevel;
  availability: AvailabilityStatus;
  max_active_tickets: number;
  open_count: number;
  in_progress_count: number;
  blocked_count: number;
  active_count: number;
  capacity_used_pct: number;
  resolved_in_period: number;
}

export interface EngineerWorkloadReport {
  window: ReportWindow;
  engineers: EngineerWorkload[];
}

// --- /reports/blocked-escalated ----------------------------------------------

export interface BlockedGroup {
  blocked_reason_type: BlockedReasonType | null;
  count: number;
  average_age_hours: number | null;
  max_age_hours: number | null;
}

export interface EscalatedTicket {
  incident_id: string;
  reference: string;
  title: string;
  status: IncidentStatus;
  priority: IncidentPriority;
  escalation_reason: string | null;
  escalated_at: string | null;
  age_hours: number | null;
}

/**
 * Mirrors `BlockedEscalatedReport` — a live queue, not a period.
 *
 * Everything currently blocked and everything currently escalated is here
 * however old it is, and the escalated half counts only tickets that are still
 * OPEN, IN_PROGRESS or BLOCKED (decision D10). `escalated_total` here is
 * therefore smaller than `SummaryReport.escalated_total`, which counts
 * escalations raised during the period including on tickets since closed.
 * Both are right; they answer different questions.
 */
export interface BlockedEscalatedReport {
  scope: ReportScope;
  blocked_total: number;
  escalated_total: number;
  blocked: BlockedGroup[];
  escalated: EscalatedTicket[];
}

// --- /reports/communication --------------------------------------------------

/**
 * Mirrors `CommunicationReport`.
 *
 * **Two halves that count different rows.** The first seven fields count
 * *incidents created* in the period. The last three count *notifications sent*
 * in it, and can therefore move while the others do not — telling somebody in
 * March about a ticket raised in February is activity in March. Both obey the
 * same rule: the window filters the `created_at` of the row being counted. See
 * decision D29.
 *
 * Every `_pct` is `null` rather than `0` when its denominator is empty, and
 * the difference is load-bearing: "nothing was resolved" is not "0% informed".
 */
export interface CommunicationReport {
  window: ReportWindow;
  total: number;
  resolved_total: number;
  informed_total: number;
  informed_pct: number | null;
  median_first_public_note_hours: number | null;
  reopened_total: number;
  reopen_rate_pct: number | null;

  /** In-app notifications sent to reporters about their own tickets. */
  notifications_total: number;
  notifications_read_total: number;
  notification_read_rate_pct: number | null;
}

// --- /reports/me -------------------------------------------------------------

/** One person's ticket counts, in one capacity. Current state, never a period. */
export interface PersonalCounts {
  total: number;
  active: number;
  open: number;
  in_progress: number;
  blocked: number;
  resolved: number;
  closed: number;
  escalated: number;
}

/**
 * Mirrors `MyReport` — the counts a persona's home screen opens with.
 *
 * `assigned` is present only for engineers. Everything here is current state:
 * "open", "in progress", "blocked" and "resolved" are claims about what is on
 * somebody's plate now, so a ticket raised in February and still open counts.
 */
export interface MyReport {
  scope: ReportScope;
  role: UserRole;
  reported: PersonalCounts;
  assigned: PersonalCounts | null;
}

// --- Requests ----------------------------------------------------------------

/** Backlog summary for a period: status, priority, assignee and daily flow. */
export async function fetchSummary(params: ReportPeriodParams): Promise<SummaryReport> {
  const { data } = await apiClient.get<SummaryReport>('/reports/summary', { params });
  return data;
}

/** What people reported most in a period, by group and subcategory. */
export async function fetchCategories(params: ReportPeriodParams): Promise<CategoriesReport> {
  const { data } = await apiClient.get<CategoriesReport>('/reports/categories', { params });
  return data;
}

/** The buildings, floors and seats with the most incidents in a period. */
export async function fetchLocations(params: ReportPeriodParams): Promise<LocationsReport> {
  const { data } = await apiClient.get<LocationsReport>('/reports/locations', { params });
  return data;
}

/** Median time to assign, acknowledge and resolve over a period. */
export async function fetchResponseTimes(
  params: ReportPeriodParams,
): Promise<ResponseTimesReport> {
  const { data } = await apiClient.get<ResponseTimesReport>('/reports/response-times', { params });
  return data;
}

/** One category group and how much of it an engineer resolved. */
export interface EngineerGroupCount {
  group_id: string;
  group_name: string;
  count: number;
}

/**
 * `/reports/engineers/{id}` — one engineer's output over a period.
 *
 * Separate from `EngineerWorkloadReport`, which answers "who is free" across
 * the roster. This answers "how is this person doing", and carries the one
 * number nothing else does: how many of the tickets they resolved came back.
 */
export interface EngineerDetailReport {
  window: ReportWindow;
  user_id: string;
  resolved_in_period: number;
  closed_in_period: number;
  reopened_in_period: number;
  /** Null when nothing was resolved — no rate, rather than a flawless 0%. */
  reopen_rate_pct: number | null;
  resolved_by_group: EngineerGroupCount[];
}

/** One engineer's output over the period, for their profile page. */
export async function fetchEngineerDetail(
  userId: string,
  params: ReportPeriodParams,
): Promise<EngineerDetailReport> {
  const { data } = await apiClient.get<EngineerDetailReport>(`/reports/engineers/${userId}`, {
    params,
  });
  return data;
}

/** Every engineer's live load, and what they resolved during the period. */
export async function fetchEngineerWorkload(
  params: ReportPeriodParams,
): Promise<EngineerWorkloadReport> {
  const { data } = await apiClient.get<EngineerWorkloadReport>('/reports/engineer-workload', {
    params,
  });
  return data;
}

/**
 * What is blocked or escalated **right now**.
 *
 * Takes no date range, and the parameter type makes that impossible to attempt.
 */
export async function fetchBlockedEscalated(
  params: ReportScopeParams,
): Promise<BlockedEscalatedReport> {
  const { data } = await apiClient.get<BlockedEscalatedReport>('/reports/blocked-escalated', {
    params,
  });
  return data;
}

/** Whether reporters were kept informed during a period. */
export async function fetchCommunication(
  params: ReportPeriodParams,
): Promise<CommunicationReport> {
  const { data } = await apiClient.get<CommunicationReport>('/reports/communication', { params });
  return data;
}

/**
 * The caller's own counts, as they stand now.
 *
 * No date range, for the same reason as `fetchBlockedEscalated`: a ticket
 * someone raised two months ago and is still waiting on belongs on their home
 * screen. See decision D9.
 */
export async function fetchMyReport(params: ReportScopeParams = {}): Promise<MyReport> {
  const { data } = await apiClient.get<MyReport>('/reports/me', { params });
  return data;
}

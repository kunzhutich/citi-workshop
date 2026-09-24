import { apiClient } from './client';
import type {
  ActivityEntry,
  AllowedTransition,
  AssignResult,
  BlockedReasonType,
  CloseReason,
  Incident,
  IncidentListItem,
  IncidentPriority,
  IncidentStatus,
  Page,
} from './types';

/**
 * The incident endpoints, one function per route.
 *
 * Two of these are load-bearing in a way the others are not:
 * `fetchAllowedTransitions` is the **only** thing the UI may draw workflow
 * buttons from, and the `can_*` flags on `fetchIncident` are the only thing it
 * may draw the remaining actions from. Nothing here reimplements a rule; it
 * asks the API what is permitted and renders the answer.
 */

/** Body of `POST /incidents` — what the report questionnaire collects. */
export interface IncidentCreatePayload {
  title: string;
  description: string;
  category_id: string;
  building_id: string;
  floor_id?: string | null;
  seat_id?: string | null;
  priority: IncidentPriority;
}

/** Body of `PATCH /incidents/{id}` — every field optional. */
export interface IncidentUpdatePayload {
  title?: string;
  description?: string;
  category_id?: string;
  building_id?: string;
  floor_id?: string | null;
  seat_id?: string | null;
  priority?: IncidentPriority;
}

/**
 * Body of `POST /incidents/{id}/transitions`.
 *
 * Every field but `to_status` is required by *some* transition and ignored by
 * the rest; which ones apply is `required_fields` on the chosen
 * `AllowedTransition`.
 */
export interface TransitionPayload {
  to_status: IncidentStatus;
  reason?: string;
  blocked_reason_type?: BlockedReasonType;
  blocked_reason?: string;
  resolution_summary?: string;
  close_reason?: CloseReason;
  duplicate_of_id?: string;
}

/**
 * The query string of `GET /incidents`, as the list screens build it.
 *
 * `assignee_id` accepts the literal `'unassigned'` as well as a user id — the
 * API treats "assigned to nobody" as one more answer to the same question
 * rather than a separate boolean.
 */
export interface IncidentQuery {
  q?: string;
  status?: IncidentStatus[];
  priority?: IncidentPriority[];
  group_id?: string;
  category_id?: string;
  building_id?: string;
  floor_id?: string;
  seat_id?: string;
  assignee_id?: string;
  reporter_id?: string;
  is_escalated?: boolean;
  /** Reported on or after this instant. Both ends inclusive, like the reports' window. */
  created_from?: string;
  /** Reported on or before this instant. */
  created_to?: string;
  mine?: 'reported' | 'assigned';
  specialty?: boolean;
  sort?: string;
  /**
   * Put closed tickets after the rest, whatever `sort` says.
   *
   * Server-side on purpose. A list is paged, so reordering the twenty-five
   * rows the browser was handed moves a closed ticket to the bottom of page
   * one and leaves it above every open ticket on page two.
   */
  closed_last?: boolean;
  page?: number;
  page_size?: number;
}

/** One page of incidents matching the filters. */
export async function listIncidents(query: IncidentQuery): Promise<Page<IncidentListItem>> {
  const { data } = await apiClient.get<Page<IncidentListItem>>('/incidents', { params: query });
  return data;
}

/** One ticket in full, including what the caller may do to it. */
export async function fetchIncident(id: string): Promise<Incident> {
  const { data } = await apiClient.get<Incident>(`/incidents/${id}`);
  return data;
}

/** Report a new incident. The caller is always the reporter. */
export async function createIncident(payload: IncidentCreatePayload): Promise<Incident> {
  const { data } = await apiClient.post<Incident>('/incidents', payload);
  return data;
}

/** Edit a ticket's content or priority. Each field is permission-checked. */
export async function updateIncident(
  id: string,
  payload: IncidentUpdatePayload,
): Promise<Incident> {
  const { data } = await apiClient.patch<Incident>(`/incidents/${id}`, payload);
  return data;
}

/**
 * The workflow moves this caller can make on this ticket right now.
 *
 * The single source of truth for the action buttons and for the fields their
 * dialogs collect. Guarded moves that are currently blocked are already left
 * out, so every entry returned is one the API will accept.
 */
export async function fetchAllowedTransitions(id: string): Promise<AllowedTransition[]> {
  const { data } = await apiClient.get<AllowedTransition[]>(`/incidents/${id}/allowed-transitions`);
  return data;
}

/** Perform a workflow transition. */
export async function performTransition(
  id: string,
  payload: TransitionPayload,
): Promise<Incident> {
  const { data } = await apiClient.post<Incident>(`/incidents/${id}/transitions`, payload);
  return data;
}

/**
 * Assign a ticket to an engineer, or unassign it with `null`.
 *
 * Succeeds even when the engineer is unavailable or at capacity, returning
 * `warnings` for the dialog to show: an admin who has decided to overload a
 * lead is making a judgement the system records rather than overrules.
 */
export async function assignIncident(
  id: string,
  assigneeId: string | null,
): Promise<AssignResult> {
  const { data } = await apiClient.post<AssignResult>(`/incidents/${id}/assign`, {
    assignee_id: assigneeId,
  });
  return data;
}

/** Self-assign an unassigned open ticket. SENIOR and LEAD engineers only. */
export async function pickUpIncident(id: string): Promise<AssignResult> {
  const { data } = await apiClient.post<AssignResult>(`/incidents/${id}/pick-up`);
  return data;
}

/** Flag a ticket as needing attention, with a reason. */
export async function escalateIncident(id: string, reason: string): Promise<Incident> {
  const { data } = await apiClient.post<Incident>(`/incidents/${id}/escalate`, { reason });
  return data;
}

/** Clear an escalation, saying what was done and optionally re-prioritising. */
export async function clearEscalation(
  id: string,
  payload: { note: string; priority?: IncidentPriority },
): Promise<Incident> {
  const { data } = await apiClient.post<Incident>(`/incidents/${id}/clear-escalation`, payload);
  return data;
}

/**
 * The ticket's events and readable notes as one chronological stream.
 *
 * Not paginated, and note visibility is already applied by the API's query —
 * an employee's response never contains an INTERNAL note to filter out.
 */
export async function fetchActivity(id: string): Promise<ActivityEntry[]> {
  const { data } = await apiClient.get<ActivityEntry[]>(`/incidents/${id}/activity`);
  return data;
}

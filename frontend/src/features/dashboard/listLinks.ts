import type { IncidentPriority, IncidentStatus } from '../../api/types';
import { paths } from '../../routes';

/**
 * Turning a dashboard number into the list of tickets it counted.
 *
 * BUILD-PLAN section 10 asks that KPI tiles and chart segments link to
 * pre-filtered lists, with the filters in the query string so the view is
 * bookmarkable. The value of that is entirely in the word *pre-filtered*: a
 * tile that says 13 and opens a list of 300 has taught the reader that the
 * dashboard's numbers cannot be checked.
 *
 * So the rule these builders exist to keep is **the link carries the same
 * scope the number was computed under**. A period tile's link carries
 * `created_from`/`created_to`, because `_window_clauses()` in the backend
 * filters on `created_at` and the list's own `created_from`/`created_to` do
 * the same thing on the same column. A current-state tile's link carries **no
 * dates at all**, because the number behind it was not windowed either — see
 * decision D9. Passing the dashboard's date range to a link for a live number
 * would produce a shorter list than the tile claimed, which is the same defect
 * D9 fixed in the API, reintroduced one layer up.
 *
 * `building_id` goes on both kinds, because it is a scope filter rather than a
 * time filter and both halves of the dashboard honour it.
 */

export interface PeriodScope {
  from: string | undefined;
  to: string | undefined;
  buildingId: string;
}

export interface ListFilterSpec {
  statuses?: IncidentStatus[];
  priorities?: IncidentPriority[];
  groupId?: string;
  categoryId?: string;
  buildingId?: string;
  assigneeId?: string;
  escalatedOnly?: boolean;
}

/**
 * A link into All tickets for a number computed over the period.
 *
 * The date range comes from the response's own `window`, not from the picker,
 * so the link cannot claim a period the server did not apply.
 */
export function periodListLink(scope: PeriodScope, spec: ListFilterSpec = {}): string {
  const params = buildParams({ buildingId: scope.buildingId || undefined, ...spec });
  if (scope.from) {
    params.set('created_from', scope.from);
  }
  if (scope.to) {
    params.set('created_to', scope.to);
  }
  return `${paths.allTickets}?${params.toString()}`;
}

/**
 * A link into All tickets for a number that describes the present.
 *
 * Deliberately takes no dates. A separate function rather than an optional
 * argument, so the choice is made at the call site and is visible there.
 */
export function currentListLink(buildingId: string, spec: ListFilterSpec = {}): string {
  const params = buildParams({ buildingId: buildingId || undefined, ...spec });
  return `${paths.allTickets}?${params.toString()}`;
}

function buildParams(spec: ListFilterSpec): URLSearchParams {
  const params = new URLSearchParams();
  for (const status of spec.statuses ?? []) {
    params.append('status', status);
  }
  for (const priority of spec.priorities ?? []) {
    params.append('priority', priority);
  }
  if (spec.groupId) {
    params.set('group_id', spec.groupId);
  }
  if (spec.categoryId) {
    params.set('category_id', spec.categoryId);
  }
  if (spec.buildingId) {
    params.set('building_id', spec.buildingId);
  }
  if (spec.assigneeId) {
    params.set('assignee_id', spec.assigneeId);
  }
  if (spec.escalatedOnly) {
    params.set('is_escalated', 'true');
  }
  return params;
}

/** The three statuses that mean "still live work", as the backend defines them. */
export const ACTIVE_STATUSES: IncidentStatus[] = ['OPEN', 'IN_PROGRESS', 'BLOCKED'];

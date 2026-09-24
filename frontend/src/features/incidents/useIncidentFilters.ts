import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { IncidentQuery } from '../../api/incidents';
import type { IncidentPriority, IncidentStatus } from '../../api/types';
import { INCIDENT_PRIORITIES, INCIDENT_STATUSES } from '../../display/labels';

/**
 * The list filters, kept in the URL query string.
 *
 * BUILD-PLAN section 10 asks for this, and the reason is that a filtered list
 * is a thing people send each other. "The blocked tickets in SFO-1" should be
 * a link, not a set of instructions — and in M7 the dashboard's chart segments
 * become links into exactly these views.
 *
 * The URL is the state. There is no `useState` mirroring it, so the back
 * button, a reload and a pasted link all produce the same screen, and there is
 * no second copy to fall out of step with the address bar.
 */

/** How many rows a page holds. The API's default, stated so paging can do arithmetic. */
export const PAGE_SIZE = 25;

export interface IncidentFilters {
  q: string;
  statuses: IncidentStatus[];
  priorities: IncidentPriority[];
  groupId: string;
  buildingId: string;
  escalatedOnly: boolean;
  sort: string;
  page: number;

  /**
   * The four filters below have no control on the filter bar.
   *
   * They exist because M7's dashboard links into this list, and a link is only
   * honest if the list it opens really is the set of tickets the tile counted.
   * A KPI tile reading "Unassigned · 13" over a thirty-day period has to land
   * on thirteen tickets, which needs an assignee filter and a date range that
   * the bar never offered.
   *
   * They are not hidden. `AppliedFilterChips` renders one removable chip for
   * each of them above the list, so a reader who arrived from a chart can see
   * exactly what was applied on their behalf and take it off. Giving them full
   * controls in the bar was the alternative: rejected because a subcategory
   * select and two date pickers are four more controls for everyone, to serve
   * a case that only ever arrives by link.
   */

  /** A subcategory, from drilling into a category group's chart. */
  categoryId: string;
  /** A user id, or the literal `unassigned`. */
  assigneeId: string;
  /** Both ends inclusive, ISO-8601, matching the reports' window exactly. */
  createdFrom: string;
  createdTo: string;
}

export interface IncidentFilterControls {
  filters: IncidentFilters;
  /** Apply a change. Any change but paging returns to page 1. */
  setFilters: (changes: Partial<IncidentFilters>) => void;
  /** Drop every filter, keeping the screen's own preset. */
  reset: () => void;
  /** How many filters the user has applied, for the mobile button's badge. */
  activeCount: number;
}

/** Read and write the filters in the address bar. */
export function useIncidentFilters(): IncidentFilterControls {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<IncidentFilters>(
    () => ({
      q: searchParams.get('q') ?? '',
      statuses: readEnum(searchParams.getAll('status'), INCIDENT_STATUSES),
      priorities: readEnum(searchParams.getAll('priority'), INCIDENT_PRIORITIES),
      groupId: searchParams.get('group_id') ?? '',
      buildingId: searchParams.get('building_id') ?? '',
      escalatedOnly: searchParams.get('is_escalated') === 'true',
      sort: searchParams.get('sort') ?? '-created_at',
      page: Math.max(1, Number(searchParams.get('page') ?? '1') || 1),
      categoryId: searchParams.get('category_id') ?? '',
      assigneeId: searchParams.get('assignee_id') ?? '',
      createdFrom: searchParams.get('created_from') ?? '',
      createdTo: searchParams.get('created_to') ?? '',
    }),
    [searchParams],
  );

  const setFilters = useCallback(
    (changes: Partial<IncidentFilters>) => {
      const next = { ...filters, ...changes };
      // Any change to *what* is listed invalidates which page you were on;
      // page 4 of a narrower result set is usually empty.
      if (changes.page === undefined) {
        next.page = 1;
      }

      const params = keepForeignParams(searchParams);
      if (next.q) {
        params.set('q', next.q);
      }
      for (const status of next.statuses) {
        params.append('status', status);
      }
      for (const priority of next.priorities) {
        params.append('priority', priority);
      }
      if (next.groupId) {
        params.set('group_id', next.groupId);
      }
      if (next.buildingId) {
        params.set('building_id', next.buildingId);
      }
      if (next.escalatedOnly) {
        params.set('is_escalated', 'true');
      }
      if (next.sort !== '-created_at') {
        params.set('sort', next.sort);
      }
      if (next.page > 1) {
        params.set('page', String(next.page));
      }
      if (next.categoryId) {
        params.set('category_id', next.categoryId);
      }
      if (next.assigneeId) {
        params.set('assignee_id', next.assigneeId);
      }
      if (next.createdFrom) {
        params.set('created_from', next.createdFrom);
      }
      if (next.createdTo) {
        params.set('created_to', next.createdTo);
      }

      // `replace`, so filtering six times does not put six entries between the
      // user and the page they arrived from.
      setSearchParams(params, { replace: true });
    },
    [filters, searchParams, setSearchParams],
  );

  // Clear drops this list's own filters and nothing else. On the engineer
  // page the address bar also carries that screen's period, and a Clear
  // button under a ticket table that silently reset the charts above it would
  // be doing something nobody asked for.
  const reset = useCallback(() => {
    setSearchParams(keepForeignParams(searchParams), { replace: true });
  }, [searchParams, setSearchParams]);

  const activeCount =
    (filters.q ? 1 : 0) +
    filters.statuses.length +
    filters.priorities.length +
    (filters.groupId ? 1 : 0) +
    (filters.buildingId ? 1 : 0) +
    (filters.escalatedOnly ? 1 : 0) +
    (filters.categoryId ? 1 : 0) +
    (filters.assigneeId ? 1 : 0) +
    // The two ends of one date range count as one filter, because that is how
    // a reader thinks of them and the badge is for a reader.
    (filters.createdFrom || filters.createdTo ? 1 : 0);

  return { filters, setFilters, reset, activeCount };
}

/**
 * Which query parameters this hook owns, and therefore rewrites in full.
 *
 * Everything else in the address bar belongs to somebody else and is carried
 * across untouched. Both filter hooks used to build a *fresh* `URLSearchParams`
 * from their own view of the world, which is correct on a screen where one of
 * them is the only writer — and every screen was, until R7 put a ticket list
 * inside the engineer page. There, changing the status filter reset that
 * screen's period to the default and changing the period dropped the status
 * filter: two hooks each convinced the URL was theirs alone.
 *
 * Stated as the owned set rather than as "merge what changed", because a
 * filter being *cleared* has to remove its parameter, and a merge cannot tell
 * "cleared" from "not mine". See the matching list in `useDashboardFilters.ts`.
 *
 * `building_id` and `group_id` appear in both lists deliberately: on the one
 * screen that runs both hooks they are the same filter asked twice, and a
 * reader who narrows the page to SFO-1 means it for the charts and the table
 * alike.
 */
const OWNED_PARAMS = [
  'q',
  'status',
  'priority',
  'group_id',
  'building_id',
  'is_escalated',
  'sort',
  'page',
  'category_id',
  'assignee_id',
  'created_from',
  'created_to',
] as const;

/** Every parameter except the ones above, so a co-tenant's state survives. */
function keepForeignParams(current: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const name of OWNED_PARAMS) {
    params.delete(name);
  }
  return params;
}

/**
 * Turn the filters and a screen's preset into the API's query.
 *
 * `preset` is what the screen is *for* — "assigned to me", "unassigned" — and
 * it comes second so that it cannot be filtered away: a My Queue page filtered
 * to OPEN is still My Queue.
 */
export function toQuery(filters: IncidentFilters, preset: IncidentQuery): IncidentQuery {
  return {
    q: filters.q || undefined,
    status: filters.statuses.length > 0 ? filters.statuses : undefined,
    priority: filters.priorities.length > 0 ? filters.priorities : undefined,
    group_id: filters.groupId || undefined,
    building_id: filters.buildingId || undefined,
    is_escalated: filters.escalatedOnly ? true : undefined,
    category_id: filters.categoryId || undefined,
    assignee_id: filters.assigneeId || undefined,
    created_from: filters.createdFrom || undefined,
    created_to: filters.createdTo || undefined,
    sort: filters.sort,
    page: filters.page,
    page_size: PAGE_SIZE,
    ...preset,
  };
}

/** Keep only the query values that are members of the enum. */
function readEnum<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((value): value is T => (allowed as readonly string[]).includes(value));
}

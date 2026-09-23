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

      const params = new URLSearchParams();
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

      // `replace`, so filtering six times does not put six entries between the
      // user and the page they arrived from.
      setSearchParams(params, { replace: true });
    },
    [filters, setSearchParams],
  );

  const reset = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const activeCount =
    (filters.q ? 1 : 0) +
    filters.statuses.length +
    filters.priorities.length +
    (filters.groupId ? 1 : 0) +
    (filters.buildingId ? 1 : 0) +
    (filters.escalatedOnly ? 1 : 0);

  return { filters, setFilters, reset, activeCount };
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

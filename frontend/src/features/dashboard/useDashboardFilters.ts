import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { ReportPeriodParams, ReportScopeParams } from '../../api/reports';

/**
 * The admin dashboard's filters, kept in the URL query string.
 *
 * The same rule the ticket lists follow, for the same reason: a dashboard
 * narrowed to one building over one month is a thing people send each other,
 * and it should be a link rather than a set of instructions. The URL is the
 * state; nothing mirrors it in `useState`.
 *
 * **The range is stored as a preset, not as two dates.** `?range=30d` rather
 * than `?from=2026-08-24&to=2026-09-23`, so a link sent on Monday still means
 * "the last thirty days" when it is opened on Friday. A custom range stores its
 * two dates instead, which is the case where fixed ends are what the sender
 * meant.
 */

/** A named period the dashboard offers, and how far back it reaches. */
export interface RangePreset {
  id: string;
  label: string;
  days: number;
}

/**
 * The presets, shortest first.
 *
 * Rows of named periods rather than a calendar, because nobody wants to fight
 * a date grid to say "last 30 days". The custom range is still there for the
 * case the presets do not cover.
 */
export const RANGE_PRESETS: RangePreset[] = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: '365d', label: 'Last 12 months', days: 365 },
];

/** What the dashboard shows when the URL names no period. The API's own default. */
export const DEFAULT_RANGE_ID = '30d';

/** The `range` value that means "the two dates in the URL". */
export const CUSTOM_RANGE_ID = 'custom';

export interface DashboardFilters {
  /** A preset id, or `custom` when `from`/`to` carry the period. */
  rangeId: string;
  /** Only meaningful for the custom range. `YYYY-MM-DD`. */
  from: string;
  to: string;
  buildingId: string;
  /**
   * Which category group the category chart is drilled into, if any.
   *
   * Not a filter — it narrows one chart rather than the page — but it lives in
   * the URL for the same reason the filters do: "the subcategory breakdown of
   * Building & Facilities in SFO-1 last quarter" should be a link.
   */
  drillGroupId: string;
}

export interface DashboardFilterControls {
  filters: DashboardFilters;
  setFilters: (changes: Partial<DashboardFilters>) => void;
  /**
   * What the six period reports are asked for.
   *
   * Resolved from the preset at render time, so a preset link means the same
   * thing whenever it is opened.
   */
  periodParams: ReportPeriodParams;
  /**
   * What the two current-state reports are asked for.
   *
   * The building and nothing else — the type has no room for a date, which is
   * decision D9 expressed where it cannot be forgotten.
   */
  scopeParams: ReportScopeParams;
}

/**
 * Read and write the dashboard's filters in the address bar.
 *
 * `now` is a parameter so a test can state the moment it is measuring from,
 * and it is **frozen at mount** when the caller supplies none. A fresh
 * `new Date()` on every render would put a new instant in every query key,
 * TanStack Query would see eight new queries on each pass, and each answer
 * would trigger the next render: the page would refetch itself for ever. The
 * headings read their dates back off the response's `window` rather than off
 * this value, so a frozen end is still reported accurately.
 */
export function useDashboardFilters(now?: Date): DashboardFilterControls {
  const [searchParams, setSearchParams] = useSearchParams();
  const resolvedNow = useMemo(() => now ?? new Date(), [now]);

  const filters = useMemo<DashboardFilters>(
    () => ({
      rangeId: searchParams.get('range') ?? DEFAULT_RANGE_ID,
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
      buildingId: searchParams.get('building_id') ?? '',
      drillGroupId: searchParams.get('group_id') ?? '',
    }),
    [searchParams],
  );

  const setFilters = useCallback(
    (changes: Partial<DashboardFilters>) => {
      const next = { ...filters, ...changes };
      const params = keepForeignParams(searchParams);

      if (next.rangeId !== DEFAULT_RANGE_ID) {
        params.set('range', next.rangeId);
      }
      if (next.rangeId === CUSTOM_RANGE_ID) {
        if (next.from) {
          params.set('from', next.from);
        }
        if (next.to) {
          params.set('to', next.to);
        }
      }
      if (next.buildingId) {
        params.set('building_id', next.buildingId);
      }
      if (next.drillGroupId) {
        params.set('group_id', next.drillGroupId);
      }

      // `replace`: adjusting a filter four times should not put four entries
      // between the reader and the page they arrived from.
      setSearchParams(params, { replace: true });
    },
    [filters, searchParams, setSearchParams],
  );

  const period = resolvePeriod(filters, resolvedNow);

  return {
    filters,
    setFilters,
    periodParams: {
      from: period.from,
      to: period.to,
      building_id: filters.buildingId || undefined,
    },
    scopeParams: { building_id: filters.buildingId || undefined },
  };
}

/**
 * Which query parameters this hook owns, and therefore rewrites in full.
 *
 * Everything else in the address bar belongs to somebody else and is carried
 * across untouched. Both filter hooks used to build a *fresh* `URLSearchParams`
 * from their own view of the world, which is correct on a screen where one of
 * them is the only writer — and every screen was, until R7 put a ticket list
 * inside the engineer page. There, changing the date range dropped the list's
 * status filter and changing the status filter reset the date range to the
 * default: two hooks each convinced the URL was theirs alone.
 *
 * Stated as the owned set rather than as "merge what changed", because a
 * filter being *cleared* has to remove its parameter, and a merge cannot tell
 * "cleared" from "not mine". See the matching list in `useIncidentFilters.ts`.
 */
const OWNED_PARAMS = ['range', 'from', 'to', 'building_id', 'group_id'] as const;

/** Every parameter except the ones above, so a co-tenant's state survives. */
function keepForeignParams(current: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const name of OWNED_PARAMS) {
    params.delete(name);
  }
  return params;
}

/**
 * Turn the stored filters into the two ISO instants the API takes.
 *
 * A custom range's ends are widened to cover whole local days — `from` at
 * 00:00 and `to` at 23:59:59.999 — because someone who typed two dates meant
 * both of those days in full, and the API's bounds are inclusive on an
 * instant. Without the widening, "to = 23 September" would stop at midnight
 * that morning and silently drop a day's tickets.
 */
export function resolvePeriod(
  filters: DashboardFilters,
  now: Date,
): { from: string | undefined; to: string | undefined } {
  if (filters.rangeId === CUSTOM_RANGE_ID) {
    return {
      from: startOfDay(filters.from),
      to: endOfDay(filters.to),
    };
  }

  const preset =
    RANGE_PRESETS.find((candidate) => candidate.id === filters.rangeId) ??
    RANGE_PRESETS.find((candidate) => candidate.id === DEFAULT_RANGE_ID);

  if (!preset) {
    return { from: undefined, to: undefined };
  }

  const from = new Date(now);
  from.setDate(from.getDate() - preset.days);
  return { from: from.toISOString(), to: now.toISOString() };
}

/** The label a reader sees for the period currently applied. */
export function rangeLabel(filters: DashboardFilters): string {
  if (filters.rangeId === CUSTOM_RANGE_ID) {
    return 'Custom range';
  }
  const preset = RANGE_PRESETS.find((candidate) => candidate.id === filters.rangeId);
  return preset?.label ?? 'Last 30 days';
}

/**
 * One end of a custom range as the instant its local day begins, or nothing.
 *
 * **`undefined` for a value that is not a date**, which is not defensive
 * padding: `from` and `to` come out of the address bar, where a hand-edit, a
 * truncated paste or a stale link can put anything at all. Until R7 they came
 * out of a native `type="date"` input that would only ever have written a real
 * day, and `new Date('nonsenseT00:00:00').toISOString()` throws `RangeError`
 * — so `?range=custom&from=nonsense` took the whole dashboard to the error
 * boundary. Found by another worker's deliberate-break tests on the date
 * picker, not by anything the picker itself does wrong.
 *
 * Treating it as *no date* is also the answer that agrees with the screen:
 * `components/DateRangeFields.tsx` shows an empty field for a string it cannot
 * parse, so the field and the query now say the same thing. Widening to an
 * unfiltered end is the safe direction as well — the reader sees more than
 * they asked for rather than silently less.
 */
function startOfDay(date: string): string | undefined {
  return instantOrNothing(`${date}T00:00:00`);
}

/**
 * The other end, at the last millisecond of its local day.
 *
 * The milliseconds matter: the API's bound is inclusive on an instant, so a
 * `to` left at its own midnight would drop every ticket reported during the
 * day the reader named.
 */
function endOfDay(date: string): string | undefined {
  return instantOrNothing(`${date}T23:59:59.999`);
}

/** Parse, or say so by being absent. Never throws. */
function instantOrNothing(value: string): string | undefined {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

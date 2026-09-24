import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  CUSTOM_RANGE_ID,
  DEFAULT_RANGE_ID,
  RANGE_PRESETS,
  rangeLabel,
  resolvePeriod,
  useDashboardFilters,
  type DashboardFilters,
} from './useDashboardFilters';

/**
 * How the dashboard's stored filters become the two instants the API takes.
 *
 * The behaviour worth pinning down is that **a preset is resolved when it is
 * read, not when it is written**. `?range=30d` sent on Monday has to mean the
 * thirty days before whenever it is opened; if it were stored as two dates the
 * link would age, and the person who received it would be looking at last
 * month's dashboard while believing it was current.
 */

const NOW = new Date('2026-09-23T12:00:00Z');

function filters(overrides: Partial<DashboardFilters> = {}): DashboardFilters {
  return {
    rangeId: DEFAULT_RANGE_ID,
    from: '',
    to: '',
    buildingId: '',
    drillGroupId: '',
    ...overrides,
  };
}

describe('a preset range', () => {
  it.each(RANGE_PRESETS)('resolves $label to that many days before now', (preset) => {
    const period = resolvePeriod(filters({ rangeId: preset.id }), NOW);

    expect(period.to).toBe(NOW.toISOString());
    const days = (NOW.getTime() - new Date(period.from ?? '').getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(preset.days);
  });

  it('is measured from the moment it is read, not from when the link was made', () => {
    const later = new Date('2026-10-23T12:00:00Z');

    const first = resolvePeriod(filters({ rangeId: '7d' }), NOW);
    const second = resolvePeriod(filters({ rangeId: '7d' }), later);

    expect(first.to).not.toBe(second.to);
    expect(second.to).toBe(later.toISOString());
  });

  it('falls back to the default when the URL names a range that does not exist', () => {
    // Somebody hand-edits the query string, or a preset is renamed. Thirty
    // days of data is a better answer than no dashboard.
    const period = resolvePeriod(filters({ rangeId: 'last-fortnight' }), NOW);

    const days = (NOW.getTime() - new Date(period.from ?? '').getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });
});

describe('a custom range', () => {
  it('covers both named days in full', () => {
    // Someone who typed two dates meant both of them whole. The API's bounds
    // are inclusive on an *instant*, so an unwidened "to" would stop at
    // midnight that morning and silently drop the last day's tickets.
    const period = resolvePeriod(
      filters({ rangeId: CUSTOM_RANGE_ID, from: '2026-09-01', to: '2026-09-07' }),
      NOW,
    );

    expect(new Date(period.from ?? '').getHours()).toBe(0);
    expect(new Date(period.to ?? '').getHours()).toBe(23);
    expect(new Date(period.to ?? '').getMinutes()).toBe(59);
    expect(new Date(period.to ?? '').getDate()).toBe(7);
  });

  it('leaves an end out rather than inventing one', () => {
    const period = resolvePeriod(filters({ rangeId: CUSTOM_RANGE_ID, from: '2026-09-01' }), NOW);

    expect(period.from).toBeDefined();
    expect(period.to).toBeUndefined();
  });
});

describe('the label a reader sees', () => {
  it('names the preset', () => {
    expect(rangeLabel(filters({ rangeId: '90d' }))).toBe('Last 90 days');
  });

  it('says a custom range is one', () => {
    expect(rangeLabel(filters({ rangeId: CUSTOM_RANGE_ID }))).toBe('Custom range');
  });
});

/**
 * The address bar can have a second tenant, and this hook is not its landlord.
 *
 * The engineer page runs this hook *and* `useIncidentFilters` at once: a
 * period over the charts, a ticket table underneath with filters of its own.
 * Each hook used to rebuild the query string from its own view of the world,
 * so whichever wrote last erased the other. These two tests are the ones that
 * fail when `keepForeignParams` is taken out — verified by reverting it: the
 * first reads `''` for `status` instead of `OPEN`, the second loses `page`.
 */
describe('writing the URL beside another filter hook', () => {
  /** Render the hook with the location, so a test can read what it wrote. */
  function renderDashboardFilters(initialEntry: string) {
    return renderHook(() => ({ controls: useDashboardFilters(NOW), location: useLocation() }), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries: [initialEntry] }, children),
    });
  }

  it('leaves the ticket list its filters when the period changes', () => {
    const { result } = renderDashboardFilters('/engineers/e1?status=OPEN&sort=-priority');

    act(() => result.current.controls.setFilters({ rangeId: '90d' }));

    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('range')).toBe('90d');
    expect(params.get('status')).toBe('OPEN');
    expect(params.get('sort')).toBe('-priority');
  });

  it('still clears its own filter rather than merging over it', () => {
    // The other half of the rule, and the reason this is an owned-parameter
    // list instead of a merge: a merge cannot tell "cleared" from "not mine",
    // so the building would be impossible to remove.
    const { result } = renderDashboardFilters('/engineers/e1?building_id=b1&page=4');

    act(() => result.current.controls.setFilters({ buildingId: '' }));

    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('building_id')).toBeNull();
    expect(params.get('page')).toBe('4');
  });
});

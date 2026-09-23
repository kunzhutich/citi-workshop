import { describe, expect, it } from 'vitest';

import {
  CUSTOM_RANGE_ID,
  DEFAULT_RANGE_ID,
  RANGE_PRESETS,
  rangeLabel,
  resolvePeriod,
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

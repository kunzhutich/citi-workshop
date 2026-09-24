import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { toQuery, useIncidentFilters } from './useIncidentFilters';

/**
 * The filters are the URL, and the URL is the filters.
 *
 * There is no `useState` mirroring the query string, so these tests read the
 * address bar to see what the hook did — which is the same thing a user's back
 * button, reload and pasted link do.
 */

function wrapper(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

/** Render the hook alongside the location, so a test can read both. */
function renderFilters(initialEntry = '/tickets') {
  return renderHook(
    () => ({ controls: useIncidentFilters(), location: useLocation() }),
    { wrapper: wrapper(initialEntry) },
  );
}

describe('reading the URL', () => {
  it('defaults to newest first, page one, nothing filtered', () => {
    const { result } = renderFilters();

    expect(result.current.controls.filters).toMatchObject({
      q: '',
      statuses: [],
      priorities: [],
      groupId: '',
      buildingId: '',
      escalatedOnly: false,
      sort: '-created_at',
      page: 1,
    });
    expect(result.current.controls.activeCount).toBe(0);
  });

  it('reads a repeated parameter as a list', () => {
    const { result } = renderFilters('/tickets?status=OPEN&status=BLOCKED');

    expect(result.current.controls.filters.statuses).toEqual(['OPEN', 'BLOCKED']);
    expect(result.current.controls.activeCount).toBe(2);
  });

  it('ignores a value that is not a member of the enum', () => {
    // A hand-edited or stale URL should narrow the list, not crash it or ask
    // the API about a status that does not exist.
    const { result } = renderFilters('/tickets?status=OPEN&status=NONSENSE');

    expect(result.current.controls.filters.statuses).toEqual(['OPEN']);
  });

  it('treats a missing or unreadable page as page one', () => {
    expect(renderFilters('/tickets').result.current.controls.filters.page).toBe(1);
    expect(renderFilters('/tickets?page=nope').result.current.controls.filters.page).toBe(1);
    expect(renderFilters('/tickets?page=0').result.current.controls.filters.page).toBe(1);
    expect(renderFilters('/tickets?page=4').result.current.controls.filters.page).toBe(4);
  });

  it('counts each applied filter once, for the mobile badge', () => {
    const { result } = renderFilters(
      '/tickets?q=printer&status=OPEN&priority=HIGH&is_escalated=true',
    );

    expect(result.current.controls.activeCount).toBe(4);
  });
});

describe('writing the URL', () => {
  it('puts a change in the query string', () => {
    const { result } = renderFilters();

    act(() => result.current.controls.setFilters({ statuses: ['BLOCKED'] }));

    expect(result.current.location.search).toBe('?status=BLOCKED');
  });

  it('repeats the key rather than indexing it, which is what FastAPI reads', () => {
    const { result } = renderFilters();

    act(() => result.current.controls.setFilters({ statuses: ['OPEN', 'BLOCKED'] }));

    expect(result.current.location.search).toBe('?status=OPEN&status=BLOCKED');
  });

  it('returns to page one whenever the filters change', () => {
    // Page 4 of a narrower result set is usually empty, which reads as "the
    // filter found nothing".
    const { result } = renderFilters('/tickets?page=4');

    act(() => result.current.controls.setFilters({ escalatedOnly: true }));

    expect(result.current.controls.filters.page).toBe(1);
    expect(result.current.location.search).not.toContain('page=');
  });

  it('keeps the page when the page itself is what changed', () => {
    const { result } = renderFilters('/tickets?status=OPEN');

    act(() => result.current.controls.setFilters({ page: 3 }));

    expect(result.current.controls.filters.page).toBe(3);
    expect(result.current.location.search).toContain('status=OPEN');
  });

  it('leaves the default sort out of the URL', () => {
    const { result } = renderFilters();

    act(() => result.current.controls.setFilters({ sort: '-created_at' }));
    expect(result.current.location.search).toBe('');

    act(() => result.current.controls.setFilters({ sort: 'priority' }));
    expect(result.current.location.search).toBe('?sort=priority');
  });

  it('clears everything on reset', () => {
    const { result } = renderFilters('/tickets?q=printer&status=OPEN&page=2');

    act(() => result.current.controls.reset());

    expect(result.current.location.search).toBe('');
    expect(result.current.controls.activeCount).toBe(0);
  });
});

describe('toQuery', () => {
  it('leaves an empty filter out rather than sending a blank', () => {
    const { result } = renderFilters();

    const query = toQuery(result.current.controls.filters, {});

    expect(query.q).toBeUndefined();
    expect(query.status).toBeUndefined();
    expect(query.is_escalated).toBeUndefined();
    expect(query.page_size).toBe(25);
  });

  it('applies a screen preset after the user filters, so it cannot be removed', () => {
    // My Queue narrowed to OPEN is still My Queue.
    const { result } = renderFilters('/tickets?status=OPEN');

    const query = toQuery(result.current.controls.filters, { mine: 'assigned' });

    expect(query.mine).toBe('assigned');
    expect(query.status).toEqual(['OPEN']);
  });

  it('lets a preset win over a filter of the same name', () => {
    const { result } = renderFilters('/tickets?status=CLOSED');

    const query = toQuery(result.current.controls.filters, {
      assignee_id: 'unassigned',
      status: ['OPEN'],
    });

    expect(query.assignee_id).toBe('unassigned');
    expect(query.status).toEqual(['OPEN']);
  });
});

/**
 * The address bar can have a second tenant, and this hook is not its landlord.
 *
 * The engineer page runs this hook inside a screen that also runs
 * `useDashboardFilters` — a period over the charts, this table underneath.
 * Each hook used to rebuild the query string from its own view of the world,
 * so whichever wrote last erased the other. All three tests below fail when
 * `keepForeignParams` is taken out — verified by reverting it: the first two
 * read `null` for `range`, and Clear wipes it as well.
 */
describe('writing the URL beside another filter hook', () => {
  it('leaves that screen its period when a filter changes', () => {
    const { result } = renderFilters('/engineers/e1?range=90d');

    act(() => result.current.controls.setFilters({ statuses: ['OPEN'] }));

    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('status')).toBe('OPEN');
    expect(params.get('range')).toBe('90d');
  });

  it('still clears its own filter rather than merging over it', () => {
    // The other half of the rule, and the reason this is an owned-parameter
    // list instead of a merge: a merge cannot tell "cleared" from "not mine",
    // so a status would be impossible to remove.
    const { result } = renderFilters('/engineers/e1?range=90d&status=OPEN');

    act(() => result.current.controls.setFilters({ statuses: [] }));

    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('status')).toBeNull();
    expect(params.get('range')).toBe('90d');
  });

  it('clears this list only, not the screen around it', () => {
    const { result } = renderFilters('/engineers/e1?range=90d&status=OPEN&q=printer');

    act(() => result.current.controls.reset());

    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('status')).toBeNull();
    expect(params.get('q')).toBeNull();
    expect(params.get('range')).toBe('90d');
  });
});

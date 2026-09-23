import { describe, expect, it } from 'vitest';

import { ACTIVE_STATUSES, currentListLink, periodListLink } from './listLinks';

/**
 * The rule under test: **a link carries the same scope as the number above it.**
 *
 * Two builders rather than one with a flag, so that choosing between them is a
 * decision made at each call site and visible when reading it. These tests are
 * what stops the two from quietly converging.
 */

const SCOPE = {
  from: '2026-08-24T00:00:00Z',
  to: '2026-09-23T00:00:00Z',
  buildingId: '',
};

describe('a link for a period number', () => {
  it('carries both ends of the window the report actually used', () => {
    const href = periodListLink(SCOPE, { statuses: ['OPEN'] });

    expect(href).toContain('created_from=2026-08-24T00%3A00%3A00Z');
    expect(href).toContain('created_to=2026-09-23T00%3A00%3A00Z');
    expect(href).toContain('status=OPEN');
  });

  it('repeats a parameter for each value, because the API ORs them', () => {
    const href = periodListLink(SCOPE, { statuses: ACTIVE_STATUSES });

    expect(href).toContain('status=OPEN&status=IN_PROGRESS&status=BLOCKED');
  });

  it('omits the dates when the report has not answered yet', () => {
    // The window comes off the response, so before the first answer there is
    // nothing honest to put in the link. An absent filter is right; a made-up
    // one from the picker would be a link to a different set of tickets.
    const href = periodListLink({ from: undefined, to: undefined, buildingId: '' });

    expect(href).not.toContain('created_from');
    expect(href).not.toContain('created_to');
  });

  it('carries the building when one is selected', () => {
    const href = periodListLink({ ...SCOPE, buildingId: 'b-sfo' });

    expect(href).toContain('building_id=b-sfo');
  });
});

describe('a link for a current-state number', () => {
  it('carries no dates at all', () => {
    // This is decision D9 in one assertion. The number behind such a link was
    // never windowed, so a windowed link would open a shorter list than the
    // tile claimed — which is the defect D9 removed from the API, put back by
    // the UI.
    const href = currentListLink('', { statuses: ['BLOCKED'] });

    expect(href).toBe('/tickets?status=BLOCKED');
  });

  it('still carries the building, which is a scope filter and not a time one', () => {
    const href = currentListLink('b-sfo', { statuses: ['OPEN'], assigneeId: 'unassigned' });

    expect(href).toContain('building_id=b-sfo');
    expect(href).toContain('assignee_id=unassigned');
    expect(href).not.toContain('created_');
  });

  it('spells "escalated" as the flag the list filters on', () => {
    const href = currentListLink('', { escalatedOnly: true, statuses: ACTIVE_STATUSES });

    expect(href).toContain('is_escalated=true');
  });
});

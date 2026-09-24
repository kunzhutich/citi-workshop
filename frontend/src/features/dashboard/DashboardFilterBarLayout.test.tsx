import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where the bar's four controls sit, on each of the two screens that mount it.
 *
 * `DashboardFilterBar.test.tsx` beside this one is about what the custom range
 * *writes*; this file is about where it *opens*, which is the one thing the
 * two callers disagree on. The admin dashboard's bar is the page's own, full
 * width above everything it scopes, and the pair of dates opening in place
 * between the selects is what its `Collapse` is for. The engineer page's bar
 * is a few hundred pixels in a heading's action slot, where four controls on
 * one line is four lines, so the pair opens on a row underneath.
 *
 * **The claim is a pair and the pair is why this file exists.** "Narrow puts
 * the dates below the selects" is equally true of a bar that put them below
 * for everybody, which would have moved the admin dashboard's controls without
 * anybody looking at that screen — the shape of D24, D25, D35 and D40, where
 * the assertion was adjacent to the intent and right most of the time. So both
 * arms are asserted, four lines apart, against the same component.
 *
 * Layout itself is not assertable here: jsdom resolves declarations but runs
 * no layout engine, so nothing in this file can say two selects share a line.
 * What it can say is where each control is in the document and which rule was
 * asked to arrange it, and those are the two things that would be changed by
 * mistake.
 */

vi.mock('../../api/facilities', () => ({ fetchFacilityTree: vi.fn() }));

const { fetchFacilityTree } = await import('../../api/facilities');
const { DashboardFilterBar } = await import('./DashboardFilterBar');
const { useDashboardFilters } = await import('./useDashboardFilters');
const { renderWithAuth } = await import('../../test/renderWithProviders');
const { makeAdmin } = await import('../../test/factories');

/**
 * A fixed "now", for the same reason the other file pins one.
 *
 * `useDashboardFilters` resolves its presets against it, and a test that
 * quietly depends on the hour it runs at is D40.
 */
const NOW = new Date('2026-09-24T09:00:00Z');

beforeEach(() => {
  vi.mocked(fetchFacilityTree).mockResolvedValue({ buildings: [] });
});

/** The real hook behind the bar, because the URL is what opens the range. */
function Harness({ narrow }: { narrow: boolean }) {
  return <DashboardFilterBar controls={useDashboardFilters(NOW)} narrow={narrow} />;
}

/** Draw the bar with a custom range already open, and wait for it. */
async function renderOpenBar(narrow: boolean): Promise<void> {
  renderWithAuth(<Harness narrow={narrow} />, {
    user: makeAdmin(),
    route: '/?range=custom&from=2026-09-15',
  });
  await screen.findByRole('combobox', { name: 'Date range' });
}

/**
 * The innermost element holding both selects — the line they are meant to be
 * on.
 *
 * Found by walking up from one of them rather than by a test id, because a
 * test id would have to be *put* somewhere and would then be asserting that
 * the id is where somebody put it. This asks the document the same question a
 * reader asks it: what is the box these two share?
 */
function selectRow(): HTMLElement {
  const building = screen.getByRole('combobox', { name: 'Building' });
  let node: HTMLElement | null = screen.getByRole('combobox', { name: 'Date range' });
  while (node && !node.contains(building)) {
    node = node.parentElement;
  }
  expect(node, 'the two selects have no common ancestor').not.toBeNull();
  return node as HTMLElement;
}

describe('where a custom range opens', () => {
  it('opens between the selects on a page-width bar, which is the dashboard', async () => {
    await renderOpenBar(false);

    const row = selectRow();
    const from = screen.getByRole('group', { name: 'From' });
    const to = screen.getByRole('group', { name: 'To' });

    // Inside the line the selects are on, and between them in it: four
    // controls in reading order, which is what the dashboard has always drawn
    // and what `narrow` must not have changed for it.
    expect(row).toContainElement(from);
    expect(row).toContainElement(to);
    expect(
      screen
        .getByRole('combobox', { name: 'Date range' })
        .compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      from.compareDocumentPosition(screen.getByRole('combobox', { name: 'Building' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(to).toBeInTheDocument();
  });

  it('opens on a row under them in a slot, which is the engineer page', async () => {
    await renderOpenBar(true);

    const row = selectRow();
    const from = screen.getByRole('group', { name: 'From' });

    // Out of the line, under it — and still inside the bar. The third
    // assertion is the one that makes the first two mean something: a bar that
    // had simply stopped rendering its date fields would satisfy both of them.
    expect(row).not.toContainElement(from);
    expect(row.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.parentElement).toContainElement(from);
    expect(screen.getByRole('group', { name: 'To' })).toBeInTheDocument();
  });

  it('still closes the pair away again when a preset is chosen', async () => {
    // The `Collapse` is now written once and hung in one of two places, so the
    // opening and closing of it is worth one assertion in the moved case.
    await renderOpenBar(true);

    await userEvent.click(screen.getByRole('combobox', { name: 'Date range' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Last 7 days' }));

    await vi.waitFor(() => {
      expect(screen.queryAllByRole('group')).toHaveLength(0);
    });
  });
});

describe('what arranges the two selects', () => {
  /**
   * The rule, not the result.
   *
   * jsdom has no layout, so "they are on one line" cannot be measured here.
   * What can be read back is the rule that decides it, and the rule is the
   * part that goes wrong: D44 is the entry about a layout switched on the
   * *window's* width inside a box 296px narrower than the window, and the fix
   * for it — and for this — is a track list the container resolves. A media
   * query reintroduced here would pass every other test in the suite.
   */
  it('divides the slot it is given, rather than asking the window how wide it is', async () => {
    await renderOpenBar(true);

    const columns = getComputedStyle(selectRow()).gridTemplateColumns;
    expect(columns).toContain('auto-fit');
    // `min(100%, …)` is what stops a container narrower than one column being
    // overflowed by one column — the phone case, and the half of the idiom
    // that is easiest to drop.
    expect(columns).toContain('min(100%');
  });

  it('leaves the page-width bar the flex row it has always been', async () => {
    await renderOpenBar(false);

    const row = selectRow();
    expect(getComputedStyle(row).display).toBe('flex');
    expect(getComputedStyle(row).flexWrap).toBe('wrap');
  });
});

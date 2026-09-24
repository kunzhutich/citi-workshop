import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardFilters } from './useDashboardFilters';

/**
 * The filter bar's custom range.
 *
 * Two behaviours, and they are the two that would go wrong quietly. The pair
 * of date fields is **absent**, not merely hidden, until the reader asks for a
 * custom range — an absence is the kind of claim D25 was written about, so the
 * tests below take care to make theirs mean something. And a picked date is
 * written out as the calendar day the caller stores, at the moment it becomes
 * a date and not before: half a date in the address bar is eight report
 * requests sent against a period nobody chose.
 *
 * **These run the real `useDashboardFilters`** rather than a hand-made
 * `controls` object. The bar is driven by the URL, so choosing "Custom range…"
 * only actually opens anything if the write reaches the query string and comes
 * back — a stubbed `setFilters` would leave the select stuck on its old value
 * and every assertion below would be about a bar that never changed. The spy
 * sits *beside* the real hook so the exact changes can still be asserted.
 */

vi.mock('../../api/facilities', () => ({ fetchFacilityTree: vi.fn() }));

const { fetchFacilityTree } = await import('../../api/facilities');
const { DashboardFilterBar } = await import('./DashboardFilterBar');
const { useDashboardFilters } = await import('./useDashboardFilters');
const { renderWithAuth } = await import('../../test/renderWithProviders');
const { makeAdmin } = await import('../../test/factories');

/**
 * A fixed "now".
 *
 * Nothing on the bar reads it, but `useDashboardFilters` resolves its presets
 * against it, and a test that quietly depends on the hour it runs at is D40.
 */
const NOW = new Date('2026-09-24T09:00:00Z');

/** Every change the bar asked for, in order. */
let written: Array<Partial<DashboardFilters>>;

beforeEach(() => {
  written = [];
  vi.mocked(fetchFacilityTree).mockResolvedValue({ buildings: [] });
});

function Harness() {
  const controls = useDashboardFilters(NOW);
  return (
    <DashboardFilterBar
      controls={{
        ...controls,
        setFilters: (changes) => {
          written.push(changes);
          controls.setFilters(changes);
        },
      }}
    />
  );
}

/** Render the bar at a URL, and wait for it to be there. */
async function renderBar(route: string): Promise<void> {
  renderWithAuth(<Harness />, { user: makeAdmin(), route });
  await screen.findByRole('combobox', { name: 'Date range' });
}

/**
 * Every date field on the bar, whatever it is labelled.
 *
 * `role="group"` is what Material UI's date field exposes around its editable
 * sections, and it is deliberately the *broadest* query available: the absence
 * test below has to fail if a picker is rendered under the wrong label, which
 * a query naming "From" would not catch.
 */
function dateFields(): HTMLElement[] {
  return screen.queryAllByRole('group');
}

/** Pick an entry from the "Date range" select. */
async function chooseRange(label: string): Promise<void> {
  await userEvent.click(screen.getByRole('combobox', { name: 'Date range' }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

describe('the two ends of a custom range', () => {
  it('are out of reach until the custom range is chosen, and reachable after', async () => {
    await renderBar('/?range=30d');

    // The absence is asserted against a bar that has provably drawn itself.
    // Without this the next line is also true of a blank page, of a spinner
    // and of a typo in the render helper — D24 and D25 in one.
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent(
      'Last 30 days',
    );
    expect(screen.getByRole('combobox', { name: 'Building' })).toBeInTheDocument();

    expect(dateFields()).toHaveLength(0);

    await chooseRange('Custom range…');

    // The same query, four lines later. That is what stops the assertion
    // above from being empty for the wrong reason: if `dateFields` looked for
    // something this bar never renders, it would fail here instead of passing
    // silently up there.
    expect(dateFields()).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'From' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'To' })).toBeInTheDocument();
  });

  it('leave the accessibility tree again when a preset is chosen', async () => {
    await renderBar('/?range=custom&from=2026-09-15');

    expect(dateFields()).toHaveLength(2);

    await chooseRange('Last 7 days');

    // Awaited, because the pair now closes rather than vanishing: `Collapse`
    // finishes its exit transition before letting go, not on the click that
    // starts it — the same shape as the report questionnaire's sections.
    //
    // The claim is reachability, which is what a role query measures, and it
    // is deliberately *not* a claim about the DOM. Measured: with
    // `unmountOnExit` the collapsed fields leave the document entirely, and
    // without it two `role="group"` elements stay behind — but `Collapse`
    // hides them with `visibility: hidden`, so the accessibility tree is
    // empty either way and this assertion holds for both. A reader cannot
    // reach them in either case, and that is the rule worth pinning.
    await waitFor(() => {
      expect(dateFields()).toHaveLength(0);
    });
  });
});

describe('what a picked date writes', () => {
  it('writes the chosen day, as a day', async () => {
    // `from` is set so that its calendar opens on a known month and its open
    // button is distinguishable from the empty field's. Both matter: without
    // the first the test would depend on the month it runs in, and without
    // the second there would be two buttons called "Choose date".
    await renderBar('/?range=custom&from=2026-09-15');

    await userEvent.click(
      screen.getByRole('button', { name: 'Choose date, selected date is Sep 15, 2026' }),
    );
    const calendar = await screen.findByRole('dialog');
    await userEvent.click(within(calendar).getByRole('gridcell', { name: '20' }));

    // The whole log, not `toHaveBeenCalledWith`: one write, of one end, as a
    // calendar day. A day off by one, a second write carrying `to` as well,
    // an instant, or a US-formatted string all fail on this line, which is
    // where the format rule is enforced and the only place it is.
    //
    // It did not used to be the only place: `resolvePeriod` appended
    // `T00:00:00` to whatever was stored and threw `RangeError: Invalid time
    // value` on anything that was not a bare day, so a wrong format took the
    // screen down a hop later as well. That crash was a defect in its own
    // right — the same string can arrive from a hand-edited URL, where no
    // picker is involved — and R7 fixed it, so this assertion now stands on
    // its own.
    expect(written).toEqual([{ from: '2026-09-20' }]);
  });

  it('says nothing until what has been typed is a date', async () => {
    await renderBar('/?range=custom');

    const to = screen.getByRole('group', { name: 'To' });
    // Sections are month, day, year: `DateRangeFields` states no `format`, so
    // the field's grammar is whatever the dayjs adapter's locale gives, which
    // for `en` is `MM/DD/YYYY`. The section is reached by its name rather than
    // by its position, so a future format change fails the *click* here rather
    // than quietly typing a month into a day.
    await userEvent.click(within(to).getByRole('spinbutton', { name: 'Month' }));
    for (const key of ['0', '3', '1', '2', '2', '0', '2', '6']) {
      await userEvent.keyboard(key);
    }

    // The year is filled a digit at a time, so the picker reports 12 March in
    // the years 2, 20, 202 and 2026 — the first three of them real dates that
    // would have reached the address bar, and the reports behind it, one after
    // another. The field shows every keystroke; only the last is a write.
    //
    // Note that year 2 is a perfectly good `Date`: `0002-03-12` parses and
    // formats without complaint, so nothing downstream objects to it. Four
    // writes would simply have gone out, the eight reports behind them would
    // have been asked about the third century twice on the way, and the only
    // sign of it would have been a dashboard that flickered. Nothing but the
    // assertion below catches that — which is why it is on the whole write
    // log rather than on the last entry in it.
    expect(to).toHaveTextContent('03/12/2026');
    expect(written).toEqual([{ to: '2026-03-12' }]);
  });

  it('writes an empty string for a field the reader clears', async () => {
    await renderBar('/?range=custom&from=2026-09-15');

    const from = screen.getByRole('group', { name: 'From' });
    await userEvent.click(within(from).getByRole('spinbutton', { name: 'Month' }));
    await userEvent.keyboard('{Control>}a{/Control}{Delete}');

    // Cleared is a value, not a refusal: the range has lost its start and the
    // URL has to lose the parameter with it.
    expect(written).toEqual([{ from: '' }]);
  });
});

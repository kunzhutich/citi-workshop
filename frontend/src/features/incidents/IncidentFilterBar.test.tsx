import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IncidentQuery } from '../../api/incidents';
import type { Category, CategoryTree, CurrentUser } from '../../api/types';

/**
 * The two controls R7 added to the ticket list's filter bar, and what they
 * cost the chips beside them.
 *
 * Three rules are under test here, and each one fails silently rather than
 * loudly if it breaks. A date range stored as an instant but picked as a day
 * has to be widened to cover that whole local day, or a range ending "23
 * September" returns nothing reported on the 23rd and simply looks like a quiet
 * afternoon. An engineer filter drawn for a reader who cannot read the roster
 * is a control they can never fill in. And a chip beside a control showing the
 * same value is one filter said twice, which is how a reader learns to distrust
 * both.
 *
 * **The real `useIncidentFilters` runs**, rather than a hand-made `controls`
 * object, because the bar is driven by the URL: a picked date only reaches a
 * field if the write went to the query string and came back. The address bar is
 * therefore what these tests read, which is what the back button and a pasted
 * link read too.
 *
 * **Every absence here is asserted next to a positive**, following D25: the
 * same query that finds the engineer control for an admin is the one that must
 * come up empty for an employee, and the chips are asserted missing on a page
 * where another chip is provably on screen. An absence against a page that
 * never rendered is true of every rule ever written.
 */

vi.mock('../../api/categories', () => ({ fetchCategoryTree: vi.fn() }));
vi.mock('../../api/facilities', () => ({ fetchFacilityTree: vi.fn() }));
vi.mock('../../api/engineers', () => ({ listEngineers: vi.fn() }));

const { fetchCategoryTree } = await import('../../api/categories');
const { fetchFacilityTree } = await import('../../api/facilities');
const { listEngineers } = await import('../../api/engineers');
const { IncidentFilterBar } = await import('./IncidentFilterBar');
const { useIncidentFilters } = await import('./useIncidentFilters');
const { renderWithAuth } = await import('../../test/renderWithProviders');
const { makeAdmin, makeEngineer, makeEngineerRow, makeUser } = await import(
  '../../test/factories'
);

const SUBCATEGORY_ID = '33333333-3333-4333-8333-333333333333';

/** One group with one subcategory — enough for a chip to have a name. */
const CATEGORY_TREE: CategoryTree = {
  groups: [
    {
      ...makeCategory('44444444-4444-4444-8444-444444444444', 'Hardware'),
      children: [makeCategory(SUBCATEGORY_ID, 'Monitor')],
    },
  ],
};

const GRACE = makeEngineerRow({
  user_id: 'e0000000-0000-4000-8000-00000000000a',
  full_name: 'Grace Lin',
  level: 'LEAD',
});
const ANA = makeEngineerRow({
  user_id: 'e0000000-0000-4000-8000-00000000000b',
  full_name: 'Ana Costa',
  level: 'JUNIOR',
});

beforeEach(() => {
  search = '';
  vi.mocked(fetchCategoryTree).mockResolvedValue(CATEGORY_TREE);
  vi.mocked(fetchFacilityTree).mockResolvedValue({ buildings: [] });
  vi.mocked(listEngineers).mockResolvedValue({
    items: [GRACE, ANA],
    total: 2,
    page: 1,
    page_size: 100,
  });
  vi.mocked(listEngineers).mockClear();
});

/** The address bar as of the last committed render. */
let search = '';

/**
 * Publishes the query string to the test, and renders nothing.
 *
 * From an effect rather than during render: writing to a module variable while
 * rendering is a side effect React is entitled to run twice, and the lint rule
 * that says so is right even in a test. `userEvent` flushes effects, so by the
 * time an interaction has been awaited this is current.
 */
function LocationProbe() {
  const { search: current } = useLocation();
  useEffect(() => {
    search = current;
  }, [current]);
  return null;
}

function Harness({ preset }: { preset?: IncidentQuery }) {
  const controls = useIncidentFilters();
  return (
    <>
      <IncidentFilterBar controls={controls} preset={preset} />
      <LocationProbe />
    </>
  );
}

/** Render the bar for one reader at one URL, and wait for it to be there. */
async function renderBar(
  user: CurrentUser,
  route = '/tickets',
  preset?: IncidentQuery,
): Promise<void> {
  renderWithAuth(<Harness preset={preset} />, { user, route });
  await screen.findByRole('textbox', { name: 'Search' });
}

/** What is in the address bar now. */
function params(): URLSearchParams {
  return new URLSearchParams(search);
}

/**
 * The engineer control, or `null`.
 *
 * One query, used by the tests that expect it and by the tests that do not, so
 * that a query which has quietly stopped matching anything fails the positive
 * cases below instead of passing every negative one.
 */
function engineerControl(): HTMLElement | null {
  return screen.queryByRole('combobox', { name: 'Engineer' });
}

/**
 * Every control on the bar, named and in the order the grid lays them out.
 *
 * DOM order *is* the layout here: `FilterRow` is a plain `auto-fit` grid with
 * no explicit placement, so the order these appear in the markup is the order
 * they are read in, wrapped into however many columns the bar's own width
 * gives it (D44). Nothing else in the file would notice a control moving.
 *
 * Each item is named by the label a reader sees on it. Two class names rather
 * than `<label>`, and the reason is worth knowing: a `TextField select` has no
 * focusable input for a label to point at, so Material UI renders its
 * `InputLabel` as a plain `<div>` and hangs it off `aria-labelledby` instead —
 * five of the nine controls here would have come back nameless. The switch is
 * named by `FormControlLabel`'s own `<label>`, which reads "Escalated" because
 * a checkbox contributes no text of its own — and not by the class that sounds
 * right, `MuiFormControlLabel-label`, which Material UI only adds to a label it
 * had to wrap in a `Typography` itself. This bar passes one ready-made.
 *
 * Read off the grid's children rather than by querying for each control in
 * turn, so that a control appearing where no test expected one shows up as an
 * extra entry rather than as nothing at all.
 */
function controlOrder(): string[] {
  const field = screen.getByRole('textbox', { name: 'Search' }).closest('.MuiFormControl-root');
  const grid = field?.parentElement;
  if (!grid) {
    throw new Error('the search field is not inside the controls grid');
  }
  return [...grid.children].map(
    (item) =>
      item.querySelector('.MuiFormLabel-root, .MuiFormControlLabel-root')?.textContent ??
      '(unlabelled)',
  );
}

/**
 * An instant on this machine, from wall-clock parts.
 *
 * The suite runs wherever it runs — CI is not in the same zone as a VDI — and
 * a fixture written as a literal `Z` timestamp would be a different calendar
 * day in each. D40 is the entry about a test that was correct for three
 * quarters of the day; this is the same mistake spread over longitude instead
 * of over hours.
 */
function atLocal(
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
): string {
  return new Date(2026, month - 1, day, hours, minutes, seconds, milliseconds).toISOString();
}

/** An instant broken into the local wall-clock parts a reader would name. */
function localParts(iso: string | null): number[] {
  const value = new Date(iso ?? '');
  return [
    value.getFullYear(),
    value.getMonth() + 1,
    value.getDate(),
    value.getHours(),
    value.getMinutes(),
    value.getSeconds(),
    value.getMilliseconds(),
  ];
}

/**
 * The date a picker is currently showing, as [year, month, day].
 *
 * Read off the sections rather than off the field's text, because the text is
 * `DateRangeFields`' business: it prints `09/20/2026` today, printed
 * `20 Sep 2026` in between, and neither is the claim being made here. A
 * section's `aria-valuenow` is the date the control is actually holding
 * whatever grammar it is written in, and it is what a screen reader announces —
 * which is why these tests survived both of those changes untouched.
 */
function shownDate(fieldLabel: string): number[] {
  const field = screen.getByRole('group', { name: fieldLabel });
  const section = (name: string): number =>
    Number(within(field).getByRole('spinbutton', { name }).getAttribute('aria-valuenow'));
  return [section('Year'), section('Month'), section('Day')];
}

/** Open a picker's calendar by the date it is already showing. */
async function openCalendar(selected: string): Promise<HTMLElement> {
  await userEvent.click(
    screen.getByRole('button', { name: `Choose date, selected date is ${selected}` }),
  );
  return screen.findByRole('dialog');
}

/** Build a category, of which these tests care about the id and the name. */
function makeCategory(id: string, name: string): Category {
  return {
    id,
    parent_id: null,
    name,
    hint: null,
    icon: null,
    location_detail: 'FLOOR',
    sort_order: 1,
    is_active: true,
    // Nothing in this file is about watchers; it is here because the mirror
    // declares it, which is the point of a required field.
    allows_watchers: false,
  };
}

describe('the reported-between range', () => {
  it('is offered to every reader, employees included', async () => {
    // An employee, because they are the reader most likely to be refused
    // something: `GET /incidents` takes `created_from` from anybody, so there
    // is nothing here to withhold.
    await renderBar(makeUser());

    expect(screen.getByRole('group', { name: 'Reported from' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reported to' })).toBeInTheDocument();
    // Both ends and no third field: `DateRangeFields` renders a fragment, and
    // a wrapper sneaking back in would put two pickers in one grid column.
    expect(screen.getAllByRole('group')).toHaveLength(2);
  });

  it('shows the calendar day an instant falls on, in the reader’s own zone', async () => {
    // Late evening and early morning on purpose. Read as UTC — `slice(0, 10)`
    // on the stored string, say — the first of these is the 21st in any zone
    // west of Greenwich and the second is the 24th in any zone east of it.
    await renderBar(
      makeUser(),
      `/tickets?created_from=${atLocal(9, 20, 23, 30)}&created_to=${atLocal(9, 25, 0, 15)}`,
    );

    expect(shownDate('Reported from')).toEqual([2026, 9, 20]);
    expect(shownDate('Reported to')).toEqual([2026, 9, 25]);
  });

  it('widens a picked start to the first instant of that local day', async () => {
    await renderBar(makeUser(), `/tickets?created_from=${atLocal(9, 15)}`);

    const calendar = await openCalendar('Sep 15, 2026');
    await userEvent.click(within(calendar).getByRole('gridcell', { name: '10' }));

    // An instant, not a day: the same parameter carries a dashboard window
    // computed to the second, and `AppliedFilterChips` and the API both read
    // it as one.
    expect(params().get('created_from')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(localParts(params().get('created_from'))).toEqual([2026, 9, 10, 0, 0, 0, 0]);
  });

  it('widens a picked end to the last millisecond of that local day', async () => {
    await renderBar(makeUser(), `/tickets?created_to=${atLocal(9, 25, 23, 59, 59, 999)}`);

    const calendar = await openCalendar('Sep 25, 2026');
    await userEvent.click(within(calendar).getByRole('gridcell', { name: '20' }));

    // 23:59:59.999, because the API compares `created_at <= created_to`. Left
    // at its own midnight this range would exclude everything reported on the
    // 20th — the day the reader just named — and look like an empty afternoon
    // rather than like a bug.
    expect(localParts(params().get('created_to'))).toEqual([2026, 9, 20, 23, 59, 59, 999]);
  });

  it('leaves the end that did not move exactly as a link set it', async () => {
    // What a dashboard tile links with: the instant its report was computed
    // over, to the millisecond. Touching the other end must not round it to a
    // midnight, or the list stops being the set of tickets the tile counted.
    const fromTheDashboard = atLocal(8, 25, 11, 7, 43, 211);
    await renderBar(
      makeUser(),
      `/tickets?created_from=${fromTheDashboard}&created_to=${atLocal(9, 25, 23, 59, 59, 999)}`,
    );

    const calendar = await openCalendar('Sep 25, 2026');
    await userEvent.click(within(calendar).getByRole('gridcell', { name: '20' }));

    expect(params().get('created_from')).toBe(fromTheDashboard);
    expect(localParts(params().get('created_to'))).toEqual([2026, 9, 20, 23, 59, 59, 999]);
  });

  it('drops the parameter when a reader empties one end', async () => {
    await renderBar(makeUser(), `/tickets?created_from=${atLocal(9, 15)}`);

    const from = screen.getByRole('group', { name: 'Reported from' });
    await userEvent.click(within(from).getByRole('spinbutton', { name: 'Month' }));
    await userEvent.keyboard('{Control>}a{/Control}{Delete}');

    // Cleared is a value, not a refusal. An empty day must reach the hook as
    // `''`, which is what removes the parameter rather than storing the
    // instant that `new Date('')` would have produced.
    expect(params().get('created_from')).toBeNull();
    expect(search).toBe('');
  });
});

describe('the engineer filter', () => {
  it('is offered to a facility admin, with Unassigned beside the roster', async () => {
    await renderBar(makeAdmin());

    const control = await screen.findByRole('combobox', { name: 'Engineer' });
    await userEvent.click(control);

    // Unassigned is in the list because the dashboard links here with
    // `assignee_id=unassigned`: a value the control cannot represent is a
    // filter the reader cannot take off the control that claims to own it.
    expect(await screen.findByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Any engineer' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Grace Lin' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('option', { name: 'Ana Costa' }));

    expect(params().get('assignee_id')).toBe(ANA.user_id);
  });

  it('is offered to a LEAD engineer, who assigns other people’s work', async () => {
    await renderBar(makeEngineer('LEAD'));

    expect(await screen.findByRole('combobox', { name: 'Engineer' })).toBeInTheDocument();
  });

  it('is withheld from an employee, who cannot read the roster to fill it in', async () => {
    await renderBar(makeUser());

    // The bar is provably drawn before anything is said to be missing from
    // it: two neighbouring controls, found by the same kind of query.
    expect(screen.getByRole('combobox', { name: 'Building' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument();

    expect(engineerControl()).toBeNull();
    // And the request is never sent. `GET /engineers` answers an employee with
    // 403 `ROLE_NOT_PERMITTED`, so hiding the control while still asking would
    // trade a missing control for an error in the console.
    expect(listEngineers).not.toHaveBeenCalled();
  });

  it('is withheld from a JUNIOR engineer', async () => {
    await renderBar(makeEngineer('JUNIOR'));

    expect(screen.getByRole('combobox', { name: 'Building' })).toBeInTheDocument();
    expect(engineerControl()).toBeNull();
    // A junior *may* read the roster — `GET /engineers` is staff-only, not
    // admin-only — so this absence is not a permission. Narrowing a list to
    // one person's name is the question somebody distributing work asks, and
    // `layout/navigation.ts` already decides that a LEAD is who that is.
    expect(listEngineers).not.toHaveBeenCalled();
  });

  it('is withheld from a SENIOR engineer', async () => {
    await renderBar(makeEngineer('SENIOR'));

    expect(screen.getByRole('combobox', { name: 'Building' })).toBeInTheDocument();
    expect(engineerControl()).toBeNull();
    expect(listEngineers).not.toHaveBeenCalled();
  });

  it('keeps showing an applied assignee the roster does not hold', async () => {
    // A deactivated engineer, or simply a roster that has not arrived yet.
    // Without an entry of its own the select draws an empty field for a filter
    // that is applied, which is the one thing the chips were written to stop.
    await renderBar(makeAdmin(), '/tickets?assignee_id=99999999-9999-4999-8999-999999999999');

    expect(await screen.findByRole('combobox', { name: 'Engineer' })).toHaveTextContent(
      'One engineer',
    );
  });
});

describe('the chips beside these controls', () => {
  it('no longer chips the date range, now that every reader has the control', async () => {
    await renderBar(
      makeUser(),
      `/tickets?category_id=${SUBCATEGORY_ID}&created_from=${atLocal(9, 20)}` +
        `&created_to=${atLocal(9, 25, 23, 59, 59, 999)}`,
    );

    // The strip is provably on screen, with a chip in it, before the date
    // chip is said to be absent — otherwise this test would also pass against
    // a bar that rendered no chips at all.
    const strip = (await screen.findByText('Also filtered by:')).parentElement as HTMLElement;
    expect(within(strip).getByText('Subcategory: Monitor')).toBeInTheDocument();

    // Scoped to the strip, because the bar itself now says "Reported from" on
    // a field label: an unscoped query for that word finds the control this
    // chip was replaced by, and calls the rule broken while it is working.
    expect(within(strip).queryByText(/Reported/)).toBeNull();
    // And the filter is still visible, in the control that now owns it.
    expect(shownDate('Reported from')).toEqual([2026, 9, 20]);
  });

  it('still chips an assignee for a reader with no engineer control', async () => {
    await renderBar(makeUser(), '/tickets?assignee_id=unassigned');

    // The employee who followed a dashboard tile into this list. There is no
    // control for them, so the chip is the only thing on the page that says
    // why the list is short — and the only way to widen it again.
    expect(await screen.findByText('Unassigned')).toBeInTheDocument();
    expect(engineerControl()).toBeNull();
  });

  it('names the engineer on that chip for a reader who may read the roster', async () => {
    await renderBar(makeEngineer('SENIOR'), `/tickets?assignee_id=${ANA.user_id}`);

    expect(await screen.findByText('Assigned to Ana Costa')).toBeInTheDocument();
    expect(engineerControl()).toBeNull();
  });

  it('drops that chip for a reader whose bar has the control', async () => {
    await renderBar(makeAdmin(), '/tickets?assignee_id=unassigned');

    // The value is on the page once, in the control. The test above shows the
    // same URL producing a chip for an employee, and the one below shows this
    // reader getting chips when a filter genuinely has no control — so this
    // absence is about the rule and not about admins or about an empty page.
    expect(await screen.findByRole('combobox', { name: 'Engineer' })).toHaveTextContent(
      'Unassigned',
    );
    expect(screen.queryByText('Also filtered by:')).toBeNull();
  });

  it('still chips a subcategory, which no reader has a control for', async () => {
    await renderBar(makeAdmin(), `/tickets?category_id=${SUBCATEGORY_ID}`);

    expect(await screen.findByText('Subcategory: Monitor')).toBeInTheDocument();
  });
});

/**
 * A control over something the screen has already decided.
 *
 * `toQuery` applies a screen's preset **after** the reader's filters, and it
 * does that on purpose — My queue narrowed to somebody else's tickets is not
 * My queue. The consequence is that a control over a value the preset also
 * sets writes the address bar and changes nothing, which is a filter that
 * lies: it moves, the URL moves, the list does not.
 *
 * Both cases below are asserted against a bar that is provably drawn and
 * provably drawing the *other* controls, so an absence cannot pass because
 * nothing rendered (D25). The engineer case reuses `engineerControl()`, the
 * same query the positive tests above depend on.
 */
describe('a control the screen has already decided', () => {
  it('is not drawn for the assignee when the preset pins one', async () => {
    // `/unassigned`. A LEAD is exactly the reader who would otherwise see it.
    await renderBar(makeEngineer('LEAD'), '/unassigned', { assignee_id: 'unassigned', status: ['OPEN'] });

    expect(engineerControl()).toBeNull();
    // The bar is here and still offering what it can actually change.
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeInTheDocument();
  });

  it('is not drawn for the assignee when the preset is "mine", which the API rewrites', async () => {
    // `/queue`. `mine: 'assigned'` carries no `assignee_id`, and the server
    // resolves it by overwriting that field with the caller's own id — so the
    // control was inert for a reason nothing in the query string showed.
    await renderBar(makeEngineer('LEAD'), '/queue', { mine: 'assigned', closed_last: true });

    expect(engineerControl()).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeInTheDocument();
  });

  it('is not drawn for the status when the preset pins one', async () => {
    // Predates R7 — `/unassigned` has always pinned OPEN — and is fixed by the
    // same reading of the preset rather than by a second mechanism.
    await renderBar(makeEngineer('LEAD'), '/unassigned', { assignee_id: 'unassigned', status: ['OPEN'] });

    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeInTheDocument();
  });

  it('draws both of them on a screen that pins neither', async () => {
    // The positive half, and the reason the three absences above mean
    // anything: the same two queries find both controls on `/tickets`.
    await renderBar(makeEngineer('LEAD'));

    expect(engineerControl()).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  });
});

/**
 * Where the two ends of the range sit among everything else.
 *
 * The bar is one `auto-fit` grid, so a control's position is decided by nothing
 * but its position in this file, and the reflow is decided by two numbers that
 * vary independently: how many columns the bar's width allows, and how many
 * controls the screen's preset leaves in it. A range whose two ends wrap onto
 * different rows reads as two unrelated date fields, and putting the escalated
 * switch in front of them is what keeps them adjacent *and* last.
 *
 * Adjacency is what is pinned, because it is the part that is a decision.
 * Whether the pair also shares a row is arithmetic over those two numbers — six
 * columns at 1440px against seven, eight or nine controls — and asserting it
 * would mean asserting a column count jsdom does not have: there is no layout
 * here, so a test claiming "on their own line" would be claiming something it
 * cannot see. That belongs to the eye and to `responsive.spec.ts`.
 */
describe('the order the controls are laid out in', () => {
  it('puts the escalated switch ahead of the range, and the range last', async () => {
    await renderBar(makeAdmin());
    await screen.findByRole('combobox', { name: 'Engineer' });

    // The whole row, not "escalated comes before from". A pairwise assertion
    // stays true when a control is dropped, renamed or duplicated, and the
    // count is half the claim: nine items is what makes six columns put the
    // last three on the second row.
    expect(controlOrder()).toEqual([
      'Search',
      'Status',
      'Priority',
      'Category',
      'Building',
      'Engineer',
      'Escalated',
      'Reported from',
      'Reported to',
    ]);
  });

  it('keeps them last on a screen whose preset has taken two controls away', async () => {
    // `/unassigned`, the narrowest bar in the application: it pins both the
    // status and the assignee, so seven items reach the grid rather than nine.
    // The same two must still be the last two — this is the ordering rule
    // applied to a different set of controls, which is the case a hand-written
    // order would get wrong.
    await renderBar(makeEngineer('LEAD'), '/unassigned', {
      assignee_id: 'unassigned',
      status: ['OPEN'],
    });

    expect(controlOrder()).toEqual([
      'Search',
      'Priority',
      'Category',
      'Building',
      'Escalated',
      'Reported from',
      'Reported to',
    ]);
  });
});

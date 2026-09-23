import type { Page } from '@playwright/test';

import { expect, expectNothingLoading, test } from './fixtures/test';
import { reportIssue } from './fixtures/ticket';

/**
 * The three persona home screens, in a real browser, at both widths.
 *
 * **These assertions never name a number from the seed data.** The database
 * these run against is shared and reseedable — the `seed_demo` action is not
 * idempotent (decision D12) and every run of the other specs adds tickets — so
 * "Blocked is 21" would be a test that passes today and fails after somebody
 * demos the app. What is asserted instead is the *shape* of the answer:
 *
 * * a tile holds a number at all, rather than a dash or an empty box;
 * * a chart drew bars, rather than an empty plot;
 * * a tile's number and the list behind it agree — which is checkable without
 *   knowing either, and is the property that actually matters;
 * * the period and current-state sections are labelled differently, and the
 *   live link carries no dates.
 *
 * The last two are decision D9 reaching the browser. A tile that says 21 over
 * a list of 11 is the failure D9 exists to prevent, and it can only be caught
 * end to end: the tile comes from one endpoint and the list from another, so
 * no unit test sees both.
 */

/** Whether this project is the phone-sized one. */
function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 900;
}

/** How many pixels the document scrolls sideways. Should be none. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** The whole number a tile shows, found through the caption under it. */
async function tileValue(page: Page, caption: string | RegExp): Promise<number> {
  const card = page.locator('.MuiCard-root').filter({ hasText: caption }).first();
  await expect(card).toBeVisible();
  const text = await card.innerText();
  const match = /(\d[\d,]*)/.exec(text);
  expect(match, `no number in the tile captioned "${String(caption)}"`).not.toBeNull();
  return Number((match?.[1] ?? '0').replace(/,/g, ''));
}

test.describe('the employee home screen', () => {
  test('opens with a greeting, a report button and four real counts', async ({
    employeePage,
    accounts,
  }) => {
    // A ticket of this account's own, so the counts are not all zero and the
    // recent list has something in it. Reported through the questionnaire
    // rather than the API, so what the tiles count is what the app created.
    await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Monitor',
      title: 'Second monitor flickers after the dock firmware update',
      description: 'It blanks for about a second every few minutes on the right-hand screen.',
      priority: 'Medium',
    });

    await employeePage.goto('/');

    await expect(
      employeePage.getByRole('heading', { level: 1, name: new RegExp(accounts.employee.fullName.split(' ')[0]) }),
    ).toBeVisible();
    await expect(employeePage.getByRole('link', { name: /Report an issue/ }).first()).toBeVisible();

    // At least one open ticket, because one was just reported.
    expect(await tileValue(employeePage, 'Waiting to be picked up')).toBeGreaterThan(0);
    for (const caption of ['Someone is on it', 'Stalled on parts, access or you']) {
      expect(await tileValue(employeePage, caption)).toBeGreaterThanOrEqual(0);
    }

    // Current state, never a period — this screen has no date control and
    // must not imply one. See decision D9.
    await expect(
      employeePage.getByText(/Your tickets as they stand now, however long ago/),
    ).toBeVisible();

    await expect(employeePage.getByRole('heading', { name: 'Your recent tickets' })).toBeVisible();
    expect(await horizontalOverflow(employeePage)).toBeLessThanOrEqual(1);
  });

  test('hides "Needs your attention" until something is waiting, then shows it', async ({
    employeePage,
    seniorPage,
  }) => {
    test.skip(isMobile(employeePage), 'the same data path; run once to keep the suite quick');

    await employeePage.goto('/');
    // The section is absent, not hidden, while its query is in flight, and
    // `isVisible` does not retry — so reading it straight off `goto` would
    // record "not there yet" and call it "nothing is waiting". The assertion
    // at the end of this test is only worth making once the screen has
    // actually answered. See D24.
    await expectNothingLoading(employeePage);
    const heading = employeePage.getByRole('heading', { name: 'Needs your attention' });
    const startedVisible = await heading.isVisible();

    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Headset/Webcam',
      title: 'Headset microphone cuts out on calls',
      description: 'People stop hearing me after a few minutes and I have to rejoin.',
      priority: 'High',
    });

    // Take it through to RESOLVED, which is the state that puts a ticket in
    // front of its reporter.
    await seniorPage.goto(`/tickets?q=${encodeURIComponent(reference)}`);
    await seniorPage.getByRole('link', { name: new RegExp(reference) }).first().click();
    await seniorPage.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);
    await seniorPage.getByRole('button', { name: 'Pick up', exact: true }).click();
    await seniorPage.getByRole('button', { name: 'Start work', exact: true }).click();
    await seniorPage.getByRole('dialog').getByRole('button', { name: 'Start work' }).click();
    await seniorPage.getByRole('button', { name: 'Resolve', exact: true }).click();
    const dialog = seniorPage.getByRole('dialog');
    await dialog.getByLabel(/What did you do/i).fill('Replaced the headset and tested a call.');
    await dialog.getByRole('button', { name: 'Resolve' }).click();
    await expect(dialog).toBeHidden();

    await employeePage.goto('/');
    await expect(heading).toBeVisible();

    // The buttons come from `allowed-transitions`, so their presence here is
    // the API's answer rather than this screen's opinion about RESOLVED.
    const row = employeePage.locator('.MuiCard-root').filter({ hasText: reference }).first();
    await expect(row.getByRole('button', { name: 'Confirm fixed' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Still broken' })).toBeVisible();

    // And it really was hidden to start with, on an account that had nothing
    // resolved. Asserted last so a pre-existing resolved ticket weakens this
    // test rather than failing it for the wrong reason.
    expect(startedVisible).toBe(false);
  });
});

test.describe('the engineer home screen', () => {
  test('shows a senior their own work and an unassigned queue they may take', async ({
    seniorPage,
  }) => {
    await seniorPage.goto('/');

    await expect(seniorPage.getByRole('heading', { level: 1, name: 'Your work' })).toBeVisible();
    for (const caption of ['Yours, still open', 'You are working on these', 'Stalled, waiting on something']) {
      expect(await tileValue(seniorPage, caption)).toBeGreaterThanOrEqual(0);
    }

    await expect(
      seniorPage.getByRole('heading', { name: 'Unassigned in your specialties' }),
    ).toBeVisible();
    await expect(
      seniorPage.getByText('New tickets are assigned to you by your lead or admin.'),
    ).toHaveCount(0);

    expect(await horizontalOverflow(seniorPage)).toBeLessThanOrEqual(1);
  });

  test('gives a junior the sentence instead of a queue they cannot use', async ({
    juniorPage,
  }) => {
    await juniorPage.goto('/');

    await expect(
      juniorPage.getByText('New tickets are assigned to you by your lead or admin.'),
    ).toBeVisible();
    await expect(
      juniorPage.getByRole('heading', { name: 'Unassigned in your specialties' }),
    ).toHaveCount(0);
    await expect(juniorPage.getByRole('button', { name: 'Pick up' })).toHaveCount(0);

    expect(await horizontalOverflow(juniorPage)).toBeLessThanOrEqual(1);
  });
});

test.describe('the admin dashboard', () => {
  test('draws both sections, with charts and real numbers', async ({ adminPage }) => {
    await adminPage.goto('/');

    await expect(adminPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    // The two scope headings, each saying which question it answers.
    const period = adminPage.getByTestId('period-scope-heading');
    const current = adminPage.getByTestId('current-scope-heading');
    await expect(period).toBeVisible();
    await expect(period).toContainText('Reported in this period');
    await expect(period).toContainText('Counted over');
    await expect(current).toContainText('Right now');
    await expect(current).toContainText('The date range above does not apply to these');

    // Numbers rather than placeholders.
    expect(await tileValue(adminPage, 'Tickets raised in this period')).toBeGreaterThan(0);
    expect(await tileValue(adminPage, 'Stuck right now, however long ago')).toBeGreaterThanOrEqual(0);

    // A chart that actually drew marks. `.MuiBarChart-element` is the bar
    // rectangle itself, so this fails if the card renders but the plot is
    // empty — and it is the assertion that caught the styling in
    // BreakdownChart.tsx being written against class names that do not exist.
    const statusCard = adminPage.locator('.MuiCard-root').filter({ hasText: 'By status' }).first();
    await expect(statusCard.locator('.MuiBarChart-element').first()).toBeVisible();
    const bars = await statusCard.locator('.MuiBarChart-element').count();
    expect(bars).toBeGreaterThan(0);

    // Every bar's value is readable without hovering, which is the point of
    // labelling them outside the bar rather than centred inside it.
    await expect(statusCard.locator('.MuiBarChart-label').first()).toBeVisible();
    expect(await statusCard.locator('.MuiBarChart-label').count()).toBe(bars);

    await expect(adminPage.getByRole('table', { name: 'Engineer workload' })).toBeVisible();
    expect(await horizontalOverflow(adminPage)).toBeLessThanOrEqual(1);
  });

  test('a period tile opens exactly the tickets it counted', async ({ adminPage }) => {
    test.skip(isMobile(adminPage), 'the list pages differently on a phone; checked on desktop');

    await adminPage.goto('/');

    const expected = await tileValue(adminPage, 'Of those, nobody has started');
    await adminPage
      .locator('a')
      .filter({ hasText: 'Of those, nobody has started' })
      .first()
      .click();
    await adminPage.waitForURL(/\/tickets\?/);

    // The link carries the window the report used, so the list is the same
    // set of tickets rather than a superset.
    const query = new URL(adminPage.url()).searchParams;
    expect(query.getAll('status')).toEqual(['OPEN']);
    expect(query.get('created_from')).toBeTruthy();
    expect(query.get('created_to')).toBeTruthy();

    // And the filter is visible to the reader, not applied behind their back.
    await expect(adminPage.getByText(/^Reported between /)).toBeVisible();

    await expect(adminPage.getByRole('heading', { name: 'All tickets' })).toBeVisible();
    expect(await listTotal(adminPage)).toBe(expected);
  });

  test('a current-state tile opens an unwindowed list, and the totals agree', async ({
    adminPage,
  }) => {
    test.skip(isMobile(adminPage), 'the list pages differently on a phone; checked on desktop');

    await adminPage.goto('/');

    const expected = await tileValue(adminPage, 'Stuck right now, however long ago');
    await adminPage
      .locator('a')
      .filter({ hasText: 'Stuck right now, however long ago' })
      .first()
      .click();
    await adminPage.waitForURL(/\/tickets\?/);

    // The heart of decision D9 at the UI layer: a live number must not open a
    // windowed list, or the list would be shorter than the tile claimed.
    const query = new URL(adminPage.url()).searchParams;
    expect(query.getAll('status')).toEqual(['BLOCKED']);
    expect(query.get('created_from')).toBeNull();
    expect(query.get('created_to')).toBeNull();

    expect(await listTotal(adminPage)).toBe(expected);
  });

  test('drills a category group into its subcategories, and keeps it in the URL', async ({
    adminPage,
  }) => {
    test.skip(isMobile(adminPage), 'clicking a bar is a pointer gesture; checked on desktop');

    await adminPage.goto('/');

    const card = adminPage.locator('.MuiCard-root').filter({ hasText: 'By category' }).first();
    await expect(card).toBeVisible();

    // Through the table view rather than by clicking a bar: the same handler,
    // reached by a control a keyboard can also use.
    await card.getByRole('button', { name: 'Show as a table' }).click();
    const firstGroup = card.getByRole('button').filter({ hasNotText: 'Show as' }).nth(2);
    const groupName = (await firstGroup.innerText()).trim();
    await firstGroup.click();

    await expect(adminPage).toHaveURL(/group_id=/);
    await expect(
      adminPage.locator('.MuiCard-root').filter({ hasText: `Subcategories of ${groupName}` }),
    ).toBeVisible();

    // And back out again.
    await adminPage.getByRole('button', { name: 'All groups' }).click();
    await expect(adminPage).not.toHaveURL(/group_id=/);
  });

  test('applies the building filter to both sections', async ({ adminPage }) => {
    test.skip(isMobile(adminPage), 'the same requests; checked once on desktop');

    await adminPage.goto('/');
    // `CurrentScopeHeading` renders outside every `QueryState`, with "now" as
    // its fallback, so it proves only that the dashboard mounted. See D24.
    await expect(adminPage.getByTestId('current-scope-heading')).toBeVisible();
    await expectNothingLoading(adminPage);

    // By role, not by label: "By building" is also a chart card whose view
    // toggle is labelled "How to show By building".
    await adminPage.getByRole('combobox', { name: 'Building' }).click();
    // Option 0 is the hard-coded "Every building"; everything after it comes
    // from `useFacilityTree`, which is not behind a `QueryState` of its own,
    // so the menu is one item long until that query lands.
    const option = adminPage.getByRole('option').nth(1);
    await expect(option).toBeVisible();
    const buildingLabel = (await option.innerText()).trim();
    await option.click();

    await expect(adminPage).toHaveURL(/building_id=/);

    // Named in both headings, because `building_id` is a scope filter that
    // both kinds of report honour.
    const buildingName = buildingLabel.split('—').pop()?.trim() ?? buildingLabel;
    await expect(adminPage.getByTestId('period-scope-heading')).toContainText(buildingName);
    await expect(adminPage.getByTestId('current-scope-heading')).toContainText(buildingName);
  });
});

/**
 * How many tickets the list says it holds.
 *
 * The pagination footer rather than a row count, because it reports the whole
 * result set while the table shows one page of it.
 *
 * An empty result has no footer — `IncidentsPage` renders an empty state
 * instead of a table — so that case is read from the empty state and returned
 * as zero. Without this the helper would hang for fifteen seconds and then
 * fail on a quiet database, which is a property of the data rather than of the
 * code under test.
 */
async function listTotal(page: Page): Promise<number> {
  const footer = page.locator('.MuiTablePagination-displayedRows');
  const empty = page.getByText('No tickets match those filters');

  await expect(footer.or(empty).first()).toBeVisible();
  if (await empty.isVisible()) {
    return 0;
  }

  const text = await footer.innerText();
  const match = /of\s+([\d,]+)/.exec(text);
  expect(match, `could not read a total from "${text}"`).not.toBeNull();
  return Number((match?.[1] ?? '0').replace(/,/g, ''));
}

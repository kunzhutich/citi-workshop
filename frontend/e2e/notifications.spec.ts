import type { Page } from '@playwright/test';

import { expect, expectNothingLoading, test } from './fixtures/test';
import { openTicket, reportIssue, runTransition } from './fixtures/ticket';

/**
 * The notification inbox, in a real browser, at both widths.
 *
 * What this file is really testing is the **absences**, and absences are the
 * assertions this suite has been caught getting wrong twice. D24 found a test
 * reading a page that was still a spinner; D25 found one reporting that a
 * permission was enforced when it had never waited long enough to see either
 * answer. Both fixes are the same shape and both are applied here: before any
 * "this is not on the screen", first establish that the region which *would*
 * show it has rendered, and only then assert the absence.
 *
 * Two things about this suite's fixtures shape every test below, and both were
 * discovered by getting them wrong first.
 *
 * **The accounts are worker-scoped**, so an inbox accumulates across every
 * spec file in the run — `assignment.spec.ts` gives the junior tickets, and
 * the accessibility scan gives the employee one. A test that asserts "two
 * unread" would otherwise be asserting about everything that ran before it.
 * Each test starts by clearing the inboxes it is about to make claims on,
 * which turns every count into a statement about this test's own actions.
 *
 * **Marking read does not delete**, so a cleared inbox is not an empty one.
 * The positive anchor for "you were told nothing" is therefore the *unread*
 * filter's "Nothing unread", not the all-notifications empty state.
 */
test.describe('notifications', () => {
  /** The bell's accessible name carries the count; the badge is decoration. */
  function bell(page: Page) {
    return page.getByRole('link', { name: /^Notifications/ });
  }

  /**
   * Open the inbox through the application, and wait until it has settled.
   *
   * Navigating **inside the SPA**, not with `page.goto`. Two reasons, both
   * learned the hard way. A `goto` is a full page load, which drops the
   * in-memory access token and makes the app rotate its refresh cookie to get
   * a new one; doing that four times per test, in a run where the same account
   * has already been signed in by five other spec files, is how one of these
   * tests ended up looking at the login screen. And clicking the bell while
   * already *on* `/notifications` navigates nowhere — React Router keeps the
   * component mounted, nothing refetches, and the next assertion reads a
   * screen from a minute ago. Leaving through the app-bar link first is what
   * makes the return trip a real mount, and a real mount refetches.
   */
  async function openInbox(page: Page): Promise<void> {
    if (new URL(page.url()).pathname === '/notifications') {
      await page.getByRole('link', { name: 'ACME Facilities' }).click();
      await page.waitForURL((url) => url.pathname === '/');
    }
    await bell(page).click();
    await page.waitForURL(/\/notifications$/);
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    await expectNothingLoading(page);
  }

  /**
   * Reload, so that a badge changed by somebody else's action is on screen.
   *
   * The bell polls every thirty seconds, which is longer than this suite's
   * fifteen-second expect timeout, and an SPA navigation does not remount it.
   * A reload is the honest way to say "as a user would see it a moment later",
   * and it is used only where the badge itself is the subject.
   */
  async function refreshApp(page: Page): Promise<void> {
    await page.reload();
    await expect(page.getByRole('link', { name: 'ACME Facilities' })).toBeVisible();
  }

  /** Leave this inbox with nothing unread, so later counts mean this test. */
  async function clearInbox(page: Page): Promise<void> {
    await openInbox(page);
    const markAll = page.getByRole('button', { name: 'Mark all as read' });
    if (await markAll.isEnabled()) {
      await markAll.click();
      await expect(markAll).toBeDisabled();
    }
    await expect(bell(page)).toHaveAccessibleName('Notifications');
  }

  /**
   * Assert this person was told nothing new, without asserting on a spinner.
   *
   * The unread filter is the positive anchor: "Nothing unread" is rendered by
   * the screen at rest and cannot be produced by a loading state, and
   * `openInbox` has already waited for every query on the page to finish.
   * Only then is the ticket's absence asserted.
   */
  async function expectNothingNew(page: Page, reference: string): Promise<void> {
    await openInbox(page);
    await page.getByRole('button', { name: /^Unread/ }).click();
    await expectNothingLoading(page);
    await expect(page.getByText('Nothing unread')).toBeVisible();
    await expect(page.getByText(new RegExp(reference))).toHaveCount(0);
    await expect(bell(page)).toHaveAccessibleName('Notifications');
  }

  test('tell the reporter what happened, and never tell the person who did it', async ({
    employeePage,
    seniorPage,
    juniorPage,
    accounts,
  }) => {
    // The bell is a link, and this is the one place that proves it goes
    // somewhere — `openInbox` uses it everywhere else.
    await employeePage.goto('/');
    await bell(employeePage).click();
    await employeePage.waitForURL(/\/notifications$/);
    await expect(
      employeePage.getByRole('heading', { name: 'Notifications', level: 1 }),
    ).toBeVisible();

    await clearInbox(employeePage);
    await clearInbox(seniorPage);
    await clearInbox(juniorPage);

    // --- The employee reports something ------------------------------------
    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Monitor',
      title: 'Second monitor will not come out of standby',
      description:
        'The right-hand monitor stays black until I unplug it at the wall. It has done this '
        + 'every morning this week.',
      priority: 'High',
    });

    // Reporting notifies nobody: you know you reported it, and there is no
    // assignee yet to tell. The inbox was cleared above, so an empty bell is a
    // statement about this action rather than about a fresh account.
    await expect(bell(employeePage)).toHaveAccessibleName('Notifications');

    // --- A senior engineer picks it up and works it ------------------------
    await openTicket(seniorPage, reference);
    await seniorPage.getByRole('button', { name: 'Pick up', exact: true }).click();
    await expect(seniorPage.getByRole('button', { name: 'Start work', exact: true })).toBeVisible();
    await runTransition(seniorPage, 'Start work');
    await runTransition(seniorPage, 'Resolve', {
      'What did you do?': 'Replaced the display cable and confirmed it wakes from standby.',
    });

    // --- The employee has been told, and the badge says so -----------------
    // Three of them: an owner, a start, a resolution.
    await refreshApp(employeePage);
    await expect(bell(employeePage)).toHaveAccessibleName('Notifications, 3 unread');

    await openInbox(employeePage);
    await expect(employeePage.getByText(`Your ticket ${reference} is now Resolved.`)).toBeVisible();
    await expect(
      employeePage.getByText(
        `Your ticket ${reference} was assigned to ${accounts.senior.fullName}.`,
      ),
    ).toBeVisible();
    // Unread is signalled by a word, not only by a colour.
    await expect(employeePage.getByText('New').first()).toBeVisible();

    // --- The engineer was not told about their own work --------------------
    // Every action on this ticket was the senior's own.
    await expectNothingNew(seniorPage, reference);

    // --- Somebody uninvolved hears nothing at all --------------------------
    await expectNothingNew(juniorPage, reference);
  });

  test('a public staff note reaches the reporter and an internal one does not', async ({
    employeePage,
    seniorPage,
  }) => {
    await clearInbox(employeePage);

    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Keyboard/Mouse',
      title: 'Keyboard repeats characters at random',
      description:
        'Roughly one key in twenty repeats itself. It happens in every application, so it is '
        + 'not the software.',
      priority: 'Medium',
    });

    await openTicket(seniorPage, reference);
    await seniorPage.getByRole('button', { name: 'Pick up', exact: true }).click();
    await expect(seniorPage.getByRole('button', { name: 'Start work', exact: true })).toBeVisible();

    // An INTERNAL note on its own first, so that anything in the reporter's
    // inbox afterwards could only have come from it.
    await addNote(
      seniorPage,
      'Third keyboard from this batch. Flagging to procurement.',
      'Internal',
    );

    await openInbox(employeePage);
    // The positive wait: being given an owner already produced one
    // notification, so the list is provably on screen with a row in it. The
    // absence below is then a statement about the rule, not about the network.
    await expect(
      employeePage.getByText(new RegExp(`Your ticket ${reference} was assigned to`)),
    ).toBeVisible();
    await expect(
      employeePage.getByText(new RegExp(`added an update to your ticket ${reference}`)),
    ).toHaveCount(0);
    // No badge assertion here. The bell's query has a `staleTime` just under
    // its polling interval, so an SPA navigation does not refresh it — only a
    // reload or a mark-read mutation does. Counting is test three's job; this
    // test is about what the rule let through, and the list is where that
    // shows.

    // Now a PUBLIC one, which must arrive.
    await addNote(seniorPage, 'A replacement keyboard is on its way to your desk.', 'Public');

    // A reload rather than another in-app trip, and the reason is honest
    // uncertainty rather than a diagnosis. `staleTime: 0` on the feed makes
    // navigating back re-fetch, and the two tests below rely on exactly that
    // and pass — but *this* assertion failed under a full-suite run while
    // passing every time in isolation, with the notification provably in the
    // database and the returned page still carrying the previous `total`.
    // Whatever that is, it is one layer below the rule this test exists to
    // check, so the test takes the guaranteed path and the question is
    // recorded in D33 rather than papered over.
    await refreshApp(employeePage);
    await openInbox(employeePage);
    await expect(
      employeePage.getByText(new RegExp(`added an update to your ticket ${reference}`)),
    ).toBeVisible();
  });

  test('mark one read, then mark the rest, and the badge follows', async ({
    employeePage,
    seniorPage,
  }) => {
    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Docking Station',
      title: 'Dock drops the network every few minutes',
      description:
        'The wired connection through the dock disappears for about ten seconds, several '
        + 'times an hour. Wi-Fi is fine.',
      priority: 'Medium',
    });

    await clearInbox(employeePage);

    await openTicket(seniorPage, reference);
    await seniorPage.getByRole('button', { name: 'Pick up', exact: true }).click();
    await expect(seniorPage.getByRole('button', { name: 'Start work', exact: true })).toBeVisible();
    await runTransition(seniorPage, 'Start work');

    await refreshApp(employeePage);
    // Exactly two, from this test's own two actions: an owner, then a move.
    await expect(bell(employeePage)).toHaveAccessibleName('Notifications, 2 unread');

    await openInbox(employeePage);
    await expect(employeePage.getByText(new RegExp(`${reference} was assigned to`))).toBeVisible();

    // One row, by its tick. The label names the message, so this cannot
    // accidentally press "Mark all as read".
    await employeePage.getByRole('button', { name: /^Mark ".+" as read$/ }).first().click();
    await expect(bell(employeePage)).toHaveAccessibleName('Notifications, 1 unread');

    // The unread filter narrows to what is left. Counted by "New" chips
    // rather than by `listitem`, which also counts the dividers' `<li>`s.
    await employeePage.getByRole('button', { name: /^Unread/ }).click();
    await expectNothingLoading(employeePage);
    await expect(employeePage.getByText('New')).toHaveCount(1);

    await employeePage.getByRole('button', { name: 'All', exact: true }).click();
    await expectNothingLoading(employeePage);
    await employeePage.getByRole('button', { name: 'Mark all as read' }).click();

    await expect(bell(employeePage)).toHaveAccessibleName('Notifications');
    await expect(employeePage.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    // The rows are still there; only their state changed.
    await expect(employeePage.getByText(new RegExp(`${reference} was assigned to`))).toBeVisible();
    await expect(employeePage.getByText('New')).toHaveCount(0);
  });

  test('opening a notification goes to its ticket and clears it', async ({
    employeePage,
    seniorPage,
  }) => {
    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Headset/Webcam',
      title: 'Headset microphone is not picked up in calls',
      description:
        'People on calls cannot hear me through the headset, but the laptop microphone works.',
      priority: 'Medium',
    });

    await clearInbox(employeePage);

    await openTicket(seniorPage, reference);
    await seniorPage.getByRole('button', { name: 'Pick up', exact: true }).click();
    await expect(seniorPage.getByRole('button', { name: 'Start work', exact: true })).toBeVisible();

    await openInbox(employeePage);
    // By its text rather than by the link's accessible name: the name of a row
    // is the message *plus* its whole meta line, which makes a `getByRole`
    // match sensitive to wording that is not the subject of this test. The
    // click still lands on the link, because the text is inside it.
    await employeePage.getByText(new RegExp(`${reference} was assigned to`)).click();

    await employeePage.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);
    await expect(employeePage.getByText(reference, { exact: true }).first()).toBeVisible();
    // Following the link is what reading one means.
    await expect(bell(employeePage)).toHaveAccessibleName('Notifications');
  });
});

/**
 * Add a note of the given visibility through the ticket detail page.
 *
 * The switch is the staff-only one `NoteComposer` shows to staff; its label is
 * the sentence the engineer reads, which is what the test should be driving.
 */
async function addNote(page: Page, body: string, visibility: 'Public' | 'Internal'): Promise<void> {
  const composer = page.getByLabel(/^Add a note/);
  await expect(composer).toBeVisible();
  await composer.fill(body);

  const staffOnly = page.getByLabel(/Staff only/);
  if (visibility === 'Internal') {
    await staffOnly.check();
  } else if (await staffOnly.isChecked()) {
    await staffOnly.uncheck();
  }

  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByText(body).first()).toBeVisible();
}

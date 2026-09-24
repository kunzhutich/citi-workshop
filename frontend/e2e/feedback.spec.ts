import type { Locator } from '@playwright/test';

import { expect, expectNothingLoading, test } from './fixtures/test';
import { openTicket, reportIssue, runTransition } from './fixtures/ticket';

/**
 * Rating a repair, driven through the interface by four people.
 *
 * Two things are checked here that nothing else can check.
 *
 * **The round trip**: a reporter rates work that was actually done, through
 * the real dialog, and the engineer finds it in their bell. Every step is a
 * click on a control the API said was available — nothing posts a payload or
 * reads a flag.
 *
 * **Who sees it, in a browser.** The visibility rule is exercised in
 * `tests/integration/test_feedback.py` against the API, which is where it
 * belongs. What that cannot show is the *screen*: a JUNIOR engineer opening
 * the same ticket, able to read its notes and act on it, with no trace of the
 * review anywhere on the page. Here the assertion is about what is rendered.
 *
 * **The absences are made to earn it.** Every "cannot see the rating" check
 * below is paired with something on the same page that the same person *can*
 * see — the ticket's own activity — so a page that failed to load, a ticket
 * that does not exist, and a filter that hid everything from everybody all
 * fail rather than pass. That is D24 and D25's lesson, and the whole reason
 * `expectNothingLoading` is called before each of them.
 */

const COMMENT = 'Back working within the hour, and they explained what had failed.';

/**
 * Choose a score by clicking its star, the way a person does.
 *
 * Material UI hides the real `<input type="radio">` under a `<label>`, so the
 * label is the control. In a browser this works; in jsdom it does not, which
 * is why `FeedbackDialog.test.tsx` has to reach for `fireEvent` instead.
 */
async function chooseScore(dialog: Locator, score: number): Promise<void> {
  const label = score === 1 ? '1 Star' : `${score} Stars`;
  await dialog.getByText(label, { exact: true }).click();
}

test.describe('feedback on a repair', () => {
  test('is left by the reporter, reaches the engineer, and is hidden from a colleague', async ({
    employeePage,
    seniorPage,
    juniorPage,
    adminPage,
    accounts,
  }) => {
    // --- Work that was actually done ---------------------------------------
    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Monitor',
      title: 'Second monitor stays black on the dock',
      description:
        'It lights up on the laptop directly but not through the dock. Reseating the '
        + 'cable made no difference.',
      priority: 'Medium',
    });

    await openTicket(seniorPage, reference);
    await seniorPage.getByRole('button', { name: 'Pick up', exact: true }).click();
    await runTransition(seniorPage, 'Start work');
    await runTransition(seniorPage, 'Resolve', {
      'What did you do?': 'Replaced the dock. The old one had a failed display port.',
    });

    // --- The reporter rates it ---------------------------------------------
    await openTicket(employeePage, reference);
    await expectNothingLoading(employeePage);

    const rate = employeePage.getByRole('button', { name: 'Rate the work' });
    await expect(rate).toBeVisible();
    await rate.click();

    const dialog = employeePage.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The engineer who did the work is named, so the reporter knows whose
    // work they are judging.
    await expect(dialog.getByText(accounts.senior.fullName, { exact: false })).toBeVisible();

    // Words are required at every score, including the top one. The button
    // stays disabled until both halves are there — the owner's rule, and the
    // one most likely to be "simplified" into asking only on a low score.
    await chooseScore(dialog, 5);
    const send = dialog.getByRole('button', { name: 'Send feedback' });
    await expect(send).toBeDisabled();

    await dialog.getByLabel('Why this score?').fill(COMMENT);
    await expect(send).toBeEnabled();
    await send.click();
    await expect(dialog).toBeHidden();

    // --- It is on the timeline, and the button has gone --------------------
    await expectNothingLoading(employeePage);
    await expect(employeePage.getByText('5/5 — Could not have been better')).toBeVisible();
    await expect(employeePage.getByText(COMMENT)).toBeVisible();
    // One rating per repair: the way back in is closed, by the API's flag.
    await expect(employeePage.getByRole('button', { name: 'Rate the work' })).toHaveCount(0);

    // --- The engineer is told, and can read it in full ---------------------
    await seniorPage.goto('/notifications');
    await expectNothingLoading(seniorPage);
    await expect(
      seniorPage.getByText(`${accounts.employee.fullName} rated your work on ${reference}.`),
    ).toBeVisible();
    // The sentence is a pointer, never a copy: it names neither the score nor
    // the words. `app/models/notification.py` on why.
    await expect(seniorPage.getByText(COMMENT)).toHaveCount(0);

    await openTicket(seniorPage, reference);
    await expectNothingLoading(seniorPage);
    await expect(seniorPage.getByText(COMMENT)).toBeVisible();

    // --- A colleague sees the ticket and none of the review ----------------
    await openTicket(juniorPage, reference);
    await expectNothingLoading(juniorPage);
    // The control: they are looking at the right ticket, fully loaded.
    await expect(juniorPage.getByText('Status changed: In progress → Resolved')).toBeVisible();
    await expect(juniorPage.getByText(COMMENT)).toHaveCount(0);
    await expect(juniorPage.getByText('5/5 — Could not have been better')).toHaveCount(0);

    // --- An admin sees it, because evaluating the team is the point --------
    await openTicket(adminPage, reference);
    await expectNothingLoading(adminPage);
    await expect(adminPage.getByText(COMMENT)).toBeVisible();
    // And cannot leave one: a rating is the reporter's opinion or nobody's.
    await expect(adminPage.getByRole('button', { name: 'Rate the work' })).toHaveCount(0);
  });

  test('cannot be left on a ticket nobody has resolved', async ({ employeePage }) => {
    // The absence that needs a control most: an OPEN ticket has plenty of
    // buttons, so "no Rate the work" is a statement about this rule rather
    // than about an empty Actions card. One of the others is asserted present
    // in the same breath.
    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Keyboard/Mouse',
      title: 'Space bar sticks on the left-hand side',
      description: 'It repeats or misses depending on where the key is pressed.',
      priority: 'Low',
    });

    await openTicket(employeePage, reference);
    await expectNothingLoading(employeePage);

    await expect(
      employeePage.getByRole('button', { name: 'Cancel ticket', exact: true }),
    ).toBeVisible();
    await expect(employeePage.getByRole('button', { name: 'Rate the work' })).toHaveCount(0);
  });
});

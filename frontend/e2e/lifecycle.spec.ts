import { expect, test } from './fixtures/test';
import { expectStatus, openTicket, reportIssue, runTransition } from './fixtures/ticket';

/**
 * One ticket's whole life, driven through the interface by three people.
 *
 * This is M6's acceptance criterion, and it runs at both widths:
 * report → pick up → start → block → resume → resolve → confirm → reopen.
 *
 * Every step is a click on a button the API said was available. Nothing here
 * navigates to an endpoint, posts a payload or reads a flag — if
 * `allowed-transitions` stopped returning "Resolve" for an assignee, this
 * test would fail at the point a user would, looking for a button that is not
 * there.
 *
 * It is one long test rather than eight short ones on purpose. The subject is
 * a *sequence*: "resume work" only means anything on a ticket that is blocked,
 * and eight tests would each have to manufacture the state before it, which
 * would mean eight tests exercising the earlier steps through some faster,
 * less honest path.
 */
test.describe('one ticket, three people', () => {
  test('is reported, picked up, blocked, resumed, resolved, confirmed and reopened', async ({
    employeePage,
    seniorPage,
    accounts,
  }) => {
    // --- The employee reports it -------------------------------------------
    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Monitor',
      title: 'Left monitor flickers and goes black',
      description:
        'It blanks for a second every few minutes and comes back. Started this morning. '
        + 'Swapping the cable made no difference.',
      priority: 'High',
    });

    expect(reference).toMatch(/^INC-\d+$/);
    await expectStatus(employeePage, 'Open');

    // The reporter's only workflow move on their own open ticket. An engineer
    // has "Start work" here; the difference comes from the API, not from a
    // role check in the page.
    await expect(
      employeePage.getByRole('button', { name: 'Cancel ticket', exact: true }),
    ).toBeVisible();
    await expect(
      employeePage.getByRole('button', { name: 'Start work', exact: true }),
    ).toHaveCount(0);

    // --- A senior engineer picks it up -------------------------------------
    await openTicket(seniorPage, reference);
    await expect(seniorPage.getByText('Nobody yet')).toBeVisible();

    await seniorPage.getByRole('button', { name: 'Pick up', exact: true }).click();
    await expect(seniorPage.getByText(accounts.senior.fullName).first()).toBeVisible();

    // "Start work" is guarded on the ticket having an assignee, so it appears
    // only now — `_requires_an_assignee` in app/workflow.py.
    await runTransition(seniorPage, 'Start work');
    await expectStatus(seniorPage, 'In progress');

    // --- It gets blocked, then unblocked ------------------------------------
    await runTransition(seniorPage, 'Mark blocked', {
      'What is it waiting on?': 'Waiting on parts',
      Details: 'Replacement panel ordered from the vendor, due Thursday.',
    });
    await expectStatus(seniorPage, 'Blocked');

    // The block reason belongs to the stepper, not to a separate banner: the
    // "In progress" step wears an error state and says why.
    await expect(seniorPage.getByText('Replacement panel ordered').first()).toBeVisible();

    await runTransition(seniorPage, 'Resume work');
    await expectStatus(seniorPage, 'In progress');

    // --- A note the reporter can read, and one they cannot ------------------
    await seniorPage.getByLabel('Add a note').fill('The new panel arrived, fitting it now.');
    await seniorPage.getByRole('button', { name: 'Add note' }).click();
    await expect(seniorPage.getByText('The new panel arrived, fitting it now.')).toBeVisible();

    await seniorPage.getByLabel(/Staff only/).check();
    await seniorPage.getByLabel('Add a note').fill('Third failure on this batch of panels.');
    await seniorPage.getByRole('button', { name: 'Add note' }).click();
    await expect(seniorPage.getByText('Third failure on this batch of panels.')).toBeVisible();

    // --- It is resolved ------------------------------------------------------
    await runTransition(seniorPage, 'Resolve', {
      'What did you do?': 'Replaced the monitor panel and ran it for an hour without a flicker.',
    });
    await expectStatus(seniorPage, 'Resolved');

    // --- The employee sees the public note, and not the internal one --------
    await employeePage.reload();
    await expectStatus(employeePage, 'Resolved');
    await expect(employeePage.getByText('The new panel arrived, fitting it now.')).toBeVisible();
    await expect(
      employeePage.getByText('Third failure on this batch of panels.'),
    ).toHaveCount(0);

    // --- The employee confirms it is fixed ----------------------------------
    await runTransition(employeePage, 'Confirm fixed');
    await expectStatus(employeePage, 'Closed');

    // --- And then it is not, so they reopen it ------------------------------
    await runTransition(employeePage, 'Reopen', {
      'Why?': 'It started flickering again two hours later.',
    });
    await expectStatus(employeePage, 'In progress');
    await expect(employeePage.getByText('Reopened ×1')).toBeVisible();

    // The whole history is one stream, oldest first, and every step above is
    // in it.
    const activity = employeePage.getByRole('list', { name: 'Activity' });
    await expect(activity.getByText('Reported: Open')).toBeVisible();
    await expect(activity.getByText('Status changed: Blocked → In progress')).toBeVisible();
    await expect(activity.getByText('Reopened: Closed → In progress')).toBeVisible();
  });
});

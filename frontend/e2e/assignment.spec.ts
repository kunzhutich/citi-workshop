import { expect, test } from './fixtures/test';
import { expectStatus, openTicket, reportIssue, runTransition } from './fixtures/ticket';

/**
 * The other way through the same workflow.
 *
 * `lifecycle.spec.ts` walks the path a senior engineer takes on their own:
 * pick up, work, resolve, and the reporter confirms. This is the path when
 * the work is *given* to someone — an admin assigns a junior, who may never
 * assign anything — and when nobody confirms, so the ticket is closed from
 * the other side and reopened by an admin rather than its reporter.
 *
 * It also covers escalation, which the reporter's happy path never reaches.
 *
 * Desktop only. The branch is about who may do what, and permissions do not
 * change at 900px; the layout that does is covered by `responsive.spec.ts`
 * and by running the lifecycle at both widths.
 */
test.describe('work that is given rather than taken', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 900,
    'permission branches do not vary by width',
  );

  test('is assigned by an admin, closed by the engineer and reopened by the admin', async ({
    employeePage,
    juniorPage,
    adminPage,
    accounts,
  }) => {
    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Docking Station',
      title: 'Dock stops charging when the lid is closed',
      description:
        'The laptop discharges overnight while docked. Two different docks behave the same way.',
      priority: 'Medium',
    });

    // --- A junior engineer may not take it ---------------------------------
    await openTicket(juniorPage, reference);
    await expect(juniorPage.getByRole('button', { name: 'Pick up', exact: true })).toHaveCount(0);
    await expect(juniorPage.getByRole('button', { name: 'Assign…' })).toHaveCount(0);

    // --- The admin gives it to them ----------------------------------------
    await openTicket(adminPage, reference);
    await adminPage.getByRole('button', { name: 'Assign…' }).click();

    const assignDialog = adminPage.getByRole('dialog');
    await expect(assignDialog).toBeVisible();
    // Ordered by specialty match then lowest load, so both engineers created
    // for this run are present and labelled.
    await expect(assignDialog.getByText('Specialty').first()).toBeVisible();
    await assignDialog.getByRole('button', { name: new RegExp(accounts.junior.fullName) }).click();
    await expect(assignDialog).toBeHidden();

    await expect(adminPage.getByText(accounts.junior.fullName).first()).toBeVisible();

    // --- The junior can now work it ----------------------------------------
    await juniorPage.reload();
    await runTransition(juniorPage, 'Start work');
    await expectStatus(juniorPage, 'In progress');

    // --- The reporter is unhappy and escalates ------------------------------
    await employeePage.reload();
    await runTransitionlessAction(employeePage, 'Escalate', {
      'Why does this need attention?': 'I have had no power at my desk for two days.',
    });
    // Escalation is not a status, so it is asserted on the actions rather than
    // the status chip: a ticket that is already escalated cannot be escalated
    // again, and only an escalated one can be cleared.
    await expect(
      employeePage.getByRole('button', { name: 'Escalate', exact: true }),
    ).toHaveCount(0);

    // --- The admin deals with it and clears the flag ------------------------
    await adminPage.reload();
    await expect(adminPage.getByText('I have had no power at my desk').first()).toBeVisible();
    await runTransitionlessAction(adminPage, 'Clear escalation', {
      'What was done about it?': 'Loaner dock issued today; the replacement arrives Friday.',
    });
    await expect(
      adminPage.getByRole('button', { name: 'Clear escalation', exact: true }),
    ).toHaveCount(0);
    await expect(adminPage.getByRole('button', { name: 'Escalate', exact: true })).toBeVisible();

    // The flag is gone, but the history of it is not: both events stay in the
    // timeline, which is the point of an append-only audit log.
    const adminActivity = adminPage.getByRole('list', { name: 'Activity' });
    await expect(adminActivity.getByText('Escalated', { exact: true })).toBeVisible();
    await expect(adminActivity.getByText('Escalation cleared')).toBeVisible();

    // --- Resolved, then closed by the engineer rather than the reporter -----
    await juniorPage.reload();
    await runTransition(juniorPage, 'Resolve', {
      'What did you do?': 'Replaced the dock and confirmed it charges with the lid closed.',
    });
    await expectStatus(juniorPage, 'Resolved');

    await runTransition(juniorPage, 'Close ticket');
    await expectStatus(juniorPage, 'Closed');

    // --- And the admin reopens it -------------------------------------------
    await adminPage.reload();
    await runTransition(adminPage, 'Reopen', {
      'Why?': 'The reporter says the replacement does the same thing.',
    });
    await expectStatus(adminPage, 'In progress');
    await expect(adminPage.getByText('Reopened ×1')).toBeVisible();
  });
});

/**
 * Press one of the non-workflow actions and complete its dialog.
 *
 * Escalate and Clear escalation are not transitions — they have their own
 * endpoints and their own dialogs, and their buttons come from the `can_*`
 * flags rather than from `allowed-transitions`. The shape is the same, so
 * this is `runTransition` without the assumption that the dialog's submit
 * button repeats the label that opened it.
 */
async function runTransitionlessAction(
  page: import('@playwright/test').Page,
  actionLabel: string,
  fields: Record<string, string>,
): Promise<void> {
  await page.getByRole('button', { name: actionLabel, exact: true }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  for (const [label, value] of Object.entries(fields)) {
    await dialog.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).fill(value);
  }

  await dialog.getByRole('button', { name: actionLabel, exact: true }).click();
  await expect(dialog).toBeHidden();
}

import { expect, type Page } from '@playwright/test';

/**
 * Driving the ticket screens the way a person does.
 *
 * Every helper here queries by role and visible text — the button someone
 * would press, the field someone would read the label of — rather than by CSS
 * class or test id. A test that clicks `.MuiButton-root:nth-child(2)` passes
 * after a change that moves the button somewhere useless.
 *
 * The seat field is the one that takes an argument. The questionnaire calls
 * it "Desk" for most groups and "Room" for meeting rooms, so the caller says
 * which it expects — that is a thing a user knows, and asserting it is testing
 * the feature rather than working around it.
 */

export interface ReportDetails {
  group: string;
  subcategory: string;
  title: string;
  description: string;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  /** What the questionnaire calls the seat for this group. Default "Desk". */
  seatLabel?: string;
}

/**
 * Fill in the questionnaire and submit it.
 *
 * Returns the new ticket's reference, read from the detail page it lands on.
 */
export async function reportIssue(page: Page, details: ReportDetails): Promise<string> {
  await page.goto('/report');

  // Asserted before it is clicked, so a name that does not exist fails here
  // with "no such card" rather than after ninety seconds of `click()` waiting
  // for one to appear. A misspelled subcategory cost exactly that once.
  const groupCard = page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(details.group)}`),
  });
  await expect(groupCard, `no category group card named "${details.group}"`).toBeVisible();
  await groupCard.click();

  const subcategoryCard = page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(details.subcategory)}$`),
  });
  await expect(
    subcategoryCard,
    `no subcategory card named "${details.subcategory}" under ${details.group}`,
  ).toBeVisible();
  await subcategoryCard.click();

  // Which of these three the group asks for comes from its `location_detail`,
  // so the helper fills whichever appeared rather than assuming. A building
  // is required by every group, so its absence is a failure rather than a
  // field to skip.
  await selectFirstOption(page, 'Building', { required: true });
  await selectFirstOption(page, 'Floor');
  await selectFirstOption(page, details.seatLabel ?? 'Desk');

  await page.getByLabel('Title').fill(details.title);
  await page.getByLabel('What happened?').fill(details.description);

  const priorityCard = page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(details.priority)}`),
  });
  await expect(priorityCard, 'the priority cards should be revealed by now').toBeVisible();
  await priorityCard.click();

  await page.getByRole('button', { name: 'Report this issue' }).click();

  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);
  return readReference(page);
}

/** The `INC-000123` shown at the top of the detail page. */
export async function readReference(page: Page): Promise<string> {
  const reference = await page.getByText(/^INC-\d+$/).first().innerText();
  return reference.trim();
}

/**
 * Open a ticket by its reference, through the search box a person would use.
 *
 * Deliberately not `page.goto('/tickets/<uuid>')`. Nobody knows a ticket's
 * UUID; they know INC-000123, and getting from one to the other is a feature
 * — the list's ticket-number search — that deserves to be exercised on the
 * way to everything else.
 */
export async function openTicket(page: Page, reference: string): Promise<void> {
  await page.goto(`/tickets?q=${encodeURIComponent(reference)}`);
  await page.getByRole('link', { name: new RegExp(escapeRegExp(reference)) }).first().click();
  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);
  await expect(page.getByText(reference, { exact: true }).first()).toBeVisible();
}

/** The status chip in the detail page header. */
export async function expectStatus(page: Page, status: string): Promise<void> {
  await expect(page.getByTestId('incident-status')).toHaveText(status);
}

/** Fields a transition dialog may ask for, keyed by the label it shows. */
export type TransitionFields = Record<string, string>;

/**
 * Press a workflow button and complete the dialog it opens.
 *
 * `fields` is keyed by the dialog's visible labels rather than by the API's
 * field names, because the dialog is built from `required_fields` and the
 * test should be asserting what a user sees. A label the dialog does not show
 * is a failure worth having: it means the transition asked for something the
 * test did not expect.
 */
export async function runTransition(
  page: Page,
  actionLabel: string,
  fields: TransitionFields = {},
): Promise<void> {
  await page.getByRole('button', { name: actionLabel, exact: true }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  for (const [label, value] of Object.entries(fields)) {
    const field = dialog.getByLabel(label, { exact: false }).first();
    const isSelect = (await field.getAttribute('role')) === 'combobox';
    if (isSelect) {
      await field.click();
      await page.getByRole('option', { name: value, exact: true }).click();
    } else {
      await field.fill(value);
    }
  }

  await dialog.getByRole('button', { name: actionLabel, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Choose the first option of a select, if that select is on screen.
 *
 * Quiet about an absent field unless `required`, because the questionnaire
 * reveals the floor and seat fields only for groups whose `location_detail`
 * asks for them — a helper that insisted on all three could only report a
 * Software problem by knowing that rule.
 *
 * The label is matched as a prefix, not exactly. Material UI appends an
 * asterisk to a required field's label, so the accessible name of the
 * building select is "Building *" — and an exact match would find nothing,
 * skip the field and fail three steps later on a form that was never filled
 * in. Which is precisely what it did the first time this ran.
 */
async function selectFirstOption(
  page: Page,
  label: string,
  { required = false }: { required?: boolean } = {},
): Promise<void> {
  const select = page.getByLabel(new RegExp(`^${escapeRegExp(label)}`));

  if (required) {
    await expect(select, `the "${label}" field should be on the form`).toBeVisible();
  } else if (!(await select.isVisible())) {
    return;
  }

  await select.click();
  await page.getByRole('option').first().click();
}

/** Escape a string for use inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

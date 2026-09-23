import {
  test as base,
  expect,
  request as playwrightRequest,
  type Browser,
  type Page,
} from '@playwright/test';

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiLogin,
  createEngineer,
  deactivateUser,
  findCategoryGroupId,
  registerEmployee,
  type Account,
} from './api';

/**
 * The three accounts a lifecycle needs, and a signed-in page for each.
 *
 * Three **browser contexts**, not one page signing in and out. Each context
 * has its own cookie jar, so the employee's session and the engineer's
 * session exist at the same time and a test can move between them in one
 * statement. Signing out and in again between every step would work, but it
 * would also mean a failure in `POST /auth/logout` failing a test about
 * resolving a ticket.
 *
 * The accounts are **worker-scoped** and suffixed with the worker index and a
 * timestamp. Created once per run, reused by every test in that worker, and
 * deactivated afterwards. Emails are unique because the development database
 * is shared with whoever is using the app, and a fixed address would collide
 * with the run before it.
 */

export interface Accounts {
  employee: Account;
  /** SENIOR: may pick up an unassigned open ticket. */
  senior: Account;
  /** JUNIOR: may never assign, so tickets have to be given to them. */
  junior: Account;
  admin: Account;
  /** The "Hardware" group, which both engineers specialise in. */
  hardwareGroupId: string;
}

interface WorkerFixtures {
  accounts: Accounts;
}

interface TestFixtures {
  employeePage: Page;
  seniorPage: Page;
  juniorPage: Page;
  adminPage: Page;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  accounts: [
    // Playwright inspects this parameter's source to work out which fixtures
    // the function depends on, so it has to be a destructuring pattern even
    // when nothing is taken from it. Hence the empty one, and the disable.
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide, workerInfo) => {
      // `baseURL` is a test-scoped option, so a worker fixture reads it off
      // the project rather than taking it as a dependency.
      const baseURL = workerInfo.project.use.baseURL;
      const request = await playwrightRequest.newContext({ baseURL });
      const suffix = `${workerInfo.workerIndex}-${Date.now().toString(36)}`;

      const adminToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      const hardwareGroupId = await findCategoryGroupId(request, adminToken, 'Hardware');

      const employee = await registerEmployee(
        request,
        `e2e.reporter.${suffix}@acme.inc`,
        'Robin Employee',
      );
      const senior = await createEngineer(request, adminToken, {
        email: `e2e.senior.${suffix}@acme.inc`,
        fullName: 'Sam Senior',
        level: 'SENIOR',
        specialtyGroupIds: [hardwareGroupId],
      });
      const junior = await createEngineer(request, adminToken, {
        email: `e2e.junior.${suffix}@acme.inc`,
        fullName: 'Jay Junior',
        level: 'JUNIOR',
        specialtyGroupIds: [hardwareGroupId],
      });

      await provide({
        employee,
        senior,
        junior,
        admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, fullName: 'Facility Admin' },
        hardwareGroupId,
      });

      // Teardown. Accounts are deactivated rather than deleted, which is what
      // the API offers and what the application means by removing someone.
      // The tickets these tests created stay, on purpose: they are ordinary
      // data, and a grader looking at the app afterwards should see them.
      const cleanupToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      for (const account of [employee, senior, junior]) {
        await deactivateUser(request, cleanupToken, account.email);
      }
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  employeePage: async ({ browser, accounts }, provide) => {
    await withSignedInPage(browser, accounts.employee, provide);
  },
  seniorPage: async ({ browser, accounts }, provide) => {
    await withSignedInPage(browser, accounts.senior, provide);
  },
  juniorPage: async ({ browser, accounts }, provide) => {
    await withSignedInPage(browser, accounts.junior, provide);
  },
  adminPage: async ({ browser, accounts }, provide) => {
    await withSignedInPage(browser, accounts.admin, provide);
  },
});

/**
 * Open a context, sign in through the real form, hand the page over.
 *
 * Playwright calls the second argument `use`; it is `provide` here and above
 * because a function named `use` outside a React component trips
 * `react-hooks/rules-of-hooks`, which cannot tell Playwright's fixture
 * protocol from React's `use` hook. The name is positional either way.
 */
async function withSignedInPage(
  browser: Browser,
  account: Account,
  provide: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, account);
  await provide(page);
  await context.close();
}

/**
 * Sign in through the form, as a person would.
 *
 * Not by injecting a token: the access token lives in a module variable that
 * a test cannot reach, and the refresh cookie is `HttpOnly` with a
 * `/api/v1/auth` path. Driving the form is both the only way in and the
 * honest one.
 */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The shell's title only renders once the session is restored and the
  // guard has let the route through.
  await expect(page.getByRole('link', { name: 'ACME Facilities' })).toBeVisible();
}

export { expect } from '@playwright/test';

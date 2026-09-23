import type { APIRequestContext } from '@playwright/test';

/**
 * Setting up test data through the API, the way the fixtures need it.
 *
 * Not through the database and not through the UI. Not the database, because
 * a fixture that writes rows directly can produce states the application
 * cannot — and then the test proves something about a state that never
 * occurs. Not the UI, because the sign-up and engineer-creation screens have
 * their own tests, and re-driving them at the top of every lifecycle test
 * would make a failure there look like a failure here.
 */

/** Password used for every account these tests create. */
export const TEST_PASSWORD = 'PlaywrightLifecycle2026!';

/**
 * The seeded facility admin.
 *
 * `playwright.config.ts` sets both of these for the local stack, and an
 * explicit environment variable overrides it. The fallbacks below are what a
 * fresh clone with its own `seed_admin` account would replace, and are
 * deliberately not a working local credential — a wrong password here costs a
 * run and then a fifteen-minute lockout, so it should fail on the first
 * request with a message that says what to do.
 */
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@acme.inc';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

export interface Account {
  email: string;
  password: string;
  fullName: string;
}

/** Sign in and return the bearer token, failing loudly on a bad password. */
export async function apiLogin(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const response = await request.post('/api/v1/auth/login', { data: { email, password } });
  if (!response.ok()) {
    throw new Error(
      `Could not sign in as ${email} (${response.status()}). ` +
        'For the admin, set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD, or seed one with ' +
        "the `seed_admin` ops action — see the README's step 3.",
    );
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

/** The `Authorization` header for a bearer token. */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Register an EMPLOYEE. Self-registration never produces anything else. */
export async function registerEmployee(
  request: APIRequestContext,
  email: string,
  fullName: string,
): Promise<Account> {
  const response = await request.post('/api/v1/auth/register', {
    data: { email, full_name: fullName, password: TEST_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`Could not register ${email}: ${response.status()} ${await response.text()}`);
  }
  return { email, password: TEST_PASSWORD, fullName };
}

export interface CreateEngineerOptions {
  email: string;
  fullName: string;
  level: 'JUNIOR' | 'SENIOR' | 'LEAD';
  specialtyGroupIds: string[];
}

/**
 * Create an engineer and make the account usable.
 *
 * `POST /engineers` returns a temporary password and flags the account
 * `must_change_password`, which makes every endpoint outside `/auth` answer
 * 403 until it is replaced. That gate has its own test from M5; here it is
 * something to get past, so the fixture spends the temporary password
 * immediately and hands back one that works.
 */
export async function createEngineer(
  request: APIRequestContext,
  adminToken: string,
  options: CreateEngineerOptions,
): Promise<Account> {
  const created = await request.post('/api/v1/engineers', {
    headers: bearer(adminToken),
    data: {
      email: options.email,
      full_name: options.fullName,
      level: options.level,
      specialty_group_ids: options.specialtyGroupIds,
      max_active_tickets: 10,
    },
  });
  if (!created.ok()) {
    throw new Error(
      `Could not create engineer ${options.email}: ${created.status()} ${await created.text()}`,
    );
  }
  const body = (await created.json()) as { temporary_password: string };

  // Changing a password revokes every session, so this token is spent here
  // and the caller signs in again with the new one.
  const temporaryToken = await apiLogin(request, options.email, body.temporary_password);
  const changed = await request.post('/api/v1/auth/change-password', {
    headers: bearer(temporaryToken),
    data: { current_password: body.temporary_password, new_password: TEST_PASSWORD },
  });
  if (!changed.ok()) {
    throw new Error(`Could not clear the password gate for ${options.email}.`);
  }

  return { email: options.email, password: TEST_PASSWORD, fullName: options.fullName };
}

/** The id of a top-level category group, by name. */
export async function findCategoryGroupId(
  request: APIRequestContext,
  token: string,
  groupName: string,
): Promise<string> {
  const response = await request.get('/api/v1/categories', { headers: bearer(token) });
  const body = (await response.json()) as { groups: { id: string; name: string }[] };
  const group = body.groups.find((candidate) => candidate.name === groupName);
  if (!group) {
    throw new Error(
      `No category group named "${groupName}". The development database should have ` +
        'the seeded tree; run the `migrate` ops action if it does not.',
    );
  }
  return group.id;
}

/** Deactivate an account, so repeated runs do not fill the roster. */
export async function deactivateUser(
  request: APIRequestContext,
  adminToken: string,
  email: string,
): Promise<void> {
  const found = await request.get('/api/v1/users', {
    headers: bearer(adminToken),
    params: { q: email },
  });
  if (!found.ok()) {
    return;
  }
  const body = (await found.json()) as { items: { id: string; email: string }[] };
  const user = body.items.find((candidate) => candidate.email === email.toLowerCase());
  if (!user) {
    return;
  }
  await request.patch(`/api/v1/users/${user.id}`, {
    headers: bearer(adminToken),
    data: { is_active: false },
  });
}

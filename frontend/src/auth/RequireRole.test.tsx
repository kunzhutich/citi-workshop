import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EngineerLevel, UserRole } from '../api/types';
import { makeAdmin, makeEngineer, makeUser } from '../test/factories';
import { renderWithAuth } from '../test/renderWithProviders';
import { RequireRole } from './RequireRole';

/**
 * The role and level matrix for guarded routes, mirroring the API's
 * `require_roles` and `require_engineer_levels` — including the rule that a
 * facility admin passes every engineer-level check.
 */

const PERMITTED = 'the page';
const REFUSED = 'Not available to your account';

describe('RequireRole by role', () => {
  const cases: [string, UserRole[], ReturnType<typeof makeUser>, boolean][] = [
    ['an employee on an employee route', ['EMPLOYEE'], makeUser(), true],
    ['an employee on an admin route', ['FACILITY_ADMIN'], makeUser(), false],
    ['an engineer on an admin route', ['FACILITY_ADMIN'], makeEngineer('LEAD'), false],
    ['an admin on an admin route', ['FACILITY_ADMIN'], makeAdmin(), true],
    [
      'an engineer on a staff route',
      ['ENGINEER', 'FACILITY_ADMIN'],
      makeEngineer('JUNIOR'),
      true,
    ],
  ];

  it.each(cases)('%s', (_name, roles, user, permitted) => {
    renderWithAuth(
      <RequireRole roles={roles}>
        <span>{PERMITTED}</span>
      </RequireRole>,
      { user },
    );

    expectVisible(permitted);
  });
});

describe('RequireRole by engineer level', () => {
  const cases: [string, EngineerLevel[], ReturnType<typeof makeUser>, boolean][] = [
    ['a junior on a senior-and-lead route', ['SENIOR', 'LEAD'], makeEngineer('JUNIOR'), false],
    ['a senior on a senior-and-lead route', ['SENIOR', 'LEAD'], makeEngineer('SENIOR'), true],
    ['a lead on a senior-and-lead route', ['SENIOR', 'LEAD'], makeEngineer('LEAD'), true],
    ['a senior on a lead-only route', ['LEAD'], makeEngineer('SENIOR'), false],
    ['a lead on a lead-only route', ['LEAD'], makeEngineer('LEAD'), true],
    // Admins can do anything an engineer can, so a level never filters them.
    ['an admin on a lead-only route', ['LEAD'], makeAdmin(), true],
  ];

  it.each(cases)('%s', (_name, levels, user, permitted) => {
    renderWithAuth(
      <RequireRole roles={['ENGINEER', 'FACILITY_ADMIN']} levels={levels}>
        <span>{PERMITTED}</span>
      </RequireRole>,
      { user },
    );

    expectVisible(permitted);
  });

  it('refuses an engineer whose profile is missing', () => {
    // Should not happen — every ENGINEER has a profile — but a level rule that
    // silently admitted the exception would be the wrong kind of forgiving.
    renderWithAuth(
      <RequireRole roles={['ENGINEER']} levels={['LEAD']}>
        <span>{PERMITTED}</span>
      </RequireRole>,
      { user: makeUser({ role: 'ENGINEER' }) },
    );

    expectVisible(false);
  });

  it('explains the refusal rather than redirecting', () => {
    renderWithAuth(
      <RequireRole roles={['FACILITY_ADMIN']}>
        <span>{PERMITTED}</span>
      </RequireRole>,
      { user: makeUser() },
    );

    expect(screen.getByText(REFUSED)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your home page' })).toBeInTheDocument();
  });
});

/** Assert the guarded content is shown, or the refusal is. */
function expectVisible(permitted: boolean): void {
  if (permitted) {
    expect(screen.getByText(PERMITTED)).toBeInTheDocument();
    return;
  }
  expect(screen.queryByText(PERMITTED)).not.toBeInTheDocument();
  expect(screen.getByText(REFUSED)).toBeInTheDocument();
}

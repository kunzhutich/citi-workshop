/**
 * The accounts `seed_demo` creates, listed on the sign-in screen so a
 * demonstration does not begin with someone typing an email address.
 *
 * These credentials are real and they are in the source. That is a deliberate
 * choice for a workshop demonstration running on a sandbox account, not a
 * pattern to copy: the password below is the one constant `seed_demo` gives
 * every account it invents (`DEMO_PASSWORD` in `app/seed/demo.py`), and the
 * seeder refuses to run in a deployed environment unless the caller explicitly
 * says they accept that.
 *
 * If this application were ever to hold anything real, this file and the
 * component that reads it are the first two things to delete.
 *
 * The accounts are grouped by the persona a viewer is being shown, and within
 * engineers by level, because what an engineer may do depends on it: a JUNIOR
 * cannot pick work up, a SENIOR can take unassigned tickets in their
 * specialties, and a LEAD can assign anyone.
 */

export interface DemoAccount {
  readonly email: string;
  readonly name: string;
  readonly note: string;
}

export interface DemoAccountGroup {
  readonly label: string;
  readonly accounts: readonly DemoAccount[];
}

/** Every seeded account shares this. See `DEMO_PASSWORD` in the seeder. */
export const DEMO_PASSWORD = 'AcmeDemo2026!';

export const DEMO_ACCOUNT_GROUPS: readonly DemoAccountGroup[] = [
  {
    label: 'Facility admin',
    accounts: [
      {
        email: 'demo.admin@acme.inc',
        name: 'Ada Whitfield',
        note: 'Dashboard, facilities, engineers, users',
      },
    ],
  },
  {
    label: 'Engineer',
    accounts: [
      {
        email: 'grace.lin@acme.inc',
        name: 'Grace Lin',
        note: 'LEAD — can assign anyone, sees the team page',
      },
      {
        email: 'nina.alvarez@acme.inc',
        name: 'Nina Alvarez',
        note: 'SENIOR — can pick up unassigned work',
      },
      {
        email: 'tom.okafor@acme.inc',
        name: 'Tom Okafor',
        note: 'JUNIOR — work is assigned to them',
      },
    ],
  },
  {
    label: 'Employee',
    accounts: [
      {
        email: 'amara.obi@acme.inc',
        name: 'Amara Obi',
        note: 'Reports issues and confirms fixes',
      },
      {
        email: 'ben.sutton@acme.inc',
        name: 'Ben Sutton',
        note: 'A second reporter, for showing two people at once',
      },
    ],
  },
];

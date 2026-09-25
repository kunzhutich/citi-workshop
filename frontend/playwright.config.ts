import { defineConfig, devices } from '@playwright/test';

/**
 * The admin account the fixtures create test data with.
 *
 * Set here rather than left to `e2e/fixtures/api.ts`'s defaults, which still
 * name `henry@acme.inc` on the retired `acme_incidents_dev` database. The
 * local API runs against `acme_demo` permanently (`backend/v1/.env`), whose
 * facility admin is the seeded demo account.
 *
 * Failing to set it is not a clean failure. Every run spends two bad sign-ins
 * on the address, ten inside fifteen minutes trips `login_attempts`, and the
 * suite then dies with a 429 that looks nothing like a credentials problem —
 * which cost a full run to work out once. Committing the values is what stops
 * anyone having to remember.
 *
 * `??=`, so an explicit environment variable still wins. That is how the
 * deployed smoke run in `readme/DEPLOYMENT-CHECKLIST.md` points the same suite
 * at a different stack. The password is the one `seed_demo` gives every
 * account it invents and is already published in
 * `src/features/auth/demoAccounts.ts`; this is a local sandbox, and if this
 * application ever held anything real both files are the first to delete.
 */
process.env.E2E_ADMIN_EMAIL ??= 'demo.admin@acme.inc';
process.env.E2E_ADMIN_PASSWORD ??= 'AcmeDemo2026!';

/**
 * End-to-end tests, in a real browser, over real HTTP.
 *
 * The Vitest suite runs in jsdom, which has no layout engine: it can prove
 * that `useBreakpoint` *decides* "mobile" at 375px, but not that anything is
 * laid out correctly at 375px, because nothing is laid out at all.
 * Three defects in this project so far were visible only when the app was
 * driven over HTTP rather than through a test client, and M5 recorded the
 * absence of real-browser testing as a known gap to close here.
 *
 * These tests run against the **running development stack** — uvicorn on 8000,
 * Vite on 3000 — and against the development database. They create their own
 * accounts and tickets through the API, with a unique suffix per run, and
 * deactivate the accounts afterwards. Nothing is dropped or truncated.
 *
 * Two projects, one viewport each, because the acceptance criterion for this
 * phase is a lifecycle completed at both widths. They are the two sizes
 * BUILD-PLAN section 10 names: a phone and a desktop.
 */
export default defineConfig({
  testDir: './e2e',
  // A run drives three signed-in browser contexts through one ticket's life,
  // and that ticket's state is shared. Parallel files would be fine; parallel
  // *tests* inside a file would not, so files opt in individually.
  fullyParallel: false,
  workers: 1,
  // A cold Vite dev server compiles on first request, and bcrypt at cost 12
  // is deliberately slow, so the defaults are too tight for the first test.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  retries: 0,

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // Kept only for a failure: a passing run should leave nothing behind.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      // A viewport rather than `devices['iPhone 13']`: the layout switch is
      // on width alone (`useBreakpoint`, 899px), and a device preset would
      // also bring touch emulation and a mobile user agent, which would make
      // a failure ambiguous about which of the three caused it.
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
  ],

  // Reuses whatever is already running, which on a developer machine is the
  // stack from the README's step 4. `npm run test:e2e` therefore works
  // whether or not the two terminals are already open.
  webServer: [
    {
      command: '.venv/bin/uvicorn app.main:app --port 8000',
      cwd: '../backend/v1',
      url: 'http://localhost:8000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

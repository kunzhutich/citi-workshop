# Review guide

**For the owner, who has not seen five phases of UI and does not have all day.**

This is a worklist, not a summary. It assumes you will read it once and then go
clicking. If you want to understand how the system works, that is
[PROJECT-GUIDE.md](PROJECT-GUIDE.md); if you want to know why something is the way
it is, that is [DECISION-LOG.md](DECISION-LOG.md). This file answers one question:
**where should you point your eyes, and in what order.**

The build is finished — M1–M8 plus S6 (hardening) and S1 (in-app notifications).
Nothing further is planned.

| | |
| --- | --- |
| **Total review time** | ~2 hours for the full worklist · **40 minutes** for the short version (§7) |
| **Verified** | 1,219 tests pass — 825 pytest, 312 vitest, 82 Playwright |
| **Never run** | **The AWS deployment.** Not once. See §3. |
| **Most likely to be broken** | The four admin screens and `/team` — see §5, pass 1 |

---

## 1. Why you are the right instrument for this

Read this section. It is ninety seconds and it changes what you look for.

**Every phase of this build from M5 onward had its most valuable defect found by
looking at a screen, not by running a test.** That is not a general truth about
software; it is this project's specific, repeated track record — the decision log
keeps its own score and reached *"the fifth phase in a row where the most valuable
defect was found by looking"* ([D31](DECISION-LOG.md)). Across the build, **at
least sixteen defects were found by eye or by driving a browser. The unit suites
found none of them.** D14 puts the reason plainly: none *"would have failed a test
that was not written specifically to catch it."*

That is the reason this guide exists:

- **M5** shipped a font that was never loaded. `theme.ts` asked for Roboto;
  nothing imported the `@fontsource` CSS. The browser fell back to a different
  family with different metrics, so **every button in the application sat visually
  low for an entire phase**. Every test passed. Tests assert that a button says
  "Save", not that it looks right saying it.
- **M7's charts had six defects**, found by taking screenshots at 1440 px and
  375 px and looking at them: bar labels in dark ink on saturated fills; the
  largest bar's label dropped for want of axis headroom; an uneven day axis with a
  clipped last tick; an attention panel with no cap that made the phone page
  **12,000 px tall**; and a daily-flow axis **a full day early in every time zone
  west of Greenwich**, because a bare `YYYY-MM-DD` parses as UTC midnight. The
  sixth — chart `sx` written against class names that do not exist, so the styling
  was a silent no-op — needed a Playwright assertion to catch.
- **S6 was the accessibility phase, and it passed its own axe-core scan while the
  application had no visible focus indicator anywhere.** A focus ring was defined
  in `theme.ts` and rendered on nothing: Material UI's `ButtonBase` sets
  `outline: 0` in its own class, a bare `:focus-visible` ties on specificity, and
  Emotion's injection order decided it. Found by tabbing to a card and looking at
  the screenshot — the focused card was pixel-identical to the four beside it.
  **axe checks that controls have names, not that a keyboard user can see where
  they are.**
- **S1's inbox showed contents that disagreed with the badge and the chip beside
  them.** Each message sat next to the ticket's *current* status, so "Your ticket
  INC-000455 is now In progress." rendered directly above a green **Resolved**
  chip. Both facts were true and the pair read as a contradiction. **Every
  assertion about that row passed.**
- **M6 is the one worth reading if you only read one.** Three defects, three
  different kinds:
  - A **snackbar sat on top of the button it was confirming**. On a phone, the
    shell's bottom navigation is 56 px, the ticket's sticky action bar sits at
    `bottom: 56px`, and the snackbar was anchored at `bottom: 72px` — so "You have
    picked this ticket up" covered "Start work". Playwright found it with
    `<div class="MuiSnackbarContent-root"> intercepts pointer events`. **Every
    jsdom test passed, and always would: jsdom has no layout, so nothing can
    overlap anything.**
  - The activity timeline **printed a UUID at a person** — "Assigned:
    f6ac2cf4-0330-…". The stored value was correct and `GET /activity` had been
    returning it verbatim since M4. Nothing noticed **because until M6 nothing
    rendered it.**
  - The workflow **button colours were wrong twice.** Version one drew a large
    blue "Cancel ticket" in an employee's actions card, so cancel read as the
    recommendation. Version two coloured by outcome, which drew "Confirm fixed"
    grey and "Still broken" blue — it had traded one mis-emphasis for its mirror
    image. Both versions were functionally perfect. **No test can decide whether a
    colour recommends the wrong action.**

There is a fifth story that is about the tests themselves. In S6, fixing one flaky
test ([D24](DECISION-LOG.md)) revealed that **seven axe scans had been passing
while scanning spinners** — they were not checking the markup they were named
after. Fixing those ([D25](DECISION-LOG.md)) revealed a permission test that
reported a privilege boundary was enforced **without ever checking it**: it passed
just as happily with the rule deleted. Nothing in `src/` or `backend/` was wrong
either time. The application was right; the tests were silent about it.

### The six things a passing suite cannot tell you

Carry these as you click. They are the shapes every defect above belonged to:

1. **It rendered, but it looks wrong.** Wrong font, wrong weight, misalignment,
   something sitting low or clipped. No assertion covers appearance.
2. **Two true things side by side that read as a lie.** The inbox message and the
   status chip. The two Escalated figures on the dashboard. Each value is correct;
   the pair misleads. Only a reader notices this.
3. **Something on top of something else.** Overlap needs layout, and jsdom has
   none, so all 312 component tests are structurally incapable of seeing it. It is
   almost always a phone-width defect.
4. **Correct in UTC, wrong on your screen.** Dates, axis ticks, "today". The M7
   axis bug was invisible to anyone testing at GMT and wrong for everybody else.
5. **A right answer that never reached a human.** A UUID where a name belongs; a
   field written on every request that no client can read; a report with no screen.
   The data is correct, so every backend assertion passes, and the defect lives at
   the layer nothing was calling yet.
6. **It passes its own check because the check is vacuous.** A scan of a spinner,
   an absence asserted before the thing that would show it has loaded. Green means
   the assertion ran, not that it meant anything.

The emphasis one — is this colour, this order, this wording *recommending the right
thing?* — has no automated form at all. That judgement is the whole reason you are
doing this pass rather than reading a test report.

---

## 2. How to run it

Do this first and give it fifteen minutes. Most of the ways a review goes wrong
are already fixed here.

### 2.1 Prerequisites

PostgreSQL 17 or newer, Python 3.13, Node 22. No Docker, no LocalStack, no
`docker-compose.yml` — the database runs natively and the app is two processes.

### 2.2 The database switch — read this or lose your first ten minutes

**There are two databases and they are not interchangeable.**

| Database | What is in it | Use it for |
| --- | --- | --- |
| `acme_incidents_dev` | Sparse. Ad-hoc test residue, ~121 incidents, plus leftovers from Playwright runs | Anything where you create your own data. The e2e suite runs here |
| `acme_demo` | 90 days of designed data — **318 incidents**, 3 buildings, ~420 desks, 6 engineers, 30 employees, backdated event history | **The dashboards and the charts.** They are not worth looking at against the dev database |

The switch is one line, and then a restart:

```sh
# backend/v1/.env
POSTGRES_NAME=acme_demo          # or acme_incidents_dev
```

```sh
# and then, always:
# restart uvicorn
```

**You must restart uvicorn.** Settings are cached per process, and `--reload` does
not watch `.env`. Editing the file under a running server changes nothing at all,
which is a very convincing way to conclude the data is missing.

> **Check which one you are on before you believe anything:**
> ```sh
> grep POSTGRES_NAME backend/v1/.env
> ```
> At the time of writing it reads `acme_incidents_dev`. It is gitignored, so
> whatever it says on your machine is what you last left it at — including from an
> earlier session whose uvicorn may still be running on :8000.

**The symptom, when you get this wrong:** Henry signs in fine and everybody else
is rejected with "Incorrect email or password." Nothing is broken.
`henry@acme.inc` exists in *both* databases; the rest of the cast exists only in
`acme_demo`. **A rejected Eve means you are pointed at the dev database.**

Both databases are migrated to head (revision `0005`), so no migration step is
needed for either.

### 2.3 Start it

```sh
# terminal 1 — API on :8000
cd backend/v1 && .venv/bin/uvicorn app.main:app --reload --port 8000

# terminal 2 — UI on :3000, proxying /api to :8000 with the path unchanged
cd frontend && npm run dev
```

Open <http://localhost:3000>. The API's own docs are at
<http://localhost:8000/api/v1/docs> — note the `/api/v1` prefix; the application
owns the whole path in both environments, deliberately.

Thirty-second smoke check before you trust anything:

```sh
curl -s localhost:3000/api/v1/health     # "healthy" proves Vite + proxy + uvicorn + database
```

`/health` proves the *connection* only. If it is healthy and every other call
500s, `POSTGRES_NAME` points at a database with no schema.

### 2.4 The two account sets

**They are different sets with different passwords, and one email exists in both
with a different password in each.** This is the single most common way to lose
time.

**In `acme_incidents_dev`:**

| Who | Email | Password |
| --- | --- | --- |
| Facility admin | `henry@acme.inc` | `AcmeLocalDev2026!` — **one** exclamation mark |

Everything else here is ad-hoc residue from test runs, including deactivated
`e2e.*` accounts and eleven tickets titled "Proof harness…". All harmless.

**In `acme_demo`** — everything seeded shares one password, `AcmeDemo2026!`:

| Who | Email | Password | Why them |
| --- | --- | --- | --- |
| Eve Carter, **employee** | `eve.carter@acme.inc` | `AcmeDemo2026!` | Reports, confirms |
| Nina Alvarez, **engineer (SENIOR)** | `nina.alvarez@acme.inc` | `AcmeDemo2026!` | Senior, so she can pick work up herself. Specialty: Building & Facilities |
| Grace Lin, **engineer (LEAD)** | `grace.lin@acme.inc` | `AcmeDemo2026!` | **The only way to reach `/team`** — see pass 1 |
| Demo admin | `demo.admin@acme.inc` | `AcmeDemo2026!` | Facility admin |
| Henry, **facility admin** | `henry@acme.inc` | `AcmeLocalDev2026!!` | **Two** exclamation marks here. Pre-dates the seed |

> **`henry@acme.inc` has a different password in each database** — one `!` in the
> dev database, two `!!` in the demo one. If Henry is refused, you are almost
> certainly using the other database's password. `demo.admin@acme.inc` /
> `AcmeDemo2026!` is a facility admin in `acme_demo` and avoids the whole problem.

A seeded or admin-created account is flagged `must_change_password` and every
endpoint outside `/auth/*` returns 403 until it is cleared. Landing on a
change-password screen with no way past it is **the gate working, not a fault**.
None of the five accounts above should do it.

### 2.5 Two tabs in one browser profile share one session

The refresh cookie lives on `localhost:3000`, so **two windows of the same browser
profile share a session**. Signing in as the engineer in a second tab silently
signs the employee out of the first. Two incognito windows in the same Chrome
share a session too.

To be three people at once you need three separate cookie jars:

| Window | Browser | Signed in as |
| --- | --- | --- |
| A | Chrome, normal window | Eve (employee) |
| B | Chrome, incognito | Nina (engineer) |
| C | Firefox, or a **second Chrome profile** | Henry or `demo.admin` (admin) |

If that is awkward, sign out between roles (avatar menu → "Log out"). It costs
about ten seconds a switch.

### 2.6 Where things are

| Route | Screen | Who can reach it |
| --- | --- | --- |
| `/` | Home — **three different screens** by role: employee home, engineer home, or the admin dashboard | everyone |
| `/report` | The five-step questionnaire | everyone |
| `/notifications` | The inbox (the bell links here — it is a page, not a dropdown) | everyone |
| `/tickets`, `/tickets/mine` | Ticket lists | everyone |
| `/tickets/:id` | Ticket detail, actions, notes, activity | everyone |
| `/queue` | An engineer's own queue | ENGINEER |
| `/unassigned` | Unassigned open tickets | SENIOR, LEAD |
| `/team` | Team page | LEAD engineers — **and admins, who get no link to it** (see pass 1) |
| `/engineers`, `/facilities`, `/categories`, `/users` | Admin CRUD | FACILITY_ADMIN |

---

## 3. What is verified, and what is not

### Verified

**1,219 tests pass**, and lint, types and build are clean (`ruff check`,
`ruff format --check`, `eslint`, `tsc -b`, `vite build`).

| Suite | Count | What it actually proves |
| --- | --- | --- |
| Backend, pytest | **825** | Unit: the workflow table parametrised over `TRANSITIONS` itself, and the notification rules over `RULES`, so an untested row cannot exist. Integration: a **real PostgreSQL database brought up by the actual Alembic migrations**, so every run also proves the migration works |
| Frontend, Vitest | **312** (33 files) | Components and hooks in jsdom. **No layout, no appearance** — jsdom has no rendering |
| End-to-end, Playwright | **82 passed, 10 skipped** | 6 spec files across 2 viewports (1440×900 and 375×812). Real browser, real HTTP, real database |
| Accessibility | part of the e2e run | axe-core at WCAG 2.1 AA over every screen, at both viewports, with dialogs and drawers **open** |

**The 10 skips are deliberate and expected.** Every one is a viewport guard:

- **4 mobile-only tests skipped in the desktop project** — the two phone drawers and
  the keyboard path into one of them (`accessibility.spec.ts`), and the sticky
  action bar (`responsive.spec.ts`).
- **5 desktop-only tests skipped in the mobile project** — all in
  `dashboards.spec.ts`, where a list pages differently on a phone or the gesture is
  a pointer one.
- **1 describe-level skip** in `assignment.spec.ts`, whose permission branches do
  not vary by width.

4 + 5 + 1 = 10. A skip count other than 10 is worth investigating; a skip count of
0 means the project filter is not being applied.

### Not verified

**The AWS deployment has never run. Not once.**

Be plain about what this means. No credentials were issued during the build, so
nothing in this application has executed in the cloud. Not the Lambda package, not
CloudFront, not Aurora. Every cloud-only behaviour is *designed*, *configured* and
*written down* — and entirely unproven:

- whether the Lambda package is under the size limit
- whether `/api/v1` survives CloudFront without the prefix being stripped
- whether the refresh cookie's path works behind the distribution
- whether repeatable query parameters (`status=A&status=B`) survive
- whether the API's 404s stay 404s rather than being rewritten to 200
- whether `CREATE EXTENSION` succeeds on Aurora
- whether timestamps serialise as UTC from the Lambda
- what a ~15-second Aurora cold start does to the first page load

All 68 of these are written up with the exact command and the expected result in
[DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md). **Treat the deployment as
unknown until that list has been walked.** A local review, however thorough,
cannot substitute for any item on it.

Also never done, and not the same as "failing":

- **No coverage measurement**, either side. Neither `pytest-cov` nor
  `@vitest/coverage-v8` is installed, so the rubric's 80% cannot be claimed or
  disproved ([D16](DECISION-LOG.md)).
- **No load or performance testing.** No Artillery, no JMeter, no p95 figures.
- **No screen reader.** Everything was checked with axe and with a keyboard.
  Nobody has listened to NVDA, JAWS or VoiceOver read the application. **The
  semantics are asserted; how they sound is not.** Worth half an hour if you have
  it.
- **No visual-regression tests.** Which is precisely why §1 is your job.
- **The end-to-end suite does not run in CI.** It needs a browser, a database and
  both servers; the CI job stops at `vite build`.

---

## 4. Before you start clicking

Two minutes of setup that make the whole pass better:

1. **Put the browser at 1440×900 and plan to redo the worst parts at 375×812.**
   Those are the two viewports the e2e suite uses, so anything else is territory
   nothing has looked at.
2. **Know your own time zone.** If you are at or near UTC you are structurally
   blind to the M7 class of bug. If you are west of Greenwich, date labels are
   worth a hard stare.
3. **Keep a note open.** Record what you see as you see it; the value of this pass
   is the list you come out with.

---

## 5. The worklist

**Ordered by where defects are most likely, not by what was built last.** The
newest feature (S1, notifications) is fourth, not first, because it is the most
heavily tested thing in the build. The admin screens are first because **not one
of them has a component test**.

### Pass 1 — the thin ice: the admin screens and `/team` · 35 min

**Why here first.** This is the least-tested surface in the application, by a
distance, and it is not close:

| Screen | Component tests | End-to-end |
| --- | --- | --- |
| `/facilities` | **none** | an axe scan of the resting page |
| `/categories` | **none** | an axe scan of the resting page |
| `/users` | **none** | an axe scan of the resting page |
| `/engineers` | **none** (only `sortForAssignment`, a pure function) | an axe scan of the resting page |
| **`/team`** | **none** | **never visited by any test at all** |

The axe scans prove those four screens have no accessibility violations *while
sitting still*. They open the page, wait for loading to finish, and scan. **They
click nothing.** No dialog, no form, no create, no edit, no delete, no validation
message on any of these screens has ever been exercised by an automated test of
any kind. Their APIs are covered by backend integration tests; their screens are
not.

`/team` is worse: **no test of any kind has ever loaded it** — not a component
test, not an axe scan, not a single `goto`. It is also the only screen here that
two different roles reach by two different means, which is the second reason it
is first on the list.

**Sign in as `demo.admin@acme.inc` on `acme_demo`** and work through:

- **`/facilities`** — the building → floor → seat tree. Expand it. Create a
  building, add a floor, add seats (there is a bulk-create path — try it). Rename
  something. Try to delete a building that has floors under it: it should refuse
  with a 409, not fall over. This tree is named in the code as having had the
  worst of S6's accessibility violations, which means it is the most structurally
  complicated thing on any admin screen.
- **`/categories`** — the two-level tree, 5 groups and 32 subcategories. Check the
  two levels are actually two levels. Create a subcategory; check the location
  detail it declares is what the report form then asks for. Delete one that is in
  use — again, expect a refusal, not a crash.
- **`/users`** — list, change a role, deactivate someone. **There should be two
  deactivated employees already**, seeded on purpose so the state is visible. Check
  the deactivated state actually looks different rather than just being absent.
- **`/engineers`** — full CRUD on engineer accounts. Creating one hashes a
  password inside the request; watch for it being slow.
- **`/team`, as `grace.lin@acme.inc` (LEAD)** — whatever it shows, you are the
  first reviewer to look at it and nothing automated ever has.

  Then **open `/team` again as an admin, by typing the URL**. The guard is
  `roles={['ENGINEER','FACILITY_ADMIN']} levels={['LEAD']}`, and `isPermitted`
  short-circuits the level check for anyone who is not an `ENGINEER` — so an admin
  is admitted. That is deliberate and matches the API (`require_engineer_levels`
  never filters admins by level). But an admin has no engineer profile and
  therefore no team, **and the admin navigation offers no link to this page**, so
  nobody has ever seen what it renders for them. It is the most likely empty-state
  defect in the application. Check it says something sensible rather than crashing
  or showing an empty table with no explanation.

**What to look for:** empty states, error states, a form that accepts something it
should not, a dialog that does not close, a list that does not refresh after a
change, and anything that looks visually unlike the rest of the app. The four
admin screens were built in M3 and have had the least attention of anything since;
`/team` came with M6's persona screens and has had none.

### Pass 2 — the phone · 20 min

**Why second.** jsdom cannot do layout, so all 312 component tests are structurally
incapable of catching a layout defect. Only 4 of the 82 e2e tests are mobile-only.
M7's 12,000-pixel-tall page lived at this width, and M5's font affected every
button at every width for a whole phase.

Resize to **375×812** and redo the tour. Specifically:

- The sidebar should become a **bottom bar**; the ticket table should become
  **cards**; dialogs should go **full-screen**; a ticket's action buttons should
  move into a **sticky bar** at the bottom.
- **Scroll to the bottom of every long page**, especially the admin dashboard.
  Something uncapped is the defect that has actually happened here.
- **Check nothing scrolls sideways.** There is one e2e test for this; trust your
  eyes over it.
- Open the navigation drawer and the filter drawer. Close them. Check focus goes
  back where it came from.
- **Watch for one thing sitting on top of another**, which is defect shape 3 and
  the exact defect M6 shipped: the bottom of a phone screen here holds the bottom
  navigation (56 px), the ticket's sticky action bar, *and* the snackbar, and they
  have collided before. **Do an action that raises a snackbar — pick up a ticket,
  add a note — and check the confirmation does not cover the buttons it is
  confirming.**
- Redo pass 1's admin screens at this width — they are untested at *both* widths,
  and a tree or a wide table is where a phone layout gives up.

### Pass 3 — the dashboard numbers · 20 min

**Why third.** Charts are the most defect-dense thing in this build's history: six
in one pass. And the dashboard is the one screen that shows two kinds of number
under one filter bar, which is a design decision ([D14 §1](DECISION-LOG.md)) that
either reads clearly or does not — and only a reader can say which.

**On `acme_demo`, as an admin.** If everything is zero, set **Date range** to
**"Last 90 days"**; the seeded history ages out of a default 30-day window.

- **The two-sections thing.** The page has "Reported in this period" and "Right
  now". The date range applies to the first only; the building filter applies to
  both. **Does the screen make that obvious, or did you have to be told?** That is
  the actual question.
- **The two Escalated figures deliberately disagree** — around 12 in the period
  section against around 16 live. Both are correct. Does the screen explain itself,
  or does it just look like a bug?
- **Every chart axis.** Read the day labels against a calendar. This is where the
  UTC-midnight defect lived, and if you are west of Greenwich you are the person
  who can see it.
- **Bar labels**: readable against their fills? Is the largest bar's label still
  there, or clipped by the top of the chart?
- **Click a KPI tile.** It should open exactly the tickets it counted, with the
  filters spelled out as chips above the list. Check the count matches.
  ("Resolved in the period" deliberately has no link — that is a known gap, §6.)
- **Click a chart bar** to drill a category group into its subcategories, and check
  it lands in the URL.
- **The table twin.** Each chart has a text version beside it. Check the numbers
  agree with the picture.

> **The trick that found the axis bug: look at the dashboard against *both*
> databases.** These screens were designed and screenshotted against `acme_demo`
> and its 318 incidents. The day-early axis defect only became visible when the
> app was pointed **back at the sparse dev database**, where a handful of days with
> gaps between them makes each label individually readable — against 90 dense days
> nobody could see that every label was off by one. If you have five minutes,
> switch to `acme_incidents_dev` (§2.2, and restart uvicorn) and look at the same
> charts with almost no data in them. Sparse data is a different test, not a worse
> one.

### Pass 4 — the inbox and the bell · 15 min

**Why fourth and not first.** S1 is the newest phase but the best tested — four
dedicated e2e tests across two viewports, 45 unit tests on the rule module alone,
and the integration suite asserts the negative cases. It still earns a pass
because **both of its late defects were cache bugs that only appear when you
navigate**, which is the thing a component test structurally cannot do.

Two windows, Eve and Nina (see §2.5 — different profiles, or you will sign
yourself out).

- **As Nina, do things to a ticket Eve reported**: pick it up, start work, resolve
  it. **As Eve, watch the bell.** The badge should gain a number within thirty
  seconds; the poll interval is 30 s and it pauses while the tab is unfocused, so
  give it a moment or refocus the tab.
- **The message and the chip must agree.** Each row shows the message ("…is now In
  progress") beside the ticket's *current* status. These are two different facts by
  design and the word "Now" precedes the chip to say so. **Read a few rows and
  decide whether that actually reads clearly** — this is exactly where the phase's
  defect was, and the fix was a wording change, which means it either works or it
  does not and only you can tell.
- **Open a notification.** It should navigate to the ticket **and the badge should
  drop immediately** — not thirty seconds later. That is [D32](DECISION-LOG.md): the
  count is decremented before the navigation unmounts the page, because
  TanStack Query will not run a mutation's `onSuccess` once its component has gone.
- **Go back to the inbox from the dashboard**, and do it more than once, within
  the 30-second poll window. The inbox must not show stale contents. That is
  [D33](DECISION-LOG.md), and it is the one where the inbox and the badge
  disagreed.

  > **This is the one place in the build with a known, honestly-recorded loose
  > end.** D33's fix (`staleTime: 0` on the inbox feed) demonstrably works — three
  > of the four tests that depend on navigating back to a fresh inbox failed
  > before it and pass after. **One did not.** It still failed in a full-suite run
  > while passing in isolation, with the notification provably in the database and
  > the response still carrying the old `total`, so something else is also holding
  > a stale answer on that path under load. That test now takes a reload, and its
  > comment says it does so because of an unresolved question rather than because a
  > reload is better. The *rule* is unaffected. **If you can make the inbox show
  > you something stale by hand, that is a genuinely useful finding** — it is the
  > one open question in the application and nobody has reproduced it deliberately.
- **Mark one read, then mark all read.** Badge follows both times?
- **The negative cases, which are the interesting ones.** As Nina, add an
  **internal** note to Eve's ticket → Eve gets **nothing**. Add a public one → it
  arrives. And **Nina should never be told about her own actions** — she resolved
  it; she does not need telling.

### Pass 5 — the keyboard and the focus ring · 15 min

**Why.** This is where the accessibility phase's own scan was green while the
application had no visible focus indicator at all. The tooling cannot see this
class of defect; you can, in five minutes.

**Put the mouse down.** From a signed-in home screen:

- Press Tab once. The **skip link** should be the first stop, and activating it
  should land you on the main content.
- Keep tabbing. **Can you always see where you are?** Every focused control should
  have a visible ring — 3 px, and white rather than blue inside the app bar.
- **Go to `/report` and tab to one of the five category cards.** That is the exact
  spot where the missing focus ring was found: the focused card was pixel-identical
  to the four beside it. Cards and list rows are where this class of defect shows;
  buttons are where it hides.
- Open a dialog with the keyboard. Focus should move into it, Escape should close
  it, and focus should return to the control that opened it.
- **Complete the report questionnaire with no pointer at all.** All five steps.
- At 375 px, open the navigation drawer from the keyboard and close it; focus
  should return to the button.

### Pass 6 — the happy path · 10 min, skim

**Why last.** This is the best-covered path in the build: a full lifecycle e2e test
across two viewports, plus an assignment variant, plus component tests on every
piece. You are checking it *feels* right, not whether it works.

Run the [demo script](DEMO-SCRIPT.md) — one ticket, three personas, reported →
picked up → blocked → resumed → resolved → confirmed. Watch for loading states,
error states and empty states, which are where polish is thin rather than where
logic is wrong.

One thing worth pausing on: on a ticket detail page, **the action buttons come
from the API**, not from the UI. `GET /incidents/{id}/allowed-transitions` decides
what you can do, and the dialog builds its fields from the same response. If a
button you expect is missing, the likely answer is that a guard says so — try
"Start work" on an unassigned ticket to see the mechanism rather than a bug.

---

## 6. Known gaps — one honest list

Gathered from the README, the deployment checklist and the decision log, so you
are not surprised by something already known. **None of these is a defect to
report; all of them are recorded choices or acknowledged limits.**

### Not built, deliberately

- **No email, ever.** No verification on registration; no notification leaves the
  application. Notifications are in-app only.
- **No file or photo attachments** — for facility reporting ("here is the leak"),
  the most-missed feature.
- **No SSO.** Local accounts, bcrypt, JWTs.
- **One global admin role.** No per-building admins, no read-only auditor. The
  visibility hook that would scope them exists and returns the query unchanged.
- **Response times are wall-clock, not business hours.** Friday evening → Monday
  morning reports ~60 hours.
- **A Kanban board (S2) and SLA targets (S3) were never started.**

### Known rough edges

- **Notifications are not retrospective.** The table starts empty on an existing
  database. The history to reconstruct what *would* have been sent is in
  `incident_events` — what is not there is which of them anybody **read**, so a
  backfill would report a 0% read rate over invented rows ([D31](DECISION-LOG.md)).
- **The unread badge does not announce itself.** No live region on the bell — a
  polite announcement every thirty seconds on every screen would interrupt whatever
  a screen-reader user was reading. The count is in the control's accessible name
  instead: available on demand, not pushed.
- **"Resolved in the period" has no drill-down link.** `GET /incidents` cannot
  filter on `resolved_at`, so no list matches that tile exactly. Unlinked rather
  than linked to something slightly wrong ([D14 §3](DECISION-LOG.md)).
- **"Unassigned for over 24 hours" is computed from one page of fifty.** Exact
  while fewer than fifty tickets are that stale; under-reports past that.
- **A ticket resolved by an admin on an *unassigned* ticket is missing from
  "Resolved in the period"**, because that figure sums per engineer and work with
  no assignee belongs to nobody. Rare, recorded rather than handled.
- **The 404 page returns HTTP 200.** CloudFront rewrites extension-less paths to
  `/index.html` so deep links survive a reload, so only the router can know a path
  is not a route — and by then the response has been sent. `/api/*` still returns
  real 404s, which is the part the rubric cares about ([D21](DECISION-LOG.md)).
- **Login lockout can be used against somebody.** Ten failed sign-ins lock an
  address for fifteen minutes whether or not anybody holds it — which is what stops
  the refusal revealing who has an account. Keying on the client address instead
  would make it *bypassable*, because the Function URL is publicly reachable and
  `X-Forwarded-For` is attacker-controlled ([D19](DECISION-LOG.md)).
- **`seed_demo` is local-only and not re-runnable.** A second run finds its own
  buildings, writes nothing and says so. To regenerate, drop the database.
- **Only one pytest run per database at a time.** The suite drops and recreates
  `acme_incidents_test` with `WITH (FORCE)`; a concurrent run kills the first one's
  connections.

### Things you will see that are not defects

- **318 incidents in `acme_demo`, not 300.** `seed_demo` writes 300; earlier
  Playwright runs left about eighteen more, plus deactivated `e2e.*` accounts
  visible on the Users screen.
- **Eleven tickets titled "Proof harness…" in `acme_incidents_dev`**, left by
  D25's proof harness. `acme_demo` is unaffected.
- **"Right now" numbers drift** from anything quoted in the docs — they are
  relative to today.
- **Two deactivated employees in `acme_demo`**, on purpose.
- **A change-password screen with no way past it** — that is the gate working.

---

## 7. If you only have forty minutes

Do these, in this order, and skip the rest:

1. **§2 — get it running** on `acme_demo`, signed in as an admin. *(10 min)*
2. **Pass 1, abridged** — `/facilities`, then `/team` as an admin by URL. The tree
   is the most complex untested thing; `/team` is the only screen no test has ever
   loaded, and no one has seen what it renders for an account with no team.
   *(15 min)*
3. **Pass 5 — the keyboard.** Tab through one screen and watch for the focus ring.
   *(5 min)*
4. **Pass 3, abridged** — the admin dashboard at 1440, then at 375. Read the axis
   labels; scroll to the bottom of the phone layout. *(10 min)*

That covers the least-tested surface, the defect class the tooling proved it
cannot see, and the two viewports — which is most of the value.

---

## 8. What to do with what you find

- **A defect** → it is a real one; nothing here is merged to `main` yet, so it can
  be fixed on its branch. `s1-notifications` is the tip and contains every phase.
- **A judgement call you disagree with** → check [DECISION-LOG.md](DECISION-LOG.md)
  first. Thirty-three decisions are recorded with the alternatives that were
  rejected and why; the ones most likely to come up on a click-through are D9 and
  D14 (the two kinds of dashboard number), D21 (the 404's status code), D26 and D30
  (notifications and polling) and D31 (what S1 deliberately does not do).
- **Something the docs got wrong** → say so. The documents were reconciled against
  the code, but reconciliation catches contradictions, not omissions.

And the standing reminder from §1: **the most valuable thing you can report is
something that looks wrong.** Every phase of this build has had one, the suite has
never caught any of them, and it is the one job that could not be delegated.

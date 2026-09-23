# Build status

**The build is finished.** Every phase that was going to be built has been built:
the MVP `M1`–`M8`, then two stretch phases, `S6` (hardening) and `S1` (in-app
notifications). Nothing is in progress and no further features are planned.

This file was written **during** the build, appended after every verified step,
so that a session resumed after a machine restart could reconstruct its position
from this file plus `git log`. That is why it reads as a log rather than an
essay: the sections below are in the order they were written, not in phase
order, and each one records what was true **at the time it was written**. Where
a passage describes a state that a later phase moved on from, it is marked.

For the finished system as it stands, read [`REVIEW-GUIDE.md`](REVIEW-GUIDE.md)
(what to look at, and how to run it) or
[`PROJECT-GUIDE.md` Part I](PROJECT-GUIDE.md) (how it works). This file is the
record of how it got there.

Trust git over this file if they disagree — commits are written after the work,
this file is written after the commit.

---

## Final state

**Last updated:** 2026-09-23, after S1 (in-app notifications) — the last phase.
**Branch:** `s1-notifications`, which is the tip of the stack and contains
everything. **Phase in progress:** none. The build is over.

**Verified on the final tree:**

| | |
| --- | --- |
| Backend | **825** pytest |
| Frontend | **312** vitest (33 files) |
| End-to-end | **82** Playwright passed, **10** deliberate viewport skips (6 spec files × 2 viewports) |
| **Total** | **1,219 passing** |
| Lint / types / build | `ruff check`, `ruff format --check`, `eslint`, `tsc -b`, `vite build` — all clean |

The shape of the thing: **12 tables** (five Alembic revisions, `0001`→`0005`),
**45 paths / 65 operations** under `/api/v1` on one Lambda, **8 reports**,
**11 workflow transitions**, **4 notification rules**.

**The one thing that has never run: the AWS deployment.** No credentials were
issued during the build. Every cloud-only check is written up with its command
and its expected result in [`DEPLOYMENT-CHECKLIST.md`](DEPLOYMENT-CHECKLIST.md),
unrun. See [D1](DECISION-LOG.md).

**S1's own numbers**, for the record: backend 825 (738 + 87) · frontend 312
(290 + 22) · e2e 82 passed (72 + 10 new), skips unchanged at 10.
Migration `0005` applied to **both** `acme_incidents_dev` and `acme_demo`.

S1 builds the feature the brief's one measured-but-unacted-on business question
asked for — "how effectively are employees being informed about ticket progress
and outcomes?" — and is the only thing in the build that touches
`docs/full-stack.md`'s "Deliver real-time capabilities".

**1. The rule, in one place.** `app/notifications.py` is the sibling of
`app/workflow.py`: four `NotificationRule` rows as data, each carrying its
audience *and* that audience's wording in one mapping, so an audience without a
sentence cannot be declared. Three rules apply to every row and are therefore
applied once in `plan()` — never your own action, one person one notification,
skip a capacity nobody holds. The four services that create notifications
contain one line each, naming a `NotificationType` and never a recipient. The
module touches **no database**, which is what makes all 45 of its unit tests run
in 0.13 s with no session. [D26](DECISION-LOG.md).

**2. The leak that did not happen.** The NOTE_ADDED row carries a precondition,
`_is_a_public_staff_note`. `services/notes.add_note` calls the rule module for
*every* note including INTERNAL ones, and the rule is what refuses — so "an
internal note notifies nobody" is a statement in the rule table rather than an
`if` at a call site somebody can delete. D9–D11 are three entries about this
class of leak arriving through an unwatched door.

**3. Checked rather than trusted.** Two mutations of the rule module — deleting
that precondition, and letting an actor stay in their own audience — fail 9 of
the 45 unit tests between them. The e2e absence assertion was proved the same
way: with the actor rule removed, "the engineer was not told they resolved it"
fails with a clear message; restored, it passes.

**4. The cost of the thing that polls.** Measured on a scratch database of
200,000 notifications across 40 users (27 MB table, 35 MB indexes):
`unread-count` is an Index Only Scan with `Heap Fetches: 0` — 3 shared buffers
and 0.09 ms for an empty inbox, 4 and 0.13 ms for the busiest (556 unread). The
inbox page is an Index Scan Backward, 25 buffers, 0.19 ms. Polling rather than
websockets was not a preference: a Lambda Function URL cannot hold a connection
open. [D30](DECISION-LOG.md).

**5. A latent migration bug, found on the way.** Revision 0001 created its enum
types by iterating the live `ENUM_TYPES` constant, so adding `notification_type`
to that registry changed what an *already-applied* revision did — and only on
databases created after the change, which is exactly the test database that CI
drops and recreates. 0001 now names the eleven types it has always created.
[D28](DECISION-LOG.md).

**6. The report that had no screen.** `/reports/communication` has existed since
M7 and `useCommunicationReport` had no caller — which is exactly why the brief's
seventh business question counted as measured-but-unacted-on. S1 gives it
something to measure and puts all four figures on the admin dashboard as
`CommunicationPanel`. A `null` percentage renders as an em dash and never as
`0%`, because "nothing was resolved" and "nobody was informed" are different
facts and the API is careful to distinguish them.

**The migration was round-tripped**, not just applied: on a scratch database,
`0004 → 0005`, then `alembic downgrade 0004` (which removes the table *and* the
enum type — checked in `pg_type`, not assumed), then back up to `0005`. That
also exercises the 0001 fix: a database created after the change gets eleven
enum types from 0001 and the twelfth from 0005, with no collision.

**Demo data.** `seed_demo` now builds the demo inbox by replaying each ticket's
planned history through `app/notifications.py` rather than reimplementing the
audience rule. A 60-incident world produces 304 notifications across all four
kinds, with a 61.4% read rate — a number a dashboard can show, which neither 0%
nor 100% would be.

**The one application bug the e2e suite found.** Opening a notification follows
a link, which unmounts the inbox — and TanStack Query does not call a
mutation's `onSuccess` once its component has gone, so the invalidation that
clears the badge never ran and the bell kept its old number until the next
poll. Invisible in a component test, because jsdom has no navigation to unmount
anything. The count is now decremented in `onMutate`, which fires
synchronously before the navigation. [D32](DECISION-LOG.md).

**What looking at the screen found**, as in every phase so far: the inbox showed
each message beside the ticket's *current* status chip, so "Your ticket
INC-000455 is now In progress." sat directly above a green **Resolved** chip and
read as a contradiction. Every assertion about that row passed. The chip is now
preceded by the word "Now". Screenshots were taken at 375 px and 1440 px, with
and without a badge, read and unread, and with the keyboard focus ring on a row.

S6 shipped the five things BUILD-PLAN §15 names, plus the three cleanups M8
recorded but did not make.

**1. Accessibility.** `@axe-core/playwright` bolted onto the existing fixtures:
every screen, at both viewports, signed in as the role that owns it, and — the
part that matters — with the dialogs and drawers *open*, the questionnaire
part-answered, and the login screen showing an error. WCAG 2.1 AA only;
`best-practice` rules are deliberately off.

What axe found: `<ul>` containing `<a>` and `<button>` on every signed-in
screen (four places, three of which nothing was scanning); the OPEN status chip
at 3.86:1 and HIGH priority at 3.11:1, because the palette defined three tokens
and left `info`/`warning`/`success`/`error` as Material UI's unchecked
defaults; the questionnaire's step numbers at 2.64:1; and "Choose a building
first" — the sentence telling you how to enable a disabled field — as the least
readable text on the form.

**What tabbing found that axe did not, which is the entry worth reading
([D23](DECISION-LOG.md)):** the global focus ring added earlier in the same
phase was doing nothing at all. Material UI's `ButtonBase` sets `outline: 0` in
its own class; a bare `:focus-visible` has the same specificity, so the winner
is decided by Emotion's injection order, and Material UI won on every button,
card and link in the application. Found by tabbing to a category card on the
report form and looking at the screenshot: the focused card was pixel-identical
to the four beside it. `body :focus-visible` is one point higher and fixes it.
A pass that stopped at "axe is green" would have shipped an accessibility phase
that made the application no easier to use with a keyboard.

Also built rather than only checked: a skip link (first in the tab order on
every screen, which had 4–11 stops before the content), real `<nav>`/`<main>`
landmarks with distinct names, `aria-current` on the current page and the
current stepper step, the bottom bar's items as links rather than buttons
driven by `onChange`, each stepper step's state in words, `role="img"` plus a
written summary on both charts, a **table twin for `FlowChart`** — which never
had one, making the guide's claim that no dashboard value is pointer-only false
for the chart with the most values in it — and the first live regions in the
codebase (`aria-live`, `role="status"` and `aria-busy` had zero occurrences
before this).

**2. Error boundaries.** There were none: a render error unmounted the whole
tree and gave a white page. Two now — one inside `AppShell` keyed on the
pathname, where the navigation survives and "try again" is real, and one in
`main.tsx` outside the router, where the only honest offer is a reload. A
failed lazy chunk (a tab left open across a deploy) is recognised and offered a
reload, because retrying re-requests the same dead URL.

**3. The 404 page.** Checked in a browser before changing anything: `path="*"`
was `<Navigate to="/" replace />`, so a typo, a stale bookmark and a dead link
all silently rewrote the address bar and landed on the dashboard. A
non-existent ticket *id* was already handled properly, so it was route-not-found
specifically that was swallowed. `NotFoundPage` says so and shows the path that
failed. Its HTTP status is honestly 200 and the component says why
([D21](DECISION-LOG.md)).

**4. Login lockout.** 10 failures per email per 15 minutes, in a new
`login_attempts` table because a Lambda container shares no memory with the next
one. One row per address, keyed on the email, `CITEXT`, **no foreign key to
`users`** so that addresses with no account are counted identically — otherwise
the 429 becomes the account-existence oracle the generic 401 exists to prevent.
Fixed window, not sliding. Self-cleaning on the failure path, because Aurora
sleeps at `min_capacity = 0` and a sweeper would have nowhere to run. The
service commits its own count, since the request that increments it is the
request that then 401s — `rotate_session` set that precedent in M2 and this is
the second and last such place. Verified against the running stack as well as in
tests: ten 401s then a 429 carrying `Retry-After: 898`.

**5. Structured JSON logging.** One JSON object per line on stdout, with request
id, user id where known, method, path, the **route template**, status and
duration. Nothing secret is logged structurally rather than by filtering: the
middleware never reads a header, a cookie, a body or the query string. It is the
project's first middleware, and [D20](DECISION-LOG.md) explains why the standing
argument against middleware was about rules rather than observation.

**Two silent defects found while building it.** `logger.log(..., exc_info=False)`
stores the literal `False`, not `None`; formatting that as a traceback raises
inside the handler, `logging` swallows it to stderr, and the line is lost. And
Alembic's `env.py` called `fileConfig` with its default
`disable_existing_loggers=True`, which sets `disabled = True` on every logger
that already exists *and* replaces the root handler with a plain-text one — so
one in-process `migrate` would have ended structured logging for the life of a
warm Lambda container. Both have regression tests.

**The three M8 cleanups**, all verified before removal: the dead
`current_user_id`, the vestigial `if TYPE_CHECKING: pass` in
`app/models/category.py`, and `clear_escalation`'s error message, which was only
correct because the route's `AdminUser` dependency made the other branch
unreachable. It now refuses with 403 for the wrong caller and 409 for a ticket
with nothing to clear, mirroring `escalate`.

**Not done, deliberately** ([D22](DECISION-LOG.md)): `eslint-plugin-jsx-a11y`
is not installed — its peer range stops at ESLint 9 and this project is on 10,
so it needs `--force`, and the rules it would add turned out to catch nothing
this codebase does. The questionnaire's cards are still `aria-pressed` toggle
buttons rather than a radio group; they are labelled, reachable and operable,
and the cost is tab stops rather than access. And nobody has listened to a real
screen reader.

**Database note.** Migration `0004` was applied to `acme_incidents_dev`, because
the application cannot serve a login without that table and Playwright runs
against that database. It creates one empty table and touches nothing that was
there.

`acme_demo` **has since been migrated** (2026-09-23, after S6 handed back) —
verified by signing in as `henry@acme.inc` and confirming a wrong password
returns 401 with the lockout counter live. Category seeding reported 37 already
present and 0 created, so the action is idempotent as documented. Both
databases are now at head; the demo script in `docs/DEMO-SCRIPT.md` works
without any migration step.

**M8 verified:** `README.md` rewritten for this application (281 lines, ~160 of
them the upstream Citi template, → ~615 lines that are about what was built);
`docs/DEMO-SCRIPT.md` written; D15–D18 appended to the decision log; an M8
section appended to the project guide. **No application file changed in this
phase** — `git diff m7-dashboards-demo-data..` touches `README.md` and four
files under `docs/` and nothing else — so the 683 / 271 / 25 figures carry over
from M7 and no suite was re-run. The test suites were deliberately not run: the
owner was using them.

Every claim in the new documents was checked rather than copied. The route
count (41 paths, 61 operations) was read out of the running OpenAPI document;
the workflow table out of `app/workflow.py`, which has **eleven** rows against
BUILD-PLAN §6's ten, because the plan's single "RESOLVED → CLOSED, assignee or
admin" row ships as two; the six demo logins were confirmed against the stored
hashes in `acme_demo` through `verify_password`; and every dashboard figure the
demo script quotes was queried (21 blocked, 16 live escalations against 12 in
the default 30-day period, 26 unassigned over 24 h, 318 incidents).

**Three contradictions found and handled:**
1. The template's README said "licensed under the MIT-0 License". `LICENSE` is,
   and always was, **Apache-2.0**, `Copyright 2023 Citigroup, Inc.` The README
   now says Apache-2.0 and says the old claim was wrong; `LICENSE` is untouched.
   Worth reporting upstream.
2. BUILD-PLAN §1 lists `@mui/x-data-grid`, `@mui/lab` and `dayjs`. **None is
   installed.** The ticket table is a plain MUI `Table` and the activity feed is
   built from `Box`; both files carry the reasoning at the top. The README
   documents what shipped.
3. The old README claimed "PostgreSQL 17" as a prerequisite. The development
   machine runs **18.6**; CI runs 17; Aurora is 17.7. The README now says "17 or
   newer" and names all three.

**Done in a second M8 pass:** BUILD-PLAN §15's *front section* on
`docs/PROJECT-GUIDE.md`. The guide is now in two parts. **Part I** (~1,310 lines)
is a single coherent account of the system as it stands: a system overview
separating what the scaffold and the IAM boundary forced from what was chosen, the
ten tables as a narrative in the order that makes them make sense, the complete
rule-to-file map merged from all nine per-phase maps, one request — an engineer
resolving a ticket — followed through every file it touches with real function
names, a reading order, and one merged glossary of every non-obvious term. **Part
II** is the unchanged phase log. The guide is now 6,985 lines.

> **Superseded by S6 and S1.** The figures in the paragraph above were correct
> when M8 wrote them and are kept as the record of that pass. They are no longer
> the current state of the guide: S6 added `login_attempts` and S1 added
> `notifications`, so Part I now narrates **twelve** tables rather than ten, and
> the guide as a whole is **7,936** lines. The related claim below that "nine of
> ten" tables carry `UUIDPrimaryKeyMixin` is now **ten of twelve** — the two
> exceptions are `engineer_profiles`, which keys on `user_id`, and
> `login_attempts`, which keys on `email` and carries neither mixin.

Part I was verified rather than transcribed, in two passes. The first checked
every markdown link (372, 176 distinct targets) and every backticked identifier
(818) against the code, and found two stale claims in the existing phase
sections: `apply_visibility`, which has been two functions since M4, and a
gotcha attributing a timezone dependency to `date_trunc` where the code casts
with `::date`. Both were in rule-map tables rather than prose.

The second pass asked the stricter question the map promises — is the symbol
*defined* in the file beside it, rather than merely imported there — and found
six rows in Part I itself that the first pass could not catch, because an
imported name is present in a file without being defined in it
(`LOCATION_SEPARATOR` and `DEFAULT_WINDOW_DAYS` live in `schemas/`,
`revoke_all_refresh_tokens` in `repositories/users.py`, `RegisterRequest` in
`schemas/auth.py`, and the Lambda handler/runtime are hardcoded in
`infra/locals.tf`, not `lambda.tf`). All corrected. Also corrected: a claim that
every table carries `UUIDPrimaryKeyMixin` — nine of ten do, and
`engineer_profiles` keys on `user_id`.

Two loose ends in the application code were found and recorded rather than
changed, since this was a documentation pass: `current_user_id` in
`app/security/dependencies.py` is defined and never called, and
`app/models/category.py` carries an empty `if TYPE_CHECKING: pass`.

**M7 pass 1 verified:** all eight MVP report endpoints from BUILD-PLAN section
11, computed with SQL aggregates. 665 backend tests (609 + 56 new), ruff check
and ruff format clean. Every new test asserts a number worked out by hand from
the fixture table at the top of `tests/integration/test_reports.py`.

**Corrected after pass 1 ([D9](DECISION-LOG.md)):** `/reports/blocked-escalated`
and `/reports/me` are no longer window-scoped. They answer present-tense
questions, so a ticket blocked or opened long before the default thirty days
must still appear; they now filter on `building_id` only, and carry a `scope`
rather than a `window` in the response. The other six reports are unchanged.
D5 and D7 are amended in place to point at D9.

**Corrected again ([D10](DECISION-LOG.md)):** `/reports/blocked-escalated`
filtered its escalated half on `is_escalated` alone, with no status filter,
while its blocked half filtered `status == BLOCKED`. Since nothing but
`clear_escalation` ever lowers that flag, a ticket escalated and then closed
stayed in the report for ever. The escalated list and `escalated_total` now also
require `ACTIVE_INCIDENT_STATUSES`. A latent defect D9 exposed rather than one
D9 introduced: the old thirty-day window had been ageing the stale rows out of
sight. One new test —
`test_escalated_list_drops_a_ticket_that_was_closed_while_still_flagged` —
which fails `assert 4 == 2` against the unfixed code.

**Completed after pass 1 ([D11](DECISION-LOG.md)):** the same stale-flag defect
D10 fixed on `/reports/blocked-escalated` was still present on `/reports/me`,
which D10 had deliberately left for a separate change. `personal_counts`
counted `is_escalated` with no status term, so an employee whose ticket was
escalated, fixed and closed carried "1 escalated" on their home screen for
ever — a count with nothing under it to contradict it and no cap. It now goes
through the same `_live_escalation_clauses()`, which corrects an engineer's
`assigned` block at the same time. `summary.escalated_total` is untouched: it
is a period report. One new test,
`test_me_drops_an_escalation_on_a_ticket_the_reporter_has_had_closed`, which
fails `{'escalated': 2} != {'escalated': 1}` against the unfixed code.
666 backend tests.

**M7 pass 2 verified:** `seed_demo`, the third ops action, beside `migrate` and
`seed_admin`. A default run writes 3 buildings, ~14 floors, ~420 desks, ~34
meeting rooms, 1 admin, 6 engineers, 30 employees and 300 incidents over 90
days, with ~1,800 **backdated** `incident_events` rows and ~500 notes, in
**0.9 seconds**. Each incident is generated as a timeline and walked up to
`now`, so its status is an outcome of its age and its durations rather than a
value chosen and back-filled. Verified by querying all eight reports against a
throwaway database: median resolve 6.6 h CRITICAL against 141 h LOW, blocked
ages up to 1,640 hours read out of the event log, ~70% informed, three
visible recurring-problem seats. Refuses to run unless `settings.is_local`.
Safe to run twice (second run is a no-op) but not a top-up — documented in the
return payload and the guide. 683 backend tests (666 + 17), ruff clean.

**M7 pass 3 verified:** the three persona dashboards from BUILD-PLAN section 10,
replacing M5's placeholders on `/`. 271 frontend tests (211 + 60), 32 Playwright
cases across two viewports of which 25 run and 7 are deliberate viewport skips
(14 cases and 12 runs before), eslint + `tsc -b` + `vite build` clean. **No backend file changed
in this pass**, so the 683-test suite is untouched and was not re-run for it.

The load-bearing decision is [D14](DECISION-LOG.md) §1: the admin dashboard puts
period-scoped and current-state widgets in two separately headed sections under
one filter bar, because D9 means the date range genuinely cannot reach two of
the eight reports. Against `acme_demo` the two blocked figures read 11 (period)
and 21 (live) and the two escalated figures read 12 and 16 — all four correct,
and the screen says which is which rather than picking one. `api/reports.ts`
enforces the same split in its parameter types, so a screen that tried to window
a present-tense report would not compile.

Five defects were found by taking screenshots at 1440px and 375px and looking at
them: bar labels centred in dark ink on saturated fills, the largest bar's label
dropped for want of axis headroom, an uneven day axis with a clipped last tick,
an uncapped attention panel that made the phone page 12,000px tall, and — only
visible once the app was pointed back at the sparse dev database — a daily-flow
axis a whole day early, because a bare `YYYY-MM-DD` parses as UTC midnight and
renders as the previous day anywhere west of Greenwich. A sixth, chart `sx`
written against class names that do not exist so the styling was a silent no-op,
was found by a Playwright assertion that a bar element is present.

Also split the admin dashboard into its own bundle chunk: it is the only screen
importing `@mui/x-charts` and `RequireRole` already keeps everyone else off it,
so the main bundle went from 406 kB gzipped to 301 kB.

**M6 verified independently:** 609 backend tests, 211 frontend tests,
12 Playwright tests (2 deliberate viewport skips), ruff check + format clean,
eslint + tsc + vite build clean. The full ticket lifecycle completes through
the UI at both desktop and phone widths — M6's acceptance criterion.

**Blocked:** `git push` is refused by the permission classifier, so
`m6-persona-screens` is committed locally but NOT pushed. Everything else
continues; the owner needs to push, or grant the permission.

## M7 verified independently (2026-09-23)

Backend **683** pytest · frontend **271** vitest · e2e **25 Playwright passed,
7 deliberate viewport skips** · ruff check + ruff format clean · eslint, tsc -b
and vite build clean · backend confirmed untouched by pass 3 (`git diff` shows
nothing outside `frontend/` and `docs/`) · `backend/v1/.env` restored to
`POSTGRES_NAME=acme_incidents_dev`.

Report figures were checked against live seeded data, not only fixtures:
response-time medians are monotonic across priority (CRITICAL 0.49 h assign /
7.98 h resolve → LOW 17.37 h / 124.48 h), which is the evidence the backdated
events in `seed_demo` are real rather than stamped at seed time.

## Branch stack

Each phase branches off the one below. **`s1-notifications` is the tip and
contains every phase**; reviewing it reviews the whole build. Nothing above M5
has been merged to `main` — that is deliberate ([D3](DECISION-LOG.md)), so that
`main` stays a known-good state and rejecting a phase rebases the ones above it
rather than requiring a revert.

**All branches are pushed.** Every local branch below matches its `origin/`
counterpart at the same commit. (Earlier revisions of this file recorded M6
onward as "committed, not pushed (blocked)" — the permission classifier was
refusing `git push` at the time. That has since been resolved and the pushes
went through.)

| Branch | Phase | State |
| --- | --- | --- |
| `main` | — | at the M5 merge (PR #5) |
| `m1-walking-skeleton` | M1 | merged to main (PR #1) |
| `m2-data-model-auth` | M2 | merged to main (PR #2) |
| `m3-facilities-categories-engineers` | M3 | merged to main (PR #3) |
| `m4-incidents-workflow` | M4 | merged to main (PR #4) |
| `m5-frontend-shell-auth` | M5 | merged to main (PR #5); branch deletable |
| `m6-persona-screens` | M6 | complete, pushed, awaiting review |
| `m7-dashboards-demo-data` | M7 | complete, branched off `m6`; all three passes pushed |
| `m8-docs-and-demo` | M8 minus deploy | README, demo script, decision log, guide phase section + guide Part I — pushed |
| `s6-hardening` | S6 (stretch) | complete, branched off `m8-docs-and-demo`; pushed |
| `s1-notifications` | S1 (stretch) | complete, branched off `s6-hardening`; pushed. **The tip.** |
| `s3-sla-targets`, `s2-kanban` | stretch | **not started, and not being started** |

## What is left

Nothing is left to build.

1. **M1–M8** — done, and the MVP is complete.
2. **Stretch** — ~~S6~~ → ~~S1~~. Done. S3 (SLA targets) and S2 (a Kanban
   board) were the next two in [D2](DECISION-LOG.md)'s order and **were never
   started**; they are recorded as unbuilt scope in the README's known
   limitations, not as outstanding work.
3. **Review** — the owner has not seen five phases of UI. That is the real
   outstanding item, and [`REVIEW-GUIDE.md`](REVIEW-GUIDE.md) is the worklist
   for it.
4. **The AWS deploy** — the one thing in this project that has never run. No
   credentials were issued during the build. Every step that needs them is
   recorded, with its command and expected result, in
   [`DEPLOYMENT-CHECKLIST.md`](DEPLOYMENT-CHECKLIST.md).

## Standing constraints

- Only one test run against a given database at a time. Give each agent its own
  `POSTGRES_TEST_NAME`; check `pgrep -af pytest` before starting.
- Do not push to `upstream` (the Citi template). `origin` is the owner's repo.
- Do not merge anything to `main`.
- Infra edits are limited to the three recorded in `docs/INFRA-CHANGES.md`;
  a fourth (`compress`) is proposed and awaiting the owner's mentor.
- Commit after every verified step, not at phase end — the VDI may stop without
  warning and uncommitted work is the only thing that cannot be recovered.

## Local environment facts worth not rediscovering

- Dev database `acme_incidents_dev`: 37 categories, SFO-1 → Level 3 → 6 desks +
  2 meeting rooms, admins `henry@acme.inc` / `AcmeLocalDev2026!` and
  `admin@acme.inc` (password unknown, harmless).
- `backend/v1/.env` (gitignored) sets `POSTGRES_NAME=acme_incidents_dev`. Switch it
  to `acme_demo` and restart uvicorn to see the dashboards against 300 incidents
  over 90 days; switch it back afterwards. See D13.
- Playwright against `acme_demo` needs `E2E_ADMIN_PASSWORD='AcmeLocalDev2026!!'`
  — two exclamation marks. The fixture's default is the dev database's password.
- `@mui/x-charts` was added in M7 pass 3 and is **only** imported by
  `features/dashboard/`, which is lazy-loaded. Keep it that way: importing a
  chart anywhere else puts 106 kB gzipped back in every persona's bundle.
- Run the API with `backend/v1/.venv/bin/uvicorn app.main:app --port 8000`, the
  UI with `npm run dev` in `frontend/` on :3000.
- Full backend suite takes roughly 5-6 minutes; run it in the background.
- M7's report tests need `make_incident(created_at=..., escalated_at=...,
  blocked_reason_type=...)` and `make_event(...)` in `tests/factories.py`; all
  four were added in pass 1 and are additive, so no existing test changed.
- `is_escalated` is cleared only by `clear_escalation`, never by closing a
  ticket, so any present-tense query over that flag needs a status filter too.
  See D10 and `_live_escalation_clauses()` in `app/repositories/reports.py`.

## S6 verified independently (2026-09-23)

Backend **738** pytest · frontend **290** vitest · e2e **72 passed, 10 deliberate
viewport skips** · ruff check + format, eslint, tsc -b and vite build all clean.

The e2e figure took three corrections to reach. S6 first reported 72; the suite
gave 71 passed / 1 failed, reproducibly. Fixing it (D24) found that a heading is
not a signal that data has arrived, that **seven axe scans had been passing while
scanning spinners**, and that twelve tests shared the shape. Fixing those (D25)
found a permission test that reported a privilege boundary was enforced without
ever checking it — it passed just as happily with the rule deleted.

Nothing in `src/` or `backend/` changed in either correction. The application was
right; the tests were silent about it.

**Known detritus:** the D25 proof harness left 11 tickets titled "Proof harness…"
in `acme_incidents_dev`. Harmless, and consistent with the e2e suite, which
leaves its tickets behind by design. `acme_demo` — the database the demo script
uses — is unaffected.

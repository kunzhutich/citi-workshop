# Decision log

Decisions taken while running phases without the repo owner present. Each entry
records the question, the options, what was chosen, and why — so any of them can
be reversed on review without reconstructing the reasoning.

**Owner's standing instruction (2026-09-23):** decide everything; log the
questions I would otherwise have asked, marked with the answer I went with.

---

## D1 — Skip M8 entirely, or do everything except the deploy?

**Question.** The owner proposed skipping M8 on the grounds that it is "only
deploy," and spending the time on stretch features instead. AWS credentials do
not exist yet, so the deploy genuinely cannot run.

**Finding.** M8 is not only deploy. Its other half is the README, the
architecture diagram, the role/permission summary, the known-limitations write-up
and the demo script — none of which need AWS. `README.md` is still the upstream
Citi template (title "Coding Workshop", plus its Contributing / License /
Roadmap / Authors sections) with a "Local development" section grafted in. There
is no README describing this application.

Two evaluation criteria in `docs/full-stack.md` speak to exactly this:
*Experience* — "README/update notes clearly explain architecture, trade-offs, and
assumptions"; *Testing* — "test artifacts (commands, results, and known gaps) are
documented clearly."

**Chosen.** Do M8 without the deploy, then stretch features. The deploy step and
its verification move to `docs/DEPLOYMENT-CHECKLIST.md` for when credentials
arrive.

**Why.** Skipping M8 wholesale would forfeit marks under two of the five
competencies to buy time for bonus work that is graded under none of them
directly. The documentation is also what makes the bonus work legible to a
reviewer.

**Reversible.** Yes — it is additive. If the owner still wants M8 dropped, the
commits stand alone and the phase can be abandoned without touching the app.

## D2 — Which stretch features, in what order?

**Question.** BUILD-PLAN section 15 lists S1–S6. Time is finite; which earn their
place?

**Chosen order.** S6 → S1 → S3 → S2. Skipping S5 and S4.

**Why.**
- **S6 (hardening)** first: accessibility, error boundaries, a 404 page, login
  lockout, structured logging. `docs/full-stack.md` lists "Accessibility (a11y)
  and inclusivity" as an Expected Capability and nothing has addressed it yet.
  Unaddressed explicit criteria outrank new features.
- **S1 (in-app notifications)**: answers the brief's own business question — "how
  effectively are employees being informed about ticket progress and outcomes" —
  and hits the Expected Capability "deliver real-time capabilities."
- **S3 (SLA targets)**: deepens the analytics the admin dashboard already shows.
- **S2 (Kanban board)**: strongest demo impact, no new evaluation criterion.
- **S5 (SVG workflow diagram) skipped**: the M6 `WorkflowStepper` already
  satisfies the brief's "visual representation of the ticket workflow." A second
  solution to a solved problem.
- **S4 (similar-ticket suggestions) skipped**: lowest return per unit of work.

**Reversible.** Yes — each is an independent branch.

## D3 — Branch strategy while the owner is away

**Question.** Merge each phase to `main` as it passes, or stack branches?

**Chosen.** Stack: each phase branches off the previous phase's branch, and
nothing merges to `main` until the owner has reviewed.

**Why.** The owner's instruction, and it is the right call — `main` stays a known
good state, and rejecting any phase rebases the ones above it rather than
requiring a revert.

## D4 — The development database has accumulated test data

**Question.** `acme_incidents_dev` was left at a deliberate baseline after M5 —
37 categories, one building/floor/eight seats, two admin accounts, zero
incidents. After M6 it holds 87 users, 64 incidents, 22 notes, 181 events and
56 engineer profiles: the residue of M6's Playwright runs and manual checks.
The Playwright suite creates accounts and tickets in the development database
by design, deactivating the accounts afterwards but not removing the tickets
(`frontend/playwright.config.ts`, header comment).

Should this be cleaned now, cleaned before M7, or left?

**Chosen.** Leave it during M6 review; reset the database to a clean seeded
baseline immediately before M7's `seed_demo` runs.

**Why.** Two reasons to leave it now: the owner will review M6's screens, and
screens with data in them are far more reviewable than empty ones; and deleting
data while the phase is still being verified risks removing something a test
depends on.

One reason to reset before M7: `seed_demo` is specified to produce a coherent
dataset — 3 buildings, 6 engineers across three levels, 30 employees, ~300
incidents backdated over 90 days so the timing metrics mean something. Layering
that on top of 64 arbitrary test tickets and 56 profiles would make every
dashboard number a mix of designed data and detritus, which defeats the purpose
of the M7 reports and makes them impossible to verify against expected values.

**Reversible.** The reset is destructive to the development database only. No
migration, no schema change, nothing in git. Re-running `migrate` plus
`seed_demo` reproduces the result exactly.

**Note for the owner.** If you want to review M6 with data before M7 resets it,
do that first — or just review afterwards, when `seed_demo` will have produced
a much better dataset to look at than this one.

## D5 — What do `from` and `to` actually filter on?

**Question.** BUILD-PLAN section 11 says every report accepts `from` and `to`.
It does not say which timestamp they filter. An incident has five: `created_at`,
`assigned_at`, `acknowledged_at`, `resolved_at`, `closed_at`. Pick wrongly and
two tiles on the same dashboard describe different sets of tickets.

**Chosen.** **The window filters `created_at`, for every report**, with exactly
three named exceptions, each of which is impossible to express any other way:

1. `summary.per_day`'s *closed* series filters `closed_at` — a created-versus-
   closed chart whose closed series were keyed on `created_at` would be two
   views of the same event and would tell you nothing;
2. `engineer-workload.resolved_in_period` filters `resolved_at` — "what did
   this engineer get done this month" is a question about when they finished;
3. `engineer-workload`'s active counts have **no** date filter at all. "How
   loaded is Nina right now" is a question about today, and a ticket she is
   working on counts whether it was reported yesterday or in March.

**Why.** One rule, stated once, that a reader can hold in their head. The
alternative — each report choosing the timestamp that flatters it — makes
`summary.total` and `categories.total` silently different numbers, and there is
no way for a dashboard to explain the difference to the person looking at it.

**The consequence worth knowing, and the reason this might be reversed.**
`/reports/blocked-escalated` is window-scoped too. A ticket reported ninety days
ago and still blocked does **not** appear in the default thirty-day view — and
that is arguably the single ticket an admin most wants to see. The counter-
argument is that a report which silently ignores the period it was given is
worse, and that the dashboard can pass a wider `from`.

**Reversible.** Yes, and cheaply: `_window_clauses()` in
`app/repositories/reports.py` is the only place the rule is written down.
Making the blocked/escalated report a live queue is deleting the two `created_at`
clauses from the two functions that build it, plus the affected assertions in
`tests/integration/test_reports.py`. If the owner wants that, say so and it is a
ten-minute change — but it should be a deliberate exception, documented on the
endpoint, not a quiet inconsistency.

## D6 — How old is a blocked ticket?

**Question.** Section 11 asks for "BLOCKED tickets grouped by
`blocked_reason_type` **with age**". Age since when? There is no
`blocked_at` column, and there deliberately is not: `incident_service.py`
clears `blocked_reason_type` the moment a ticket leaves BLOCKED, because the
event log already keeps the history.

**Options.** (a) Age since `created_at` — trivial, and wrong: a ticket raised in
March and blocked yesterday would report an age of four months. (b) Add a
`blocked_at` column and a migration. (c) Read it out of `incident_events`.

**Chosen.** (c). A correlated scalar subquery takes `MAX(created_at)` over the
`STATUS_CHANGED` events whose `to_value` is `'BLOCKED'`, and `COALESCE`s to
`created_at` when there is none.

**Why.** The audit log already records it, exactly and for free — the model's
own docstring says events carry `from_value`/`to_value` rather than a rendered
message precisely so "the timing metrics the reports compute" can read them. A
new column would be a second copy of a fact the database already holds, with a
migration and a write path to keep in step. The `COALESCE` covers seeded or
imported rows whose blocking predates their event log: a missing event
understates the age rather than producing a `NULL` hole in an average.

**Cost.** One correlated subquery per blocked row. Blocked tickets are a small
minority of a small table; this is not a number worth optimising yet.

**Reversible.** Yes — `_blocked_since()` in `app/repositories/reports.py` is one
function, and a `blocked_at` column could be introduced behind it without the
report changing at all.

## D7 — What does `/reports/me` return to whom?

**Question.** "Persona home counts" is one line in the plan and three different
screens in practice.

**Chosen.** `reported` always; `assigned` **only for engineers**; the window and
`building_id` applied exactly as on every other report.

**Why `assigned` only for engineers.** `services/assignment.py` refuses any
assignee that is not an ENGINEER (`ASSIGNEE_NOT_ENGINEER`). An `assigned` block
on an employee's or an admin's home screen is therefore a block of guaranteed
zeroes, which is worse than its absence — it invites the reader to wonder what
they did wrong. The response carries `role`, so the frontend branches on that
rather than on whether a field happens to be null.

**Why it takes no user parameter.** There is no `?user_id=`, so there is nothing
to tamper with: the subject is the caller, resolved from the access token. This
is what lets the endpoint be the one report that is not admin-only.

**The thing the owner may want reversed.** `/reports/me` is window-scoped, so an
employee's home screen shows "1 open ticket" when they have one open ticket
reported *in the last thirty days*, and says nothing about the one they raised in
February that is still open. Consistency won the argument; if the home screens
in M7's third pass want all-time counts, they should pass a wide `from` rather
than the endpoint growing a special case.

## D8 — Smaller shapes, recorded so they are not mistaken for accidents

- **Durations are hours, rounded to two decimals, and `NULL` when the population
  is empty.** Seconds are unreadable on a tile and a client that divides them is
  a client that can get it wrong. `NULL` matters: "no ticket reached this
  milestone" must not render as "it took zero hours", and every affected schema
  field is `float | None` for that reason.
- **Percentages are `NULL` at a zero denominator**, via `NULLIF`, for the same
  reason — a period with nothing resolved is not a period with 0% informed.
- **Top-10 per level in `/reports/locations`**, and at most 50 rows in the
  escalated list. Both are constants in `app/schemas/report.py`. Neither is
  paginated: a "top N" list that needs a second page is not a top N list.
- **Deactivated engineers are excluded** from `/reports/engineer-workload`. It is
  a staffing view; someone who cannot be assigned work does not belong on it.
  Their past tickets still count everywhere else.
- **`building_id` is not validated.** An id that matches no building returns
  zeroes rather than a 404. It costs a query per report to do otherwise and the
  only caller is our own dashboard, which picks from a list.

# Decision log

Decisions taken while running phases without the repo owner present. Each entry
records the question, the options, what was chosen, and why — so any of them can
be reversed on review without reconstructing the reasoning.

**Owner's standing instruction (2026-09-23):** decide everything; log the
questions I would otherwise have asked, marked with the answer I went with.

**D41–D43 do not exist.** The numbering skipped when the redesign work started;
nothing was written under those numbers and nothing is missing.

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

> **Superseded in part by D9 (2026-09-23).** The consequence flagged above is
> exactly what went wrong, and it was reversed. `/reports/blocked-escalated`
> is no longer window-scoped. Everything else in D5 stands: on the six reports
> that cover a *period*, the window still filters `created_at`, with the same
> three named exceptions.

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

> **Superseded in part by D9 (2026-09-23).** That is what happened, and the
> proposed workaround was wrong: making every caller remember to pass a wide
> `from` is a bug waiting for the one caller who forgets. `/reports/me` is no
> longer window-scoped. The rest of D7 stands: `reported` always, `assigned`
> only for engineers, no user parameter, and `building_id` still applies.

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

## D9 — Two reports were answering a present-tense question with a period

**Question.** D5 chose one rule — the `from`/`to` window filters `created_at` on
every report — and D7 applied it to `/reports/me` along with everything else.
Both entries flagged, in writing, the case that would break it. Does that case
break it?

**Finding.** It does, on two endpoints, and both were in the flagged list.

1. **`/reports/blocked-escalated`.** The brief's business question is "Which
   incidents are escalated or blocked **and why?**" — present tense. BUILD-PLAN
   section 11 asks for "BLOCKED tickets grouped by `blocked_reason_type` **with
   age**", and an age is only worth reporting if the old ones can appear. Under
   D5 an incident blocked ninety days ago and still blocked was missing from the
   default thirty-day view. That is the single most important row in the report:
   nobody opens a blocked-work queue to find out about the tickets that got
   blocked this week.
2. **`/reports/me`.** The tiles it feeds are Open, In Progress, Blocked and
   Awaiting your confirmation. Those are statuses, not events — "you have one
   open ticket" is a claim about now. Under D7 an employee's ticket from sixty
   days ago that was still open was silently absent from their own home screen,
   and the person best placed to notice the omission is the only person who
   cannot see the query.

D7's proposed workaround — have the home screens pass a wide `from` — makes the
correctness of a home screen depend on every caller remembering to defeat a
filter. The first caller that forgets ships the bug, and it fails quietly.

**Chosen. The rule is now stated in two halves:**

> **A report about *current state* is not window-scoped. A report about
> *activity during a period* is.**

`/reports/blocked-escalated` and `/reports/me` are the current-state reports.
They take **no** `from`/`to` — they do not accept the parameters at all, rather
than accepting a period and ignoring it — and they filter on `building_id`
only. `building_id` survives because it is a *scope* filter, not a *time*
filter: it narrows which tickets are in view, not when they happened.

The other six are unchanged and remain period reports: `/reports/summary`
(including the created-versus-closed daily series), `/reports/categories`,
`/reports/locations`, `/reports/response-times`, `/reports/engineer-workload`
(`resolved_in_period` — its active counts were already a live snapshot under
D5's third exception) and `/reports/communication`. Every median response time
is genuinely about activity in a period and stays that way.

**Why the response shape changed too.** `BlockedEscalatedReport` and `MyReport`
used to echo a `window`. A response that reports a period it did not apply is
worse than one that reports nothing, because a dashboard will happily label a
chart with it. They now carry a `ReportScope` instead — `as_of` and
`building_id` — which says exactly what was and was not filtered. The OpenAPI
document matches: those two routes no longer declare `from`/`to`, so the
contract cannot imply a windowing that is not happening.

**What this costs.** The one-rule-stated-once property D5 was defending. It is
now two rules, and a reader has to know which kind of report they are looking
at. That is acceptable because the distinction is not arbitrary — it follows
from the tense of the business question, it is visible in the response (a
`window` or a `scope`), and it is enforced by two different dependencies in
`app/routers/reports.py` rather than by remembering. A dashboard can still
explain itself to the person reading it, which was D5's real requirement.

**Where it is written down.** `_window_clauses()` (period) and `_scope_clauses()`
(current state) in `app/repositories/reports.py`, one function each, and
`build_window()` / `build_scope()` in `app/services/reporting.py`.

**Regression tests.** `tests/integration/test_reports.py`, one per endpoint,
both of which fail against the old code:
`test_blocked_escalated_shows_a_ticket_blocked_long_before_the_window` (an
incident created 90 days ago and still BLOCKED appears, with a 2160-hour age)
and `test_me_counts_a_ticket_reported_long_before_the_window` (a ticket reported
60 days ago and still OPEN is counted). Both deliberately still send the
thirty-day window in the query string, because a dashboard with a period picker
will, and it must make no difference.

**Reversible.** Yes, symmetrically with D5: `_scope_clauses()` is one function.

> **This entry supersedes D5 and D7 in part**, and both carry a matching marker.
> D5's rule still governs the six reports that cover a period; what D9 removes
> is its application to `/reports/blocked-escalated` and `/reports/me`. D7's
> shape for `/reports/me` stands except for the window. Neither entry is
> withdrawn — both are worth reading precisely because each one names, in
> advance, the case that later broke it.
>
> D9 was in turn *extended* by [D10](#d10--an-escalation-flag-that-outlives-the-work-it-was-about)
> and [D11](#d11--finishing-d10-the-same-stale-flag-on-the-home-screen), which
> fix a latent defect this reversal exposed rather than introduced: the old
> thirty-day window had been ageing stale `is_escalated` rows out of sight.

## D10 — An escalation flag that outlives the work it was about

**Question.** `/reports/blocked-escalated` filtered its two halves differently.
The blocked half asks for `status == BLOCKED`, so closed work drops out of it by
construction. The escalated half asked only for `is_escalated`, with no status
term at all. Should a ticket that was escalated and then closed still be
reported as escalated?

**The defect.** `Incident.is_escalated` is raised by `escalate` and lowered by
exactly one thing: `clear_escalation`
(`app/services/incident_service.py`). Resolving or closing a ticket does not
touch it. The common case is not an admin clicking Clear — it is an engineer
fixing the thing that was escalated about, and the ticket closing with the flag
still standing. Those rows then stayed in the report for ever.

**This is a latent defect D9 exposed, not one D9 introduced.** Under D5 the
report was window-scoped, so a stale escalation aged out of the default
thirty-day view after thirty days and nobody saw the accumulation. The bug was
already there — the filter was always wrong — and the window was concealing it.
D9 removed the window for good reasons that still hold, and the concealment went
with it. Without a status filter the stale rows now accumulate without limit,
bounded only by `ESCALATED_TICKET_LIMIT = 50`: once fifty closed-but-flagged
tickets exist they crowd live escalations out of the list entirely, and
`escalated_total` counts work nobody can act on. Reverting D9 would re-hide this
rather than fix it.

**Chosen.** Both the escalated list and `escalated_total` now also require
`Incident.status.in_(ACTIVE_INCIDENT_STATUSES)` — OPEN, IN_PROGRESS, BLOCKED.
The constant already existed in `app/models/enums.py`, where M3 defined it for
an engineer's `active_ticket_count` and `services/assignment.py`'s capacity
warnings, so "active" still means one thing across the whole application. The
two terms live in one helper, `_live_escalation_clauses()` in
`app/repositories/reports.py`, shared by the count and the list so they cannot
drift apart — which is the shape of this bug in the first place.

**Why this is right, not merely convenient.** BUILD-PLAN section 10 puts the
escalated tickets in the admin dashboard's "Needs attention" panel, each row
carrying an inline Assign button. A closed ticket cannot be assigned and needs
no attention. And D9 already settled the tense of this endpoint: it answers
"what *is* escalated and why" in the present. A flag that survives the ticket is
history, and history is not what a live queue is for. This also restores the
symmetry the report should always have had — both halves now describe live work,
one via a status and one via a status plus a flag.

**Alternative considered and rejected: clear `is_escalated` when a ticket
closes.** It would fix the report and it is a one-line change in
`_apply_transition_effects`. Rejected on three grounds. It is a state-machine
change made to satisfy a reporting problem, and the workflow is the one thing in
this codebase that is deliberately data rather than code. It destroys
information: "this ticket was escalated before it was fixed" is a fact worth
keeping on the row, and `GET /incidents?is_escalated=` and the incident detail
screen both read the column. And it would be a second writer to the flag, so
"what clears an escalation" would stop having one answer — `clear_escalation`
raises `NOT_ESCALATED` precisely because it expects to be the only one. The
event log records `ESCALATED` and `ESCALATION_CLEARED` either way; the column is
the current-state copy, and a report that wants current state can say so itself.

**Deliberately not changed.** The blocked half, which was already correct. The
workflow, the service layer and the schema of `Incident`. And two other counts
of `is_escalated` that have the same shape but a different question behind them:
`summary.escalated_total` (a period report — "how many of the tickets raised
this month were escalated" is a question about the period, and a ticket
escalated and since closed genuinely was) and `personal_counts.escalated` on
`/reports/me`. The second is arguably the same bug and is noted for the owner
rather than fixed here, because it is a different endpoint with its own
assertions and this change was meant to be surgical.

**Regression test.**
`test_escalated_list_drops_a_ticket_that_was_closed_while_still_flagged` in
`tests/integration/test_reports.py`. It adds a CLOSED and a RESOLVED incident,
both with `is_escalated` still True and both escalated *more recently* than the
fixture's two live escalations, so a missing filter puts them at the head of the
list rather than out of sight at the end of it. It asserts `escalated_total ==
2`, a list of exactly two rows, and their titles and statuses. Against the
unfixed code it fails with `assert 4 == 2`.

**Reversible.** Yes: one function, `_live_escalation_clauses()`.

## D11 — Finishing D10: the same stale flag on the home screen

**Question.** D10 fixed `/reports/blocked-escalated` and deliberately left one
thing behind: `personal_counts.escalated`, which feeds `/reports/me`, counted
`is_escalated` with no status term exactly as the escalated list used to. D10
called it "arguably the same bug" and noted it for the owner rather than fixing
it, because that change was meant to be surgical. Is it the same bug, and does
the same answer apply?

**Finding. It is the same bug, on the endpoint where it is read by the person
least able to diagnose it.** The two facts D10 turns on hold here unchanged:

1. `Incident.is_escalated` is raised by `escalate` and lowered by exactly one
   thing, `clear_escalation`. Closing or resolving a ticket leaves it standing,
   on purpose, because the flag is history and `incident_events` keeps it.
2. `/reports/me` is a current-state report. D9 settled that: its tiles read
   Open / In Progress / Blocked / Awaiting your confirmation, which are claims
   about now, which is why it takes no `from`/`to` at all.

So an employee whose ticket was escalated, fixed and closed — the ordinary
ending, with no admin ever clicking Clear — saw "1 escalated" on their home
screen for ever afterwards. The count is not capped the way the escalated list
is by `ESCALATED_TICKET_LIMIT`, so it grows without bound: a long-serving
employee accumulates a permanent, rising tally of escalations that are all
finished work. And unlike the admin panel, this number has no list under it to
contradict it. The reader sees a figure, cannot open it, cannot act on it, and
has no way to find out it is wrong.

**Chosen.** `personal_counts` now counts the `escalated` column through
`_live_escalation_clauses()` — the helper D10 introduced — so `is_escalated`
carries `Incident.status.in_(ACTIVE_INCIDENT_STATUSES)` with it. One line in
`app/repositories/reports.py`. No new concept, no second definition of "live":
the point of putting those two terms in a helper was that the next place asking
the present-tense question would reuse it, and this is that place.

This applies to both capacities the endpoint reports. An engineer's `assigned`
block runs through the same function with `Incident.assignee_id` in place of
`Incident.reporter_id`, so their escalated figure is corrected by the same
line — which is the argument for `personal_counts` taking the column as a
parameter rather than existing twice.

**Deliberately not changed, again: `summary.escalated_total`.** D10 settled
this and nothing here reopens it. `/reports/summary` is a *period* report, and
"how many of the tickets raised this month were escalated" is a question about
the period. A ticket escalated in that period and since closed genuinely was
escalated in that period, and removing it would make the number answer a
different question from the one beside it. The rule is not "always filter on
status" — it is **the tense of the question decides**, which is D9's rule
reaching the last place it had not been applied.

**With this, every present-tense read of `is_escalated` goes through one
helper.** There are now exactly three readers of the flag in the reporting
layer: `blocked_escalated_totals`, `escalated_tickets` and `personal_counts`,
all three current-state, all three calling `_live_escalation_clauses()`; plus
`summary`, the one period reader, which does not and says why. A fourth reader
has a decision to make and two worked examples to make it from.

**Regression test.**
`test_me_drops_an_escalation_on_a_ticket_the_reporter_has_had_closed` in
`tests/integration/test_reports.py`. It gives Eve — who already has one live
escalation, I2, IN_PROGRESS — a second ticket that is CLOSED with
`is_escalated` still True, and asserts her whole `reported` block exactly:
`total` rises to 7 and `closed` to 2, because the ticket is real and belongs in
those counts, while `escalated` stays at 1. Asserting the entire dictionary
rather than the one field is deliberate: it proves the fix removed the row from
one count and from no other. Against the unfixed code it fails with
`{'escalated': 2} != {'escalated': 1}`.

**Reversible.** Yes: the same one function as D10, `_live_escalation_clauses()`.

## D12 — `seed_demo`: three choices that are easy to get quietly wrong

**Question.** BUILD-PLAN section 15 specifies what the demo data must contain.
It does not say how a generator should behave when it is run twice, what it
should do about passwords, or how a ticket's status should be decided. Those
three were decided here.

### 1. The status is an outcome of the timeline, not an input to it

**Rejected: pick a status from a distribution, then back-fill the timestamps it
implies.** It is the obvious approach and it is subtly wrong in a way that only
shows up on a dashboard. Back-filling means inventing an `assigned_at` for a
ticket whose status you already chose, and nothing then ties the age of a
ticket to how far through its life it is: you get tickets reported eighty days
ago that are still OPEN with no explanation, and tickets reported an hour ago
that are CLOSED. The reports do not catch it — every count is fine — but a
human reading the ticket list sees a world that could not exist.

**Chosen.** Each incident is generated as a full intended path with a drawn
duration for every hop, and `_walk` applies the steps in time order, stopping
at the first one later than `now`. Status falls out of age and duration. A
ticket is OPEN because its assignment has not happened yet.

The cost is that the status mix cannot be dialled directly — it is a
consequence of `RESPONSE_MEDIANS` and `PATH_WEIGHTS`, and changing either
moves it. That was worth paying, and it surfaced a real fact: with every ticket
given a path to CLOSED, ninety days of history comes out **85% closed**, with
two blocked tickets in three hundred. The five stopping paths in `PATH_WEIGHTS`
exist because of that measurement, and each one was added for a specific empty
tile.

### 2. Not idempotent, and saying so rather than pretending

**Rejected: make it idempotent by matching on natural keys**, the way
`seed_categories` matches on `(parent_id, name)`. Categories have a natural
key. Three hundred generated incidents do not — there is nothing to match a
regenerated ticket against — so "idempotent" could only mean "delete everything
and regenerate", which is a destructive operation wearing a safe word.

**Rejected: top up to the requested count.** Then two runs produce a world
whose ninety-day history has a seam in it, and the second run's tickets are
drawn against a different `now`.

**Chosen.** It looks for its own buildings first and returns without writing,
reporting `created: false` and saying in the payload that it does not top up or
refresh and that the way to regenerate is to drop the database. Safe to run
twice; not useful to. The requirement was "idempotent or clearly documented as
not", and this is the second — documented in the return payload, the module
docstring, the action docstring, the guide and here, because a caller who
learns this from a constraint violation learns it too late.

### 3. One bcrypt hash for thirty-seven demo accounts

**The shortcut.** `hash_password` at twelve rounds costs about 250 ms by
design. Hashing thirty-seven identical demo passwords separately would add
roughly nine seconds to a seed that otherwise takes under one.

**Why it is safe here and nowhere else.** Reusing one hash means reusing one
salt, so identical hashes reveal that the passwords are identical. That is not
a disclosure: the password is printed in the return payload and is the same for
every demo account by design, because a reviewer who has to reset thirty
passwords to look around will not look around. The accounts are also
deliberately not flagged `must_change_password`, for the same reason.

**What keeps it contained.** The shortcut lives in `_seed_people` and nowhere
else — every real account still goes through `hash_password` per user — and
`_op_seed_demo` refuses to run unless `settings.is_local`, so these accounts
cannot exist in a deployed database. That guard is the thing protecting this
decision, which is why it is checked on `IS_LOCAL`, the same flag that drives
`sslmode`, the `Secure` cookie flag and the weak-JWT-secret startup refusal,
rather than on a second environment test invented here.

**Reversible.** Yes, and cheaply: one line in `_seed_people`, at the price of
nine seconds per seed.

## D13 — The demo data went into a new database, not over the old one

**Question.** D4 planned to reset `acme_incidents_dev` before seeding, so that
`seed_demo`'s designed dataset would not be mixed with M6's ad-hoc test residue
(93 users, 74 incidents, left by Playwright runs and manual checks).

**What happened.** The `DROP DATABASE` was refused by the permission classifier
as irreversible local destruction. That refusal was correct, and working around
it would have been the wrong move.

**Chosen.** Seed into a **new** database, `acme_demo`, and leave
`acme_incidents_dev` exactly as it was.

**Why it is better than the original plan.** Nothing is destroyed, both datasets
exist side by side, and switching between them is one line in
`backend/v1/.env`. The owner can compare M6's screens against ad-hoc data with
the same screens against the designed dataset, which the reset would have made
impossible.

**How to use it.** `backend/v1/.env` currently reads
`POSTGRES_NAME=acme_incidents_dev`. Change it to `acme_demo` and restart uvicorn
to see the dashboards against 300 incidents over 90 days. Change it back to
return to the old data.

**Logins in `acme_demo`.** `henry@acme.inc` / `AcmeLocalDev2026!!` (note the
second `!` — the password-change gate forced a change, which is the gate working
as designed). The 36 generated accounts share the password `seed_demo` returns
in its payload, `AcmeDemo2026!`.

**Verified against the seeded data.** Response-time medians are monotonic across
priority — CRITICAL 0.49 h assign / 7.98 h resolve, HIGH 1.72 / 17.74, MEDIUM
5.39 / 50.2, LOW 17.37 / 124.48 — which is the evidence that the backdated
events are real rather than everything having been created at seed time. The
escalated total reads 16 against 13 further escalations still flagged on closed
tickets, so D10 and D11 are demonstrably filtering live data, not just fixtures.

**Reversible.** Entirely. `acme_demo` can be dropped; nothing else changed.

## D14 — The dashboards: five calls where the honest answer cost something

**Question.** BUILD-PLAN section 10 specifies the three persona screens down to
the tile. Five of its instructions could not be followed literally against the
API D9, D10 and D11 left behind, and each one had a plausible way to *appear*
to follow it. They are recorded together because they are one judgement applied
five times: **when the label and the number disagree, change the label.**

### 1. The admin dashboard has one filter bar and two kinds of number under it

The brief asks for "a filter bar (date range, building) applying to all
widgets". It cannot apply to all widgets, because D9 made two of the eight
reports refuse `from`/`to` outright — `/reports/blocked-escalated` and
`/reports/me` answer present-tense questions, and a ticket blocked ninety days
ago and still blocked is the row those reports exist to surface.

Three options. **Send the dates anyway** and let the API ignore them: the
dashboard would then label a live figure with a period, which is precisely the
defect D9 was raised to fix, reintroduced one layer up and harder to see.
**Drop the live widgets** so the filter really does reach everything: that
removes the blocked queue and the escalation list, which are the two things an
admin opens this screen to act on. **Say which is which**, chosen.

The page is two sections. Everything period-scoped sits under a
`PeriodScopeHeading` reading "Reported in this period — counted over 24 Aug
2026 – 23 Sep 2026", and the dates are read **off the response's `window`**,
not off the picker, so the heading cannot name a period the server did not
apply. Everything current-state sits under a `CurrentScopeHeading` reading
"Right now — as it stands at 23 Sep 2026, 02:46. The date range above does not
apply to these." The filter bar says the same thing in one line before either
section starts.

What it costs is a longer page and a reader who has to notice a heading. What
it buys, against the demo data, is that "Blocked · 21" and "reported in this
period and blocked · 11" can both be on screen without either being a lie.

The building filter carries no such caveat and is applied to both, because
`building_id` narrows *which* tickets are in view rather than *when* they
happened — the distinction D9 drew when it kept `building_id` on the
current-state reports.

**Where it is enforced.** `features/dashboard/ScopeHeading.tsx` for the
headings, and `api/reports.ts` for the half that cannot be got wrong:
`fetchBlockedEscalated` and `fetchMyReport` take `ReportScopeParams`, which has
one field, so a caller that tried to pass a date would not compile. That is a
deliberate second guard — a type is cheaper than a code review.

### 2. Both escalated figures are shown, and the screen says why they differ

`summary.escalated_total` is period-scoped and counts every escalation raised
on a ticket reported in the period, closed ones included.
`blocked-escalated.escalated_total` is live-only and counts flagged tickets
that are still OPEN, IN_PROGRESS or BLOCKED (D10). Against `acme_demo` they
read 12 and 16.

Showing one would have been simpler. Showing the larger would overstate what
needs attention; showing the smaller would understate what happened in the
period. Both are on screen, one per section, and an alert under the live tiles
names the difference in the reader's words rather than leaving them to work out
why two tiles labelled "Escalated" disagree.

### 3. "Resolved in the period" has no link, because no list matches it

Every other KPI tile opens the tickets it counted. This one cannot: it sums
`resolved_in_period` from `/reports/engineer-workload`, which counts by
`resolved_at`, and `GET /incidents` filters only on `created_at`. A link would
open a *similar* list — tickets reported in the period that are now resolved —
which is a different set, and for a short period a very different one.

A wrong link is worse than no link: it teaches a reader that the dashboard's
numbers cannot be checked. The tile renders as a plain card rather than a
clickable one, so nothing invites the click. The same approximation *is* used
for the per-engineer resolved count in the workload table, where the chip above
the list names the dates it applied — visible rather than silent. Closing the
gap properly means a `resolved_from`/`resolved_to` filter on `GET /incidents`;
it is in `DEPLOYMENT-CHECKLIST.md` as work not done.

This tile also excludes a ticket resolved by an admin on an unassigned ticket,
which the workflow permits by an unusual route (unassign an IN_PROGRESS ticket,
then resolve it as FACILITY_ADMIN). The count is per engineer, so such a ticket
belongs to nobody. Rare enough to accept and worth writing down.

### 4. The engineer's fourth tile is not "Resolved this week"

The brief names it so. No endpoint an engineer may call can answer it.
`/reports/me` is current-state by D9 and carries no period at all;
`/reports/engineer-workload` does carry a period-scoped `resolved_in_period`
and is **admin-only**, deliberately, because an engineer who could read it
could rank their colleagues. `GET /incidents` filters on `created_at`, not
`resolved_at`, so the client cannot compute it either.

Three ways out. **Widen `/reports/me` to take a period** — rejected: it would
undo D9 on the endpoint D9 was most concerned about, to serve one tile.
**Open `/reports/engineer-workload` to engineers** — rejected: a permission
change to satisfy a label. **Change the label**, chosen. The tile reads
"Resolved, awaiting confirmation" and counts `assigned.resolved` — the tickets
this engineer has fixed that are still waiting on their reporter. It is a
number they can act on, which "resolved this week" mostly is not, and it
parallels the employee's "Awaiting your confirmation" tile on the other side of
the same handover.

### 5. The response-time tiles say "median", not "average"

The brief asks for "average time-to-assign / acknowledge / resolve". The
endpoint computes `percentile_cont(0.5)`, and M7 pass 1 chose the median
deliberately so that one ticket left over a long weekend cannot move the
headline. The labels say median. Three words, and the alternative was a
dashboard that names a statistic it is not showing.

### Smaller shapes, recorded so they are not mistaken for accidents

- **"Confirm fixed" and "Still broken" are drawn from `allowed-transitions`,
  not from `status === 'RESOLVED'`.** The shortcut was available and would have
  saved one request per row. It would also have kept drawing the buttons after
  the transition table changed, drawn them for a viewer who is not the
  reporter, and drawn "Still broken" past the reopen window — where the API
  would refuse the click. `InlineTransitionButtons` asks the same endpoint the
  detail page asks and renders the answer; `only` filters what is drawn from
  that answer and can never add to it.
- **"My active tickets" is sorted client-side within the fetched page.**
  BUILD-PLAN asks for "priority then age" and `IncidentSort` offers no compound
  ordering. The server sorts by `-priority`, which guarantees the page holds
  the most urgent tickets, and `sortByPriorityThenAge` decides their order
  among themselves. Sound here because the list is a fixed top-N; it would not
  be sound as a general list sort, so the full My Queue screen uses the
  server's ordering and the helper lives beside the home screen that can afford
  it.
- **The status chart is one colour, not five.** The obvious move was the status
  chip palette — blue Open, orange Blocked, green Resolved. As a five-colour
  categorical set on a white card it fails: blocked-orange beside
  resolved-green measures ΔE 3.2 under protanopia, well under the floor of 8,
  and closed-grey falls below the chroma floor. Those two are adjacent in
  workflow order and workflow order is not ours to rearrange. Every bar is
  therefore slot-1 blue and the axis label carries the identity, which is the
  correct treatment for nominal categories anyway. The chips are unaffected:
  they carry a word, so their colour never stands alone. Priority is the one
  exception and gets a validated single-hue ramp, because priority is a
  genuinely ordered scale and darker-is-more-urgent is information rather than
  decoration.
- **Every chart has a table view.** A bar chart puts its values behind a hover,
  and a hover is not available to a keyboard, a screen reader or a printout.
  The toggle in each chart card's header gives the same numbers as text and the
  same drill-downs as links.
- **The Needs attention panel shows six rows per half, not all of them.**
  Against `acme_demo` it had 26 unassigned and 16 escalated, which made the
  dashboard 12,000 pixels tall on a phone and buried the blocked-by-reason
  panel under them. The heading still states the real total and a link under
  the rows opens all of them. A panel headed "what needs somebody" is a prompt
  to act; thirty rows of it is a list to scroll past.
- **Three list filters arrive only by link.** `category_id`, `assignee_id` and
  `created_from`/`created_to` are honoured by `useIncidentFilters` but have no
  control on the filter bar, because they exist to make a dashboard link land
  on exactly the tickets a tile counted. They are not hidden:
  `AppliedFilterChips` renders one removable chip for each above the list, so a
  reader who arrived from a chart can see what was applied on their behalf and
  take it off. Giving them full controls would be four more controls for
  everyone, to serve a case that only ever arrives by link.
- **The admin dashboard is lazy-loaded.** It is the only screen that imports
  `@mui/x-charts`, which is about a third of the bundle, and `RequireRole`
  already keeps everyone else off it. Splitting along a line the permission
  model draws took the main bundle from 406 kB gzipped to 301 kB for every
  employee and engineer.

### What looking at the screens found

Recorded because the count is the argument for doing it. Five defects came from
taking screenshots at 1440px and 375px and reading them, and none of them would
have failed a test that was not written specifically to catch it:

1. Bar value labels centred **inside** the bars in dark ink — close to
   unreadable on the darkest step of the priority ramp, and spilling past the
   end of a short bar.
2. Moving them outside then hid the **largest** number on every chart: a bar
   that reaches the plot edge has nowhere to draw its label and Material UI
   drops it silently. Fixed with 15% headroom on the value axis.
3. The daily-flow axis labelled every second day in August and every day in
   September — the library thinning whichever labels happened to collide — and
   clipped its last tick to "Se…".
4. The Needs attention panel rendered all 26 unassigned and 16 escalated rows,
   making the dashboard 12,000 pixels tall on a phone and burying the
   blocked-by-reason panel beneath them.
5. **The daily-flow axis was a whole day early.** `per_day[].day` is a bare
   `YYYY-MM-DD`, which ECMAScript parses as UTC midnight and
   `toLocaleDateString` then renders in the reader's zone, so west of Greenwich
   every label lost a day. The axis read "Sep 15" under a heading reading
   "Counted over Sep 16". It was wrong on the demo data too and invisible there
   because the heading sat far enough up the page; it only became obvious after
   `.env` was restored to the sparse dev database and a seven-day range put the
   two within one screen of each other.

A sixth came from a test rather than an eye, and is worth the same note: the
chart `sx` blocks were written against `MuiBarElement-root` and
`MuiBarLabel-root`. The library's classes are `MuiBarChart-element` and
`MuiBarChart-label`, so the selectors matched nothing and the styling was a
silent no-op — the bars never took their pointer cursor and the labels never
took their ink. A Playwright assertion that a bar element is present is what
surfaced it. **If you style a chart, assert on the element you styled.**

**Reversible.** All five, independently. The scope headings are one component;
the two parameter types are one file; the four relabelled tiles are four
strings.

## D15 — How much of the upstream template survives the README rewrite

**Question.** `README.md` was 281 lines, roughly 160 of them the Citi scaffold's:
the title "Coding Workshop", a "Coding Workshop Example" section reproducing the
brief verbatim, and Contributing / License / Roadmap / Security / Authors /
Feedback. This is a **fork of an Apache-2.0 repository**. What must stay, what
should stay, and what is only there because nobody deleted it?

**Finding: three different kinds of content, and only one of them is an
obligation.**

1. **Licence and attribution.** Apache-2.0 §4 requires the `LICENSE` file to
   travel with the work. `LICENSE` is untouched and is not ours to touch. The
   fork's origin is now stated in one section with a table of what came from the
   scaffold and what was written here, so nothing in this repository can be read
   as claiming authorship of `infra/`, `bin/` or the workshop guides.
2. **Community files that still work.** `CONTRIBUTING.md`, `DCO.md`,
   `CODE_OF_CONDUCT.md` and `SECURITY.md` describe how Citi takes contributions
   and vulnerability reports. They are not obligations, but they are live and
   correct for this repository, and deleting a security-disclosure route is a
   bad trade for four lines of README. Kept, as links.
3. **Template furniture that is now wrong.** The verbatim brief (the reviewer has
   it; reproducing it says nothing about what was built), the Roadmap section
   pointing at *upstream's* issue tracker (this fork's issues are not there), and
   the Feedback section asking the reader to star the repository. Removed. Also
   removed: the scaffold's own "Getting Started → navigate to the main guide",
   demoted to a link in the last section, because the first thing a reviewer of
   *this application* needs is not the workshop's index.

**The scaffold authors are still credited**, by name and GitHub handle, under a
heading that says they wrote the workshop template rather than this application.
That distinction did not exist in the old README, where the five names sat under
a bare "Authors" heading directly beneath our setup instructions.

**A defect found while doing it.** The template's own README said "This library is
licensed under the MIT-0 License." `LICENSE` is, and always was, the **Apache
License 2.0**, `Copyright 2023 Citigroup, Inc.` The new README states Apache-2.0
and says in one parenthesis that the earlier claim was wrong, rather than
silently correcting it — a licence statement that changes without explanation is
exactly the kind of thing a reviewer should be suspicious of. The `LICENSE` file
itself is unmodified. Worth reporting upstream.

**Reversible.** Entirely: one file, and the old version is in git.

## D16 — The README states a coverage figure it does not have

**Question.** `docs/full-stack.md` sets explicit coverage goals — 80%+ both
layers, 90%+ on API endpoints and error cases. Neither `pytest-cov` nor
`@vitest/coverage-v8` is installed, so no number exists. Install a coverage tool
and generate one, estimate, or say so?

**Chosen.** Say so, first in the list of known gaps, and describe what *is*
covered instead: which rules are tested by construction (every workflow row, via
a suite that parametrises over `TRANSITIONS` itself), which suites run against a
real database and real migrations, and which four screens have no component tests
at all.

**Why not just install it.** It is twenty minutes of work and it would produce a
number. But the number would arrive on the last day of the build, unexamined — a
coverage report is only worth having if somebody acts on what it shows, and
there is no phase left in which to act. A figure published to satisfy a rubric
line, with nothing done about it, is worse than the honest absence: it invites
the reader to believe the gaps were looked for.

**Why not estimate.** 431 test functions expanding to 683 cases over ~60 endpoints
[**M8 figures, kept as written.** The finished build is 825 backend, 312
frontend and 82 end-to-end — 1,219 cases over 45 paths / 65 operations. The
argument is unchanged by the larger number, and deliberately so: a bigger
denominator makes a guess sound better without making it a measurement.]
would support a confident-sounding guess. It would still be a guess presented as
a measurement.

**What was done instead.** The gap list names eight specific things, including the
four untested admin screens (`features/facilities`, `features/categories`,
`features/users`, `features/engineers`), that end-to-end tests do not run in CI,
and that nothing at all has been verified against AWS. A reviewer can check every
one of those in a minute; they cannot check an unaudited percentage at all.

**Reversible.** Yes, and it should be reversed: add `pytest-cov` and
`@vitest/coverage-v8`, publish the report in CI, and close the specific gaps it
finds. That is stretch work with a real result, not a documentation change.

## D17 — The demo runs entirely on `acme_demo`, not across two databases

**Question.** D13 left two local databases: `acme_incidents_dev` (sparse, real
test residue) and `acme_demo` (300 designed incidents over 90 days). The demo
walks one *new* ticket through its life and then shows the dashboard. Switching
between them mid-demo means editing `.env` and restarting uvicorn — about thirty
seconds of dead air, and a signed-out audience.

**Chosen.** Run the whole script on `acme_demo`, including the new ticket.

**Why.** The seeded world contains everything the walkthrough needs and the
dashboard only makes sense against it: a SENIOR engineer whose specialty matches
the ticket (Nina Alvarez, Building & Facilities), an admin, thirty employees, and
90 days of backdated history behind the response-time medians. Reporting the demo
ticket into `acme_incidents_dev` and then switching would also mean the ticket the
audience just watched being created is *absent* from the dashboard they are then
shown, which invites exactly the wrong question.

**What it costs.** The demo ticket is written into the demo database and stays
there. Run the script three times and `acme_demo` holds three leaks. That is
acceptable — it is already not pristine (earlier Playwright runs left ~18
incidents and several deactivated `e2e.*` accounts in it), and `seed_demo`
refuses to re-seed over an existing world rather than merging into it, so nothing
silently diverges. The script says all of this under "What you will see that is
not in the script" rather than letting a presenter discover it in front of an
audience.

**Reversible.** Drop `acme_demo`, re-run `migrate` and `seed_demo`: about one
second of compute.

## D18 — Three browsers, and the accounts were verified rather than trusted

Two smaller calls in the demo script, recorded because both were nearly got
wrong.

**Three separate cookie jars, not three windows.** The script has three personas
signed in simultaneously. The refresh cookie is `HttpOnly; SameSite=Strict` on
`localhost:3000`, so two windows of one browser profile share one session and
signing in as the engineer silently signs the employee out — mid-demo, with no
error message, looking exactly like a bug in the application. The script
prescribes a normal window, an incognito window and a *different browser or
profile* for the third, notes that two incognito windows do not count, and offers
sign-out-between-acts as the fallback.

**The logins were checked against the stored hashes.** Three documents recorded
demo credentials and they did not agree on the admin's, which differs from the
shared demo password by one character and is exactly the kind of thing that
fails live. Rather than trusting any of them, each account's `password_hash` was
read out of `acme_demo` and tested with the application's own
`verify_password` — which matters, because passwords are SHA-256-and-base64
pre-hashed before bcrypt (`app/security/passwords.py`), so a plain `bcrypt.checkpw`
against the stored hash returns False for the *correct* password. The first check
did exactly that and reported that every account was wrong. All six are now
confirmed: `henry@acme.inc` / `AcmeLocalDev2026!!` (two exclamation marks) and
the seeded accounts on `AcmeDemo2026!`.

Every figure the script quotes was queried the same way rather than copied from
an earlier document: 21 blocked now, 16 live escalations against 12 in the
default 30-day period, 26 unassigned for over 24 hours, 318 incidents.

**Reversible.** Not applicable; this is verification, not design. But it is worth
re-running before any demo, because the "right now" figures move with the clock
and the seeded history ages out of a 30-day window.

## D19 — Where a failed-login counter can live when there is no shared memory

**Question.** BUILD-PLAN S6 asks for a lockout after 10 failed sign-ins per
email per 15 minutes. Where does the counter live, what does it count, and what
cleans it up?

**Where.** A table, `login_attempts`. There was never a second option. A Lambda
container shares no memory with the next one, so an in-process counter resets on
every cold start and disagrees between two warm ones — ten attempts spread over
three containers would be three counts of three or four, and the lockout would
never fire. The database is the only shared state this system has.

One row per email, not one row per attempt. A row *is* the current window: when
it started and how many failures are in it. A credential-stuffing run against
one address therefore costs one row rather than one row per guess. The email is
the primary key, the way `engineer_profiles` keys on `user_id` — there is no
identity here beyond the address, and a surrogate key would make two counters
for one address possible. `CITEXT`, matching `users.email`, so varying the
capitalisation cannot buy a second allowance.

**What it counts, and the part that is easy to get wrong.** Attempts against
addresses that have **no account** are counted identically, the check runs
*before* the user lookup, and the table has **no foreign key to `users`** so that
those rows are possible at all. A lockout that only applied to real accounts
would answer "does this person have an account here?" — which is exactly the
question the single generic 401 exists to refuse, and it would have undone a
defence M2 built deliberately. `test_migration.py` asserts the absence of that
foreign key, because it is load-bearing rather than an omission.

Every rejected sign-in counts, including a correct password for a deactivated
account. Not because that attempt was a guess, but because one rule with no
branches is what keeps the endpoint uninformative: an attacker who could tell
"counted" from "not counted" would have learned which of the three refusals they
received.

**The window is fixed, not sliding** — measured from the first failure in the
run. A sliding window would let somebody keep a colleague's address locked
indefinitely by failing one login every fourteen minutes.

**Self-cleaning, because there is nowhere for a sweeper to run.** Aurora
Serverless v2 is at `min_capacity = 0` and sleeps when idle, so a scheduled job
would have to wake the cluster on a timer for the sole purpose of deleting rows
nobody is reading — which costs more than the rows do. Every failed login
deletes the windows that have expired, and the failure path is the only path
that inserts, so the table stays the size of whatever attack is happening right
now.

**Two smaller shapes, recorded so they are not mistaken for accidents.**

*The service commits on its own.* The request that increments the counter is the
request that then raises 401, so the router never reaches its `session.commit()`
and `get_db` closes the session without one — which would roll the count
straight back and make the lockout unreachable. `rotate_session` set this
precedent in M2 for its mass revocation; this is the second and last place a
service commits for itself, and both are security responses that have to outlive
the request that failed.

*`authenticate` now takes an injectable `now`.* Every other time-windowed rule
in this codebase does (`app/clock.py`'s docstring is about exactly this), and
without it the expiry could only be tested by sleeping for fifteen minutes.

**The cost, accepted.** Anybody can lock a colleague's address for fifteen
minutes by failing ten logins against it. The alternative — keying on the client
address — trades that for something worse: the Lambda Function URL is publicly
reachable, so `X-Forwarded-For` is attacker-controlled and the lockout would
become *bypassable* rather than merely annoying. A bypassable lockout is not a
lockout. The window is short, clears itself and needs no administrator to undo,
and this is written up in the README's known limitations.

**Also.** Migration `0004` was applied to `acme_incidents_dev`, because the
application cannot serve a login without that table and the Playwright suite
runs against that database. It creates one empty table and touches nothing that
was there. `acme_demo` was left alone and will need the same `migrate` before it
is next used.

**Reversible.** Yes. One migration, one model, one repository and about seventy
lines in `auth_service.py`; `downgrade()` drops the table.

## D20 — The first middleware, in a codebase that argues against middleware

**Question.** Structured logging has to record a request id, the route, the
status and the duration. Those are properties of a *request*, and this
application has no middleware at all — `security/dependencies.py` and the guide
both argue explicitly against them.

**Finding: the argument was about rules, and it still holds.** What M2 rejected
was a middleware that *pattern-matches URLs to decide who may pass*. Its reasons
were that the gate then lives somewhere no route mentions, that the URL list
drifts from the router, and that a new route defaults to unprotected. All three
are about a middleware **deciding** something.

**Chosen.** Add one, `RequestLogMiddleware`, and say why it is not the thing that
was rejected.

**Why.** It decides nothing. It cannot refuse a request, cannot change a
response body, and removing it changes no behaviour — only the record of it. And
the thing it needs is the thing a dependency cannot be: it has to wrap requests
that fail *before any dependency runs*, which is every 404, every malformed body
and every 500. A `Depends` on every route would also be a list that drifts from
the router, which is the objection restated.

It is a **pure ASGI** middleware rather than `BaseHTTPMiddleware`, and that is
not a style preference: the latter runs the rest of the application in a
separate task, which breaks the context variable carrying the request id and
buffers the response.

**The direction a context variable cannot travel.** The request id flows
downward on a `ContextVar`, which works — a worker thread inherits a copy of the
context, so it sees values set before it started. The *user id* has to flow
back up, from the dependency that verified the token to the middleware that
writes the line, and a `ContextVar.set` inside a thread is invisible to its
caller. FastAPI runs this application's synchronous dependencies and endpoints
in worker threads, so that direction had to be a plain dict on the ASGI scope,
shared by reference. This is the kind of thing that appears to work in a test
and produces empty fields in production.

**Reversible.** Yes — deleting one `add_middleware` line restores the previous
behaviour exactly.

## D21 — An unknown URL gets a page, not a redirect

**Question.** BUILD-PLAN S6 asks for a 404 page. What does the application do
now?

**Finding, checked in a browser before anything was changed.** `App.tsx` had
`<Route path="*" element={<Navigate to={paths.home} replace />} />`. Signed in,
a mistyped URL silently rewrote the address bar and landed on the dashboard;
signed out it bounced on to the login screen. A typo, a stale bookmark and a
dead link pasted into a chat all looked exactly like "you asked for the home
page". A ticket **id** that does not exist was already handled properly — "That
ticket does not exist." — so it was route-not-found specifically that was being
swallowed.

**Chosen.** A `NotFoundPage` that says so, shows the path that failed, and
offers two places to go. Inside the shell, so the navigation is still there to
leave by.

**Why.** `NotPermittedPage` had already made this argument in M6 and its
docstring states it: "An explanation, not a redirect: a URL someone pasted to
you should tell you why it will not open." The catch-all was the one place that
did not follow it. Showing the path matters more than it sounds — the most
useful thing a person can do with a dead link is see which character of it is
wrong.

**The HTTP status really is 200, and that is not a bug we can fix here.**
CloudFront rewrites every extension-less path to `/index.html` so that deep
links survive a reload (`docs/INFRA-CHANGES.md` item 1), which means the server
cannot know the path is not a route. Only the router knows, and by then the
response has been sent. A genuine 404 needs server-side rendering, which this
architecture deliberately does not have. What the user is told is accurate; the
network log is a consequence of SPA routing. Nothing crawls it: the whole
application is behind a login.

**Signed out, an unknown URL still goes to the login screen**, because the
catch-all sits inside the authenticated group. That is the right answer rather
than a compromise — the application is not browsable without a session, and
after signing in the bad URL resolves to the page that can explain it.

**Reversible.** Yes — one route element.

## D22 — What the accessibility pass covered, and three things it did not

`docs/full-stack.md` lists "Accessibility (a11y) and inclusivity" as an Expected
Capability for the frontend and nothing in M1–M8 had addressed it; that is why
S6 went first (see [D2](#d2--which-stretch-features-in-what-order)).

**Chosen: axe-core in the existing Playwright suite, at WCAG 2.1 AA, plus a
manual keyboard pass — and the manual pass is not optional.** See
[D23](#d23--what-tabbing-found-that-axe-did-not) for what that bought.

`best-practice` rules are deliberately **not** enabled. They include opinions
(`landmark-unique`, `region`) that are worth arguing about rather than failing a
build over, and mixing them in makes a real violation harder to find among them.

**Scanned with things open, not only at rest.** A screen's resting markup is not
the markup a person interacts with, so the suite scans the workflow dialog open,
the assign dialog open, the mobile navigation drawer open, the mobile filter
sheet open, the questionnaire after each section it reveals, and the login
screen with an error on it.

**Three things not done, with reasons.**

1. **`eslint-plugin-jsx-a11y` is not installed.** Its peer range stops at ESLint
   9 and this project is on ESLint 10; installing it needs `--force` or
   `--legacy-peer-deps`. Forcing a peer-dependency conflict into a graded
   repository to gain a lint rule is a bad trade, and the rules it would have
   caught — clickable non-interactive elements, unlabelled icon buttons — turned
   out to be things this codebase does not do: every `onClick` in `src/` is on a
   real control, and all three `IconButton`s were already labelled. Worth
   revisiting when the plugin supports ESLint 10.

2. **The questionnaire's cards are still toggle buttons, not a radio group.**
   Each `SelectableCard` is a `ButtonBase` with `aria-pressed`, so the five
   category cards are five tab stops where a radio group would be one with
   arrow-key navigation. A radio group is arguably the more correct semantic.
   It was not done because it is a rewrite of the component's interaction
   model — roving `tabindex`, arrow handling, group labelling — and it would
   change the accessible role every existing test and fixture queries by. The
   cards are labelled, reachable, operable by Space and Enter, and they announce
   their pressed state; the cost is tab stops, not access. Recorded as a known
   gap rather than quietly left.

3. **The drawer's account rows are `div role="button"`, not `<button>`.** That
   is Material UI's `ListItemButton` default component. They are focusable,
   operable and announced as buttons, and axe is satisfied; changing the
   rendered element for no measurable gain risked a visual regression. Noted
   rather than changed.

**Reversible.** The scans are additive. The fixes are not, and should not be.

## D23 — What tabbing found that axe did not

Recorded because the count is the argument, exactly as it was for the
screenshots in [D14](#d14--the-dashboards-five-calls-where-the-honest-answer-cost-something).

**axe went green while the application had no visible focus indicator at all.**
A global `:focus-visible` rule was added to `theme.ts` in the same session. It
did nothing. Material UI's `ButtonBase` sets `outline: 0` in its own root class;
a bare `:focus-visible` selector has the same specificity as a class, so the
winner is decided by stylesheet order, and Emotion injects a component's styles
after `CssBaseline`'s. Every button, card and navigation link in the application
had the ring in the theme and no ring on screen.

It was found by tabbing to a category card on the report form and **looking at
the screenshot**: the focused card was pixel-identical to the four beside it.
`body :focus-visible` is one specificity point higher and fixes it.

axe has nothing to say about this, and never would: it checks that controls have
accessible names, not that a sighted keyboard user can see where they are. A
pass that had stopped at "axe is green" would have shipped a theme rule that did
nothing, and the phase would have reported an accessibility pass that had made
the application no easier to use with a keyboard.

**Four more things came from driving it rather than scanning it:**

1. The two smallest MUI text greys are used for things that are not disabled.
   The questionnaire's step numbers and the helper text on a disabled field —
   "Choose a building first", the sentence that tells you how to enable the
   control — were the least readable text on the form at 2.64:1.
2. The `<ul> → <a>` structure violation was in four places, and three of them
   were on screens nothing was scanning. They were found by looking for the
   same shape elsewhere after axe reported the first; the suite now covers those
   screens, because a rule the suite does not exercise is a rule it does not
   enforce.
3. **The first fix for the chip contrast was wrong in an instructive way.**
   `#0277bd` is 4.80:1 against white and 4.43:1 against the page background, and
   an outlined chip sits on both. It was only caught because axe was re-run
   after the fix rather than assumed. Both ratios are now recorded beside all
   four colours, including the two that already passed.
4. **A keyboard test written the obvious way tests the wrong page.** Playwright's
   `goto` resolves while the application still shows "Restoring your session…",
   which has no focusable element at all — and clicking the body first to
   "reset" focus makes it worse, because clicking a non-focusable element sets
   the browser's sequential focus navigation starting point, so Tab resumes from
   there and skips the skip link. Both mistakes make a working application look
   broken, which is the expensive direction to be wrong in.

**Reversible.** Not applicable; this is verification.

## D24 — A heading is not a signal that the data arrived

**Question.** `e2e/accessibility.spec.ts`'s "every chart has a text
alternative, and one of them is a table" failed intermittently on the `mobile`
project and passed when the same command was run again, so the e2e suite
reported 71 passed / 1 failed instead of 72. Raise the `expect` timeout, or
change what the test waits for?

**Finding — it was never a timeout.** The line that fails is not the one that
looks slow:

```ts
const charts = adminPage.getByRole('img');
expect(await charts.count()).toBeGreaterThan(0);   // Expected: > 0, Received: 0
```

`count()` is awaited *before* it is handed to `expect`, so this is an ordinary
value comparison and Playwright never retries it. The line has **zero**
tolerance, not the suite's fifteen seconds — which is why a busier machine
turns it red and why raising `expect.timeout` would have changed nothing at
all. Measured over six consecutive runs of that file it failed twice, both
times on that line, both times in under six seconds.

What the test waited for first was
`getByRole('heading', { name: /Reported/ }).first()`. That matches "Reported in
this period" — `PeriodScopeHeading`, which `AdminDashboardPage.tsx:131` mounts
*outside* every `QueryState` and which renders a literal fallback ("the
selected period") until the server tells it the window. It is on screen before
any of the dashboard's report requests has returned, and it precedes the flow
chart's own heading in the DOM, so `.first()` always picks the static one.
Meanwhile every `role="img"` in the application is inside a chart and every
chart is inside a `QueryState`, whose pending branch renders a spinner instead
of its children. Instrumented, **nine** busy loading regions were still on the
page at the instant that heading became visible.

Holding the report responses back by four seconds turns the flake into a
deterministic failure carrying the identical message, and the same four-second
hold passes once the test waits for the screen rather than for the heading.
That is the before-and-after this entry rests on.

**Chosen.** One helper, `expectNothingLoading(page)` in `e2e/fixtures/test.ts`,
asserting that `[role="status"][aria-busy="true"]` has count zero, called after
`goto` on every screen whose content arrives from a query. The non-retrying
`count()` became a web-first `await expect(charts).not.toHaveCount(0)` in the
same edit.

**Why not simply extend the timeout.** Three reasons, in increasing order of
importance. It would not have worked, because there is no timeout on the
failing line to extend. A timeout is a guess about a machine — the number that
is comfortable on this VDI is not the number that is comfortable on a loaded CI
runner — whereas "nothing on this page is still loading" is a statement about
the page, and it becomes true at the same moment whatever the hardware is
doing. And the bad wait was quietly weakening the test as well as destabilising
it: the loop over `charts.all()` inspects whichever charts happen to exist at
that instant, so a run in which only some of the five had rendered was an
under-check indistinguishable from a real pass.

**Why `aria-busy`, and not `role="status"` on its own.** The obvious selector
is wrong, in a way worth recording because it would be rediscovered. Every
chart from `@mui/x-charts` carries its own permanently-empty `role="status"`
live region inside `MuiChartsSurface-root`, used to announce what a tooltip is
pointing at; five of them sit on the admin dashboard for as long as the charts
do. A plain `getByRole('status')` count therefore never reaches zero on the one
screen the helper was written for, and a check that can never pass is worse
than no check. Both of this application's waiting states — `QueryState`'s
pending branch and `FullPageProgress` — also set `aria-busy`, and the chart
regions do not, so `aria-busy` is what separates "waiting" from "wired for
announcements".

**Where else the pattern was.** All of `e2e/` was audited against the same
shape: a `goto` followed by a wait on something that renders before any query
resolves, and then a read of query-driven content. Twelve tests had it and all
twelve are fixed here — ten in `accessibility.spec.ts` (the employee home, the
ticket list, the admin dashboard scan, the four admin screens, the two mobile
drawers, and the chart test this entry started with) and two in
`dashboards.spec.ts`.
For the axe tests the symptom was the mirror image and quieter: scanning while
the screen is still a spinner *passes*, so those tests were not checking the
markup they name. `dashboards.spec.ts`'s "hides Needs your attention" was the
sharpest of them — it read `isVisible()` with no wait at all, on a heading that
is absent rather than hidden while its query is in flight, so the assertion it
ends with was very nearly vacuous.

Seven further tests are recorded as borderline and deliberately left alone
(**this count is wrong — see the marker at the end of this entry**): they reach
query-driven content through a retrying assertion that happens to
rescue them, or take a layout measurement while a sibling panel is still
resolving. `assignment.spec.ts:25` is the one worth a second look later — it
asserts that a JUNIOR does *not* see "Pick up" or "Assign…", but those buttons
come from a different query than the one it waited for, so the spinner can
satisfy the assertion instead of the permission rule. That is a false pass
rather than a flake, it is not the shape this entry is about, and it is left
for a deliberate change rather than folded into a flake fix.

**Reversible.** Yes, and cheaply — the helper is additive and every call site
is one line. Nothing in `src/` changed; this is a test-suite change only.

> **Corrected in part by D25 (2026-09-23).** The "seven further tests …
> borderline and deliberately left alone" above is **ten**. D25 re-derived the
> list mechanically against this entry's own two descriptions, enumerated all
> ten, fixed three of them and left seven — and it was that remaining seven,
> rather than the original count, that made the wrong number look right for as
> long as it did. `assignment.spec.ts:25`, flagged above as "the one worth a
> second look later", is the defect D25 is about. Everything else in D24 stands:
> the twelve definite instances and their fixes are unaffected, and so is the
> `aria-busy` reasoning.
>
> The lesson D25 draws is this entry's own: **a count nobody enumerated is a
> claim nobody can check.** The lists in D25 exist so that this cannot happen a
> third time.

## D25 — A test that reported a permission was enforced without checking it

**Question.** `e2e/assignment.spec.ts:25` asserts that a JUNIOR engineer sees
neither "Pick up" nor "Assign…" on a ticket. It passes. Does it pass because
the permission rule holds, or because the assertion is made before the page
could have shown either button?

**Finding — because of the second.** The two assertions are absences:

```ts
await openTicket(juniorPage, reference);
await expect(juniorPage.getByRole('button', { name: 'Pick up', exact: true })).toHaveCount(0);
await expect(juniorPage.getByRole('button', { name: 'Assign…' })).toHaveCount(0);
```

`openTicket` waits on the ticket's reference, which comes from the `incident`
query. The buttons are in `ActionsCard`, which the detail page keeps behind a
**second** `QueryState`, on `allowed-transitions`
(`IncidentDetailPage.tsx:206`). Until that query lands the entire card is a
spinner, so "there is no Pick up button" is true of every ticket in the
application, for every role, including an admin's. The assertion had no way to
tell the permission rule from the network.

That the buttons themselves are drawn from `incident.can_assign` rather than
from the transitions payload makes no difference: it is the *card* they live
in that the transitions query gates.

**Proof, before any change.** A temporary spec (`e2e/_proof.spec.ts`, deleted
after use) held `allowed-transitions` back with `page.route` and re-ran the
assertion exactly as it stands today. Four cases, on the desktop project:

1. **Transitions delayed 8s, rule in place** — the assertion passes. Asserted
   in the same breath that `[role="status"][aria-busy="true"]` was *not* zero,
   so the page was provably mid-flight at the moment it passed.
2. **Transitions delayed 8s, rule deleted** — the assertion still passes. The
   rule's absence was simulated at the wire: the incident response was fetched
   and re-fulfilled with `can_assign: true`, which is what the page would
   receive if `assignment.can_assign` stopped excluding a JUNIOR. The same test
   then waited for the page to finish and found **both** buttons present,
   `toHaveCount(1)` each. So a test that had just reported "a junior cannot
   take this ticket" was looking at a page on which a junior could.
3. **Rule deleted, assertion as fixed below** — fails, in 15s, with
   `Expected: 0 / Received: 1` on `getByRole('button', { name: 'Pick up' })`.
4. **Transitions delayed 3s, rule in place, assertion as fixed** — passes.

Cases 1 and 2 are the defect. Cases 3 and 4 are the fix having teeth. The
backend was never edited: simulating the rule's absence in the response keeps
this a test-suite change, and it is the same signal a real regression would
produce.

**Chosen.** Establish the region before asserting about its contents:

```ts
await expect(juniorPage.getByRole('heading', { name: 'Actions' })).toBeVisible();
await expectNothingLoading(juniorPage);
```

`ActionsCard` renders that heading whatever it holds — it is above the branch
that chooses between the buttons and "There is nothing for you to do on this
ticket." — so waiting for it is exactly "the thing that would show the buttons
has rendered", and it cannot be satisfied by a spinner. `expectNothingLoading`
(D24) adds that no sibling query is still in flight. Both, because the helper's
own docstring asks for a positive wait beside it: on its own it is also
satisfied by a page that has not started loading.

**Why a heading and not a longer timeout, or a `waitForResponse`.** A timeout
is a guess about a machine, and this is not a timing bug at all — the assertion
is wrong on a fast machine too, it is just wrong invisibly. `waitForResponse`
on `allowed-transitions` would work and would tie the test to a URL; the page
already says when it has finished, in the markup, and that statement survives
a route being renamed.

**The borderline tests D24 left alone — D24 said seven, and there are ten.**
D24 recorded a count but never enumerated them, so the list was re-derived here
against its own two descriptions — "reach query-driven content through a
retrying assertion that happens to rescue them" and "take a layout measurement
while a sibling panel is still resolving". **Ten tests match**, not seven. They
are written out below so the list is not lost a second time, and D24's sentence
now points here.

The seven is not simply wrong, which is the part worth understanding: three of
the ten are fixed in this entry and seven are left, so D24's number happens to
equal the size of the group that *remains* borderline after this pass. An
unenumerated count is how that goes unnoticed — the figure stays plausible
against whichever group you hold in mind. That is the same failure mode as the
tests themselves, one level up: a claim nobody can check against a list.

*Fixed, being the same shape as the defect above — an absence asserted without
first establishing the thing that would show it:*

| Test | Why it is the same shape |
| --- | --- |
| `accessibility.spec.ts` "a ticket detail page" | "No violations" is an absence, and a region that is still a spinner contributes no markup to fail on. The scan waits on the stepper, which belongs to the `incident` query; the actions card and the activity timeline are two further queries, and the timeline is a list — which is where the `list` violation S6 §1 records was found. |
| `accessibility.spec.ts` "the assign dialog, which is a list of people" | The roster is a query of its own (`AssignDialog.tsx:103`). The dialog is on screen before it lands, so the scan can cover everything *except* the list the test is named after, and pass. |
| `responsive.spec.ts` "no screen scrolls sideways" | "Does not scroll sideways" is an absence, and the first of its three measurements is taken on the detail page immediately after reporting a ticket — a two-column grid that is still a pair of spinners is narrow enough to satisfy any ruler. The other two measurements each already follow a wait for the widest thing on their screen. |

Each fix is one call to `expectNothingLoading`.

**Honest limit on that second group.** Unlike `assignment.spec.ts:25`, these
three were *not* caught checking nothing. A second temporary spec measured the
busy-region count at each old wait point on this machine: the detail page had
zero busy regions with its timeline and actions card already rendered, the
assign dialog had zero inside it with its list present, and the overflow
measurement's `scrollWidth` was 1440 both before and after the page settled.
They are checking what they name today. What they do not do is *guarantee* it —
the guarantee is an accident of the API answering three requests at once on an
idle VDI, which is precisely the accident D24 watched break under load. The
fixes were taken because they cost one line and no runtime (the helper returns
immediately when the count is already zero), not because a failure was
observed. Recording the distinction matters more than the fixes do.

*Left alone, as fragile at worst:*

| Test | Why the absence cannot be vacuous |
| --- | --- |
| `dashboards.spec.ts` "gives a junior the sentence instead of a queue they cannot use" | The closest relative of the defect — a JUNIOR is asserted to see no "Pick up" — and it is sound for a reason the assignment test did not have. "Pick up" exists only inside `UnassignedInSpecialties`, the *other arm* of the `mayPickUp ? … : …` ternary at `EngineerHomePage.tsx:166`, and the test first waits for the else-arm's sentence to be visible. The absence is a statement about which branch rendered, not about when it did. |
| `dashboards.spec.ts` "shows a senior their own work and an unassigned queue they may take" | The same ternary from the other side: the queue heading is asserted visible before the sentence is asserted absent. |
| `dashboards.spec.ts` "draws both sections, with charts and real numbers" | The two raw `.count()` reads are each preceded by a retrying `toBeVisible()` on `.first()` of the same selector, and a bar and its label are emitted in one render commit. |
| `accessibility.spec.ts` "every workflow action on a ticket is reachable by keyboard" | `expect(action).toBeVisible()` is a positive, and a loading page fails it. |
| `responsive.spec.ts` "the workflow stepper runs across on desktop and down on a phone" | Comparative geometry, not an absence: both boxes must exist, and no loading state yields two boxes in the wrong relative position. |
| `responsive.spec.ts` "a dialog fills a phone and is a panel on a desktop" | Measures a dialog it has waited for. The exposure is MUI's grow transition, which is fragility, not vacuity. |
| `responsive.spec.ts` "the phone keeps the ticket actions in reach" | `toBeInViewport` retries and fails outright on a button that is not there. |

The four tail `horizontalOverflow` measurements in `dashboards.spec.ts` were
considered with them and left: each follows a positive wait for that screen's
own query-driven content, and widening a permission fix into a rewrite of the
dashboard suite is the scope creep D24 declined for this very test.

**Nothing in `src/` changed, and no application bug was found.** The rule works;
only the test was silent about it. Reversible: four call sites, one line each.

## D26 — Who gets notified is a rule, so where does it live?

**Question.** S1 creates notifications on four different events, handled by
four different services: `perform_transition` and `clear_escalation` in
`incident_service.py`, `assign` in `assignment.py`, `add_note` in `notes.py`.
The obvious implementation is four blocks of "and also tell the reporter, and
the assignee unless they did it". Is that acceptable, and if not, what shape
replaces it?

**Finding — it is the shape this codebase exists to avoid.** The audience of a
notification is a business rule with the same three properties as the workflow
and the visibility filter: several places need it, the places do not otherwise
know about each other, and getting it wrong is invisible to the person who got
it wrong. Written inline it would be four copies of "not the actor", four
copies of "the reporter, and the assignee if there is one", and four different
wordings of the same sentence. The fifth trigger somebody adds later would be
the one that forgets.

**Chosen.** `app/notifications.py`, a peer of `app/workflow.py`, shaped the
same way: four `NotificationRule` rows as **data**, read by three things and
restated by none —
`services/notification_service.record`, `seed/demo.py`, and
`tests/unit/test_notifications.py`, which parametrises over `RULES` itself so
a kind of notification added without a test is not possible.

Three decisions inside that shape are worth recording separately.

**1. The audience list and the wording are one field, not two.**

```python
@dataclass(frozen=True)
class NotificationRule:
    type: NotificationType
    messages: Mapping[Audience, Message]
    applies: Precondition | None = None
```

`messages` *is* the audience list: a capacity that is not a key is never
notified. The alternative — an `audiences: frozenset` beside a `render`
function — makes it possible to declare an audience and forget to give it a
sentence, and makes the per-audience wording ("**Your ticket** INC-000123 was
assigned to Sam Senior" for the reporter, "INC-000123 was assigned **to you**"
for the engineer) either impossible or a conditional inside the renderer.
`test_every_audience_has_wording` pins the property even though the type makes
it hold, so that a refactor back to two fields fails here rather than in
somebody's inbox.

**2. Three rules apply to every row, so they are applied once.** In `plan()`,
not eleven times in the table: never your own action; one person, one
notification; a capacity nobody holds is skipped. The first is why
`NotificationContext` carries the actor at all.

**3. There is no FACILITY_ADMIN audience.** `Audience` has two members where
`workflow.Actor` has three. Notifying every admin of every event in the estate
is a fan-out with no bound, and the admin dashboard's "Needs attention" panel
is already the screen that answers "what needs me?" — a queue, not an inbox.
`test_no_rule_speaks_to_an_admin_as_an_audience` is where that decision is
written down rather than left as an omission.

**The one thing the table is not.** `notifications.user_in_capacity` is
deliberately *not* `workflow.resolve_actors`. That function makes a LEAD
engineer an ASSIGNEE on **any** ticket, because leads cover for their team when
*acting*. Notifying every lead about every ticket in the estate is not covering
for anybody, it is an unreadable inbox, and the two functions answering the
same question differently is the point rather than a duplication.

**Cost.** One more module, and a reader tracing "why did I get this?" has one
extra hop: service → `notification_service.record` → `notifications.plan` →
the row. That is the same hop the workflow already costs, and the same trade:
a rule is one grep away instead of four.

**Reversible.** Yes. The four call sites are one line each and name only a
`NotificationType`; inlining the policy back into them is mechanical.

## D27 — A notification stores its sentence, and never quotes a note

**Question.** `notifications.message` holds rendered English. Two alternatives
were available: store structured fields (`type`, `from_status`, `to_status`)
and render in the browser, or render from the incident's current state at read
time. And within the stored-sentence option: should a NOTE_ADDED message quote
the note?

**Chosen: store the sentence; quote nothing.**

**Why stored rather than rendered at read time.** The facts that made a
sentence true change. "Your ticket INC-000123 is now Resolved" is a statement
about a moment; read a week later, after the ticket was reopened and resolved
again, a re-rendered inbox would show a sentence nobody was ever sent. An inbox
that rewrites its own history is worse than one that is out of date, because
the reader has no way to tell. `test_the_message_is_stored_not_re_rendered`
reopens a ticket and asserts the notification still says "Resolved", while the
row's `incident_status` — which *is* read live — says `IN_PROGRESS`.

**Why not structured fields rendered in the browser.** It would have kept the
wording in `frontend/src/display/labels.ts` with every other label, which is
the tidier place for it. It loses the property above: the row would carry
`to_status = RESOLVED` and the browser would render it, which is the same
sentence, but any future rule that depends on more than two columns would have
to add columns. The deciding argument is that the sentence is the *record*. It
is also why `STATUS_WORDING` in `app/notifications.py` is the one place the
backend renders a domain value into English, and its docstring says so: the
API returns enums everywhere else precisely because the browser should decide
how to say them.

**Why a NOTE_ADDED message names the author and quotes nothing.** A snippet
would be more useful and is safe *today*, because the rule only fires on a
PUBLIC note the reporter may read. It is not safe over time. A note can be
edited for fifteen minutes and soft-deleted by an admin at any point — and the
usual reason an admin deletes one is that it should not have been written down,
a phone number pasted into a ticket thirty people can read being the example in
`services/notes.py`'s own docstring. A quotation in a notification would
outlive both the edit and the deletion, in a table no visibility filter
touches. So the message is a pointer: "Sam Okafor added an update to your
ticket INC-000451", and following it goes through `apply_note_visibility` like
every other read. `test_a_note_never_quotes_itself` and
`test_a_note_notification_never_carries_the_note_body` hold both ends of it.

**Reversible.** The stored sentence, not cheaply — old rows would keep their
wording. The no-quotation rule, trivially, and it should not be.

## D28 — Revision 0001 was not frozen, and 0005 is what proved it

**Question.** `NotificationType` needs a PostgreSQL enum type. Adding it to
`app/models/enums.ENUM_TYPES` is what the registry's own docstring asks for —
"the single source of truth for which enum types exist". Does that work?

**Finding — it breaks the initial migration, silently and only on new
databases.** `0001_initial_schema.py` creates its enum types by **iterating
`ENUM_TYPES`**:

```python
for type_name, enum_cls in ENUM_TYPES.items():
    op.execute(f"CREATE TYPE {type_name} AS ENUM (...)")
```

So adding a twelfth entry to a live application constant changes what an
*already-applied* revision does. A database created before the change (the
development one, the demo one, the deployed one) had 0001 create eleven types
and would get `notification_type` from 0005. A database created after it — the
test database, which `tests/conftest.py` drops and recreates every session —
would have 0001 create twelve, and 0005 would die on `type "notification_type"
already exists`. The two paths diverge, and only one of them is ever exercised
by CI.

The irony is on the file itself: 0001's docstring opens "Written once, then
frozen."

**Chosen.** 0001 now names the eleven types it has always created, in
`ENUM_TYPES_AT_0001`, and iterates that. The *values* still come from the enum
classes, because changing a member of an existing enum is a different question
and would need its own revision; the *set of types* is frozen. 0005 creates
`notification_type` itself and spells its four values out as literals, for the
same reason.

This is an equivalence-preserving edit to an applied migration: every database
that has run 0001 ran it with exactly these eleven names, so freezing them
changes nothing that has happened and everything that could.

**Why not the alternatives.** Keeping `notification_type` out of `ENUM_TYPES`
would leave a Postgres enum type that the registry does not know about and that
`test_every_enum_type_exists_with_the_right_values` does not check —
trading a real invariant for avoiding a six-line edit. `CREATE TYPE IF NOT
EXISTS` does not exist in PostgreSQL, and the `DO $$ ... $$` block that
emulates it would hide the divergence rather than fix it.

**The general rule this leaves behind**, written into 0001's docstring: a
migration that reads a live application constant is not frozen. It is worth
auditing the others for the same shape — 0001 also imports nothing else, and
0002–0005 import no application code at all.

**Reversible.** Yes, and it would reintroduce the bug.

## D29 — The read rate: whose inbox, and which `created_at` the window filters

**Question.** BUILD-PLAN §15 says "add notification read-rate to the
communication report". Two things that sounds like it settles and does not:
which notifications are counted, and what the report's `from`/`to` window
filters when the row being counted is not an incident.

**Finding.** `/reports/communication` is a *period* report (D9), and every
period report filters `Incident.created_at` through `_window_clauses()`.
A read rate is not about incidents.

**Chosen, in two halves.**

**1. The window filters `notifications.created_at`.** This is D5's rule
unchanged — *the window filters the `created_at` of the thing being counted* —
applied to a row that happens to be a notification. The report now has two
halves that count different things: the first seven fields count incidents
created in the period, the last three count notifications sent in it. They can
therefore move independently, and that is correct: telling somebody in March
about a ticket raised in February is activity in March. Windowing on the
incident instead would answer "how much of what we sent about tickets raised
in March has been read", which is a question nobody has.
`test_communication_read_rate_windows_on_the_notification_not_the_ticket`
asserts both directions at once — a notification sent yesterday about the
fixture's out-of-window ticket **is** counted, one sent forty days ago about an
in-window ticket is **not**, and `total` stays at 9 throughout to prove the
other half of the report did not move.

**2. Only notifications addressed to the ticket's own reporter are counted.**
The join is `Notification.user_id == Incident.reporter_id`. Every other number
on this report is about the reporter's experience — were they told anything
before their ticket was resolved, how long did the first note take, did they
have to reopen it — and the brief's question is "how effectively are
**employees** being informed". A rate that folded in engineers' inboxes would
answer a different question while standing next to the ones it does not.
`test_communication_read_rate_ignores_notifications_to_the_engineer` pins it.

**The honest limitation, stated in the code.** A notification sent an hour
before the end of the window has had an hour to be read; one sent three weeks
earlier has had three weeks. The rate is therefore depressed by recent
activity, inherently, and no amount of filtering fixes it. That is why
`notifications_total` is reported beside the percentage rather than the
percentage alone, and why the repository docstring says so rather than leaving
the reader to discover it.

**And the report finally has a screen.** `/reports/communication` has existed
since M7 and **nothing rendered it** — `useCommunicationReport` was a hook with
no caller, which is why the brief's seventh business question could be
described as "measured and unacted on". That was defensible while the only
answer to it was "somebody should write a note"; S1 gives it something to act
on, so the whole thing goes on the admin dashboard together as
`features/dashboard/CommunicationPanel.tsx`: told-before-it-was-fixed, median
time to first update, notifications read, and reopen rate. Four tiles, none of
them linked — a percentage and a median have no list behind them, and
`GET /incidents` cannot filter on "had a public staff note before resolution"
in any case, so a link would open the wrong tickets.

The panel renders a `null` percentage as an em dash and never as zero. The API
is careful to distinguish "nothing was resolved" from "0% were kept informed",
and collapsing that at the last moment would throw the distinction away where
nobody would see it happen. `test_renders_a_missing_percentage_as_a_dash` is
the assertion; it checks that `0%` appears nowhere on the screen.

**Deliberately not done: a per-type breakdown.** "Status changes are read 80%
of the time and note updates 40%" would be a genuinely interesting number and
is one `GROUP BY` away. It is not in scope, the panel has nowhere to put a
fifth tile without becoming a table, and a report grows a column far more
easily than it loses one.

**Reversible.** Yes: one repository function, three schema fields and one
component.

## D30 — Thirty seconds, one integer, and a database that sleeps

**Question.** BUILD-PLAN §15 says poll the unread count every 30 seconds. What
does "cheap" have to mean for the route that will be called more than any other
in the application, and is polling really the only option?

**There was no choice about polling.** The API is a Lambda behind a Function
URL. A Function URL cannot hold a connection open, so websockets and SSE are
not alternatives that were rejected — they are not available. The interesting
question is only what the poll costs.

**Chosen, and measured.**

*The query.* `SELECT count(*) FROM notifications WHERE user_id = ? AND read_at
IS NULL`, over `ix_notifications_user_id_read_at`, whose two columns are
exactly that WHERE clause in that order. No join, no ORM entity, no ordering,
and `count(*)` needs no other column — so PostgreSQL answers it from the index
alone. Measured on a scratch database of 200,000 notifications across 40 users
(27 MB table, 35 MB of indexes):

| case | plan | buffers | time |
| --- | --- | --- | --- |
| empty inbox (the common one) | Index Only Scan, `Heap Fetches: 0` | 3 | 0.09 ms |
| busiest inbox, 556 unread | Index Only Scan, `Heap Fetches: 0` | 4 | 0.13 ms |
| the inbox page, 25 rows + tickets | Index Scan Backward + nested loop | 25 | 0.19 ms |

*The response.* `{"unread": 3}` and nothing else — no timestamps, no echo of
the request, no list. Reading the count through the list endpoint would have
been one fewer endpoint and would have made the busiest request in the
application carry a page of rows it never renders.

*A second index.* `ix_notifications_user_id_created_at` exists because the
badge's index cannot serve the inbox page: its second column is `read_at`, so a
user's rows come out of it grouped by read state and would have to be sorted
afterwards. Two indexes on a table written on every status change is two index
inserts per notification, which is the right side of that trade.

**The part that is not about the query.** Aurora Serverless v2 runs at
`min_capacity = 0` and sleeps when idle. A poll that never stopped would be a
standing instruction to keep the database awake, which is a bill rather than a
bug — and the sort of thing that is discovered a month later. TanStack Query
does not run a `refetchInterval` while the window is unfocused
(`refetchIntervalInBackground` defaults to false), so a tab left open behind
another one stops asking; `staleTime` is set just under the interval so that
regaining focus inside the same tick reuses the answer rather than adding a
request. Both are recorded in `features/notifications/hooks.ts` beside the
code, because neither is visible from the outside.

**A failed poll is not an error the user sees.** `retry: 1`, and no snackbar:
the badge keeps its last value until the next tick. A network blip must not put
an alert on every screen in the application, and there is nothing the reader
could do about it if it did.

**Reversible.** The interval is one constant, `UNREAD_POLL_INTERVAL_MS`.

## D31 — What S1 deliberately does not do, and what looking at it found

**Question.** Four triggers are in scope. Several neighbouring events look like
they belong and are not there. Recording the omissions is the difference
between a decision and an oversight — and each has a test, so that adding one
later is a visible change rather than a surprise.

**Not notified, and why.**

| Event | Why not |
| --- | --- |
| **Unassignment** | BUILD-PLAN §15 names "assignment". Losing a ticket is a workload question, and the engineer's queue screen is where workload is answered. `test_unassigning_notifies_nobody`. |
| **An escalation being raised** | There is no admin audience (D26), so there is nobody to tell: the reporter raised it and the assignee already has the ticket. It reaches an admin through the dashboard's "Needs attention" panel, which is a queue. `test_raising_an_escalation_notifies_nobody`. |
| **A priority change** | The reason `NotificationType` is narrower than `EventType`. A ticket moving from MEDIUM to HIGH is housekeeping; when it accompanies a cleared escalation it is part of that one decision and rides on that one notification. `test_a_priority_edit_notifies_nobody`. |
| **A ticket being reported** | You know you reported it, and there is no assignee yet. `test_reporting_a_ticket_notifies_nobody`. |
| **A reporter's own public note** | The rule is "a PUBLIC note **from staff**", which is the same definition `/reports/communication` already uses for being kept informed. The assignee learns of a reply on the ticket page they are already looking at. |
| **Watchers** | S4's feature, and its own rule row when it arrives. |

**No backfill, and this one was close.** `incident_events` and
`incident_notes` hold the whole history, so a backfill could honestly
reconstruct which notifications *would* have been sent to whom — and the demo
database's 318 incidents would light the feature up immediately. It is not
done, for one reason: it could not reconstruct which of them anybody **read**,
so every backfilled row would be unread and `/reports/communication` would
report a read rate of 0% over invented data. A number computed from fabricated
history is worse than an empty one. Fresh environments get demo notifications
from `seed_demo`; existing ones accumulate real ones from use, which on the
demo database means the demo script generates them live — which is a better
demonstration of a notification feature than pre-seeded rows anyway.

**No live region on the bell.** A polite announcement every time the poll finds
something new would interrupt whatever a screen-reader user was reading, every
thirty seconds, on every screen. The count is in the control's accessible name
instead, so it is available on demand rather than pushed. The cost is real and
is recorded in `docs/DEPLOYMENT-CHECKLIST.md`: such a user learns of a
notification when they next reach the bell, not when it arrives.

**What looking at the screen found.** One defect, and no test would have caught
it. The inbox shows each row's message beside the ticket's **current** status
chip, deliberately — the message is a sentence about a moment and the chip says
where the ticket stands now. On screen, unlabelled, they read as a
contradiction: "Your ticket INC-000455 is now In progress." with a green
**Resolved** chip directly beneath it. Every assertion about that row passed;
it was legible only in a screenshot. The chip is now preceded by the word
"Now", which costs one `<Typography variant="caption">` and removes the
ambiguity for sighted and screen-reader readers alike. This is the fifth phase
in a row where the most valuable defect was found by looking.

**Reversible.** Each omission is a row in `RULES` and a test that would need
deleting. The "Now" label is one element.

## D32 — The badge that stayed behind, because the page it belonged to had gone

**Question.** `useMarkNotificationRead` invalidated the whole `['notifications']`
query prefix in `onSuccess`, which is the standard shape and is what every
other mutation in this codebase does. Writing the end-to-end test for "opening
a notification clears it" found the assertion failing. Is the test wrong?

**Finding — the test was right, and the shape is wrong for this one case.**
Opening a notification does two things at once: it fires the mark-read mutation
and it follows a React Router link to the ticket. The link unmounts
`NotificationsPage`, and **TanStack Query does not call a mutation's callbacks
once the component that started them has unmounted** — the mutation itself
completes, the row is marked read on the server, but `onSuccess` never runs and
nothing invalidates the unread count. The bell therefore kept its old number
until the next poll: up to thirty seconds after the user watched the row they
had just read disappear.

It is a small bug with an unpleasant shape. It is invisible in a component
test, because jsdom has no navigation to unmount anything; it is invisible in a
manual click-through if you happen to wait; and the symptom — "the badge is
sometimes wrong" — points at the polling, which is the part that works.

**Chosen.** Decrement the cached count in `onMutate`, which fires
**synchronously** when `mutate()` is called and therefore always runs, before
any navigation. The mutation takes `{ id, wasUnread }` rather than a bare id so
the decrement happens only for a row that was actually unread — the per-row
tick only exists on unread rows, but opening an already-read one must not move
the badge.

The invalidation stays in `onSuccess`, as the correction: when it runs it
replaces the optimistic guess with the server's answer, and when it does not,
the next poll does within thirty seconds. This is deliberately *not* a full
optimistic-update-with-rollback — there is no `onError` restoring the previous
count, because the worst case is a badge one too low for one polling interval,
and a rollback would need a snapshot and a cancel for a symptom nobody would
notice.

**Alternatives rejected.** *Await the mutation, then navigate programmatically*:
the row stops being a real link, losing open-in-new-tab, middle-click and the
status-bar preview — the same properties S6 changed the mobile bottom bar to
gain. *Move the invalidation into a global `MutationCache` handler*: it would
work, and it would put one mutation's business in a place that every other
mutation also passes through.

**Where it is written down.** `useMarkNotificationRead` in
`frontend/src/features/notifications/hooks.ts`, with the reasoning beside it,
because the code looks over-engineered without it.

**Regression test.** `e2e/notifications.spec.ts`, "opening a notification goes
to its ticket and clears it" — the test that found it. It is end-to-end by
necessity rather than by preference: the bug only exists where there is a real
router unmounting a real component.

**Reversible.** Yes: delete `onMutate` and the `wasUnread` flag, and the badge
goes back to being right within thirty seconds instead of immediately.

## D33 — An inbox is not a dashboard, so it cannot share a dashboard's cache

**Question.** `main.tsx` sets a global TanStack Query `staleTime` of 30 seconds.
Should the notification feed inherit it?

**What went wrong.** It did inherit it, and the end-to-end tests caught the
consequence: navigating to the inbox within thirty seconds of the previous visit
rendered the *previous* contents — the same `total`, the same rows. The unread
badge, which polls on its own schedule, had already moved on. So the list and
the badge beside it disagreed, which is precisely the failure the shared
query-key prefix was chosen to prevent: that prefix handles invalidation after
*this* user's mutation and has nothing to say about a row somebody else created.

**Chosen.** `useNotificationFeed` overrides the global default with
`staleTime: 0`, with the reasoning written beside it because the override looks
arbitrary otherwise. The override is local to the one hook, not a change to the
global default.

**Why.** Thirty seconds of cache is right for a dashboard: its numbers describe a
month, nobody is waiting on them, and re-fetching on every navigation would be
waste. An inbox is the opposite. It is the screen people open *because* something
told them a thing had arrived, so the one guarantee it owes is that it shows what
is there now. A cache that is correct for the common case and wrong for the
attention case is worse than no cache, because the failure only appears when
someone is actually watching.

**Why not raise it globally.** The dashboard's 30 seconds is load-bearing —
`/reports/*` runs eight aggregate queries against Aurora at `min_capacity = 0`,
and a dashboard that re-queried on every navigation would wake a sleeping
database repeatedly. The right shape is one default with a documented exception,
not a default chosen to suit its least typical consumer.

The unread count keeps a `staleTime` of its own, just under the polling
interval. That one is deliberate and unrelated: it stops a window regaining
focus inside a tick from adding a request.

**How it was found.** Not by reading the code. The end-to-end suite navigated
away and back inside the window and saw the stale list. This is the fourth time
in this project that a defect invisible to unit tests was caught by driving the
application — see D24 and D25 for the others. No component test could have seen
it: `renderWithProviders` builds its own `QueryClient` with test defaults, so
the global `staleTime` is not in force there at all.

**The honest limit of this diagnosis.** The fix demonstrably works — three of
the four tests that depend on navigating back to a fresh inbox failed
consistently before it and pass after. One did not. `a public staff note
reaches the reporter and an internal one does not` still failed in a
full-suite run while passing every time in isolation, with the notification
provably in the database and the response still carrying the old `total`. So
something else is also holding a stale answer on that path under load, and
`staleTime` was not all of it. Candidates not ruled out: an HTTP-layer reuse of
the `GET /notifications` response, and `useInfiniteQuery`'s refetch semantics
once more than one page has been loaded.

That test now takes a reload, which is guaranteed, and its comment says it does
so because of an unresolved question rather than because a reload is better.
**The rule under test is unaffected** — an internal note produces nothing and a
public one produces a notification — and that is still what it checks.
Recording the gap is worth more than a confident explanation that has not been
demonstrated: the two entries above are both about a test that passed for a
reason nobody had checked, and inventing a cause here would be the same mistake
with better prose.

**Next step for the owner**, if it is worth the time: watch
`GET /notifications` in the network panel during a full suite run. If the
request is made and returns the old `total`, the answer is server-side and
interesting. If it is not made at all, it is TanStack Query and the fix is
another option on that one query.

**Reversible.** One line in `frontend/src/features/notifications/hooks.ts`.

## D34 — The demo's two deactivated employees do not exist

**Found during the final documentation pass**, while writing
`docs/REVIEW-GUIDE.md`'s worklist for the admin screens. Recorded rather than
fixed, because that pass changes no application code.

**The claim.** `seed_demo` sets out to leave two employee accounts inactive.
`app/seed/demo.py` says so in a comment, in the words that explain why: *"Two
people have left. A users screen where everyone is active never shows the
deactivated state, and the reports still count their old tickets, which is the
behaviour worth demonstrating."* Both `docs/DEMO-SCRIPT.md` and the README
repeated it.

**What actually happens.** Nothing. The loop is

```python
for index in range(min(spec.employees, len(EMPLOYEE_NAMES))):
    ...
    employee.is_active = index not in (len(EMPLOYEE_NAMES) - 1, len(EMPLOYEE_NAMES) - 2)
```

`EMPLOYEE_NAMES` holds **36** names and `DemoSpec.employees` defaults to **30**,
so the loop runs `range(30)` while the deactivated indices are computed from the
length of the *name list* — 34 and 35. Those iterations never happen. **A freshly
seeded `acme_demo` has thirty employees and every one of them is active.**

**Why it survived.** The two constants agreed when the list was shorter, and
nothing asserts the outcome: `tests/integration/test_seed_demo.py` checks the
employee *count*, not how many are active. The demo script promised the state
and no one had opened the Users screen looking for it — which is the same shape
as [D24](#d24--a-heading-is-not-a-signal-that-the-data-arrived) and
[D25](#d25--a-test-that-reported-a-permission-was-enforced-without-checking-it):
a claim nobody could check against a list, sitting next to a test that passed
without testing it.

**Chosen.** Record it, correct every document that repeated the claim, and leave
the code alone. The documentation pass that found it was explicitly scoped to
documentation, and this is the project's standing habit — M8 found
`current_user_id` and an empty `if TYPE_CHECKING: pass` the same way, recorded
both, and S6 removed them in a phase that was allowed to.

**The fix, when somebody is allowed to make it.** One line. Either key the
condition to the loop bound rather than the name list —
`index not in (spec.employees - 1, spec.employees - 2)` — or slice
`EMPLOYEE_NAMES[: spec.employees]` before iterating and keep the existing
expression. The second is better: it makes the list and the bound the same
thing, so they cannot drift again. Worth a test that asserts **two inactive
employees**, since the absence of one is why this lasted.

**Consequence for a reviewer.** Deactivate an employee by hand before judging
the Users screen's deactivated state. `docs/REVIEW-GUIDE.md` pass 1 says so.

**Reversible.** Not applicable — nothing was changed.

## D35 — D34 fixed: the departed employees now exist, and a test says so

**What D34 recorded.** `seed_demo` claimed to deactivate two employees so the
users screen would show an inactive row and the reports would demonstrate that a
departed person's old tickets still count. It never did. `EMPLOYEE_NAMES` holds
36 names, `DemoSpec.employees` defaults to 30, and the loop ran `range(30)` while
the deactivation condition targeted indices 34 and 35. Confirmed against the live
demo database: all 30 seeded employees active, and the only deactivated accounts
were end-to-end test residue.

**The fix.** One line. The condition now counts from the number actually
created — `index < created - 2` — rather than from the length of the name list,
which is deliberately longer than the default spec so that a larger run has names
to draw on. The discrepancy between those two numbers was the whole bug.

**Why the suite missed it.** `test_it_creates_one_admin_six_engineers_and_the_employees`
asserted how many employees existed. It never asked how many were active, so it
stayed green while the feature did nothing.

**This is the third defect of that exact shape in this project.** D24: a heading
asserted as a proxy for data having loaded. D25: a permission asserted as an
absence a spinner satisfied. Now a count asserted in place of a property. In each
case the test named the right behaviour and checked something adjacent to it that
was easier to reach.

**What was added.** `test_exactly_two_employees_have_left` asserts the property.
Verified by reverting the fix and watching it fail —
`expected exactly two departed employees, found 0 of 8` — then restoring it.

**Reversible.** One line in `app/seed/demo.py`, one test.

**Not yet reflected in data.** The two existing databases were seeded before this
fix, so neither has departed employees until it is reseeded. The cloud database
will get it from the first seed.

## D36 — The deployed app could not be signed into, and only the deployed app

**The symptom.** Sign in with a temporary password, change it when asked, sign
in again with the new one — and land back on the change-password screen. Every
time. The password was correct and the API was answering correctly.

**Found by** the repo owner, on the deployed URL, within minutes of it going
live. Reproduced headless against the same URL: login → change-password →
login → `/change-password`, with `200 /auth/login` and `200 /auth/me` in the
network log. Both succeeding, and the loop still happening.

**The cause.** `/auth/me` carried **no `Cache-Control` header at all**. RFC 9111
§4.2.2 permits a cache to invent a freshness lifetime when the server gave none,
so the browser answered the second `/auth/me` from its own store — with the body
from *before* the password change, in which `must_change_password` was still
true. `RequireAuth` did exactly what it should with the data it was given.

CloudFront was not at fault: the `/api/v1*` behaviour uses the managed
CachingDisabled policy and every response showed `x-cache: Miss`. The cache was
in the browser.

**Why no test caught it.** Locally the Vite dev proxy does not cache, so the
whole class of defect is invisible in development, in the unit suites and in the
end-to-end suite — all of which run against the dev server. This is the first
defect in this project that *could only* appear once deployed.

**The fix.** `NoStoreMiddleware` in `app/main.py` sets `Cache-Control: no-store`
on every API response. Registered outside `RequestLogMiddleware` so that
responses raised before any router runs carry it too — verified on a 401 as well
as a 200.

`no-store` rather than `no-cache`: `no-cache` permits storing the response and
revalidating, a weaker promise than is wanted for per-user responses that carry
session state.

**Guarded by** `test_every_api_response_refuses_to_be_cached`, which asserts the
header on both a success and an error.

**The wider lesson.** Five phases of looking at screens found defects the suites
could not see. This one could not be found by looking at a screen *locally*
either — only on the deployed thing. Worth remembering that "it works in dev" and
"it works" are different claims, and that the gap between them is not always
about data or scale.

## D37 — CloudFront compression enabled

The workshop organisers approved changes to the Terraform, so `compress = true`
is now set on the API behaviours and the default behaviour. CloudFront defaults
it off. The React bundle is 976 kB raw against 301 kB gzipped, paid on every cold
visit; JSON API responses gzip well too.

This was recorded in `docs/INFRA-CHANGES.md` as proposed-not-applied pending that
approval. It is now the fourth change to the provided Terraform.

## D38 — Correcting D36: the login loop was a redirect, not a cache

**D36 was wrong about the cause.** It recorded a missing `Cache-Control` header
as the reason a user could not get past the change-password screen. The header
was genuinely missing and is genuinely worth setting — but adding it did not fix
the symptom, which is the test D36 should have run and did not.

**The actual cause.** `LoginPage` honoured `state.from` unconditionally:

```ts
void navigate(state?.from?.pathname ?? paths.home, { replace: true });
```

Changing a password revokes every session. The app therefore goes anonymous
*while still rendering* `/change-password`; `RequireAuth` records that location
as the page to return to and redirects to the login screen. Signing in then sends
the user back to `/change-password`, and because that route is mounted with
`skipPasswordGate` it renders without complaint even though the flag has just
been cleared. Correct password, correct API response, endless loop between two
screens.

**The fix.** `destinationAfterSignIn` refuses `paths.changePassword` as a
post-login destination and falls back to home. Nothing is lost: an account that
genuinely needs the gate is sent there by the next render anyway.

**Proven, this time.** The same headless reproduction that produced
`after 2nd login → /change-password` now produces `after 2nd login → /`.

**What D36 keeps.** `NoStoreMiddleware` stays. API responses should not be
browser-cacheable, and a heuristically-cached `/auth/me` would have caused
trouble eventually. It was a real gap found while chasing the wrong thing.

**The lesson, which this project had already written down twice.** D24 and D25
both established the rule: prove the fix removes the symptom, not merely that the
mechanism you suspected is now different. D36 asserted a fix without re-running
the reproduction that was already sitting on disk. A diagnosis that explains the
symptom is not the same as the cause of it.

## D39 — What deploying proved, what it cost, and the two bugs only it could find

**The situation.** Every document in this repository said the AWS deployment had
never run. [D1](#d1--skip-m8-entirely-or-do-everything-except-the-deploy) recorded
the decision to build the rest of M8 without credentials and write down every
cloud-only behaviour instead — 68 numbered checks in
[`DEPLOYMENT-CHECKLIST.md`](DEPLOYMENT-CHECKLIST.md), each with its command and
its expected result, none of them run. Credentials arrived after the build was
finished. This entry records what happened when the list was finally walked.

**It deployed on the first apply.** `terraform apply` reported `10 added, 1
changed, 0 destroyed`. Aurora, CloudFront and S3 already existed from a partial
deploy on 2026-09-22, before the application did; the Lambda, its SQS dead-letter
queue, `JWT_SECRET` and the CloudFront Function were the additions. Live at
<https://d3jo3ezb7ss05m.cloudfront.net>.

### What it proved

The structural risks — the ones that would have stopped the deploy dead, and the
ones no amount of local testing could speak to:

- **The IAM boundary permits everything `infra/` asks for.** This was the
  underlying worry behind every constraint in CLAUDE.md.
- **`pgcrypto` and `citext` create on Aurora.** The checklist called item 2.1
  "the single highest-risk item"; every primary key in the schema defaults to
  `gen_random_uuid()` and `users.email` is `CITEXT`. Nothing would have existed
  without it.
- **`JWT_SECRET` reaches the Lambda** — 64 characters, generated by Terraform.
- **`IS_LOCAL = false` arrives**, so `sslmode=require` applies. One flag, four
  behaviours, all correct.
- **The CloudFront 404 fix works.** An unauthenticated API call returns 401, not
  a 200 serving `index.html`, while `/tickets` still returns 200. This was the
  only `infra/` change with no workaround, and the one the rubric turns on.
- **The ops-invoke path works** — `migrate` upgraded the schema to head;
  `seed_demo` then wrote 300 incidents, 1,813 events, 37 users and 3 buildings
  **inside the Lambda**, which retired checklist item 7.8 (recorded as
  unverifiable) in passing.
- **512 MB imports FastAPI, SQLAlchemy and psycopg**, and a warm
  `/reports/summary` answers in **0.20 s** against the full dataset.

### What it cost

**The Aurora cold start is real, and it is worse than predicted.** `min_capacity
= 0`, so the cluster sleeps. The checklist expected "roughly 15–25 s and then
succeeds". What actually happened:

- the **first `migrate` invoke failed outright** — `server closed the connection
  unexpectedly` — and succeeded on an immediate retry;
- **six seconds after a sign-in**, the engineer home still showed three
  "Loading…" spinners.

So a first request against a sleeping cluster is not merely slow; it can be
**dropped**. That is a correction to the checklist's own success criterion.

**The options were a genuine trade, and we took the cheap one.** Raising
`min_capacity` to 0.5 removes the wait — and bills continuously, on an AWS
account shared with other workshop participants, for a deployment whose purpose
is an eight-minute demonstration. It also deviates from the scaffold's default,
which this project has otherwise been careful not to do. **Chosen instead: load
the page about a minute beforehand.** It costs a minute of a presenter's time, it
is free, and it is recorded in `DEMO-SCRIPT.md` where somebody about to run a
demo will actually see it — a mitigation nobody knows about is not a mitigation.

**The second cost is credentials in the open.** `seed_demo` used to refuse
outright in a deployed environment. It now proceeds if the payload carries
`"i_understand_this_publishes_demo_credentials": true` — deliberately verbose,
because `force: true` is too easy to copy out of a runbook without reading it.
That flag was passed once, knowingly, because a deployed application with nothing
to show is not much of a demonstration. The price is that the deployed database
holds **37 accounts sharing one password published in this repository**, and
there is no `unseed_demo`. Acceptable for a throwaway sandbox holding nothing
real; the first thing that would have to change anywhere else.

### The two bugs only deploying could find

**This is the part that justifies the exercise.**

- [**D38**](#d38--correcting-d36-the-login-loop-was-a-redirect-not-a-cache) — a
  login loop. Sign in with a temporary password, change it, sign in again, and
  land back on the change-password screen, for ever. It needs a **real session
  revocation behind a real distribution**: changing a password revokes every
  session, so the app goes anonymous while still rendering `/change-password`,
  `RequireAuth` stashes that location, and signing in dutifully returns to it.
  Found by walking checklist item 5.5 — which is precisely the item that exists
  to walk it.
- [**D36**](#d36--the-deployed-app-could-not-be-signed-into-and-only-the-deployed-app)
  — `/auth/me` carried no `Cache-Control` header at all, so a browser was free to
  invent a freshness lifetime for a per-user response carrying session state.
  Found while chasing D38, and wrong as a diagnosis of it, but a real gap on its
  own merits. `NoStoreMiddleware` stays.

**Neither was reachable from any local environment.** The Vite dev proxy does not
cache, so the whole D36 class of defect is invisible to the unit suites, the
component suites and the end-to-end suite alike — all three run against the dev
server. And D38 needs the deployed redirect path. **1,219 passing tests had
nothing to say about either.**

### The lesson, which is a sharper version of one this project keeps learning

This build's running score is that from M5 onward, **every phase's most valuable
defect was found by looking at a screen rather than by running a test** — sixteen
of them, none caught by a unit suite. D39 extends it by one notch: **this time,
looking at a screen locally would not have been enough either.** "It works in
dev" and "it works" are different claims, and the gap between them is not always
about data or scale — here it was about a cache header and a redirect.

The corollary is the honest one. **30 of the 68 checks now carry a cloud
observation; 36 do not.** Deploying settled the structural questions and left
most of the per-endpoint behaviour untouched — query-string forwarding through
the distribution (whose failure mode is a wrong answer that looks right), the
refresh cookie's attributes, full-text search on Aurora, the lockout, JSON logs,
the focus ring against production CSS. **"Deployed" is not "verified."** The
checklist marks each item with what was actually seen, and ends with a
prioritised list of what to walk next, precisely so that this entry cannot be
read as a finish line.

## D40 — A test that passed all morning and failed all evening

**Found by CI**, not by any local run. Run #23 went red on a documentation-only
commit; runs at 12:38 PM had been green. Same code, different time of day.

**The defect.** `test_summary_reports_created_and_closed_for_every_day_in_the_window`
asserted that I8 — created three days ago and closed six hours later — appeared
in a single `per_day` row. The fixture anchors to `utc_now()`, so six hours after
the current wall-clock time crosses midnight whenever the suite runs after
18:00 UTC. The test was correct for roughly three-quarters of the day.

Every "826 passed" reported during this build was a run that happened to fall in
the passing window.

**Two fixes were tried and are wrong. Both are recorded in the code.**

1. **Anchor the whole fixture to midday.** Broke the blocked-and-escalated tests:
   that report is current-state and reads the *live* clock to compute an age, so
   moving the fixture away from `now` turned 24.0 hours into 31.71. The fixture
   and that report must share one clock.
2. **Pin only I8 to 06:00.** Broke `test_engineer_workload_scopes_output_to_the_window`,
   which narrows to three days — 06:00 three days ago falls before a window
   starting at the current time three days ago. The constraint is genuinely
   unsatisfiable at some hours: I8 must be *after* `now - 3 days` and *early
   enough in its day* for six hours not to cross midnight.

**The fix.** The fixture was never the problem. The test asserted "created and
closed on the same day" when what it means is "a closure is bucketed by
`closed_at`, not by the day the ticket was reported — the two series are
independent." That is true whether or not the six hours cross midnight. The
assertion now reads the timestamps the fixture actually produced.

**The fifth defect of this shape in this project**, after M4's colliding fixture
names, D24's heading-as-a-load-signal, D25's permission-asserted-as-an-absence
and D35's count-asserted-as-a-property. Each asserted something *adjacent* to its
intent, and each was true most of the time. The first two attempts here repeated
the error one level down: fixing the arithmetic rather than the claim, which is
why each broke something else.

**Worth saying plainly:** CI caught what six days of local runs did not, because
CI ran at an hour nobody had.

## D44 — The sideways scroll: a viewport breakpoint deciding a layout inside a narrower box

**The report.** The owner: every page needs scrolling right to reach the drawer
button or the avatar, in Chrome but not Firefox, at any width from 400px to
1400px. The brief points out that `e2e/responsive.spec.ts` has a test called
*"no screen scrolls sideways"* which passes, and asks why.

**What was measured.** A real Chrome, signed in as three personas, every screen,
at eleven widths from 400 to 1400, reporting
`documentElement.scrollWidth - clientWidth` and every element whose right edge
passed the viewport. The result is narrower and sharper than the report:

| Screen | Viewport widths that overflow | By |
| --- | --- | --- |
| `/tickets`, `/tickets/mine`, `/queue`, `/unassigned` | 900–1290 | up to 333px |
| everything else | none | — |

So: four screens, not every screen; a band in the middle, not any width. The
four are one component — `IncidentsPage` — and the overflowing element is the
same in every case, the filter bar.

**The cause.** `IncidentFilterBar`'s controls were a CSS grid whose template
changed at Material UI's `md` breakpoint:

```ts
gridTemplateColumns: { xs: '1fr', md: 'minmax(200px, 2fr) repeat(4, minmax(140px, 1fr)) auto' }
```

`md` is a **media query**: it asks how wide the *window* is. The bar does not
live in the window. It lives inside `<main>`, which sits beside a 248px
permanent drawer and carries 48px of its own padding — so at a 900px window the
bar has about 620px, and at 1200px about 900px. Its own minimums come to roughly
950px (200 + 4×140 + the escalated switch + five 16px gaps). A grid track cannot
shrink below a `minmax()` minimum, so between the width at which the six columns
switched on and the width at which they finally fitted, the bar pushed out of
`<main>` and the document gained a horizontal scrollbar.

**Why Chrome and not Firefox.** Chrome on Linux draws a classic 15px scrollbar,
which comes off the layout width; Firefox's overlay scrollbars do not. Every
window width therefore lands 15px further into the band in Chrome than in
Firefox. That shifts the band; it does not create it, and Firefox at 1000px
would overflow too. The browser difference is real but it is not the fault.

**Why the test passed.** `playwright.config.ts` has two projects, 375px and
1440px. Neither is in the band. The test was not measuring the wrong element or
the wrong browser — it was measuring the right thing at two widths, and the
fault lives between them. A layout rule with a threshold in it has to be
measured on both sides of the threshold *and in between*.

**Chosen.** `gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))'`.

The column count now follows the width of the box the bar is actually in. There
is no breakpoint to get wrong, and `min(100%, 160px)` is what keeps a container
narrower than one column from being overflowed by it — the phone case.

**Rejected: `overflow-x: hidden`.** The brief rules it out and is right to:
hiding the overflow makes the controls unreachable rather than reachable.

**Rejected: a container query.** `@container (min-width: …)` would have kept the
explicit six-column template and asked the right question about width. It needs
a `containerType` wrapper, and it still needs a threshold — one that would have
to be at least 1040px to be safe, which on a 1400px window is most of the
available space. `auto-fit` needs no threshold at all.

**What it costs.** The search box loses its `2fr` emphasis; all six controls are
now equal width. At 1400px the bar is still a single row of six, as before. Below
about 1290px it wraps to two rows instead of overflowing, which is the honest
answer — six controls at a usable width do not fit in 900px, and something had
to give.

**Proven, and proven both ways.** The same sweep, after the change: 360 to
1600px, every screen, every persona, including the phone's filter drawer opened
— no horizontal overflow anywhere. `e2e/responsive.spec.ts` gained *"the ticket
list does not scroll sideways at any width"*, which sweeps fifteen widths rather
than sampling two, and it passes.

A test that passes proves nothing about the bug it was written for unless it
also fails without the fix, so the old template was put back and the new test
run against it:

```
✘ layout › the ticket list does not scroll sideways at any width
  Error: at 900px
  Expected: <= 1
  Received:    318
```

318 rather than the 333 measured in a headed browser, because Playwright's
headless Chromium has no scrollbar — 900px of layout width instead of 885. The
fix was then restored and the test passes again. Without that second run, the
new test would be one more assertion that has never been seen to fail, which is
the same category of thing as the one it replaces.

## D45 — Correcting the brief: the filters were never lost on the browser's back button

**The report.** Brief §1.2: "Apply filters on All Tickets → open a ticket →
press back → the filters are gone… Something is dropping them on the return
journey."

**What was measured, before changing anything.** Four list screens, two widths,
filters applied through the real controls, a ticket opened, `page.goBack()`. The
URL came back with its query string intact every time, and the filter controls
came back showing it. `useIncidentFilters.setFilters` writes with `replace`, so
the history entry the list was on already carries the filters; the browser's
back button restores them and always did.

**The actual cause.** The ticket page's own back link:

```tsx
<Button component={RouterLink} to={paths.allTickets} startIcon={<ArrowBackIcon />}>
  All tickets
</Button>
```

A literal destination and a literal label. Pressing it goes to a bare
`/tickets` — dropping the query string, which *is* the list's state — and it
says "All tickets" from wherever you came. In an application, that arrow **is**
the back button; §1.2 and §1.4 are one line of code, and the symptom the owner
described is exactly what it produces.

**Chosen.** `features/incidents/backTarget.ts`. Every link that leads to a
ticket carries the location it was clicked from in React Router's navigation
state (`useTicketLinkState`); the ticket page reads it back
(`useBackTarget`) and renders the link from it. Navigation state lives in the
history entry, so it survives a reload and comes back correctly on
forward/back, and is simply absent for a pasted URL — which is what
`DEFAULT_BACK_TARGET` ("All tickets") is for.

The label is not a table of its own. `backTargetFor` asks
`navigation.ts::activeNavItem` — the same longest-prefix rule that highlights
the sidebar — so the link names the screen exactly as that user's own
navigation names it: "Tickets" for an admin, "All tickets" for an employee,
"My tickets" at `/tickets/mine`, "Notifications" from the inbox.

**Rejected: remembering the last list screen in a module variable.** A second
copy of the URL, wrong the moment two tabs are open, and gone after a reload.

**Rejected: reading the browser's history.** React Router does not expose the
previous entry, and the DOM History API deliberately does not either.

**Validated, not trusted.** History state survives a reload and can be edited
from the console, so `readBackTarget` checks the shape and refuses anything
whose destination is not an in-app absolute path — a protocol-relative
`//elsewhere.example` is a link off the site, and this link is not allowed to
be one.

**The lesson, again.** [D24](#d24--a-heading-is-not-a-signal-that-the-data-arrived),
[D25](#d25--a-test-that-reported-a-permission-was-enforced-without-checking-it)
and [D38](#d38--correcting-d36-the-login-loop-was-a-redirect-not-a-cache) all say
prove the fix removes the symptom. This is the other half of the same rule:
reproduce the symptom before believing the diagnosis that came with it. Had the
`replace` in `useIncidentFilters` been "fixed" on the strength of §1.2's wording,
the filters would still have vanished and the history stack would have been
worse.

## D46 — One focus ring on the app bar's search box, drawn around the box

**The report.** Brief §1.3: the global search field renders a white bordered box
when clicked.

**The cause.** S6's global focus rule, `body .MuiAppBar-root :focus-visible`,
which exists because a primary-coloured ring is invisible on a primary-coloured
bar. Its selector reaches the focusable element, and inside a Material UI text
field that is the bare `<input>` — not the rounded, bordered thing a reader
would call "the search box". So the ring was a hard white rectangle that stopped
short of the search icon and ignored the field's border radius. A text input
matches `:focus-visible` on a mouse click as well as on Tab, so this was every
use of the control.

**Chosen.** Two rules: suppress the ring on `.MuiInputBase-input` inside the app
bar, and draw it on `.MuiInputBase-root:has(:focus-visible)` instead. The ring
then takes the field's radius, encloses the icon, and looks deliberate.
`TicketSearchField`'s own `&.Mui-focused fieldset` override — solid white, a
second white line 2px inside the ring — drops back to the hover colour, so there
is exactly one focus indicator.

**What was checked, not assumed.** That the buttons on the bar still get the
white ring: tabbing from the search box to the bell gives
`rgb(255, 255, 255) solid 3px`, screenshotted. Deleting a focus indicator is the
thing S6 was written to stop, so a fix that quietly did it to the bell would be
worse than the box it removed.

**`:has()`** is used deliberately. Matching `.Mui-focused` would have worked
identically here, because a text input is always focus-visible — but it would
also fire for focus this rule is not about, and the intent is "the field
containing the focused thing", which is what `:has()` says.

## D47 — The end-to-end suite could not run at all, and had not been able to for some time

**Found while verifying [D44](#d44--the-sideways-scroll-a-viewport-breakpoint-deciding-a-layout-inside-a-narrower-box)–[D46](#d46--one-focus-ring-on-the-app-bars-search-box-drawn-around-the-box).** `npx playwright test` fails 95 of 96 tests.
Not on an assertion — in the shared sign-in fixture, before any test reaches its
first `expect`:

```
strict mode violation: getByRole('button', { name: 'Sign in' }) resolved to 2 elements
  1) <button type="submit">Sign in</button>
  2) <button aria-expanded="false">Sign in as someone</button>
```

The demo account picker (`features/auth/DemoAccountPicker.tsx`) puts an
accordion under the sign-in form whose header is a button called "Sign in as
someone". `e2e/fixtures/test.ts::signIn` and two tests in
`e2e/accessibility.spec.ts` ask for a control named "Sign in" without `exact`,
which now matches both.

**Confirmed pre-existing**, by stashing every frontend change and running the two
failing accessibility tests against the clean tree: they fail identically.

**Chosen.** Add `exact: true` at the three locators, with a comment saying why.
Three characters of scope creep, and the alternative is a section of work
verified by a suite that cannot start.

**What it says about the claim "82 e2e pass".** That number is in
`docs/PROJECT-GUIDE.md`, `docs/BUILD-STATUS.md` and the README. It was true when
it was written and stopped being true when the picker landed, and nothing
noticed, because nobody ran the suite again. A test suite reports on the code
only as often as it is run.

## D48 — The new palette, and the three colours that had to be re-derived to get it

**The brief's section 2.** Page background white → cream beige `#f0eada`; primary
navy `#1f3a93` → coco brown `#73362a`; a third colour to be proposed. It also
warns that two things validated against the old palette will break *quietly*:
S6's four pinned chip contrasts, and M7's chart palette.

Both warnings were correct. One of them was worse than the brief expected.

### The page background alone broke three of the four chip colours

`#f4f6fa` has relative luminance 0.920. `#f0eada` has 0.824. Every outlined chip
— and `PriorityChip` is outlined, on every row of every list — sits on that
surface, so the whole status palette moved closer to its background:

|  | vs `#ffffff` | vs `#f4f6fa` (old) | vs `#f0eada` (new) |
| --- | --- | --- | --- |
| info `#026da8` | 5.59 | 5.17 | **4.66** pass |
| warning `#b45309` | 5.02 | 4.64 | **4.18** FAIL |
| success `#2e7d32` | 5.13 | 4.74 | **4.27** FAIL |
| error `#d32f2f` | 4.98 | 4.60 | **4.15** FAIL |

**Re-derived, not re-picked.** Each failing colour was walked down its own hue at
constant saturation until it cleared 4.6 against the new page — 4.5 plus enough
headroom that a rounding cannot decide it. Hue drift is 0.2° at worst, so
`#a94e08`, `#2c7730` and `#c72a2a` are the same three colours a step darker
rather than three new ones. Clearing the cream clears white automatically, the
cream being the harder surface.

**And it is a test now.** `src/theme.test.ts` reads both surfaces off the theme
and asserts every slot against each. Put the old three back and it fails three
times with the three real ratios. S6 wrote eight numbers into a comment and
nothing checked them; that is precisely how they came to be wrong.

### The third colour: ochre, and why not the other two

The brief suggests a warm ochre `#a9743a` and offers a muted olive `#6f7548` or a
deeper clay `#8c4a32`. The third colour has two jobs — an accent beside the
brown, and the hue the charts are drawn from — and only one candidate does both
with the same colour:

| candidate | OKLCH hue | from primary (32.5°) | chroma as given | as a chart step |
| --- | --- | --- | --- | --- |
| ochre `#a9743a` | 66.3° | 33.7° | 0.100 | `#b46d00` |
| clay `#8c4a32` | 40.4° | 7.9° | 0.097 | `#d74c00` |
| olive `#6f7548` | 114.8° | 82.3° | 0.065 | `#7f8900` |

A chart mark needs chroma ≥ 0.10 or it reads as grey at bar size. Ochre is
already there, so its chart step is the same colour one shade stronger. Clay has
to travel to a vivid orange-red that is no longer brown and collides with the
error chip — and as an accent it is eight degrees from the primary, close enough
to read as the app bar slightly faded. Olive gives the most separation of the
three and is the furthest from its own chart step: a muted sage in the interface
and a chartreuse in the charts, which is two colours wearing one name.

**Shipped as two steps, not one.** `secondary.main` in this application is always
a *surface with white text on it* — the avatar initials in `UserMenu` and
`DrawerAccountSection`, the note dot on the activity timeline. White on `#a9743a`
is 4.00:1 and fails AA for 15px initials. So `main` is the ochre snapped until
white text clears the bar (`#8b5f30`, 5.56:1) and `light` keeps the brief's
literal `#a9743a` for the places nothing sits on top.

### `background.paper` stays pure white, deliberately

The brief changes the *page*. Cards a shade lighter than the page is what makes
them read as cards, and it has a second benefit: `chartPalette.ts` is validated
against the surface its marks are painted on, which is `background.paper`.
Holding that colour still means the chart numbers moved only because we chose to
change the hues, never because the surface moved underneath them. A warm
off-white would be a defensible taste call and would invalidate every figure in
that file.

### The chart palette, re-derived rather than recoloured

The old pair `#2a78d6,#eb6834` **still passes every check** — the card surface did
not move, so nothing forced this. It changed because a blue-and-orange chart
inside a cream-and-brown application looks imported from somewhere else.

New values, all validated against `#ffffff`:

- `SERIES_PRIMARY` `#b46d00`, `SERIES_SECONDARY` `#007ca5` — worst CVD ΔE 18.9
  (protan), normal-vision 24.6, both clear of the 8 and 15 floors.
- `PRIORITY_RAMP` `#ff9e0d → #d48100 → #aa6600 → #814d00` — monotone, gaps above
  0.06, light end 2.07:1, hue spread 1°.

Three things the derivation settled that guesswork would not have:

1. **The primary brown cannot be a chart colour.** `#73362a` is OKLCH L 0.411,
   below the 0.43 band, and chroma 0.089, below the floor — it reads as grey at
   bar size. Pushed to a passing chroma at its own hue it becomes `#ce2700`, a
   vivid red-orange that is no longer brown and collides with the error red. The
   brand's darkest colour is a good app bar and a bad bar chart.
2. **The second slot has to be cool.** Two warm hues carrying a two-series chart
   is the arrangement that fails protanopia; warm against cool is what survives.
3. **The ramp's light end is a floor, not a preference.** The first attempt
   started at L 0.82 (`#ffb15c`) and failed at 1.80:1 — "Low" would have
   dissolved into the white card. L 0.78 is the lightest step that clears 2:1.

## D49 — What the new palette cost: Blocked and In progress are now the same brown

**Found by looking at the screen**, which is the thing this project's own notes
keep saying to do, and then measured.

`statusChipColor` maps IN_PROGRESS to `primary` and BLOCKED to `warning`. Under
the old palette those were navy and orange — about as far apart as two colours
get. Under the new one they are `#73362a` and `#a94e08`: OKLab ΔE 13.4, below the
15 floor at which two marks are considered tellable apart by a full-colour
reader. For scale, In progress against Open is 23.0 and Blocked against Resolved
is 19.9.

**It cannot be fixed by moving the warning colour.** A colour that clears 4.5:1
on a cream page has to be dark, and dark warm hues cluster. Walking the hue from
40° to 100° and taking the darkest passing step at each, separation from the
brown never reaches 15 — and every degree it gains from the brown it loses to
the green:

```
 40°  #b93f00   vs cream 4.63   ΔE brown 14.8   ΔE green 23.7
 70°  #915b00   vs cream 4.73   ΔE brown 12.8   ΔE green 14.7
100°  #766800   vs cream 4.66   ΔE brown 15.1   ΔE green  9.2
```

There is no warm step that clears both. The collision is a property of choosing a
cream page and a brown primary, not a bad pick within that choice.

**Proposed: accept it, and say so**, on the grounds that a chip carries its own
word — the argument M7 recorded when it refused to colour the status chart by
status — with the real fix noted as "stop IN_PROGRESS borrowing `primary`",
one line in `src/display/statusColor.ts`.

**Superseded the same day.** The owner rejected the premise rather than the
verdict: the ticket's progress should not have followed the brand in the first
place. [D51](#d51--the-brand-is-brown-the-workflow-is-blue) does the one-line
fix immediately instead of deferring it to section 3, and the collision is gone
— IN_PROGRESS against BLOCKED is ΔE 30.9 against the navy, where it was 13.4
against the brown.

**Left in the log rather than deleted**, because the measurement is what made
the owner's instinct actionable, and because "two warm colours on a cream page
cannot be pulled apart" is a constraint the next palette change will meet
again.

## D50 — The colour the new contrast test could not have caught

`e2e/accessibility.spec.ts` failed on the notification inbox, on both viewports:

```
[serious] color-contrast: .MuiToggleButtonGroup-lastButton
  insufficient color contrast of 4.38 (foreground #6e6c64, background #f0eada,
  font size 9.8pt (13px)). Expected 4.5:1
```

An unselected `ToggleButton` — the inbox's All/Unread filter, and the
chart/table switch on every dashboard panel. Material UI colours it
`rgba(0, 0, 0, 0.54)` (`action.active`), which lands at `#6e6c64` on the cream
page. It was 4.61 on the old near-white background and failed the moment the
page warmed up.

**The point worth keeping.** [D48](#d48--the-new-palette-and-the-three-colours-that-had-to-be-re-derived-to-get-it)
added a unit test asserting every palette slot against both surfaces, and that
test passes here — because this colour is not a palette slot. It is a library
default this application never named, and a test over "the colours we chose"
cannot see it. The axe run scans what is actually on the screen and does not
care where a colour came from. Two checks, different ground, and the brief said
as much: *"`npx playwright test e2e/accessibility.spec.ts` … will catch failures,
but only for what it scans — check the numbers as well as the scan."* This is
the converse, and both halves of the sentence earned their place.

**The fix** is one override: an unselected toggle takes `text.secondary`
(5.40:1 on the page, 5.74:1 on a card) instead of `action.active`. That is the
token the label should have worn regardless — it is text, and the data-viz rule
this project already follows says text wears text tokens. The selected state is
untouched.

**What it suggests for next time.** Any *other* Material UI default built on
`action.*` alpha is in the same position and only a scan will find it. The
accessibility suite covers fourteen screens and three open dialogs; a surface
change should be taken as a reason to run all of it, not the unit tests alone.


## D51 — The brand is brown, the workflow is blue

**The owner, on seeing R2:** *"i like the main new colors, but i didnt want you
to change the blue colors on chips and charts and progress bar of the ticket.
that is because blue is intuitive but brown isnt."*

That is a better statement of the problem than the one D49 was working on. The
question is not which brown to use for IN_PROGRESS; it is that a ticket's
progress was never the brand's to colour. It had been `primary` since M5 and
nothing noticed, because `primary` was navy and navy is what progress looks
like anyway. The redesign made the two diverge and the borrowing became visible.

**Chosen.** A palette slot of our own, `workflow`, holding the old navy
`#1f3a93`. It paints exactly two things:

- the IN_PROGRESS chip (`display/statusColor.ts`)
- the ticket's stepper (`features/incidents/WorkflowStepper.tsx`)

The app bar, the drawer's call to action, the workflow buttons, the focus ring
and every other use of `primary` stay brown. The product speaks in brown; the
ticket speaks in blue.

**And the charts go back to M7's values** — `#2a78d6` / `#eb6834`, the blue
ramp. R2's ochre re-derivation passed every check and so does this; no
measurement decided it. The owner's reason is the one that should be written
down: *a chart is read by someone who has never seen this application before,
and blue is a convention they already have while brown is a brand they do not.*
Coherence with the interface lost to legibility to a stranger, which is the
right way for that argument to go.

**What it fixes for free.** D49's collision. Against the brown, IN_PROGRESS sat
at OKLab ΔE 13.4 from BLOCKED — under the 15 floor, on the pair an engineer
scans a queue for. Against the navy it is 30.9.

**What it costs.** `workflow` is a custom palette slot, so it needs TypeScript
module augmentation in `theme.ts` for `Palette`, `PaletteOptions` and
`ChipPropsColorOverrides`. Without the last one `<Chip color="workflow">` does
not type-check and the status palette would go back to hardcoded hexes at the
point of use, which is the thing `statusColor.ts` exists to prevent.

**A trap worth recording.** Material UI fills in `light`, `dark` and
`contrastText` only for the five slots it knows about. `workflow: { main }`
type-checks, renders, and produces a **grey** filled chip, because `Chip` reads
a `contrastText` that is not there. It has to be
`createTheme().palette.augmentColor({ color: { main }, name: 'workflow' })`.
Caught by screenshotting the ticket page; the type-checker and 349 unit tests
were all happy with the grey one.

**One number to keep an eye on.** IN_PROGRESS navy against OPEN `#026da8` is
ΔE 14.0, marginally under the 15 floor — two blues, adjacent. That pair is
unchanged from what shipped through M7 and S6, it is not a regression, and both
chips carry their word. Noted so that nobody rediscovers it and assumes D51
introduced it.
## D52 — The end-to-end suite had buried today under its own test data

**The symptom.** 154 tickets reported on 2026-09-23, against three to nine on
every neighbouring day. The admin dashboard's daily series was a flat line with
one wall at the right-hand edge, and every rate computed over the last thirty
days was measuring the test suite.

**The cause is a decision, not a fault.** `e2e/fixtures/test.ts` deactivates the
accounts it registers and deliberately keeps their tickets — "they are ordinary
data, and a grader looking at the app afterwards should see them". That was
reasonable when the suite ran occasionally. Section 1 and section 2 of the
redesign brief ran it a dozen times in an afternoon, at ~13 tickets a run, and
the rationale inverted: the tickets stopped being data a grader should see and
became the only thing they could see.

[D4](#d4--the-development-database-has-accumulated-test-data) is the same
observation one database ago, and its answer — reset before the next seeded
phase — is not available now, because the seeded data is the demo.

**What was removed.** Everything reported by an `e2e.<role>.<worker>-<stamp>@acme.inc`
account and the accounts themselves: 150 incidents, 96 users, 282 events, 24
notes, 116 notifications, in one transaction.

**The discriminator is the reporter's address, and it was checked rather than
assumed.** Before deleting: no demo ticket was assigned to an e2e engineer, no
e2e note or event sat on a demo ticket, and no notification to a demo user came
from an e2e ticket — three counts, all zero. Every e2e ticket was dated
2026-09-23. So the set is genuinely separable and nothing outside it moved,
which a `WHERE created_at::date = today` would not have given: three of that
day's tickets are seeded demo data and are still there.

Events, notes and notifications CASCADE from the incident, and `reporter_id` is
`ON DELETE RESTRICT`, so the order is forced: incidents first, then accounts.
`login_attempts` is keyed on the address with no foreign key and would have
outlived the accounts, so it is swept explicitly.

Afterwards: 300 incidents, 38 users — the seeded baseline exactly — and
2026-09-23 holds 3 tickets beside its neighbours' 3, 5, 5, 4, 9, 7.

**Not fixed: it will happen again on the next run.** Roughly 13 tickets per
suite. The options are to delete the suite's own tickets in teardown — which
needs SQL, because the application has no endpoint for deleting an incident and
should not have one — or to keep clearing it by hand between phases. That is
the owner's call and is recorded here rather than taken.

## D53 — Chips: one width per family, and the arrows come off

**Section 3 of the brief.** Equal width and height for the status, priority and
level chips; more padding inside them; the priority icons removed; CRITICAL
filled rather than outlined; the escalation flag moved to the front of the
title.

### The widths are measured, and now asserted

`src/components/UniformChip.tsx` is the one place that decides a chip's size.
Each family is pinned to its longest label plus 12px of padding either side,
rounded up to a multiple of four — taken by rendering the real screens with the
widths set to zero and reading the boxes back, not by counting characters:

| family | longest | measured | pinned |
| --- | --- | --- | --- |
| status | In progress | 88.8 | 92 |
| priority | Medium | 73.3 | 76 |
| level | Senior | 62.8 | 64 |

Three numbers in a comment is exactly the arrangement S6's contrast figures
were in when three of them silently stopped being true
([D48](#d48--the-new-palette-and-the-three-colours-that-had-to-be-re-derived-to-get-it)),
so `e2e/chips.spec.ts` asserts them in a real browser at both viewports. A font
change moves these and nothing else would notice.

**A `styled()` base rather than a `MuiChip` override in `theme.ts`.** The rule
is for three families, not for every chip. Specialty chips, the inbox's "New"
badge and the escalation flag all say something whose length is real
information and keep their natural width.

### The priority arrows come off, and the justification they had was wrong

`PriorityChip`'s comment said the icons were there because "colour alone fails
for the roughly one person in twelve with a red-green deficiency". That is true
of colour alone, and this chip has never been colour alone — it carries the
word *Critical*. WCAG 1.4.1 is about colour being the **only** visual means of
conveying information; the label was always the other one. The icons were a
third channel behind a second, and four of them down a table column cost more
than they bought.

**Filling CRITICAL is the better version of what the arrows were reaching
for.** The row people most need to find is now the only one with a solid block
of colour in it — a difference in *form*, not in hue, which survives a
red-green deficiency and a monochrome printout. The other three stay outlined
so an ordinary list does not become a wall of blocks.

### The escalation flag leads the title

Trailing it, the flag sat wherever that row's title happened to end, so a
column of escalated tickets had its flags scattered across the width: the one
thing in the row you want to find by glance was the one thing with no fixed
position. It now leads the title in the table, the card list and the home
screens' rows.

**What it costs, stated because it is visible.** The flag takes about 100px out
of the title cell, so an escalated ticket's title truncates sooner. Two things
offset it and neither fully: the status and priority columns were sized against
their longest *word* and carried slack for the icon that is now gone, so both
are cut to the chip's pinned width plus a cell's padding — 124 and 108, from
128 and 118 — and the room goes to the title. The remainder is the real price
of the alignment the brief asked for, and is worth checking on a screen before
it is accepted.

**The detail page's flag did not move.** It sits in the chip row under the
heading, and the brief's reason — "so rows line up" — has nothing to align
there. Putting a chip inline before an `<h1>` would cost the heading to buy
nothing.

## D54 — Section 4: the phone loses a navigation bar and gains its screen back

**Seven requests, and two of them are the owner overruling an earlier decision
of ours.** Recorded together because the reasoning in both cases is the same
shape: something was built for a good reason, and the reason stopped being the
whole story once the thing was used.

### The bottom navigation bar is deleted, not hidden

It carried three or four of the drawer's items and cost 56px of a phone's
height permanently, plus the padding every screen reserved to clear it. The
drawer covers the same ground and more.

Deleted rather than hidden, per the brief, so nothing has to reserve room for
it: `BOTTOM_NAV_HEIGHT` is gone, `<main>`'s phone padding is the ordinary one,
the report FAB sits at `bottom: 16` instead of `bottom: 72`, and `NavItem` no
longer carries `inBottomNav` — a flag with no consumer is a question the next
reader has to answer for nothing.

**The tests that asserted the bar are gone with it**, on the owner's
instruction. Two were rewritten rather than deleted outright, and the
distinction matters: `AppShell.test.tsx`'s two cases each asserted the bar
*and* something that still exists — that the sidebar is absent at phone width,
and that Material UI keeps a temporary `Drawer` out of the DOM until it opens.
Deleting them whole would have removed coverage of behaviour we still ship, so
each keeps its surviving half. `navigation.test.ts`'s "at most four items in
the bottom bar" is deleted outright; there is no bar to bound.

### The phone's drawer opens from the right

M5 moved the menu *button* to the right corner for thumb reach and left the
panel coming in from the left, so the tap and the thing it produced were at
opposite edges of the screen. The desktop drawer stays on the left: it is
permanent, never "opened", and reach is not a constraint with a mouse.

`theme.ts`'s drawer border had to learn about the anchor — a right-hand panel
with a border down its right edge is a line drawn in the margin of nothing.

### Dialogs are no longer full screen on a phone

BUILD-PLAN §10 asked for full screen because a text field in a centred dialog
is unusable once the keyboard takes half the viewport. The owner overrides it,
and the reason is worth keeping: **a dialog that fills the screen looks like a
page**, and a page that arrived without the address bar changing loses the cue
that closing it puts you back where you were.

The keyboard problem is real and is answered with margins instead: 16px of page
on every side — the gutter the rest of the application uses — and a `maxHeight`
that keeps the dialog inside the viewport so it scrolls rather than the page
behind it. The e2e assertion is a **gap on every side**, not "smaller than the
viewport", which would pass on a dialog one pixel short of filling it.

### Full-width controls: the container decides, not the control

Two new pieces, both so the rule lives in one place:

- **`components/RowActions.tsx`** — the buttons acting on one row. Full width
  and stacked below 900px. The alternative was `fullWidth={isMobile}` on each
  button, which is the same rule at four call sites and forgotten at the fifth,
  and it makes every button that might appear in a row take a viewport prop it
  has no other use for. `AssignButton` and `PickUpButton` know nothing about
  this. Measured after: 309px of a 343px card on a phone, 64px on a desktop.
- **`components/FilterRow.tsx`** — a filter row that reflows to the width it
  has, `repeat(auto-fit, minmax(min(100%, N), 1fr))`. The ticket lists, the
  engineer roster and the users page all use it, which also folds in
  [D44](#d44--the-sideways-scroll-a-viewport-breakpoint-deciding-a-layout-inside-a-narrower-box)'s
  fix rather than leaving it as one screen's special case. Controls inside stop
  setting their own widths — the engineers page was opting out of the theme's
  full-width text fields with `fullWidth={false}` and a `minWidth` precisely to
  work around the flex row this replaces.

`RowActions` uses a viewport media query, built from `MOBILE_MAX_WIDTH` so it
cannot drift from `useBreakpoint`. A container query would be more honest by
D44's lesson, and is deliberately not used: "is this a phone" is a viewport
question everywhere else in this application, and one component answering it
differently would be a worse fault than the one it fixed.

### The ticket title rule

Six surfaces rendered a ticket title and no two agreed — `body2`, `subtitle1`
at 600, `body1`, `subtitle2`, `h1`. The team page's sat *inside* the link with
the reference, so it wore the link colour while every other title was ink, and
that is the half that actually misleads: a coloured title says "click this" on
a card where the whole card is already the target.

**The rule, in `components/TicketTitle.tsx`:** a title is always ink, never a
link colour — what is clickable is the reference or the row, and colour is how
a reader tells those apart. Size follows how much of the screen the ticket
owns: `row` (`body2`) in table and panel rows, `card` (`subtitle1`/600) on
cards and home rows, `page` (`h1`) on the detail page. `page` is the deliberate
exception the brief allows: there the title is not one item among many, it is
what the page is about, and the heading level is a fact for a screen reader as
much as a size for everyone else.

### Facilities: the columns start on the same line

The floor's name sat above the seat panel on the page background, so the
buildings panel's top edge and the seat table's were a heading apart and the
right column read as having slipped down. The name and its four buttons move
*inside* the seat card as its toolbar: both panels now start at y=225,
measured.

`Collapse` replaces the bare conditional, so choosing a floor opens the panel
rather than teleporting it. On a phone the two columns are stacked, so a tap on
"Level 3" filled a panel a screenful below the fold and looked like it had done
nothing — the page now scrolls it into view. `prefers-reduced-motion` is
honoured by hand there: `theme.ts` sets `scroll-behavior: auto` for that case,
but `behavior: 'smooth'` passed to `scrollIntoView` overrides the stylesheet
rather than obeying it.

## D55 — A whole card that opens a ticket, with buttons that still do their own job

**The owner:** on the engineer screens, clicking anywhere on a ticket should
open it — except on the buttons, which should keep acting.

Those two were genuinely incompatible, and `HomeTicketRow`'s own docstring
said so: a `<button>` inside an `<a>` is invalid HTML and browsers resolve it
by folding the button into the link, so a `CardActionArea` around everything
would have made "Pick up" navigate instead of picking up. That note is why the
home rows had only their title clickable, and it was correct about the
constraint and wrong that the constraint was binding.

**Chosen: a stretched link** (`components/stretchedLink.ts`). One real anchor —
the title — grown over the card by an absolutely positioned `::after`, with
the buttons lifted above it on the z axis. The markup stays valid, there is one
link and one tab stop, and a screen reader hears the title as the link's name
rather than the card's entire text read out as one.

Three pieces, and all three are load-bearing: `position: relative` on the card
(or the overlay escapes to the nearest positioned ancestor), the overlay on the
link, and `zIndex: 1` on the actions. Miss the last and the buttons stop
working, which is the exact failure the arrangement exists to prevent — so it
is asserted rather than commented.

**The reference stops being a link.** The card is the link now; a second anchor
to the same ticket is a second tab stop and a second thing to read out for one
destination.

**What it costs:** text inside the card can no longer be selected by dragging,
because the overlay is what the pointer meets. The accepted trade of this
pattern everywhere it is used, and a ticket card is something you click rather
than something you quote.

**§5.7 arrived early as a consequence.** The team page had its own card with
its own typography and its own link treatment. Rather than teach a second card
the overlay, it now renders `HomeTicketRow` with Assign in place of Pick up,
which is what the brief asks for anyway. Three copies of one decision became
one.

## D56 — The first click that did nothing, twice

**Reported by the owner:** on the facilities page the first floor click does
not scroll to the table; every click after it does, on any floor of any
building.

**A defect in [D54](#d54--section-4-the-phone-loses-a-navigation-bar-and-gains-its-screen-back), shipped the same day.** The scroll ran from an
effect on `selectedFloorId`. That fires when the id changes, which is *before*
the `Collapse` holding the panel has grown — so the first time, it scrolled to
a box that was still zero pixels tall and already on screen, and nothing
appeared to happen. Every later click worked because the panel already had
height. A first-click-only fault: the kind a developer never sees, because by
the second attempt it is gone.

**The fix is to notice there are two moments, not one.** The panel *opening*
has a transition to wait for (`onEntered`); the floor changing while the panel
is already open has no transition at all, so there is nothing to wait for and
the effect is right. A `paneOpen` ref tells them apart. Measured after: 982px
on the first click and 982px on the second.

**Generalised rather than patched.** The report questionnaire got the same
treatment in the same pass — every question is a `Collapse` now, and on a phone
the one that just opened is scrolled to from `onEntered` for exactly this
reason. The reduced-motion handling both share is `display/revealScroll.ts`:
`theme.ts` sets `scroll-behavior: auto` under `prefers-reduced-motion`, which
covers scrolling the stylesheet causes and not an explicit
`behavior: 'smooth'` passed from JavaScript, which overrides it.

## D57 — Two pies, and why they are not painted in the chip colours

**The owner asked** for By priority and By building as pies, with the priority
slices in the colours of the priority chips.

The shapes are theirs to choose and both are defensible: each is a composition
— of all the tickets, this share was urgent; this share came from that building
— with few enough slices to read at a glance. By status and By category stay
bars, because those are read to compare one count against another, and five
categories where two are small is a puzzle as a pie.

**The chip colours do not survive the check, and not marginally.** The HIGH
chip `#a94e08` against the CRITICAL chip `#c72a2a`:

```
worst all-pairs  #c72a2a ↔ #a94e08  ΔE 1.9 (deutan) · 8.5 (normal vision)
floors                              ΔE 8.0 (CVD)    · 15.0 (normal)
```

The two slices a reader most needs to tell apart would be the same colour to a
deuteranope and very nearly the same to everyone else.

**That is not a flaw in the chips — it is caused by them being right.** A chip
carries its own word half a centimetre away, so its colour never has to carry
identity alone; and the chips are *dark* precisely because their labels must
clear 4.5:1 on the cream page ([D48](#d48--the-new-palette-and-the-three-colours-that-had-to-be-re-derived-to-get-it)),
which is what pushes HIGH's orange down into CRITICAL's red. A pie slice has no
text on it and needs only 3:1 against the white card, so it can be lighter and
far more chromatic — which is exactly the room those two hues needed.

**Chosen: the chip hues at slice steps.** Grey stays grey, blue stays blue,
CRITICAL is the error chip unchanged, and HIGH moves furthest — to a true amber
— because it was the one colliding. Three of the four are recognisably their
chip. Validator: CVD ΔE 14.0 (protan), normal-vision 16.6.

Two flags are accepted deliberately. The grey trips the chroma floor, which
exists to stop a hue that is *trying* to be a colour from reading as grey — LOW
is meant to be neutral, mirroring its chip, and a neutral slice beside three
coloured ones is distinguishable *because* it is neutral. And the grey and the
amber sit under 3:1 against white, which is a relief case: legal only with
visible labels or a table view.

**The counts moved to the legend to meet that**, and it is a better answer than
the arc labels it replaced. Painted on the slice, a number has to contrast with
whatever colour that slice is, and white sat at 2.2:1 on the amber and 2.75:1
on the grey — unreadable figures on exactly the slices a reader wants a figure
for. In the legend it is text on the card at the card's own contrast, and the
small slices get their value too, which an arc label cannot fit.

**Buildings are capped at three colours.** The validated categorical order
clears the all-pairs gates for its first three slots and not beyond, and a pie
is an all-pairs chart because every slice touches two neighbours and the
legend. A fourth building folds into "Other", or the chart goes back to bars.

## D58 — Section 5: the per-persona screens, and one backend flag

Seven items. Six are frontend; one needed the API, and the reason is worth more
than the change.

### 5.6 — "closed tickets last" is server-side, because a list is paged

There is no status ordering in `_SORT_TERMS`, and the tempting fix — reorder
the rows the browser was handed — is wrong: a page holds twenty-five tickets,
so a closed one sinks to the bottom of *page one* and still sits above every
open ticket on page two.

So `closed_last` is a query flag that **prefixes** the ORDER BY. A prefix and
not a sort of its own, because it answers a different question: `sort` says how
to arrange the work, and this says that finished work goes at the end of it
however it is arranged. `case((status == CLOSED, 1), else_=0).asc()` ahead of
whatever terms the sort produces, relevance ranking included.

The test asserts it against `-priority`, deliberately: the interesting claim is
that a CRITICAL closed ticket sinks anyway, and that the tickets above it keep
the order the sort asked for.

### 5.2 — hide and reorder, in `localStorage`, with the table written down

The owner's call, taken after a correction: the worry was that `localStorage`
would need redoing weekly, and it does not — it never expires, and is lost only
when site data is cleared or another browser is used. The real difference is
cross-device, and a table is the fix for that. It is in the README's known
limitations as the next step rather than pretended away.

`dashboardLayout.ts` is the only file that touches storage, so making that move
later changes one file.

Four decisions inside it:

- **Reordering cannot cross the period/current line.** That boundary is what
  the whole dashboard is arranged around ([D9](#d9--two-reports-were-answering-a-present-tense-question-with-a-period), D10): a
  "Blocked · 21" tile under a "last 30 days" heading is the failure the two
  scope headings exist to prevent. A section can be hidden, and can move among
  its own kind.
- **The two headline tile rows are not in the list at all.** A dashboard where
  everything can be turned off can be turned into a blank page, and the admin
  who does that by accident has nothing left on screen to tell them what went
  missing.
- **Arrows, not drag-and-drop.** Dragging is the expected gesture and needs a
  pointer, a library and a keyboard story that usually never arrives. Each
  arrow names its section, so a screen reader hears "Move Engineer workload up"
  rather than seven identical "Move up".
- **Storage is validated, not trusted.** It survives upgrades and can be edited
  from the console; unknown ids are dropped, a malformed value falls back to
  the default whole rather than half-applying, and every access is wrapped
  because `localStorage` throws in a private window. A section added by a later
  release is appended in catalogue order rather than vanishing because
  somebody's saved layout predates it.

### 5.5 — the table gets a click handler, not the cards' overlay

`HomeTicketRow` and the card lists use the stretched link from
[D55](#d55--a-whole-card-that-opens-a-ticket-with-buttons-that-still-do-their-own-job).
The desktop table does not, for two reasons: an overlay inside a `<td>` has to
escape the cell to cover the row and a `<tr>` is not a reliable positioning
context to hang one off, and — more importantly — it would block selecting the
text of a table, which is a thing people do to tables and do not do to cards.

So the row carries an `onClick` and **the reference stays a real link**. That
link is what keeps the row reachable by keyboard and announced as a link; a
`<tr onClick>` is neither, and a row clickable only with a mouse would be a
regression dressed as a feature. The handler ignores clicks that land on
anything else interactive, and ignores a click that ends a text selection —
navigating out from under a drag would make the table impossible to read from.

### 5.4 — a default written into the URL, applied once

An employee lands on their own building, and the filter goes into the address
bar rather than into the query quietly. That is what makes it a *default*
rather than a hidden rule: the filter bar shows it, it can be removed, the view
stays bookmarkable, and a link somebody sends means what it says.

Applied once per mount via a ref. The obvious condition — "no building chosen"
— is also true the instant the employee clears the filter, and the page would
put it straight back.

### 5.3 — the assign dialog says what somebody knows, not whether they match

Line one is who they are and whether they are free; line two is what they know.
Those are the two questions an assigner holds at once, and separating them is
the point: when the specialist is busy, somebody has to be picked anyway.

The single "Specialty" badge is replaced by **every** specialty chip, with the
ticket's own category group filled green. A badge says *whether* somebody
matches; the chips say *what they cover*, so "no green, but they do Networks
and this is network-adjacent" becomes a judgement the assigner can make rather
than one the dialog made for them. Green is not the only channel — the matching
chip is filled where the others are outlined, and carries a title in words.

### 5.1 — grouping needs a join the users endpoint cannot do

`GET /users` returns a role and no level; an engineer's level is on
`engineer_profiles`, behind a different endpoint. The page reads both and joins
them in `groupUsers`, which takes the levels as an argument so the ordering is
testable without a server. Adding `level` to the users response would be the
tidier API and a wider change than this screen justifies.

Empty sections are dropped rather than shown empty — a heading over nothing
reads as something that failed to load, and on a filtered list most sections
are empty most of the time. An engineer whose level has not arrived yet (the
roster is a second request) is grouped as JUNIOR rather than vanishing: briefly
in the wrong section is recoverable, in no section at all is a missing account.

## D59 — Section 6: an engineer is a page, and the demo world grew to fill it

Two items built (6.1, 6.2), two deliberately not (6.3, 6.4), and one change
nobody asked for that turned out to be the condition for 6.1 being worth
opening at all.

### 6.1 — the modal becomes a page, because the question changed

An engineer was an **Edit engineer** dialog: level, specialties, availability,
capacity, a save button. Everything in it is a *setting*, and a dialog is the
right shape for settings.

The question people actually arrive with is not what an engineer's settings
are. A lead opening somebody's record is deciding whether to hand them the next
ticket. An admin is asking how they are doing. That needs a period, an output
figure, a breakdown and a live queue — four things that do not fit in a modal,
and one of which (the period) a modal cannot even hold honestly, because a
date range floating above a settings form reads as filtering the settings.

So `/engineers/:userId` is a page, and the old dialog's contents live on it as
`EngineerBasics` — the same fields, the same mutation, now a section rather
than the whole thing. `EngineerDialog` stays for **creation**, which genuinely
is a form: you fill it in, you get a temporary password, you are done.

**The route is keyed on the user id, not a profile id.** `engineer_profiles` is
keyed that way too — the profile is an extension of a user and has no identity
of its own — so a URL built from the profile's own key would be a second name
for the same person.

### The reopen figure, and why it says less than it could

The brief asks for "how many of their closed tickets were later reopened by the
reporter" and notes the data is there. It is, but not in the shape the sentence
implies.

`reopen_count` is a column on `incidents`. It counts every reopen that ticket
has ever had — by anyone, at any time, against any assignee. A ticket that
Priya resolved in March, that was reopened, that Omar then resolved in May,
carries a reopen that belongs to neither of them individually.

The number that the brief describes — *reopened because this engineer's fix did
not hold* — requires walking `incident_events` for each REOPENED and finding
whose RESOLVED it followed. That is a window function over the event log and a
materially larger query, and it is the right thing to build **if this becomes a
performance metric**. It is not one yet.

What ships is the weaker, computable claim: **of the tickets this engineer
resolved in the window, how many carry a reopen.** The screen says "Resolved,
then reopened" and the caption says "% of what they resolved came back". Both
phrasings were chosen so that the label is true of the number underneath it. A
quality signal that overstates itself is worse than none — it gets somebody a
difficult conversation they did not earn.

`reopen_rate_pct` is `None`, not `0.0`, when the engineer resolved nothing in
the window, for the same reason every other percentage in `reporting.py` is:
a zero denominator is a *meaning* decision. Nothing resolved means **no rate**.
Zero percent would read as a flawless record, which is the opposite of what an
empty period tells you.

### `STAFF_ONLY`, and where that rule is actually enforced

Seven of the eight report routes are `ADMIN_ONLY`. `GET /reports/engineers/{id}`
is `STAFF_ONLY`, and the difference is not a relaxation — it is the guard §5.5
asks for, put where it holds.

A LEAD opens this page to decide who gets the work. An engineer opens it on
themselves. An admin opens it on anyone. An employee must not reach it at all.
The `RequireRole` on the route is a courtesy that stops a wrong link rendering
a 403 screen; **the dependency on the endpoint is the enforcement**, and it
holds when somebody types the URL, shares it, or calls the API directly.

### The two links in, and what they replace

- **The assignee column** on the ticket tables becomes a link. It is the
  natural place to ask "who is this, and are they buried" while triaging.
- **The engineer workload rows** on the admin dashboard now go to the person,
  not to a filtered ticket list. This is a genuine reversal: those rows have
  pointed at `?assignee_id=…` since M7. Clicking a row in a table *about people*
  and landing on a list of *tickets* answers a question you did not ask — and
  the ticket list is one click further on from the page you land on instead.

### 6.2 — more specialties, and the label that sat under "None"

The specialty list is the category groups, so "offer more" was not a new list:
`seed/categories.py` gained three groups — **Cleaning & Waste**, **Safety &
Security**, **Deliveries & Moves**, fourteen subcategories between them — and
the specialty field offers them because it always offered whatever the tree
holds.

The overlap was the smaller half and the more interesting one. A MUI `Select`
with `multiple` renders its value *inside* the field, and an empty multi-select
renders the literal string "None" there — on top of a label that has not
floated up, because MUI shrinks the label when it believes the field is
non-empty and an empty array is not. The ticket page's filters look correct
because they pass `slotProps={{ inputLabel: { shrink: true } }}`, pinning the
label up unconditionally. That is the fix, copied verbatim, and it is the same
two lines as the `displayEmpty` fix on the dashboard's Building filter.

### The change nobody asked for: the demo world had to grow

This was the owner's call, and it is the reason 6.1 is worth opening.

Adding three category groups to the tree does not add a single ticket that uses
them. `migrate` is idempotent and seeds categories; nothing backfills history.
A demo database migrated after §6.2 has eight groups in every dropdown and
tickets in five of them — so the engineer page's "What they fix" chart, the
dashboard's category breakdown and the new specialty options all draw from a
world where the newest third of the taxonomy is empty.

Three numbers moved:

- **300 tickets → 420.** Ten engineers across eight groups over ninety days
  need enough history for each person to have a record worth reading. At 300
  the thinnest engineer-group cells were a ticket or two.
- **Six engineers → ten.** The roster is what the dashboard's "who is free /
  who is buried / who knows about this" questions are asked against, and none
  of them is interesting when everyone has one specialty and a similar load.
  So: generalists with three groups and specialists with one, every group
  covered at least twice, two groups covered three deep,
  `ENGINEER_LOAD_WEIGHTS` deliberately uneven from 0.16 down to 0.05.
- **The three new groups sit at 9% / 7% / 5%, not 2–5%.** The first pass gave
  them a token share, which put Deliveries & Moves at about six tickets in
  three months. That satisfies a test that every group appears and is not
  enough to *look* at. A fifth of the queue between them is the honest shape
  for a facilities team — rarer than broken-monitor traffic, common enough that
  a chart segment is worth clicking.

**The bug this caused is the one worth remembering.** `CATEGORY_GROUP_WEIGHTS`
has always had a `.get(name, 0.1)` fallback, so a group added to the tree is
picked whether or not this file knows about it. `SYMPTOMS` had **no** fallback
— a plain dict subscript — so the first `seed_demo` after the categories landed
died on `KeyError: 'Deliveries & Moves'` and took nineteen tests with it. One
table tolerant of a new group and its neighbour not is the kind of asymmetry
that is invisible until the day it isn't. Both are tolerant now:
`GENERIC_SYMPTOMS` and `_symptoms_for()` mean a group added next year produces
plausible tickets without touching this file.

Four tests had hardcoded counts that were really assertions about the seed's
size. They derive them from `DemoSpec` now, so the next person to change a
number does not have to find out which tests were secretly about it.

### 6.3 and 6.4 are not built, and that is a decision

Both are recorded in the README's scope decisions rather than silently dropped.

**6.3, the "needs help" escalation chain**, is the largest item in the brief and
is backend work — a state-machine question, not a styling one. The brief itself
lists five design questions to settle before any code, including whether it is a
new `IncidentStatus` (which means new rows in `workflow.py` for every legal
transition into and out of it, plus the notification rules, plus the frontend's
`allowed-transitions` rendering, all of which follow for free if it is a status
and none of which do if it is a flag) and how it relates to the *existing*
escalation flag, which is reporter-facing and would then be the second thing in
the product called "escalate". Half-answering that in the tail of a UI pass
would put a rule somewhere other than the one place it belongs, which is the
architecture rule this project has held to throughout.

**6.4, automatic BUSY**, is a smaller question with the same shape: `BUSY` is
currently the engineer's own statement about themselves, and capacity is an
observation the system makes. Merging them means an engineer who marked
themselves available is overruled by a ticket count, and an engineer at
capacity cannot say "I am fine, send it". The capacity bar already shows the
observation next to the statement, which keeps both readable. Deciding to fuse
them is a product call worth taking deliberately, not as a side effect.

### `bin/reset-demo-database.sh`

New, and the reason is the two paragraphs above plus [D52](#d52--the-end-to-end-suite-had-buried-today-under-its-own-test-data): the e2e suite
leaves its tickets behind by design, and the seed itself now changes between
phases. `seed_demo` refuses to top up — it returns "Demo data is already
present" and changes nothing, deliberately, so a second invoke cannot double a
dataset — so the only way to a current demo world is drop, `migrate`, `seed_demo`,
in that order. The script is that, with a typed confirmation and a
`pg_terminate_backend` first, because Postgres will not drop a database the dev
server still holds a pool against.

It is local only. Aurora is `publicly_accessible = false` and unreachable from
here, which is the intended blast radius.

## D60 — Date pickers, the library that came with them, and what they cost

**§A of the phase brief.** `DashboardFilterBar.tsx` was the only file in the
application with `type="date"` inputs. It is used by the admin dashboard *and*
the engineer page, and §C adds the ticket lists, so it was treated as a shared
component from the start rather than as the dashboard's.

### dayjs, and one `LocalizationProvider`

`@mui/x-date-pickers` needs a date library. **dayjs**, on three grounds and
none of them taste: it is the smaller of the two serious candidates, it is what
`BUILD-PLAN.md` §1 named for this project before anything was written, and it
is the adapter MUI's own examples use, so the next person to read this file
finds the documentation matching it.

**One provider, at the root in `main.tsx`**, and mirrored in
`test/renderWithProviders.tsx`. Not one per screen: every picker in the
application should parse and print dates the same way, and a provider per
screen is how two screens quietly end up on different adapters. The mirror is
not optional either — without it a picker *throws* rather than rendering
wrongly, so any test of a screen with one would fail on the provider instead of
on the screen.

### `components/DateRangeFields.tsx`, and where the conversion lives

The shared thing is **not the markup, it is the value contract**: two
`YYYY-MM-DD` strings in, two out, `''` for unset, and nothing written while a
date is still being typed. No `Dayjs` crosses the boundary in either
direction — the moment one does, every caller has to reason about timezones and
about which date library this project uses.

That matters because the two consumers store ranges differently. The dashboard
keeps calendar days in the URL, deliberately, so a link means the same period
in another timezone; the ticket list keeps **full ISO instants**, because the
same parameter carries a dashboard window computed to the second. Each converts
at its own edge (§C put the day↔instant helpers in `display/time.ts`, beside
`parseCalendarDay`, whose rule they depend on) rather than this component
growing a flag.

It renders a **fragment, not a wrapper**, so its two fields are two items of
whatever layout the caller is running — a flex row on the dashboard, a grid
column each inside `FilterRow`. A wrapper would make the pair one grid item.

### Two things found by building it

**The theme does not reach a picker, and the reason is not the obvious one.**
`theme.ts` sets `MuiTextField` `defaultProps: { fullWidth: true, size:
'medium' }`, and the expectation is that a picker's field inherits it. It does
not: that slot renders `MuiPickersTextField`, a *different* component, so
nothing keyed on `MuiTextField` reaches it at all. The visible outcome is the
same — medium is also the picker's own default, so the field stood a size step
taller than the small selects beside it — which is exactly what makes it worth
writing down, because the fix a reader would reach for first is editing the
theme, and that would do nothing. Both `size` and `fullWidth` are stated at the
component.

**Guarding on the picker's validity alone silently broke keyboard entry.**
Typing a year fills the last section four times, so the field reports 12 March
in years 2, 20, 202 and 2026 — and the first three are perfectly good dates
that would each have gone into the address bar and taken eight report requests
with them. Refusing them is right; refusing them *against a field driven
straight off the stored string* is not, because Material UI resets the sections
when a change is refused, so the month and day already entered were wiped and
the date could never be finished. Fixed with a draft value held inside the
component and resynchronised **during render**, the same pattern as
`IncidentFilterBar`'s search box. Measured: four writes became one.

### The field format is stated, not inherited

dayjs's default locale renders `09/01/2026`, which is the first of September to
some readers and the ninth of January to others — sitting an inch from a
heading reading "Counted over Sep 1, 2026 – Sep 20, 2026", the same value
printed two ways, one of them unreadable. The fields use `DD MMM YYYY`.

Not `formatDate`'s exact output, which follows the reader's own locale and
cannot here: **a picker's format is also its input grammar**, and a field whose
section order changed with the browser would be a different control in
different hands. Unambiguous everywhere beats familiar somewhere. The cost is
paid once and is that sections fill day-first; digits still type.

### `Collapse`, and the transition budget that already existed

The two pickers are revealed by "Custom range…" through MUI `Collapse` rather
than appearing and disappearing abruptly. `test/renderWithProviders.tsx`
already zeroes every transition duration for jsdom — it exists because a
`Collapse` added in R5 made three tests flaky in a parallel run — so this
needed no new timeout and none was raised.

`unmountOnExit` is kept, and **not** for the reason it looks like: measured,
the accessibility tree is empty either way, because `Collapse` hides a closed
child with `visibility: hidden`. What it actually buys is that a half-typed
draft is discarded when the range closes.

### What it cost, measured rather than estimated

Built at `b45e7b6` in a throwaway worktree and again on this branch:

```
                        raw          gzipped
before   index-*.js   1,318.21 kB    407.81 kB
after    index-*.js   1,482.30 kB    457.14 kB
delta                  +164.09 kB     +49.33 kB
```

That is `@mui/x-date-pickers` plus dayjs, and it is the whole of the phase's
JavaScript growth to that point. The >500 kB chunk warning was already there
and still is.

**A correction while measuring:** `CLAUDE.md` records "994 kB raw against 309 kB
gzipped" beside the CloudFront compression note. That figure is from D37 and
predates R5 and R6; the baseline before this phase is 1,318 kB / 408 kB. The
compression decision it supports is unaffected — the ratio is the same — but
the numbers in that sentence are stale by about a third, and **only the owner
should edit `CLAUDE.md`**, so it is recorded here instead.

### Not done, and flagged rather than hidden

**jsdom renders the *mobile* picker, always.** `test/viewport.ts`'s
`matchMedia` stub understands `min-width` and `max-width` and nothing else, so
`@media (pointer: fine)` is false and `DatePicker` resolves to
`MobileDatePicker` — a modal, where a desktop browser gets an inline popper.
The value contract is shared, so the unit tests are testing the right rule, but
no test covers the desktop popper's appearance or placement. Closed by eye
instead, in Chromium at 1440px and 375px: the popper anchors under its field,
picks up the theme's brown for the selected day, and does not collide with the
filter row. Fixing the stub is a real improvement and a change to a file every
test in the suite depends on, which is not a thing to do in the tail of a UI
phase.

## D61 — Three more clickable rows, and the rule moved out of the first one

**§B of the phase brief.** Two mechanisms already existed and each was chosen
for a written reason: the stretched link of
[D55](#d55--a-whole-card-that-opens-a-ticket-with-buttons-that-still-do-their-own-job)
for cards, and a row click handler with the reference left as a real link for
tables ([D58](#d58--section-5-the-per-persona-screens-and-one-backend-flag) §5.5).
No third was invented and neither was swapped, which leaves the interesting
part elsewhere.

| Surface | Mechanism | Because |
| --- | --- | --- |
| `IncidentTable` | row `onClick` | a `<table>` |
| `EngineerRoster` | row `onClick` | a `<table>` |
| `EngineerWorkloadTable` | row `onClick` | a `<table>` |
| `NeedsAttentionPanel` | stretched link | flex rows inside a card |

### The rule is in `components/rowNavigation.ts`, and it is a hook

`openRow` lived as a closure inside `IncidentTable` with a twenty-line comment
above it. Two more tables wanted it, and three copies of one decision is the
thing this project treats as a defect rather than a style preference.

**A hook, not an exported `shouldIgnoreRowClick` predicate.** What is being
kept in one place is not only *which clicks to decline* but *that a row click
navigates at all*; handing out the exceptions and leaving `void navigate(…)` at
three call sites is half a decision in three files, free to drift from the
other half. Only the hook is exported, so no call site can take the predicate
and hand-roll the rest.

**The reasoning moved with it**, rather than staying behind in the file that no
longer owns the rule. Worth saying because the opposite mistake was made last
phase — two helpers inserted between a docstring and the function it described,
type-checking and linting clean while documenting the wrong thing.

**Something learned by deleting the guards one at a time**, and now written in
the module: the `defaultPrevented` check and the interactive-selector check
**overlap on anchors and nowhere else**. React Router's `Link` calls
`preventDefault` before navigating, so a link is held by either guard alone,
while a `<button>` prevents nothing and is held only by the selector. Delete
`defaultPrevented` on its own and every test still passes — which is exactly
how it could be removed in good faith as redundant, and it is not.

### What went, and what replaced it

**The roster's Edit button.** Every field it opened has lived on the engineer's
own page since §6.1, so it was a second route to one mutation through a modal
that could show none of the context the page shows. The row opens the page
instead; Deactivate keeps its own job, because the selector guard declines a
click that lands on a button.

**`EngineerDialog` became create-only.** Removing the button made its whole
edit half unreachable: `engineer` was null at the one remaining call site, so
every `engineer ? … : …` branch, the availability field and the `onUpdate` prop
were dead — and the call site had to satisfy that required prop with a resolved
promise for a path nothing could reach. Deleted rather than commented, which is
also what D59 says the dialog is for: you fill it in once, you get a temporary
password, you are done.

**`EngineerWorkloadTable`'s docstring was describing the wrong thing.** Its last
paragraph still said "every engineer's name links to their live queue", which
§6.1 reversed. Rewritten to the behaviour it now has.

### The attention panel, and the one piece of `clickableCard` that was not taken

`AttentionRow` takes the stretched link: the **reference** is the one real
anchor and grows over the row, `RowActions` is lifted above the overlay. The
reference and not the title, because `TicketTitle`'s own rule is that a title
is always ink — what is clickable is the reference, or the row.

`position: relative` is written inline rather than pulled in with
`clickableCard`, and the comment says so, so it does not read as forgotten. The
rest of that bundle is card chrome: its hover rule moves a *card's* border, and
the only border a row has is the divider it shares with the row below; and its
`:has(a:hover)` rule suppresses the link underline, which here is the one hover
affordance a row inside a card has to say it is a target.

**Assign is bigger and vertically centred on desktop only.** On a phone
`RowActions` already gives every button the row's full width and stacks them
(§4.5), where a larger button is no easier to hit and centring a full-width
button means nothing. Both are conditioned on `useBreakpoint`.

### What the tests can and cannot prove, and what closed the gap

**jsdom cannot test the stretched link.** There is no layout and no hit
testing, so an overlay with no geometry is never what a click meets: clicking
the middle of a row and watching it navigate would be a test that can neither
pass nor fail honestly. The three pieces are asserted directly instead —
including `position: relative; z-index: 1` on the actions, which is D55's "worth
a test rather than a comment" and is the *only* way to catch it, because a
jsdom click succeeds whatever the z-index says.

So it was closed in Chromium instead, and the first attempt **reported a
failure that was not there**: the click missed because `page.mouse.click` takes
viewport coordinates and the panel was two thousand pixels down the page, so it
landed on nothing. Scrolled into view and re-measured with
`document.elementFromPoint`, the overlay is what sits at every probe, and a
click at 35%/72% of the row opens the ticket at 1440px and at 375px. On the
phone one probe returns the Assign button rather than the link — which is the
arrangement working, not failing, and is why the second point was needed to
tell the two apart.

Recorded because the shape recurs: **a negative result from a harness is a
claim about the harness until it is checked.**

### What it costs

Text in an attention row can no longer be selected by dragging — the stated
trade of the pattern, and these rows quote an escalation reason, which is more
quotable than a ticket card. Accepted, documented at the component, and worth
the owner's eyes.

A deactivated engineer's Actions cell is now empty rather than holding Edit.
The column only renders when a screen supplies actions, so it is a blank cell
and not a missing column.

## D62 — Two filter hooks in one address bar, and who owns which parameter

**Found by building §D4**, which puts a ticket list inside the engineer page.
That screen is the first to run `useDashboardFilters` and `useIncidentFilters`
at the same time, and both of them wrote the query string the same way: build a
**fresh** `URLSearchParams` from this hook's own view of the world and hand it
to `setSearchParams`.

That is correct on every screen built before now, because on every one of them
exactly one hook was writing. Put both on one screen and the last writer wins
outright — changing the date range dropped the list's status filter, and
changing the status filter reset the period to the default and moved every
figure on the page. Neither hook would look wrong on its own, which is why this
is recorded rather than quietly patched.

**Chosen: each hook declares the parameters it owns, and carries the rest
across untouched.** `OWNED_PARAMS` in each file, deleted from a copy of the
current query string before that hook writes its own values back.

**Stated as an owned set rather than as "merge what changed", and that is the
whole decision.** A merge looks simpler and cannot work: clearing a filter has
to *remove* its parameter, and a merge has no way to tell "the reader cleared
this" from "this belongs to somebody else". Both are absent from the hook's
view. The owned list is what makes the difference expressible.

**`building_id` and `group_id` are in both lists deliberately.** On the one
screen that runs both hooks they are the same filter asked twice, and a reader
who narrows the page to SFO-1 means it for the charts and for the table
underneath them. Anything else would put two Building controls on one screen
disagreeing with each other.

**`reset()` is the case that would have been missed.** The ticket list's Clear
button called `setSearchParams(new URLSearchParams())`, so on the engineer page
it would have reset that screen's period as well — a button under a table
silently changing the charts above it. It clears its own parameters now and
nothing else.

**What it costs.** Two lists that have to stay in step with the parameters each
hook reads. A parameter added to one and forgotten in the other is silently
dropped on the next write, which is the same class of fault this entry exists
to fix, one level down. Each list carries a pointer to the other, and both are
directly beneath the hook whose parameters they name.

**Tests.** Five, across
`features/dashboard/useDashboardFilters.test.ts` and
`features/incidents/useIncidentFilters.test.tsx`, each asserting both halves —
that the foreign parameter survives *and* that the hook's own one still
clears. **Verified by reversion**, per the standing lesson of
[D24](#d24--a-heading-is-not-a-signal-that-the-data-arrived) and
[D25](#d25--a-test-that-reported-a-permission-was-enforced-without-checking-it):
with `keepForeignParams` replaced by `new URLSearchParams()` all five fail, the
dashboard pair reading `expected null to be 'OPEN'` and `expected null to be
'4'`, the ticket-list trio `expected null to be '90d'`.

**Reversible.** Yes, in two lines — one per hook.

## D63 — Two filters that already existed, given controls, and the one that was lying

**§C of the phase brief.** A reported-between range for everybody, and an
engineer filter for admins and leads.

Neither is a new *filter*. `createdFrom`, `createdTo` and `assigneeId` have
been in `IncidentFilters` since M7, because the dashboard links into this list
and a link is only honest if the list it opens is the set of tickets the tile
counted. What they had was no control — M7 judged that four more controls for
everyone was a high price for a case that only ever arrives by link, and gave
them removable chips instead. R7 revisits that for two of the three.

### The conversion, and where it lives

The two ends are stored as **full ISO instants** and picked as **calendar
days**, and those are not the same thing. The instants are not decoration: the
same parameters carry a dashboard window computed to the second, so the
conversion has to leave an end the reader did not touch *character for
character* intact rather than rounding it to a midnight. `DateRangeFields`
reports only the end that moved, which is what makes that possible, and there
is a test for exactly it.

The helpers went into `display/time.ts` — `startOfDayInstant`,
`endOfDayInstant`, `calendarDayOf` — and the reason is stronger than "it is the
date module". `startOfDayInstant` *is* `parseCalendarDay` plus `toISOString`,
so writing it there keeps the rule those three depend on — **a calendar day
means local midnight, not UTC midnight** — in the one place that already owns
it. `calendarDayOf` reads the **local** day for the same reason: `.slice(0, 10)`
on an ISO string reads the UTC day, so a filter widened to a local day that
began at 07:00 UTC comes back as the day before east of Greenwich and the
picker shows a date nobody chose.

`useDashboardFilters` had two private functions of the same shape, written
before that module had these. They are gone; it calls the shared ones and
keeps only its own guard, because deciding that a URL contains something that
is not a date is a question about the query being built rather than about
arithmetic.

### The engineer control, and a correction to the brief

The phase brief said `GET /incidents?assignee_id=` answers an employee with
403. **It does not.** Checked against the running API with two accounts:

```
employee  GET /incidents?assignee_id=<engineer>   200  + a filtered list
employee  GET /incidents?created_from=…           200
employee  GET /engineers                          403  ROLE_NOT_PERMITTED
junior    GET /engineers                          200
```

That is not an oversight in the API — `app/routers/incidents.py` says in its
first line that every signed-in user may read every ticket, because the brief
wants an employee to be able to check whether a problem is already reported.

So the honest framing, and the one the code carries: **the roster is the
privileged thing, not the filter.** An employee is not shown the control
because they could never fill it in — the list of engineers is what they may
not have — and hiding it spares them a 403 they can do nothing about. A JUNIOR
or SENIOR engineer *can* read the roster, so their exclusion is not a
permission at all: it is the same line the Team page draws about who
distributes work. Both halves are in `mayFilterByEngineer`'s docstring, because
a comment saying "the API enforces this" would have been false.

The roster request is `enabled`-gated on the same predicate, so a reader
without the control never issues it, and it asks for the same 100 rows as the
Team page and the assign dialog so all three share one cache entry.

### The chips rule, generalised

`AppliedFilterChips` existed *because* three filters had no control. Two of
them now have one, so the rule is stated once and applies to all three:

> **A chip is drawn only for a filter this reader has no control for, and never
> beside a control showing the same value.**

The date chip is gone outright. The assignee chip survives for everyone the
engineer control is not drawn for — the employee following a dashboard link
being exactly the case it was written for. The subcategory still has no control
anywhere, so its chip is unconditional. The bar computes the rule once and
passes it down as a boolean rather than letting the chips re-derive it: a chip
and a control disagreeing about one filter is the failure mode, and two copies
of the predicate is how you get there.

### The filter that lied, which is the part nobody asked for

`toQuery` applies a screen's preset **after** the reader's filters, deliberately
— My queue narrowed to somebody else's tickets is not My queue. The
consequence, once an engineer control exists, is that on `/unassigned`
(`assignee_id: 'unassigned'`) and `/queue` (`mine: 'assigned'`, which
`services/incident_service.py` resolves by *overwriting* `assignee_id` with the
caller's own id) the control moved, the address bar moved, and the list did
not. A LEAD meets that on two of their three ticket screens.

`IncidentFilterBar` now takes the screen's `preset` and leaves out the controls
it fixes. **A reading of the preset rather than a list of screens**, so a fifth
list added next year gets the right bar without anybody remembering the file —
and the engineer page's embedded list already got it without being thought
about.

**The inert Status control on `/unassigned` predates R7** and is fixed by the
same reading. Keeping one lying control beside a fixed one would have been
harder to explain than either, and the mechanism costs nothing once it exists.

The chips follow: a screen that fixes the assignee draws neither the control
nor a chip offering to remove it, because those are the same lie twice.

### What is still open

**Nothing hides a filter that is inert for a reason the preset does not
express.** This fix reads `status`, `assignee_id` and `mine`; a preset that
pinned something else would need a line here. Stated rather than generalised,
because three is the whole set today and a framework for one more would be
harder to read than the line it saved.

## D64 — Table density, set once, and the five screens it reached

**§E of the phase brief:** tables are cramped, the ticket tables worst.

Material UI's dense cell is `6px 16px`, and **every table in this application
is `size="small"`** — the ticket list, the engineer roster (which the Engineers
and Team screens share), the users page's sectioned table, the facilities
floor's places, and the dashboard's workload, blocked-by-reason, flow and
breakdown tables. At 6px a ticket row carrying two chips is 24px of chip in a
37px row, which reads as a wall rather than as a list of things.

**One `MuiTableCell` default in `theme.ts`, not eight `sx` props.** CLAUDE.md
says anything global belongs in the theme, and the reason bites here: a
per-table `sx` is the version of this change that can be half-applied, and the
two tables somebody forgets are the two that look broken next to the six that
do not. `spacing(1.25)`, so it is 10px in the theme's units rather than a
literal.

The cost is the other side of the same coin — it lands on five screens at once,
three of which nobody asked about — so all of them were measured and looked at,
at 1440px and 375px:

| Screen | Table | Row height |
| --- | --- | --- |
| Tickets | `IncidentTable` | 37 → **45px** (desktop only; a phone gets `IncidentCardList`) |
| Engineers, Team | `EngineerRoster` | 55 → **63–73px** |
| Users | sectioned table | 53 → **61px** data rows |
| Facilities | places on a floor | 44 → **52px** |
| Dashboard | workload | 43 → **51px** |

**Vertical padding only.** The horizontal padding sets a table's column rhythm,
and `IncidentTable`'s fixed `COLUMN_WIDTHS` are measured against it; widening
it would push Assignee and Updated off a 1440px screen, which is the exact
defect that file's comment records having fixed once already.

**The same height on a phone, and that was not the obvious answer.** More row
height at 375px is more scrolling, so the brief was right to flag it. What
settles it is *which* tables survive to a phone: the ticket list is not one of
them, and the ones that are — the roster, the users page — are the ones whose
cells **wrap**. A roster row is a name over an email over a column of
specialty chips, and cramped horizontal rules between wrapped blocks is where
the old density read worst rather than best. Looked at: the roster at 375px is
the screen the change helps most.

**One thing deliberately left alone.** The users page's section header cell
(`FACILITY ADMINS · 1`) carries its own `py: 1`, so it is now 8px against the
data rows' 10px where it used to be 8 against 6 — a band that was slightly
taller than its rows is now slightly tighter. Checked on screen: it reads as a
tinted band rather than as a row, which is what the background and the
`overline` type are doing, and the relative heights are not what carries it.
Adding an override to restore the old order would be styling one table from
two places to fix something nobody can see.

## D65 — Section F: the mark replaces the word, and the PNG is not the file we were given

**The owner** attached two versions of the ACME mark — black lettering on
white, white lettering on brown — for the navbar and the login page, "each
using whichever version has contrast against its background", with one
constraint: **crop freely, but do not crop out the red peak.**

### The crop, and why the supplied files could not be used as they are

Both files are 1254×1254 with the mark floating in the middle. Trimmed to
content they are 731×281 and 734×283 — the same mark, 2.6:1, the peak sitting
above the wordmark. Nothing needed to come off to fit a toolbar, so the peak
was never in danger: at 2.6:1 a 40px-tall mark is about 104px wide, which is
less room than the words "ACME Facilities" took.

What did need doing is the background. The navbar is `primary.main` `#73362a`
and the page behind the login card is `background.default` `#f0eada`; both
supplied files carry an opaque rectangle of their own. The brown one's
background samples at `srgb(115,56,44)` against the theme's `(115,54,42)` —
two levels per channel, invisible — so **recolouring its rectangle to the
theme's exact brown** was a real option and the simplest one. Rejected: it
makes the asset depend on a palette token by coincidence rather than by
reference, and the day somebody adjusts the brown the logo grows a visible
box. The failure is silent and nobody would look for it in an image.

**Chosen: transparency, extracted differently for each file**, because the two
are different problems.

- **Dark mark** (content on white): alpha is the distance of the *darkest*
  channel from white, stretched so the red peak reaches full opacity rather
  than the 89% its own green channel would imply. Anti-aliasing survives, and
  the mark composites correctly on any light surface.
- **Light mark** (content on brown): the same arithmetic does not work, because
  white lettering and a red peak sit at very different distances from the
  background and one normalisation cannot serve both — the peak came out at
  57% opacity. So the flat background is keyed out and **the anti-aliased
  fringe keeps its brown**. On the surface this version is used on that fringe
  is invisible; anywhere else it would show as a faint halo, which is a real
  limitation and the reason the two files are not interchangeable.

Both were then quantised to 64 colours: 101 kB → 14 kB and 52 kB → 10 kB, with
no visible difference at any size either is drawn at. They are 720px wide,
which is 2× the largest surface (the login mark at ~104px, so 2× covers a
retina screen with room over).

### The accessible name is the decision, not a detail

In the app bar the image is the *whole* of a link to home. Its `alt` therefore
**is** the link's accessible name: `alt=""` leaves a screen reader announcing
"link" followed by nothing, and "ACME logo" describes the artwork rather than
the destination. It stays `ACME Facilities`, which is what it always was —
`AppShell.test.tsx` and two end-to-end specs find home by that exact name, and
the fact that they still pass unchanged is the evidence the name still
resolves.

On the signed-out screens the mark replaces an `overline` reading the same
words rather than joining it, so the company is named once. It is content
there and not decoration: nothing else on those screens says whose application
this is, and the heading beneath it says "Sign in".

### What moved that nobody asked to move

`fonts.ts` named weight 700 as "the `overline` on the signed-out screens".
That `sx={{ fontWeight: 700 }}` was the only explicit 700 in `src/`, and the
mark removed it. The weight is still asked for — it is
`typography.fontWeightBold`, which every `<strong>` resolves to and which
`theme.test.ts` pins — so the import stays and the sentence was corrected.
Left alone it would have been a comment that is wrong in a file whose entire
purpose is explaining which weights exist and why.

### What to look at rather than take on trust

The lettering is a hairline, and on the brown bar at 28–40px it reads as a
light warm grey rather than white. That is the asset, not the rendering, and a
logotype is exempt from the contrast rules that govern text — but it is dimmer
than the bell and the menu button beside it, and if the owner wants it louder
the answer is a different source file, not a CSS filter.

## D66 — The engineer page rearranged, and a pie that had no colours

**§D of the phase brief**, which is a layout rebuild rather than four edits, so
it went to one worker whole.

### The split, and what replaced the sentence that was carrying it

The page was one stacked column: header, settings, filter bar, "What they got
through", then the live queue at the bottom. It is now two halves side by side
above the divider — settings on the left, the capacity bar and the live queue
on the right — with the period controls moved down beside the heading they
actually scope.

That move is what created the problem worth recording. **The date range applies
to the figures and never to what the engineer is holding right now** — D9's
rule, and both halves of this page depend on it. The only thing making that
boundary visible was the caption under the filter bar reading "Counted over
24 Aug – 23 Sep 2026", and putting the control an inch from the heading makes
that sentence a second statement of what the control already says.

**Replaced with the dashboard's own pattern from D14**: a short scope label
over each half — **"Right now"** above the capacity bar and the live queue,
**"Over the selected period"** above the tiles and the chart. Same two tenses,
same two icons, three words instead of a sentence, and each one sits *on* the
thing it is about rather than in a line above everything.

`ScopeLabel` deliberately **names no dates**. D14 and D24 are firm that a
period may only be stated from the response's own `window`, and this component
has none. "Over the selected period" claims only that whatever the control says
was applied, which is true by construction.

**The admin dashboard is protected by the default, not by care.**
`datesShownElsewhere` is false unless asked, because the dashboard has nothing
else on it that names the window — its filter bar says "Last 30 days", which is
a control and not a claim — and removing that sentence there would undo D9 and
D14 on the screen they were raised about. Two tests hold it: one on
`ScopeHeading` directly and one through `AdminDashboardPage` against a real
response. A test on only the engineer page would have passed with the caption
deleted for everybody, which was verified by deleting it.

**What this costs, and it is a real cost:** the engineer page no longer states
the server's echoed window anywhere. The only statement of the period is the
picker, which is a control. Nothing lies — `ScopeLabel` is dateless on purpose
— but it is a step back from the D14 discipline, and flipping one flag restores
the sentence if the owner disagrees.

### The ticket table is `IncidentsPage`, with one prop

`embedded`, defaulting to false, and it changes exactly one thing: the screen
renders an `h2` and its description instead of `PageHeader`. Everything else —
the filter bar, the table/card switch, the paging, the empty state — is
untouched, which is the entire reason to reuse the component rather than build
a second ticket table.

A boolean rather than a heading level, because `PageHeader` renders an `h1` **by
construction** — that is its stated job — so an embedded list must not use it
at all; and because every page here nests sections exactly one deep.

**Two `h1`s would not have been caught by the accessibility suite.**
`e2e/accessibility.spec.ts` filters to `wcag2a`/`wcag2aa`, and the only rule
that speaks to this, `page-has-heading-one`, is `best-practice` and fires on
*none* rather than on two — and that spec does not visit `/engineers/:userId`
at all. Worth writing down: this is the fourth time in this project that a
passing axe run has said nothing about a real defect.

What the section looks like as a result is a second complete filter apparatus
on a page that already has one. That is the trade the brief chose, and the
Building select now appears twice on one screen driving the same `building_id`
— which is coherent (D62 put both hooks on that one parameter deliberately) and
is still two controls for one value.

### The pie had no colours, and that is what looking at the screen found

`BreakdownChart` takes a `shape` prop, so "make it a pie" is one word. The
result was **eight identically-coloured wedges beside a legend of eight
identically-coloured dots** — a ring that carried nothing the legend did not
already say, and in which "which slice is Plumbing" had no answer.

It was not a mistake in the call. D57 caps a categorical pie at **three**
validated slice colours, `chartPalette.ts` names "category group" as a
one-colour-many-categories case, and the worker correctly refused both wrong
ways out: cycling the three would repaint two categories the same colour, which
is the one thing a pie must never do, and quietly swapping in bars would have
been a substitution rather than a report. Passing no colour is what the palette
permits, and `BreakdownChart` then paints every slice `SERIES_PRIMARY` —
correct for a bar, where the *length* carries the magnitude, and useless for a
pie.

**Chosen: the remedy D57 already named**, made into a function.
`foldToCategoricalSlices` keeps the top three in the validated order and folds
everything past them into one neutral — the same validated grey D57 reasons
about, where a neutral beside three coloured slices is distinguishable
*because* it is neutral. This is not re-litigating the shape: the entry
anticipated exactly this case and wrote down what to do about a fourth
category. Bars were the alternative it also offers, and the brief asked for a
pie.

Three consequences worth stating:

- **The fold reaches the chart and stops there.** The table twin one button
  away still lists all eight with their links, which is where a reader goes for
  values and is the relief case the neutral's contrast leans on. Folding both
  would lose five links to save three colours. Both halves are asserted, because
  the first on its own would pass against a chart that had silently dropped
  five categories.
- **Colour follows rank here, not identity**, which is a departure from the rule
  the bars follow. It is unavoidable once a cap exists — which categories are
  *inside* the cap is itself a fact about the data — and it is worth knowing
  before comparing two screenshots of this chart.
- **A folded slice has no link.** No list is "these five groups"; `GET
  /incidents` filters one group at a time. D14 §3 settled that a wrong link is
  worse than none, so `BreakdownDatum.href` is optional and the slice does not
  navigate.

**A latent defect this turned up.** The admin dashboard's building pie was
handing out `CATEGORICAL_SLICES[index % 3]` under a comment saying it was
capped at three, which the `%` made untrue: a fourth building would have been
painted the same blue as the first. The demo world has exactly three, so
nothing would ever have shown it. That call site now passes no colours and
folds like any other categorical pie, which makes its comment true.

### Smaller calls, recorded because they were not asked for

- **`StatTileGrid` gained `stack`.** Confirmed rather than assumed that it could
  not already: it is `repeat(auto-fit, minmax(190px, 1fr))` and a 440px column
  fits two. `minWidth` cannot express "never more than one" — it is a floor, and
  any value large enough to force one column also claims a tile may never be
  narrower, which is false on a phone.
- **`DashboardFilterBar`'s `note` accepts `false`**, which `null` and
  `undefined` cannot: both fall through to the default, and that is right for a
  caller that simply did not pass one. It renders nothing rather than an empty
  `Typography`, whose margin left eight pixels of unexplained gap.
- **"See all N assigned" became a sentence**, because that link now sends a
  reader off-page to reach a table 400px below them.
- **The availability word moved** out of the page header and into the "Right
  now" column beside the capacity bar, it being a right-now fact.

## D67 — S4 part 1: suggesting the ticket somebody is about to duplicate

**Why this stretch item and not another.** The brief's own problem statement
names **duplicate tickets** as something this system exists to reduce. Of what
was left in `BUILD-PLAN.md` §15, this is the one that answers a stated business
problem rather than adding a capability nobody asked for.

**The timing is the feature.** `ReportPage` reveals its five questions
progressively and asks for **subcategory and location before it asks for a
title**. So once somebody has chosen "Temperature/HVAC" and "Level 3" there is
already enough to query — before they have typed a word, and before they have
invested effort worth abandoning. A duplicate check that arrives at the submit
button is a check that arrives too late to be taken.

### No new search machinery

`GET /incidents` already filters on `category_id`, `building_id`, `floor_id`,
`seat_id` and status, and `repositories/incidents.py` is where that lives. The
new endpoint reuses it and the same visibility statement. `search_vector` is
GIN-indexed and was deliberately left out: subcategory plus location is a
stronger signal than words a reporter has not typed yet.

### Specificity and recency are two ORDER BY terms, never one score

```sql
ORDER BY  CASE WHEN seat_id  = :seat  THEN 0
               WHEN floor_id = :floor THEN 1
               ELSE 2 END        ASC,    -- specificity: absolute
          <recency>              DESC    -- breaks ties inside a band only
```

Collapsed into one blended score, a week-old exact-seat match loses to
something vague from this morning — and "someone reported this exact desk an
hour ago" and "something of this kind happened in this building last week" are
different claims. A reader has to be able to tell which one they are looking
at, so the band is **selected as well as sorted on**: the integer the rows are
ordered by and the `match` word the response carries are the same fact read
twice, indexed into `SUGGESTION_SPECIFICITY`. Reorder that tuple and both move
together.

Recency differs by list and the difference is the point: `created_at` for a
live ticket, because for unfinished work *when it was reported* is the only
date that says anything about whether it is the same event; `resolved_at` for a
finished one, because there the useful date is when it was fixed.

### `match` describes the overlap, not the precision of either side

A request with no `seat_id` can never produce a SEAT match **even when the
candidate ticket has a seat**. That candidate is banded FLOOR, because the
strongest true thing you can say to that reporter is "somebody reported this on
your floor" — telling them "somebody reported this exact desk" about a desk
they never mentioned would be a claim about a comparison that did not happen.
A location the caller did not give becomes `WHEN false` in the CASE, so the
query says literally what the docstring says.

### Three smaller calls

- **Floor and seat rank; only category and building filter.** Making them
  `WHERE` clauses is the mistake that empties the panel for the first person to
  report a fault at their own desk.
- **The exact subcategory, not its group.** Wi-Fi and VPN are both Network &
  Access and are not the same problem. A panel that confused them would teach
  reporters to ignore it, which costs more than it saves.
- **A resolved row must have a `resolution_summary`**, enforced in the `WHERE`
  rather than filtered out afterwards — otherwise `limit` would mean a
  different number of rows each time. A resolved ticket with nothing written on
  it is a link to a dead end.

### The resolution summary is the second half of the feature

Surfacing it exposes nothing new — it is already un-gated on the incident read
schema — and it turns the panel from "you may be duplicating this" into
self-service: *"Replaced the failed unit and tested it with the reporter."* is
institutional memory written by a human about that actual equipment, which
beats generic troubleshooting because it is specific and true.

### It must never block the report

The panel is advisory and says so in its own words: *"If none of them is yours,
carry straight on — nothing here stops you reporting."* No disabled button, no
confirmation step, nothing hidden while it loads. **A false positive that stops
a real report is far worse than a duplicate**, and a panel that can be read as
an obstacle will be routed around by people who then stop reporting at all. Two
of the frontend's deliberate-break tests exist for exactly this: one puts a
modal in the way, one hides the panel once typing starts, and both fail.

### Unknown ids return an empty answer, not an error

This fires while somebody is still filling a form, where an error has nowhere
to be shown and nothing for the reader to do about it. `POST /incidents`
validates the same ids for real. The route is also declared **before**
`/{incident_id}`, with a test pinning it, because the symptom of getting that
wrong is an obscure `uuid_parsing … found 's' at 1`.

## D68 — S4 part 2: "I'm affected too", and the audience more than one person holds

A watcher is somebody who said a problem affects them too, and is told when it
is **resolved**. `incident_watchers` per `BUILD-PLAN.md` §3, keyed on the pair
`(incident_id, user_id)` so "one person follows one ticket at most once" is the
only shape the table can hold, with `ON CONFLICT DO NOTHING` closing the window
a double-clicked button would land in.

### The flag, and why `location_detail` could not have been it

**The owner's rule:** subscribing only makes sense for problems that affect
other people. The field that looks as though it already answers that does not,
and the two counter-examples are the whole point — **Software is BUILDING-level
and an operating-system fault is one person's alone; Hardware is FLOOR-level
and a printer is shared while a keyboard is not.** How precisely a group needs
a location and how shared its problems are is simply not the same question.

So `categories.allows_watchers`, per subcategory, admin-editable, seeded from
the owner's list of 17. **The mapping is keyed on `(group, subcategory)` and
had to be:** six subcategories are literally named "Other", and the list marks
Meeting Rooms "Other" and Building & Facilities "Other" shared while Network &
Access "Other" is not. `CategoryGroupSeed` gained a `shared_subcategories`
field, which makes the key right by construction — the version keyed on the
name alone cannot be written by accident. A deliberate-break test keyed it on
the name and failed on exactly that pair.

**Everything not on the list is personal, including all fourteen subcategories
of the three groups R6 added.** The owner's list does not name them, and the
arguable cases default to personal on purpose: *it is better that somebody
files a duplicate than that a stranger subscribes to a problem with their
laptop.* Worth flagging to the owner as a one-line admin toggle each, not as
something to re-decide here.

**Re-seeding does not overwrite an admin's edit.** `migrate` runs
`seed_categories` on every deploy, so a seed that wrote this flag onto existing
rows would silently revert an administrator's decision every time the
application shipped — and this is precisely the field an admin curates, since
the default is personal and the arguable cases are meant to be argued. The
initial values are applied **once, by revision `0006`'s backfill**, at the
moment the column came into being: it overwrites nothing by construction,
because nobody could have had an opinion about a column that did not exist four
statements earlier. The mapping is spelled out in the revision rather than
imported, for the reason `0005` gives about `NotificationType` — a revision
that reads a live constant is not frozen — and a test asserts the two copies
are still equal.

### One audience, many people

WATCHER is the first capacity more than one person can hold at once, and
`app/notifications.py` was built on `user_in_capacity(audience, incident) ->
uuid | None`. The change is a **tuple-valued lookup table**, `CAPACITY_HOLDERS`:
every audience is now read as a tuple of user ids, and REPORTER and ASSIGNEE
are simply the ones that always answer with nought or one. `plan()` loops.

Doing it there is what keeps the module's two universal rules true for watchers
without a word about watchers being written in either: a watcher who resolved
the ticket themselves is dropped by the actor check, and a watcher listed twice
by `already_told` — the same two lines that have always been there.

**Rejected:** a `watchers` field on `NotificationRule` beside `messages`, and a
`plan_for_watchers()` beside `plan()`. Each would have given "nobody is
notified about their own action" two implementations, and the second one is the
one that gets forgotten.

**The module still touches no database.** `_the_watchers` reads
`incident.watchers`, an attribute exactly like `incident.reporter_id`, eager-
loaded by `_detail_loaders()`. The property that was ever claimed is that this
module issues no query, not that the incident arrives half-built — and that is
what keeps the whole policy testable without a session.

### A rule that does not always fire, and a bug a test caught

The trigger is a status change; the audience cares about one destination
status. `applies` — the precondition `NOTE_ADDED` already uses — is the
mechanism, applied as **a second rule**, `WATCHED_RESOLVED`. It has to be a
second rule rather than a third audience on `STATUS_CHANGED`, because `applies`
gates a whole row: putting the condition there would have silenced the reporter
and the assignee on every move that is not a resolution. CLOSED is excluded —
the watcher already heard the thing they were waiting for, and including it
would mean two notifications per repair.

Which surfaced the bug worth recording. **`already_told` spans one `plan()`
call, and a resolution now calls it twice.** A reporter who had also pressed "I'm
affected too" on their own ticket got both sentences. The fix is in
`_the_watchers`, which excludes anybody who is already the reporter or the
assignee — a statement about *what the WATCHER audience means* (the people
following a ticket who would not otherwise hear about it), which `plan()` could
not make because it cannot see which other rules fired on the same moment.

`watcher_count` on the API is deliberately **not** that narrowed number: "four
people are affected" is a fact about the problem, not about who gets an email.

### The endpoints, and the one that is deliberately ungated

`POST`/`DELETE /incidents/{id}/watchers`, both returning `{watching,
watcher_count}` from `services/watchers.status_of` — one function, so the
button and the detail page cannot disagree. Subscribing is always the caller
subscribing themselves; there is no endpoint that subscribes anybody else,
which is what bounds a fan-out audience.

`POST` is refused **409 `WATCHERS_NOT_ALLOWED`** for a personal subcategory —
409 rather than 403 because nothing about the *caller* is wrong. **`DELETE` is
not gated at all**, deliberately: an admin who marks a subcategory personal
after people subscribed must not strand them.

`allows_watchers` is refused on a *group* (422 `SUBCATEGORY_ONLY_FIELD`), the
exact mirror of the existing `GROUP_ONLY_FIELDS` rule, because incidents are
filed against subcategories so a group's copy is never read.

### Where the frontend reads it, and the bug that moved

Two readers, and neither derives anything. The report questionnaire has no
ticket yet, so it looks the flag up in the cached category tree. **The ticket
page reads `incident.category.allows_watchers`**, which the API sends on every
ticket — and that is not convenience. `load_tree` excludes deactivated
categories, so a ticket filed against a subcategory an admin has since retired
is *not in the tree*, and a lookup would answer "no watchers" for a ticket
people are already following. Found by reading the two halves against each
other after both landed; the test that pins it makes the tree and the ticket
disagree on purpose, and fails if the page goes back to the tree.

### Not done

**Watcher counts feeding the hotspot report is S3 territory**, named in
`BUILD-PLAN.md` §15 and deliberately left alone. And the deployed demo will
show "0 others affected" everywhere until somebody presses the button, because
`seed_demo` refuses to run where data exists — the local demo world has 269
watchers, the cloud one has none.


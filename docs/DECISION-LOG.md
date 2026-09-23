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

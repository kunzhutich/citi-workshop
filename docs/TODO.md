# To do

Work that is **decided and not done**, as distinct from work that was considered
and rejected. Each item says what it is, why it was not built when it came up,
and where the full reasoning lives. The rationale is not repeated here — the
README's [Known limitations](../README.md#known-limitations) holds it, and this
file is the short list to pick from.

Nothing here is required for the submission. Everything below was working
software's next step, not a gap in it.

---

## 1. "Needs help" — an escalation chain between engineers

**§6.3 of the redesign brief, and the largest item in it.** A junior who cannot
resolve a ticket marks it as needing help; a senior picks it up; if the senior
cannot either, it goes to a lead.

Not built because the first question is a design one and the brief says so:
**is this a new `IncidentStatus`, or a flag beside the existing workflow?** A
status means new rows in `app/workflow.py` for every legal transition into and
out of it — and gets the notification rules and the frontend's button rendering
for free, because both are driven from the table. A flag is cheaper and is one
more rule living outside the table this project treats as the single source of
truth.

Settle these before writing code, and log the answers:

- Status or flag.
- Who is notified, and whether `app/notifications.py`'s four rules cover it.
- Does the original assignee keep the ticket, or does it transfer?
- How it relates to the **existing** escalation flag, which is reporter-facing.
  Two things called "escalate" meaning different things will confuse everyone.
- Every request for help should appear on the engineer's page (§6.1, built).

Read `docs/PROJECT-GUIDE.md` Part I §3 (the rule-to-file map) and the workflow
section first. Reasoning: [D59](DECISION-LOG.md#d59--section-6-an-engineer-is-a-page-and-the-demo-world-grew-to-fill-it).

## 2. Automatic BUSY at capacity

**§6.4.** `BUSY` is set only by the engineer's own toggle; nothing in the backend
ever sets it. `max_active_tickets` and `active_ticket_count` both exist and the
capacity bar already draws them.

Not built because it fuses two different kinds of fact: `BUSY` is the engineer's
statement about themselves, capacity is an observation the system makes. Decide
deliberately whether the observation should overrule the statement — and note
that an engineer at capacity then cannot say "I am fine, send it".

## 3. A `user_preferences` table for the dashboard arrangement

**§5.2 shipped against `localStorage`**, which was the owner's call and is the
right first version: it never expires, and it survives reloads and restarts.
What it does not do is cross a browser or a machine.

The work is a migration, a model, a schema, a repository, a service, a router
and the hooks to call it — one row per user, a JSON column. `dashboardLayout.ts`
is the only file that touches storage, deliberately, so the frontend side of
the move is one file. Reasoning: [D58](DECISION-LOG.md#d58--section-5-the-per-persona-screens-and-one-backend-flag).

## 4. Feedback and auto-close — what is left

**S7 shipped in two passes**: the rating itself
([D71](DECISION-LOG.md#d71--feedback-a-rating-belongs-to-a-repair-not-to-a-ticket)),
then the engineer's rating, the reviews page and auto-close
([D72](DECISION-LOG.md#d72--auto-close-with-no-scheduler-and-where-a-sweep-is-allowed-to-live)).
What is deliberately not done:

**Nothing says when a ticket will close itself.** `autoclose.next_deadline`
exists and nothing renders it. "Closes in three days" on a resolved ticket
would tell the reporter that doing nothing has a consequence, which is the
whole point of a deadline they cannot see today.

**Moderating a review.** There is no way to delete one and no admin override
on the fifteen-minute edit window, unlike notes. Settle the policy first — is
a deleted review still counted in the average? is the engineer told? — then it
is a `deleted_at` column, an exclusion in `apply_feedback_visibility` beside
the note one, a route, and a test that a deleted review leaves the timeline.

**Watchers cannot rate.** The table is keyed `(incident_id, resolution_round)`;
letting the people who said "I'm affected too" rate the repair means
`(incident_id, resolution_round, author_id)` and widening
`can_give_feedback`'s first line.

**Ratings reach no report but the engineer's own page.** Satisfaction by
category, by location, or against response time are each one aggregate in
`repositories/reports.py` — and "which problems leave people unhappy even when
we fix them" is a genuinely different answer from "which problems happen
most".

**The engineer reports still count `resolved_in_period` two ways across the
application.** `engineer_detail` moved to `resolved_by_id` in S7 part 2 because
its satisfaction ratio needed both halves to mean the same thing;
`engineer_workload` still counts by `assignee_id`, correctly, because it
answers "who is free right now". Worth knowing before adding a third report
that joins them.

---

## Before you finish a phase: rebuild the demo database

```sh
./bin/reset-demo-database.sh
```

Not optional housekeeping — **two things make the local demo world drift**, and
both are invisible until somebody looks at a chart:

1. **Playwright leaves its data behind on purpose.** It registers accounts and
   reports tickets through the real API, all stamped today. A few suite runs put
   a wall of today's tickets on the admin dashboard's daily chart, and every
   rate computed over the last thirty days starts measuring the test suite.
2. **The seed changes between phases.** `migrate` is idempotent and adds new
   *categories*; nothing backfills tickets that use them, or invents engineers
   added to the roster. A database that has only been migrated shows eight
   category groups in every dropdown and tickets in five of them.

`seed_demo` refuses to top up — it finds its own buildings, writes nothing and
says so, so that a second invoke cannot silently double a dataset. Drop,
migrate, seed is therefore the only path, which is what the script does.

It is **local only**. Aurora is `publicly_accessible = false` and unreachable
from here, which is the intended blast radius. The deployed database keeps the
world it was seeded with on 2026-09-23.

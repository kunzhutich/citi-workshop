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

## 4. Feedback, part 2 — autoclose, and ratings on the engineer's page

**S7 shipped the rating itself** (see
[D71](DECISION-LOG.md#d71--feedback-a-rating-belongs-to-a-repair-not-to-a-ticket)).
Three things were deliberately left for a second pass, and one of them has a
constraint worth knowing before you plan it.

**Autoclose a RESOLVED ticket after seven days of silence**, with the timer
reset by a public note. There is **no scheduler available**: the IAM boundary
grants no `events:*` and no `scheduler:*`, SQS's maximum message delay is
fifteen minutes, and Aurora sleeps at `min_capacity = 0`. So it has to be a
bounded sweep on a request path that already runs — `WHERE status = 'RESOLVED'
AND resolved_at < …` behind a partial index, which returns no rows almost
every time and writes only when there is something to close. That is the
pattern `app/repositories/login_attempts.py::purge_expired` already uses and
explains. Add `close_stale` to `app/services/ops.py` as well, so a demo can
force one.

`incident_events.actor_id` is already nullable, so a system-performed close
needs no invented "System" user — but `perform_transition` has no path that
resolves no human actor, and that is the one genuinely new mechanism. A
`CloseReason.SYSTEM_CLOSED` member would make "closed automatically" a fact in
the data rather than an inference from a null.

**Ratings on the engineer's page.** The visual shape is already argued: one
more `StatTile` in the existing grid (it takes `to`, so it can be a link),
with the response rate as its caption because an average without its `n` is a
lie; a clickable rating distribution below it built from `BreakdownChart`,
whose form language it already matches; and the individual reviews behind a
`?reviews=2` URL parameter opening a `ResponsiveDialog`, so the view is
linkable and the browser's back button closes it.

**An engineer may already open any other engineer's page** — the route and
`GET /reports/engineers/{id}` are both staff-wide. The owner's rule is that
engineers see each other's *scores* but not each other's *reviews*, so the
aggregate can go on the page as it stands and the reviews drawer needs the
admin/lead/self gate. `apply_feedback_visibility` already holds that rule for
the rows; the report that computes the average deliberately does not go
through it, because a number is not a review.

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

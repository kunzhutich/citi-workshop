# Build status

Where the autonomous build run has got to. **Updated after every verified step**,
so that a session resumed after a machine restart can reconstruct its position
from this file plus `git log`, without relying on conversation memory.

If you are a resumed session: read this, then `git log --oneline --all`, then
`docs/DECISION-LOG.md`. Trust git over this file if they disagree — commits are
written after the work, this file is written after the commit.

---

## Position

**Last updated:** 2026-09-23, M7 pass 2 complete (`seed_demo`), plus the D11 correction
**Current branch:** `m7-dashboards-demo-data`
**Phase in progress:** M7, pass 3 of 3. Passes 1 (report endpoints) and 2
(`seed_demo`) are done and committed; pass 3 is the three dashboard screens.

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

**M6 verified independently:** 609 backend tests, 211 frontend tests,
12 Playwright tests (2 deliberate viewport skips), ruff check + format clean,
eslint + tsc + vite build clean. The full ticket lifecycle completes through
the UI at both desktop and phone widths — M6's acceptance criterion.

**Blocked:** `git push` is refused by the permission classifier, so
`m6-persona-screens` is committed locally but NOT pushed. Everything else
continues; the owner needs to push, or grant the permission.

## Branch stack

Each phase branches off the one below. Nothing merges to `main` until the owner
reviews.

| Branch | Phase | State |
| --- | --- | --- |
| `main` | — | at the M5 merge (PR #5) |
| `m1-walking-skeleton` | M1 | merged to main (PR #1) |
| `m2-data-model-auth` | M2 | merged to main (PR #2) |
| `m3-facilities-categories-engineers` | M3 | merged to main (PR #3) |
| `m4-incidents-workflow` | M4 | merged to main (PR #4) |
| `m5-frontend-shell-auth` | M5 | merged to main (PR #5); branch deletable |
| `m6-persona-screens` | M6 | verified, committed, **not pushed** (blocked) |
| `m7-dashboards-demo-data` | M7 | in progress, branched off `m6`; passes 1 and 2 committed |
| `m8-docs-and-demo` | M8 minus deploy | not started |
| `s6-hardening` … | stretch | not started |

## Remaining plan

1. **M6** — verify when the other session finishes, commit, push.
2. **M7** — ~~report endpoints~~ (done), ~~`seed_demo`~~ (done), three dashboards. Branch off `m6`.
3. **M8 minus deploy** — README rewrite, architecture diagram, role/permission
   matrix, known limitations, demo script. Branch off `m7`. See decision D1.
4. **Stretch**, in order S6 → S1 → S3 → S2. See decision D2.

The AWS deploy is not part of this run: no credentials. Every step that needs
them is recorded in `docs/DEPLOYMENT-CHECKLIST.md`.

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
- `backend/v1/.env` (gitignored) sets `POSTGRES_NAME=acme_incidents_dev`.
- Run the API with `backend/v1/.venv/bin/uvicorn app.main:app --port 8000`, the
  UI with `npm run dev` in `frontend/` on :3000.
- Full backend suite takes roughly 5-6 minutes; run it in the background.
- M7's report tests need `make_incident(created_at=..., escalated_at=...,
  blocked_reason_type=...)` and `make_event(...)` in `tests/factories.py`; all
  four were added in pass 1 and are additive, so no existing test changed.
- `is_escalated` is cleared only by `clear_escalation`, never by closing a
  ticket, so any present-tense query over that flag needs a status filter too.
  See D10 and `_live_escalation_clauses()` in `app/repositories/reports.py`.

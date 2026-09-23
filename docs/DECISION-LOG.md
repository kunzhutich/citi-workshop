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

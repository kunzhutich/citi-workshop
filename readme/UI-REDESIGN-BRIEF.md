# UI redesign brief

Requested by the repo owner after using the built application. Everything here
comes from that use, so it outranks anything left in BUILD-PLAN's stretch track.

Grouped by **when to do it**, not by which screen it touches. Several items look
like separate requests and are the same shared component; doing them per-screen
would mean doing them three times and getting three answers.

---

## Order of work, and why

1. **Bugs.** Things that are wrong now. Cheapest to fix, and two of them affect
   every page.
2. **The theme.** Touches every screen, so it lands before per-screen work
   rather than after. **It invalidates two things already validated — see below.**
3. **Shared components.** Chips and the search field appear everywhere.
4. **Layout and mobile.**
5. **Per-persona screens.**
6. **New features.** The engineer detail page and the help chain, which need
   backend work.

---

## 1. Bugs

### 1.1 Horizontal scroll on every page in Chrome
The owner reports that in Chrome — but **not Firefox on the same machine** — every
page needs scrolling right to reach the drawer button (mobile) or the avatar
(desktop), at any width from 400 px to 1400 px.

This is a real overflow, not a browser quirk; Firefox is likely tolerating
something Chrome does not. Note the e2e suite has a test called *"no screen
scrolls sideways"* which passes, so start by working out why it passes while the
owner sees the opposite — the test may be measuring the wrong element or the
wrong browser.

**Fix the cause, not `overflow-x: hidden`.** Hiding it makes content
unreachable rather than reachable.

### 1.2 Ticket-list filters are lost on the way back
Apply filters on All Tickets → open a ticket → press back → the filters are gone.
They are supposed to live in the URL query string; BUILD-PLAN §10 says views are
bookmarkable, and M7 added `AppliedFilterChips` for visibility. Something is
dropping them on the return journey.

### 1.3 The global search field shows a white border box on focus
The search field in the app bar renders a white bordered box when clicked. It
should not.

### 1.4 The back link on a ticket always says "All tickets"
It should name where you came from: **My tickets** when you arrived from there,
**Notifications** when you arrived from the inbox. Keep "All tickets" as the
fallback when there is no context.

---

## 2. The theme — read this before changing a colour

New palette:

| Role | Now | Becomes |
| --- | --- | --- |
| Page background | white | **cream beige `#f0eada`** |
| Primary | navy `#1f3a93` | **coco brown `#73362a`** |
| Third colour | grey-blue | **to be chosen — see below** |

**Suggested third colour: a warm ochre, around `#a9743a`.** It sits between the
cream and the brown rather than fighting either, and it gives a usable mid-tone
for secondary surfaces, hover states and chart series. Alternatives worth trying
before settling: a muted olive (`#6f7548`) if the palette needs something that is
not another brown, or a deeper clay (`#8c4a32`) if the brown should dominate more.
Propose one, show it, and let the owner choose.

### What changing the theme breaks

Two things in this project were validated against the **old** palette and must be
re-validated against the new one. Neither will fail loudly.

- **S6 pinned four contrast ratios** for the status and priority chips, each
  recorded against *both* white and the page background, because an outlined chip
  sits on both. Changing the background invalidates every one. The ratios and the
  reasoning are in the decision log; `npx playwright test e2e/accessibility.spec.ts`
  runs axe-core over every screen and will catch failures, but **only for what it
  scans** — check the numbers as well as the scan.
- **M7 validated a chart palette** in `frontend/src/features/dashboard/chartPalette.ts`,
  including a check that adjacent workflow colours stay distinguishable under
  protanopia. That file records the values and why. Re-derive it, do not
  hand-tune it.

Load the `dataviz` skill before touching chart colours.

---

## 3. Shared components

### 3.1 Status chips
- **Equal width and height everywhere.** "Open" being narrower than "In progress"
  reads as accidental.
- More internal padding — they are tight.
- This applies site-wide: lists, detail pages, dashboards, dialogs.

### 3.2 Priority chips
- **Remove the icons.** The colour and label carry it.
- **Make CRITICAL filled** rather than outlined, so it stands out from the other three.
- Same equal-width treatment.

### 3.3 Level chips (JUNIOR / SENIOR / LEAD)
Equal width. Otherwise leave them as they are.

### 3.4 Specialty chips
Leave alone, **except** in the assign dialog — see 5.3.

### 3.5 The escalated flag
Keep the flag icon, but move the chip to the **start of the title** rather than
trailing it, so rows line up.

---

## 4. Layout and mobile

### 4.1 The drawer opens from the right
Currently left. The owner wants right, for thumb reach. M5 already moved the
drawer *button* right for the same reason; this finishes it.

### 4.2 Remove the bottom navigation bar
The drawer covers it. Delete the bar rather than hiding it, and check what the
e2e suite asserts about it — several tests reference the mobile navigation
surface and will need updating rather than deleting.

### 4.3 Dialogs are too large on mobile
They currently fill the screen. They should not.

### 4.4 Search and filter buttons full width on mobile
Apply to every mobile page, not only the engineer screens.

### 4.5 "Pick up" and "Assign" buttons full width on mobile

### 4.6 Ticket title typography is inconsistent
Black in some places, blue in others; sizes vary. Pick one treatment per context
and apply it. The detail page may legitimately differ — decide deliberately and
write down the rule.

### 4.7 Facilities: alignment and transition
- The seat table should align its **top edge** with the top of the facilities
  panel. Currently the "Level N" heading sits at that line and the table starts
  below it.
- Use **MUI `Collapse`** so the table transitions in rather than appearing.
- **On mobile**, scroll down automatically after choosing a floor, or the user
  cannot tell anything happened.

---

## 5. Per-persona screens

### 5.1 Admin — Users page grouped
Show the table in sections with headers and dividers, in this order: **admins**,
then **engineers ordered LEAD → SENIOR → JUNIOR**, then **employees**.

### 5.2 Admin — Dashboard
- Add pie charts **where they earn their place**. A pie is good for parts of a
  whole with few slices, bad for comparison or for many categories. Status
  breakdown is a reasonable candidate; "incidents per building" over three
  buildings is not obviously better as a pie than as a bar. Load the `dataviz`
  skill and propose, do not add pies uniformly.
- Let the admin **hide sections** they do not use, and **reorder** them.
  Persist the choice per user.

### 5.3 Assign dialog — restructure (admin and LEAD engineer)
Currently: name, level, specialty chips on line one; availability underneath.

Wanted:
- **Line 1:** name · level chip · — · availability
- **Line 2:** specialty chips, with **chips matching the ticket's category group
  turned green** while the rest stay grey.

The point: the assigner sees at a glance who is qualified *and* who is merely
available, so they can pick the best compromise when the specialist is not free.

### 5.4 Employee — All Tickets defaults to their building
Filter to the employee's own building by default. They can change it, but the
default should be the building they are in.

### 5.5 Employee — whole rows clickable
On the dashboard's recent-tickets section and on My Tickets, the **entire row**
should be clickable, not just the title text. Employees must **not** get a link
through to an engineer's profile.

### 5.6 Engineer — My Queue orders closed tickets last

### 5.7 Engineer — home and team pages share one ticket style
Use the "Unassigned in your specialties" card style on the team page's
"Waiting for owner" section too. Only the button differs: **Pick up** on home,
**Assign** on team.

### 5.8 Ticket detail — remove the box around the workflow stepper
It has a white background and a border, and the page already has plenty of
borders. Let the stepper sit on the same background as the title and chips.

---

## 6. New features

### 6.1 Engineer detail page
Today an engineer is an "Edit engineer" modal. Replace it with a real page:

- **Basic information**, editable in place (what the modal does now).
- **Charts**: tickets closed, and a breakdown worth looking at. Include
  **how many of their closed tickets were later reopened by the reporter** — the
  data is there (`reopen_count` and the event log) and it is a genuinely useful
  quality signal.
- **The tickets they are working on now.**
- **A date filter** over the charts and the ticket list.
- **History/activity** for that engineer.

Then link to it from two places:
- The **assignee column** on ticket tables.
- The **engineer workload** rows on the admin dashboard — clicking a row should
  go to that engineer's page, not to a filtered ticket list.

### 6.2 Engineer specialties at creation
- Offer **more specialty tags** than the current list.
- Fix the overlap: the field shows "None" over the "Specialties" label on first
  open. The ticket page's priority and status filters do this correctly — copy
  whatever they do.

### 6.3 "Needs help" — an escalation chain between engineers
**This is the largest item here and it is backend work, not styling.**

A JUNIOR who cannot resolve a ticket marks it as needing help. A SENIOR picks it
up or helps. If the SENIOR cannot either, it goes to a LEAD.

Design questions to settle **before** writing code, and to record in the decision
log:
- Is this a **new incident status**, or a flag alongside the existing workflow?
  A new status changes the state machine in `backend/v1/app/workflow.py`, which
  is a table with eleven rows and the single source of truth for what anyone may
  do. Adding a status means adding rows for every legal transition into and out
  of it. A flag is cheaper but is one more thing that is not in the table.
- Who is notified, and does S1's notification rule module cover it?
- Does the original assignee keep the ticket, or does it transfer?
- How does this interact with the existing **escalation** flag, which is a
  reporter-facing concept? Two things called "escalate" meaning different things
  will confuse everyone.
- **Every request for help is recorded on the engineer's profile**, per 6.1.

Read `readme/PROJECT-GUIDE.md` Part I §3 (the rule-to-file map) and the workflow
section before designing this.

### 6.4 Should availability go BUSY automatically?
Today `BUSY` is set **only by the engineer's own toggle** — nothing in the
backend ever sets it. The engineer profile already carries `max_active_tickets`
and the UI already draws a capacity bar, so the data for an automatic rule
exists. Decide deliberately whether reaching capacity should set BUSY, and
record the decision either way.

---

## Working notes for whoever picks this up

- **The tests are a floor, not a ceiling.** 826 backend, 312 frontend, 82 e2e all
  pass, and every significant defect in this project was found by *looking at the
  screen* — an unloaded font, five chart defects, an accessibility phase whose own
  axe scan passed an app with no visible focus ring, an inbox disagreeing with its
  own badge. Screenshot your work and look at it.
- **Prove a fix removes the symptom**, not merely that the mechanism you suspected
  changed. The decision log has three entries where that step was skipped.
- **A negative assertion passes on an empty page** — it has to earn its emptiness.
- Deployed at https://d3jo3ezb7ss05m.cloudfront.net; Aurora sleeps at 0 ACU, so
  load it once before showing anyone.

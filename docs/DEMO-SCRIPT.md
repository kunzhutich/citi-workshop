# Five-minute demo script

One ticket's whole life, across all three personas, ending at the admin dashboard.

Written to be **read aloud while clicking**. Lines in > blockquotes are what you say;
everything else is what you do. Every account, button label and screen name below was
checked against the code and against the `acme_demo` database on 2026-09-23.

Total: **5 minutes** of talking, plus about **3 minutes of setup you do before anybody is
watching**. Do the setup. Half the ways this demo can go wrong are already fixed by it.

---

## Before you start

### 1. Point the API at the demo database

The dashboards are only worth showing against 90 days of data. That lives in a separate
database, `acme_demo` — `acme_incidents_dev` is nearly empty by comparison (121 incidents
of ad-hoc test residue versus 318 designed ones).

```sh
# backend/v1/.env  — change this one line
POSTGRES_NAME=acme_demo
```

**Restart uvicorn afterwards.** Settings are cached per process; editing `.env` under a
running server changes nothing, and `--reload` does not watch `.env`.

```sh
cd backend/v1 && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend   && npm run dev
```

If `acme_demo` does not exist on this machine, create it — takes about a second:

```sh
sudo -u postgres createdb acme_demo
cd backend/v1
POSTGRES_NAME=acme_demo .venv/bin/python -c "from function import handler; print(handler({'action':'migrate'}, None))"
POSTGRES_NAME=acme_demo .venv/bin/python -c "from function import handler; print(handler({'action':'seed_demo'}, None))"
```

**Put `.env` back to `POSTGRES_NAME=acme_incidents_dev` when the demo is over**, or the
next Playwright run will create its accounts in the demo database. (Some already exist
there from previous runs — see "What you will see that is not in the script".)

### 2. Three signed-in browsers, not one

You will be three people at once. The refresh cookie lives on `localhost:3000`, so two
windows of the same browser profile **share one session** — signing in as the engineer
would silently sign the employee out.

Use three separate cookie jars:

| Window | Browser | Signed in as |
| --- | --- | --- |
| A | Chrome, normal window | Eve Carter (employee) |
| B | Chrome, incognito | Nina Alvarez (engineer) |
| C | Firefox, or a second Chrome profile | Henry (facility admin) |

Two incognito windows in the same Chrome share a session too — the third really does need
a different browser or profile.

*Fallback if that is awkward:* run the demo in one window and sign out between acts
(avatar menu → **"Log out"**). It costs about ten seconds per switch and the story still
works.

Sign all three in **before** you start talking, and leave each on its home screen.

### 3. The cast

All three accounts exist in `acme_demo` and none of them will stop you with a
password-change screen (verified: `must_change_password` is false for all three).

| Who | Email | Password | Why them |
| --- | --- | --- | --- |
| **Eve Carter**, employee | `eve.carter@acme.inc` | `AcmeDemo2026!` | Reports the ticket, confirms the fix |
| **Nina Alvarez**, engineer (SENIOR) | `nina.alvarez@acme.inc` | `AcmeDemo2026!` | SENIOR, so she can pick work up herself; her specialty is Building & Facilities, which is the group we report into |
| **Henry**, facility admin | `henry@acme.inc` | `AcmeLocalDev2026!!` | Reads the dashboard |

Note the admin password ends in **two exclamation marks**. It is not the shared demo
password: this account pre-dates the demo seed and had its password changed through the
gate. If it will not take, `demo.admin@acme.inc` / `AcmeDemo2026!` is also a facility
admin in this database and works identically.

Every other seeded account — 6 engineers, 30 employees — uses `AcmeDemo2026!`.

### 4. Thirty seconds of dry run

Check these before the audience arrives, because each one is a demo-killer:

- `curl -s localhost:3000/api/v1/health` returns `"healthy"` — proves Vite, the proxy and
  uvicorn are all up and the database is reachable.
- Sign in as Nina and confirm her home screen's **"Unassigned in your specialties"**
  section is not empty (it should list Building & Facilities tickets).
- Open Henry's **Dashboard** and check the numbers are not all zero. If the "Reported in
  this period" section is empty, the seed data has aged out of the default 30-day window —
  set **Date range** to **"Last 90 days"** and leave it there.

---

## The walkthrough

### Act 1 — Eve reports a problem (0:00 – 1:10)

**Window A, Eve.** She is on her home screen: a greeting, a big **"Report an issue"**
button, and four count tiles.

> "This is what an employee sees. Not a ticket queue — one button, and four numbers about
> their own tickets: Open, In progress, Blocked, and Awaiting your confirmation."

Click **"Report an issue"**.

> "Reporting is five questions, and each one appears only when you have answered the last.
> No 'category ID' field, no form with thirty inputs."

1. **"1. What kind of problem is it?"** → click the **Building & Facilities** card.
   > "Five cards with plain-language hints. This one says 'Temperature, lighting, plumbing,
   > furniture.'"
2. **"2. Which one?"** → click **Plumbing/Restroom**.
3. **"3. Where?"** → it has already pre-filled a building.
   > "It remembers where she reported from last time — that is Austin Campus. She is not
   > there today."

   Change the building to **San Francisco HQ**, then floor **Level 1**. Leave the seat
   blank.
   > "And the location fields it asks for come from the category: this group needs a floor,
   > so it asks for a floor and leaves the desk optional. Report a meeting-room problem and
   > the same control demands a room, and offers only rooms."
4. **"4. Tell us more"** → Title: `Water coming through the ceiling near 1-A-04`.
   Description: `Steady drip since this morning, there is a bucket under it. The carpet is soaked.`
5. **"5. How urgent is it?"** → click **Critical** ("Safety hazard, or many people are
   blocked").

Click **"Report this issue"**.

> "And it lands on the ticket, with its number."

A snackbar reads **"INC-000xxx created."** — **write that number down**, you will use it
three more times.

> "Everything from here is that one ticket."

---

### Act 2 — Nina picks it up and fixes it (1:10 – 2:55)

**Window B, Nina.** Her home screen is headed **"Your work"**.

Reload the page if it was already open.

> "An engineer's home is the same shape and different content: what is assigned to her, and
> underneath, unassigned tickets **in her specialties**. She is a senior, so she is allowed
> to take work herself — a junior sees a sentence here instead, telling them their lead
> assigns their work. That is the permission model, rendered."

Find the new ticket in **"Unassigned in your specialties"** (it is Critical, so it sorts
near the top) and click **"Pick up"**.

> "One click, because she is a senior and the ticket is open and unowned."

*If it is not on the home list:* click **"See all unassigned"** — that page is newest-first,
so the ticket is at the top.

A snackbar reads **"INC-000xxx is yours."** Open the ticket.

> "Here is the ticket as staff see it."

Point at the **stepper** across the top.

> "Open → In progress → Resolved → Closed."

Point at the **Actions** card on the right.

> "These buttons are the part I would like you to look at hardest. The frontend does not
> know the workflow. It asks the API 'what may this person do to this ticket right now',
> and renders whatever comes back. Before she picked it up there was no 'Start work' button
> at all, because you cannot start work on a ticket nobody owns — that is a guard on the
> transition, not an if-statement in the UI."

Click **"Start work"**. The stepper moves to **In progress**.

Now scroll to the note box at the bottom of the left column. Type:
`Facilities say it is the chilled-water line on Level 2. Plumber booked for 14:00.`
Turn **on** the switch labelled **"Staff only — the reporter will not see this"**, then
click **"Add note"**.

> "Staff can write internal notes. Eve will not see this one — and not because the screen
> hides it. The employee's API response does not contain it. The filter is a WHERE clause,
> so the row never leaves the database."

Now click **"Resolve"**. A dialog opens asking for a resolution summary — type
`Chilled-water line re-sealed, ceiling tile replaced, carpet dried.` — and confirm.

> "The dialog asked for exactly one field, because the transition table says this move
> requires a resolution summary. Same source as the buttons. Adding a field to this dialog
> is a change to one Python tuple."

---

### Act 3 — Eve gets the last word (2:55 – 3:25)

**Window A, Eve.** Go to **Home** and reload.

> "The ticket is not closed. The engineer does not get to decide that."

Point at the **"Needs your attention"** section, which was not there five minutes ago.

> "It appears only when there is something waiting on her, and it says why: 'These have
> been fixed. Confirm it worked and we will close the ticket — or tell us it is still
> broken and it goes straight back to the engineer.'"

Click into the ticket and show the **Activity** timeline.

> "The whole history: reported, assigned, started, resolved. No internal note — that is the
> same page Nina was looking at, minus the thing Eve is not entitled to."

Click **"Confirm fixed"**.

> "Closed, with a reason recorded: confirmed fixed by the reporter. If she had clicked
> 'Still broken' instead, it would have gone back to In progress with the reason attached
> and the reopen counted. And she has seven days to change her mind — after that, closed is
> final and the button is gone."

---

### Act 4 — Henry sees all of it at once (3:25 – 5:00)

**Window C, Henry.** He lands on **Dashboard**, against 90 days and ~318 tickets.

> "Same application, third face. An admin opens on the numbers."

**Point at the filter bar first, and the line underneath it.**

> "One filter bar, and it is honest about its own reach: the building applies to
> everything; the date range applies to the period section only."

**Section one — "Reported in this period".**

> "Everything here is about tickets *raised* in the window, and the heading prints the
> dates the server actually used, not the dates in the picker."

Scroll to the response-time tiles under **"How fast the team reacted"**.

> "Median time to assign, to acknowledge, to resolve. Median, not average — the label says
> what the SQL computes. One ticket left over a long weekend should not move the headline.
> And these are real: they are read out of a backdated event log, which is why they come
> out ordered by priority — critical tickets are assigned inside the hour and resolved the
> same day, while low-priority ones take the best part of a week."

**Section two — "Right now".** Scroll to the heading that reads **"Right now"**.

> "And this is the part I would put on the slide. Two of these reports refuse a date range
> outright."

Point at **Blocked · 21** and **Escalated · 16**, then back up at the period section's
**Escalated**.

> "There are two Escalated figures on this page and they disagree — 16 here against 12 up
> there — and that is correct. Up there is 'escalations raised on tickets reported in this
> window, including ones since closed'. Down here is 'flagged and still live'. We built
> this the tidy way first, with one date range over all eight reports, and it hid the
> single most important row on the screen: a ticket blocked ninety days ago and still
> blocked. So the rule became 'the tense of the question decides', and the screen says
> which is which instead of picking one and hoping."

Scroll to **"Blocked, by reason"**.

> "Twenty-one tickets stuck, grouped by what they are waiting on, with an age. There is no
> `blocked_at` column — the age is read out of the audit log, because the log already knew."

Scroll to the two attention panels — **"Escalated"** and **"Unassigned for over 24 hours"**
(26 of them today).

> "Each row has an Assign button on it. This is a work queue, not a report."

Finally, the **"By category"** chart. Click the **Hardware** bar.

> "Charts drill: groups into subcategories, and it is in the URL, so you can send it to
> someone."

Then click any KPI tile, for example **Blocked**.

> "And every tile opens exactly the tickets it counted — the filters it applied are
> spelled out as chips above the list. A number on a dashboard you cannot open is a number
> you cannot check."

**Close.**

> "One ticket, three roles, and one rule table underneath all of it. The 683 backend tests
> parametrise over that same table, so a transition nobody tested is not a thing that can
> exist."

---

## If something goes wrong

### On the day

| What you see | What it is | What to do, live |
| --- | --- | --- |
| The page sits on **"Restoring your session…"** | Every page load starts with `POST /api/v1/auth/refresh`. Locally it is instant, so this means uvicorn is down or the proxy is not reaching it | Check the uvicorn terminal. `curl localhost:3000/api/v1/health` |
| Sign-in lands on a **change-password** screen with no way out | The account is flagged `must_change_password` — seeded and admin-created accounts are. None of the three accounts above should be | Complete the form; keep the new password. Or use `demo.admin@acme.inc` / `AcmeDemo2026!` |
| Sign-in is refused for `henry@acme.inc` | The password ends in **two** exclamation marks: `AcmeLocalDev2026!!` | Use `demo.admin@acme.inc` / `AcmeDemo2026!` instead |
| Signing in as Nina signs Eve out | Two windows of one browser profile share the cookie | Use a different browser or profile for the third persona |
| The dashboard is all zeroes, or "Reported in this period" is empty | The API is pointed at `acme_incidents_dev`, **or** the seeded 90 days has aged out of the last-30-days window | Check `POSTGRES_NAME` in `backend/v1/.env` and restart uvicorn; otherwise set **Date range** to "Last 90 days" |
| Everything 500s but `/api/v1/health` is fine | `POSTGRES_NAME` points at a database with no schema. Health only proves the connection | Fix `.env`, restart uvicorn |
| The new ticket is not on Nina's home list | That list is sorted by priority and capped at six rows | Click **"See all unassigned"** — newest first — or paste the INC number into the search box in the top bar |
| **"Pick up"** is missing | The signed-in engineer is a JUNIOR, or the ticket's category is not in their specialties | Use Nina (SENIOR, Building & Facilities), and report into Building & Facilities |
| **"Start work"** is missing | The ticket has no assignee yet; it is a guard, not a bug | Pick it up first |
| **"Confirm fixed"** is missing for Eve | Only the reporter sees it, and only while the ticket is RESOLVED | Check you are in Eve's window, and that Nina actually resolved rather than closed |
| Eve's screen has not changed | The client caches; her window has not refetched | Reload the page |
| A first request hangs for ~15 seconds | **Only in the cloud**: Aurora Serverless v2 runs at `min_capacity = 0` and takes about 15 s to wake from idle. There is no local equivalent | Warm it with one request a minute before you start, and never open a cloud demo cold |

### What you will see that is not in the script

- **318 incidents, not 300.** `seed_demo` writes 300; earlier Playwright runs against this
  database left about eighteen more, plus deactivated `e2e.*` accounts that are visible on
  the admin **Users** screen. Harmless. If you want it pristine, drop `acme_demo` and
  re-seed.
- **Two deactivated employees**, on purpose — an admin screen where everyone is active
  never shows the deactivated state.
- **The ticket you create is real** and stays in the database. Run the demo twice and there
  are two. That is fine; `seed_demo` will not clear them, and it will refuse to re-seed
  over an existing demo world rather than half-merging into it.
- **Numbers drift from the ones quoted above** (blocked 21, escalated live 16, unassigned
  over 24 h 26, verified 2026-09-23). "Right now" figures are relative to today, so a week
  later they will differ. Say "about twenty" and you will never be wrong.

### Afterwards

```sh
# backend/v1/.env
POSTGRES_NAME=acme_incidents_dev   # and restart uvicorn
```

---

## If you have more than five minutes

Each of these is one extra minute and shows something the main script skips.

- **Blocked and resumed.** Between Start work and Resolve, click **"Mark blocked"** — the
  dialog demands a reason *type* and free text, and the stepper's second step turns into an
  error state labelled **"Blocked"** with the reason underneath. Then **"Resume work"**.
- **Escalation.** As Eve, on an open ticket, click **"Escalate"** and give a reason. It
  appears on Henry's dashboard within one refetch, in the **"Escalated"** panel with an
  **Assign** button on the row. Only an admin can clear it — and clearing it is the *only*
  thing that lowers the flag, which is why every present-tense count of escalations also
  filters on status.
- **Assignment by a lead, instead of pick-up.** Sign in as `grace.lin@acme.inc` (LEAD) and
  assign someone else's ticket to another engineer. The dialog sorts engineers by specialty
  match and then by lowest load, and if you pick someone who is BUSY, ON_LEAVE or over
  their ticket cap the assignment **still succeeds** and returns a warning — a lead knows
  things the system does not.
- **Reopen.** As Eve or Henry, reopen the closed ticket with a reason. `reopen_count` goes
  up, the stepper shows **"Reopened ×1"**, and the seven-day window is enforced server-side
  by a guard that takes `now` as an argument — which is how it is tested without waiting a
  week.
- **The same screens at 375 px.** Narrow the window: the sidebar becomes a bottom bar, the
  ticket table becomes cards, dialogs go full-screen, and the ticket's action buttons move
  into a sticky bar at the bottom of the screen.
- **The API itself** — <http://localhost:8000/api/v1/docs>. 41 paths, 61 operations, and
  `GET /incidents/{id}/allowed-transitions` is the one the frontend leans on.

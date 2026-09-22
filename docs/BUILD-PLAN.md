# ACME Facility Incident Management Platform — Build Plan

> Companion to [CLAUDE.md](../CLAUDE.md), which holds the scaffold's hard constraints.
> Read that first. This document is the *what to build*; CLAUDE.md is the *rules you
> cannot break*.

## 0. Instructions for the implementing assistant

Build one phase at a time (Section 15). At the end of each phase, **stop** and:

1. Summarize what was built, what was tested, and anything that deviated from this plan.
2. **Append that phase's section to `docs/PROJECT-GUIDE.md`** — the living guide for the
   repo owner, written while the reasoning is fresh. Its required contents are specified in
   [CLAUDE.md](../CLAUDE.md#the-living-guide--docsproject-guidemd). This is part of the
   phase, not optional polish: a phase is not complete until its guide section exists.

Do not start the next phase until asked.

Build each phase as a **vertical slice** — migration → endpoint → test → screen — rather
than all-backend-then-all-frontend, so the app is demoable end-to-end at every point.

Code style: explicit and readable over clever. Clear names, small functions, early
returns, no deeply nested comprehensions. Type-annotate all Python; TypeScript on the
frontend. Keep each business rule in one obvious place. Every phase ships with tests for
the rules it introduces.

**Versions (set by the scaffold, not by preference): Python 3.13, Node 22, PostgreSQL 17
(Aurora in cloud), Terraform 1.16, region us-east-2.**

## 1. Tech stack

**Backend** — FastAPI, Pydantic v2, pydantic-settings; SQLAlchemy 2.0 ORM (synchronous
sessions) with `psycopg[binary]` v3; Alembic; PyJWT; `bcrypt` directly (not passlib);
Mangum (ASGI adapter for Lambda); pytest, httpx, ruff.

**Frontend** — React 19 + TypeScript, Vite 7; Material UI (`@mui/material`,
`@mui/icons-material`, `@mui/lab` for Timeline), `@mui/x-data-grid` (MIT tier),
`@mui/x-charts`; `react-responsive`; React Router v6; TanStack Query; axios;
react-hook-form + zod; dayjs. Vitest + React Testing Library, ESLint + Prettier.

The scaffold ships React 19 with **none** of these installed — the first frontend phase
must add them and convert the project to TypeScript (`.tsx`, `vite.config.ts`, `tsconfig`,
TS-aware `eslint.config.js`).

**Database** — PostgreSQL. Local install on the VDI; Aurora PostgreSQL 17.7 in the cloud.

**Infra/deploy** — the provided `infra/` Terraform and `bin/` scripts. See CLAUDE.md.

## 2. Repository layout

We build inside the existing scaffold. Only `backend/v1/`, `frontend/src/`, `CLAUDE.md`,
`docs/BUILD-PLAN.md` and three small `infra/` edits are ours.

```
coding-workshop-participant/
├── CLAUDE.md
├── docs/BUILD-PLAN.md      # this file
├── docs/PROJECT-GUIDE.md   # living guide, appended each phase
├── backend/v1/            # the single auto-discovered Lambda
│   ├── function.py        # handler = Mangum(app) + ops dispatch
│   ├── requirements.txt
│   ├── alembic.ini  alembic/versions/
│   ├── app/
│   │   ├── main.py        # routers mounted at /api/v1
│   │   ├── config.py  db.py  workflow.py
│   │   ├── routers/       auth users facilities categories engineers incidents notes reports
│   │   ├── services/      incident_service assignment categories reporting visibility ops
│   │   ├── repositories/  incidents facilities engineers
│   │   ├── models/        user engineer_profile building floor seat category incident note event
│   │   ├── schemas/       (mirrors models)
│   │   ├── security/      passwords.py tokens.py dependencies.py
│   │   └── seed/
│   └── tests/             unit/ integration/ conftest.py
├── frontend/
│   ├── vite.config.ts     # dev proxy /api -> http://localhost:8000 (path unchanged)
│   └── src/
│       ├── main.tsx  App.tsx  theme.ts
│       ├── api/           axios client, typed endpoint fns, query keys
│       ├── auth/          AuthProvider, RequireAuth, RequireRole
│       ├── layout/        AppShell (desktop sidebar / mobile bottom nav)
│       ├── hooks/         useBreakpoint.ts
│       ├── components/    StatusChip PriorityChip WorkflowStepper IncidentTimeline
│       │                  TransitionDialog LocationPicker CategoryPicker AssignDialog
│       └── features/      incidents facilities categories engineers users dashboards
└── infra/                 # PROVIDED — only the three edits listed in CLAUDE.md
```

There is no `docker-compose.yml`, no `scripts/` directory and no hand-written Terraform.

## 3. Data model

All tables use `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at` /
`updated_at TIMESTAMPTZ` (UTC). The first migration enables `pgcrypto` and `citext`.

### Enums (Postgres enum types, mirrored as Python `StrEnum`)

`user_role`: EMPLOYEE, ENGINEER, FACILITY_ADMIN
`engineer_level`: JUNIOR, SENIOR, LEAD
`incident_status`: OPEN, IN_PROGRESS, BLOCKED, RESOLVED, CLOSED
`incident_priority`: LOW, MEDIUM, HIGH, CRITICAL
`blocked_reason_type`: WAITING_ON_PARTS, WAITING_ON_EMPLOYEE, WAITING_ON_VENDOR, ACCESS_REQUIRED, OTHER
`close_reason`: CONFIRMED_FIXED, CLOSED_BY_ENGINEER, DUPLICATE, INVALID, CANCELLED_BY_REPORTER, ADMIN_CLOSED
`note_visibility`: PUBLIC, INTERNAL
`availability_status`: AVAILABLE, BUSY, OFF_DUTY, ON_LEAVE
`seat_type`: DESK, MEETING_ROOM, COMMON_AREA, OTHER
`location_detail`: BUILDING, FLOOR, SEAT
`event_type`: CREATED, STATUS_CHANGED, ASSIGNED, UNASSIGNED, PRIORITY_CHANGED, ESCALATED, ESCALATION_CLEARED, NOTE_ADDED, MARKED_DUPLICATE, REOPENED

### Tables

**users** — `email CITEXT UNIQUE NOT NULL`, `password_hash TEXT NOT NULL`,
`full_name TEXT NOT NULL`, `role user_role NOT NULL DEFAULT 'EMPLOYEE'`,
`is_active BOOL NOT NULL DEFAULT true`, `must_change_password BOOL NOT NULL DEFAULT false`,
`last_login_at TIMESTAMPTZ NULL`, and `last_building_id` / `last_floor_id` / `last_seat_id`
(nullable FKs) used to pre-fill the report form.

**engineer_profiles** (1:1 with ENGINEER users) — `user_id UUID PK FK users(id) ON DELETE CASCADE`,
`level engineer_level NOT NULL DEFAULT 'JUNIOR'`,
`specialty_group_ids UUID[] NOT NULL DEFAULT '{}'` (top-level category groups they handle;
a group covers all its subcategories), `home_building_id UUID NULL FK buildings(id)`,
`phone TEXT NULL`, `availability availability_status NOT NULL DEFAULT 'AVAILABLE'`,
`max_active_tickets INT NOT NULL DEFAULT 10 CHECK (max_active_tickets > 0)`.

**buildings** — `name TEXT UNIQUE`, `code TEXT UNIQUE` (e.g. `SFO-1`), `address TEXT`,
`is_active BOOL DEFAULT true`.

**floors** — `building_id FK`, `name TEXT`, `level_number INT`, `is_active BOOL`,
`UNIQUE(building_id, level_number)`.

**seats** — `floor_id FK`, `code TEXT` (e.g. `3-A-12`, `Room Redwood`), `seat_type seat_type`,
`is_active BOOL`, `UNIQUE(floor_id, code)`. Meeting rooms are seats with
`seat_type = MEETING_ROOM`.

Facilities referenced by incidents are soft-deactivated (`is_active = false`). Hard delete
only when unreferenced; otherwise return **409**.

**categories** (two-level tree, admin-editable) — `parent_id UUID NULL FK categories(id)`
(NULL = group, non-null = subcategory), `name TEXT NOT NULL`, `hint TEXT NULL` (one-line
description on the card), `icon TEXT NULL` (MUI icon name),
`location_detail location_detail NOT NULL DEFAULT 'FLOOR'` (meaningful on groups;
subcategories inherit from their group), `sort_order INT NOT NULL DEFAULT 0`,
`is_active BOOL NOT NULL DEFAULT true`, `UNIQUE(parent_id, name)`. The service layer
enforces max depth 2 — a subcategory's parent must be a group.

**incidents**
- `ticket_number BIGINT UNIQUE NOT NULL DEFAULT nextval('incident_ticket_seq')`, displayed as `INC-000123`
- `title TEXT NOT NULL` (5–120 chars), `description TEXT NOT NULL` (10–5000 chars)
- `category_id FK categories NOT NULL` — must be a **subcategory**, never a group (422 otherwise)
- `building_id FK NOT NULL`, `floor_id FK NULL`, `seat_id FK NULL`
- `status incident_status NOT NULL DEFAULT 'OPEN'`, `priority incident_priority NOT NULL DEFAULT 'MEDIUM'`
- `reporter_id FK users NOT NULL`, `assignee_id FK users NULL`
- `is_escalated BOOL NOT NULL DEFAULT false`, `escalation_reason TEXT NULL`, `escalated_at TIMESTAMPTZ NULL`, `escalated_by UUID NULL FK users`
- `blocked_reason_type blocked_reason_type NULL`, `blocked_reason TEXT NULL`
- `resolution_summary TEXT NULL`, `close_reason close_reason NULL`, `duplicate_of_id FK incidents NULL`
- `reopen_count INT NOT NULL DEFAULT 0`
- Lifecycle timestamps `assigned_at`, `acknowledged_at`, `resolved_at`, `closed_at` (all nullable).
  `assigned_at` and `acknowledged_at` are set once and never overwritten; `resolved_at` and
  `closed_at` are cleared on reopen.
- `search_vector TSVECTOR GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(description,'')), 'B')) STORED`
- Indexes: GIN on `search_vector`; B-tree on `status`, `priority`, `assignee_id`,
  `reporter_id`, `building_id`, `floor_id`, `seat_id`, `category_id`, `created_at`
- CHECK: `status <> 'BLOCKED' OR blocked_reason_type IS NOT NULL`
- Service layer validates `floor.building_id == building_id` and `seat.floor_id == floor_id`,
  and applies the category location rules (Section 7).

**incident_notes** — `incident_id FK`, `author_id FK users`, `body TEXT NOT NULL` (1–5000
chars), `visibility note_visibility NOT NULL DEFAULT 'PUBLIC'`, `edited_at TIMESTAMPTZ NULL`,
`deleted_at TIMESTAMPTZ NULL` (soft delete).

**incident_events** (append-only audit log; powers the activity timeline and timing
metrics) — `incident_id FK`, `actor_id FK users`, `event_type event_type`,
`from_value TEXT NULL`, `to_value TEXT NULL`, `reason TEXT NULL`, `created_at`.
Index on `(incident_id, created_at)`.

**refresh_tokens** — `user_id FK`, `token_hash TEXT UNIQUE` (SHA-256 of the raw token),
`expires_at`, `revoked_at NULL`, `created_at`.

Stretch-only (do **not** create in MVP): **notifications**
(`user_id FK`, `incident_id FK`, `type TEXT`, `message TEXT`, `read_at NULL`, `created_at`;
index `(user_id, read_at)`) and **incident_watchers**
(`incident_id`, `user_id`, `created_at`, `PRIMARY KEY(incident_id, user_id)`).

## 4. Category seed data

Groups are the cards in step 1 of the report questionnaire; subcategories in step 2. Every
group ends with an "Other" subcategory.

| Group (icon) | Hint | location_detail | Subcategories |
| --- | --- | --- | --- |
| Hardware (`Computer`) | Something physical isn't working | FLOOR | Laptop/Desktop, Monitor, Keyboard/Mouse, Docking Station, Headset/Webcam, Printer/Scanner, Other hardware |
| Software (`Apps`) | An app, email, or your operating system | BUILDING | Operating System, Email/Calendar, Office Apps, Business Application, Software Install Request, Other software |
| Network & Access (`Wifi`) | Wi-Fi, VPN, passwords, badge access | BUILDING | Wi-Fi, Wired Network, VPN, Account/Password, Badge/Door Access, Other |
| Meeting Rooms (`MeetingRoom`) | Room displays, video calls, audio | SEAT | Display/Projector, Video Conferencing, Audio/Microphone, Other |
| Building & Facilities (`Apartment`) | Temperature, lighting, plumbing, furniture | FLOOR | Temperature/HVAC, Lighting, Plumbing/Restroom, Power/Outlets, Furniture, Cleaning, Kitchen/Appliances, Safety Hazard, Other |

## 5. Roles and permissions (RBAC)

Implemented with a FastAPI dependency `require_roles(*roles)` plus ownership and level
checks in the service layer. Role failures return **403**. Visibility is applied in one
function, `apply_visibility(query, user)`, **before** any user filters.

| Action | Employee | Engineer | Facility Admin |
| --- | --- | --- | --- |
| Self-register | ✅ `@acme.inc` only | ❌ created by admin | ❌ seeded / promoted |
| Create incident | ✅ | ✅ | ✅ |
| View list and detail | All incidents, read-only except own; PUBLIC notes only | All incidents; PUBLIC + INTERNAL notes | All |
| Edit title/description/category/location | Own, while OPEN and unassigned | ❌ | ✅ |
| Set priority at creation | Any of 4 | Any of 4 | Any of 4 |
| Change priority later | Own, while OPEN | ❌ | ✅ any time |
| Escalate (flag with reason) | Own; status OPEN/IN_PROGRESS/BLOCKED | ❌ | ✅ |
| Clear escalation | ❌ | ❌ | ✅ |
| Self-assign (pick up) | ❌ | SENIOR, LEAD: unassigned OPEN tickets | — |
| Assign / reassign others | ❌ | LEAD only, any non-CLOSED ticket | ✅ |
| Change status | Per workflow (Section 6) | Per workflow | Per workflow |
| Add PUBLIC note | Own incident, not CLOSED | Assigned incidents, not CLOSED; LEAD: any | Any, not CLOSED |
| Add INTERNAL note | ❌ | ✅ (same scope as public) | ✅ |
| Edit/delete own note | Within 15 min | Within 15 min | Any note, any time |
| Facilities, categories | Read | Read | Full CRUD |
| Engineer profiles | ❌ | Read all (Team page); update own availability/phone | Full CRUD |
| Users | ❌ | ❌ | List, change role, deactivate |
| Dashboards | Employee home | Engineer home (+ Team page for LEAD) | Admin dashboard + reports |

**Assignment rules** (`services/assignment.py`):
- Target must be an active ENGINEER.
- JUNIOR engineers can never assign (403).
- SENIOR engineers may only assign *themselves* to an unassigned OPEN ticket.
- LEAD engineers and admins may assign anyone to any non-CLOSED ticket, or unassign.
- Assigning someone not AVAILABLE, or at/over `max_active_tickets`, **succeeds** but
  returns `warnings: [...]` for the UI to display.
- First assignment sets `assigned_at`. Emit ASSIGNED / UNASSIGNED events.

Write a parametrized pytest suite covering this matrix endpoint by endpoint, including
each engineer level.

## 6. Incident workflow (state machine)

Implemented in `app/workflow.py` as **data**, not `if/else` chains in routes:

```python
@dataclass(frozen=True)
class Transition:
    from_status: IncidentStatus
    to_status: IncidentStatus
    allowed_actors: frozenset[str]   # "REPORTER", "ASSIGNEE", "FACILITY_ADMIN"
    required_fields: tuple[str, ...]
    action_label: str                # button text, e.g. "Start work"
```

Callers resolve relationship actors per incident: REPORTER (created it), ASSIGNEE
(assigned to it), FACILITY_ADMIN (role). A LEAD engineer counts as ASSIGNEE for transition
purposes on any ticket.

| From → To | Button label | Who | Required input | Side effects |
| --- | --- | --- | --- | --- |
| OPEN → IN_PROGRESS | Start work | ASSIGNEE, FACILITY_ADMIN | ticket must have an assignee | set `acknowledged_at` if null |
| OPEN → CLOSED | Cancel ticket | REPORTER | none | `close_reason = CANCELLED_BY_REPORTER`, set `closed_at` |
| OPEN → CLOSED | Close ticket | FACILITY_ADMIN | `close_reason` ∈ {DUPLICATE, INVALID, ADMIN_CLOSED}; DUPLICATE requires `duplicate_of_id` | set `closed_at` |
| IN_PROGRESS → BLOCKED | Mark blocked | ASSIGNEE, FACILITY_ADMIN | `blocked_reason_type`, `blocked_reason` | — |
| BLOCKED → IN_PROGRESS | Resume work | ASSIGNEE, FACILITY_ADMIN | none | clear blocked fields (history stays in events) |
| IN_PROGRESS → RESOLVED | Resolve | ASSIGNEE, FACILITY_ADMIN | `resolution_summary` | set `resolved_at` |
| RESOLVED → CLOSED | Confirm fixed | REPORTER | none | `close_reason = CONFIRMED_FIXED`, set `closed_at` |
| RESOLVED → CLOSED | Close ticket | ASSIGNEE, FACILITY_ADMIN | none | `close_reason = CLOSED_BY_ENGINEER` or `ADMIN_CLOSED`, set `closed_at` |
| RESOLVED → IN_PROGRESS | Still broken | REPORTER, FACILITY_ADMIN | `reason` | `reopen_count += 1`, clear `resolved_at`, event REOPENED |
| CLOSED → IN_PROGRESS | Reopen | REPORTER, FACILITY_ADMIN | `reason`; only within 7 days of `closed_at` | `reopen_count += 1`, clear `resolved_at`/`closed_at`, event REOPENED |

After 7 days, CLOSED is terminal. Any other transition returns **409** with
`{"detail": "...", "allowed_transitions": [...]}`. Every transition writes an
`incident_events` row with from/to and reason.

`GET /api/v1/incidents/{id}/allowed-transitions` returns the transitions the current user
can perform *now*, each with `to_status`, `action_label` and `required_fields`. **The
frontend renders action buttons and dialog fields exclusively from this**, so workflow
rules are never duplicated in the UI.

Test every row (allowed and denied actors), the 7-day reopen window (inject a fixed "now"
into the service), and all timestamp side effects.

## 7. Report questionnaire and location rules

Employees report issues through a guided, **single-page** form whose sections reveal
progressively — not a multi-page wizard, so users can scroll back and change answers.

1. **"What kind of problem is it?"** — group cards (icon, name, hint) in a responsive grid:
   2 columns on mobile, up to 5 across on desktop. Single-select (radio behavior).
   Selecting one reveals step 2.
2. **"Which one?"** — subcategory cards for the chosen group, with a "← Change" link back
   to step 1. Changing the group clears the subcategory.
3. **"Where?"** — `LocationPicker` adapts to the group's `location_detail`:
   - BUILDING: building required; floor and seat hidden behind an optional "Add more detail" link.
   - FLOOR: building and floor required; seat optional.
   - SEAT: building, floor and seat required. For Meeting Rooms, relabel "Seat" as "Room"
     and filter to `seat_type = MEETING_ROOM`.

   Pre-fill from the user's last-used location (`users.last_*_id`, updated on each
   successful create).
4. **"Tell us more"** — title and description.
5. **"How urgent is it?"** — four selectable priority cards with plain-language hints:
   Low "minor, can wait a few days" · Medium "annoying, but I can still work" (default) ·
   High "I can't do part of my job" · Critical "safety hazard, or many people are blocked".

Submit navigates to the new ticket's detail page with a snackbar: "INC-000482 created."

The backend enforces the same rules in `services/incident_service.py` (subcategory
required, location detail per group, floor/seat consistency), returning **422** with
field-level errors that the form maps onto the matching inputs.

## 8. Authentication

- **Register** `POST /api/v1/auth/register` with `{email, full_name, password}`:
  trim and lowercase the email; split on the **last** `@`; the domain must equal exactly
  `acme.inc`. Reject subdomains and lookalikes (`x@acme.inc.evil.com`, `x@sub.acme.inc`).
  Password 12–128 chars, hashed with bcrypt (cost 12). Role is always EMPLOYEE — ignore
  any `role` field from the client. No email verification in MVP (no external
  integrations); document as a limitation.
- **Login** `POST /auth/login` returns `{access_token, user}` and sets the refresh cookie.
  One generic error for wrong email *or* password.
- **Access token** — JWT HS256, 15-minute expiry, claims `sub`, `role`, `exp`, `iat`,
  `type: "access"`. Engineer level is loaded from the DB per request, never trusted from
  the token.
- **Refresh token** — random 32-byte URL-safe string, stored hashed, 7-day expiry, cookie
  `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. This works because the frontend
  and API are same-origin in **both** environments: behind one CloudFront distribution in
  the cloud, and behind Vite's dev proxy locally. Drive `Secure` from config so local HTTP
  dev still works.
- `POST /auth/refresh` rotates the refresh token (revoke old, issue new) and returns a new
  access token. `POST /auth/logout` revokes it and clears the cookie.
  `POST /auth/change-password` requires the current password and clears
  `must_change_password`. `GET /auth/me` returns the user plus engineer profile if
  applicable.
- Engineers are created by the admin with a temporary password and
  `must_change_password = true`. While set, every endpoint except `/auth/*` returns **403**
  with `code: "PASSWORD_CHANGE_REQUIRED"`, and the frontend forces the change-password screen.
- The first FACILITY_ADMIN is created by the `seed_admin` ops action.
- Frontend: access token in **memory only**. An axios interceptor calls `/auth/refresh`
  once on 401 and retries; `AuthProvider` calls refresh on page load to restore sessions.

`JWT_SECRET` is injected as a Lambda env var — add it to `local.env_vars` in
`infra/locals.tf` (see CLAUDE.md).

## 9. REST API (all under `/api/v1`)

Conventions: JSON; list endpoints return `{items, total, page, page_size}` (default 25,
max 100); errors `{detail, code?}`; ISO-8601 UTC timestamps.

**Health** — `GET /health` (checks DB connectivity)

**Auth** — `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`,
`/auth/change-password`; `GET /auth/me`

**Users (admin)** — `GET /users?role=&q=`, `GET /users/{id}`,
`PATCH /users/{id}` (role, is_active, full_name)

**Facilities**
- `GET/POST /buildings`, `GET/PATCH/DELETE /buildings/{id}`
- `GET/POST /buildings/{id}/floors`, `GET/PATCH/DELETE /floors/{id}`
- `GET/POST /floors/{id}/seats`, `GET/PATCH/DELETE /seats/{id}`
- `POST /floors/{id}/seats/bulk` with `{codes: [...], seat_type}`
- `GET /facilities/tree` — nested buildings → floors → seats (active only; admins may pass
  `include_inactive=true`)

**Categories**
- `GET /categories` — tree `[{id, name, hint, icon, location_detail, sort_order, children: [...]}]`
- Admin: `POST /categories` (with or without `parent_id`), `PATCH /categories/{id}`,
  `DELETE /categories/{id}` (soft-deactivate if referenced)

**Engineers**
- `GET /engineers?availability=&level=&group_id=&building_id=` — profile plus
  `active_ticket_count` (assigned tickets in OPEN/IN_PROGRESS/BLOCKED)
- `POST /engineers` (admin) — creates user + profile, returns a temporary password **once**
- `GET/PATCH/DELETE /engineers/{user_id}` (delete = deactivate)
- `PATCH /engineers/me` — availability, phone

**Incidents**
- `GET /incidents` (search/filter below), `POST /incidents`
- `GET /incidents/{id}` — detail with reporter, assignee, category + group, location names,
  and `can_edit` / `can_escalate` / `can_change_priority` booleans for the current user
- `PATCH /incidents/{id}` — field edits, permission-checked per field
- `POST /incidents/{id}/transitions` with
  `{to_status, reason?, blocked_reason_type?, blocked_reason?, resolution_summary?, close_reason?, duplicate_of_id?}`
- `GET /incidents/{id}/allowed-transitions`
- `POST /incidents/{id}/assign` with `{assignee_id | null}` → `{incident, warnings}`
- `POST /incidents/{id}/pick-up` (self-assign convenience)
- `POST /incidents/{id}/escalate` with `{reason}`;
  `POST /incidents/{id}/clear-escalation` with `{note, priority?}` (admin)
- `GET /incidents/{id}/activity` — merged events and notes, chronological, filtered by note
  visibility for the current user

**Notes** — `GET/POST /incidents/{id}/notes`, `PATCH /notes/{id}`, `DELETE /notes/{id}`.
INTERNAL notes are filtered out for employees **in the query**, not the serializer.

**Reports** — `GET /reports/{name}` (Section 11) and `GET /reports/me`

### Search and filter on `GET /incidents`

All optional and combinable:
- `q` — if it matches `^(INC-?)?\d+$` (case-insensitive), search by ticket number;
  otherwise `search_vector @@ websearch_to_tsquery('english', q)` ranked with `ts_rank`
- `status` (repeatable), `priority` (repeatable), `group_id`, `category_id`,
  `building_id`, `floor_id`, `seat_id`
- `assignee_id` (unassigned allowed), `reporter_id`, `is_escalated`
- `created_from`, `created_to`
- `mine` = `reported` | `assigned`
- `specialty=true` (engineers) — only tickets in the caller's specialty groups
- `sort` ∈ `created_at`, `-created_at` (default), `priority`, `-priority`, `updated_at`,
  `-updated_at`, `ticket_number`. Priority sort uses enum order (CRITICAL highest).

## 10. UI specification

### Shared shell
- `useBreakpoint()` — `isMobile = useMediaQuery({ maxWidth: 899 })` from `react-responsive`
  (aligned with MUI `md = 900`).
- **Desktop** — top AppBar (ACME logo, global ticket search, availability toggle for
  engineers, avatar menu with Change password / Log out) and a permanent left Drawer nav.
- **Mobile** — compact AppBar and a `BottomNavigation` with 3–4 items; tables become card
  lists with "Load more"; filters open in a bottom Drawer; dialogs are `fullScreen`; a FAB
  opens "Report an issue" for employees.
- Nav items — Employee: Home, My Tickets, All Tickets, Report an issue (primary button).
  Engineer: Home, My Queue, Unassigned (SENIOR/LEAD only), All Tickets, Team (LEAD only).
  Admin: Dashboard, Tickets, Engineers, Facilities, Categories, Users.
- Consistent chips — status (OPEN info/blue, IN_PROGRESS primary/purple, BLOCKED
  warning/orange, RESOLVED success/green, CLOSED default/grey); priority with icon and
  color (CRITICAL error/red); escalated tickets show a red flag badge.
- List filters live in the URL query string (`useSearchParams`) so views are bookmarkable.
  Chart segments and KPI tiles link to pre-filtered lists.
- Test layouts at **375 px, 768 px and 1440 px**.

### Incident detail page (shared by all personas)
- Header: back link, ticket number, title, status chip, priority chip, escalated badge.
- **`WorkflowStepper`** — the required workflow visualization. Horizontal MUI Stepper on
  desktop, vertical on mobile; steps Open → In Progress → Resolved → Closed. When BLOCKED,
  the In Progress step shows an error state with the block reason beneath it. Reopened
  tickets show a small "Reopened ×N" note.
- Desktop two-column layout:
  - **Left** — description, then Activity (MUI Timeline merging events and notes
    chronologically, INTERNAL notes visually shaded and labeled "Internal"), then the note
    composer (Public/Internal toggle for staff only).
  - **Right** — Details card (group › subcategory, location path, reporter, assignee,
    created, last updated, escalation reason if any) and Actions card.
- Actions card renders buttons from `allowed-transitions` plus contextual actions from the
  `can_*` flags and role: Assign (admin/LEAD), Pick up (SENIOR/LEAD on unassigned OPEN),
  Escalate (reporter), Clear escalation (admin), Change priority, Edit.
- `TransitionDialog` shows exactly the `required_fields` for the chosen transition.
- Mobile: stacked layout with action buttons in a sticky bottom bar.
- Other employees' tickets show no composer and no actions.

### Employee
- **Home** — greeting; full-width "Report an issue" button; four count tiles (Open,
  In Progress, Blocked, Awaiting your confirmation); a "Needs your attention" section,
  shown only when non-empty, listing RESOLVED tickets with **Confirm fixed** and
  **Still broken** buttons (the latter asks for a reason); recent tickets list.
- **Report an issue** — the questionnaire in Section 7.
- **My Tickets** — their incidents with status, priority, "updated 2h ago".
- **All Tickets** — every incident, read-only, filterable by building/floor/group, useful
  for checking whether something is already reported.

### Engineer
- **Home** — count tiles for their own work (Assigned-not-started, In Progress, Blocked,
  Resolved this week); My active tickets sorted by priority then age; Unassigned in your
  specialties with **Pick up** buttons (SENIOR/LEAD only). JUNIOR engineers see instead:
  "New tickets are assigned to you by your lead or admin."
- **My Queue** — full table of assigned tickets with status/priority filters.
- **Unassigned** (SENIOR/LEAD) — unassigned OPEN tickets, specialty filter on by default.
- **Team** (LEAD) — engineers with level, availability, active count and a capacity bar
  (active / max); Assign action uses the same dialog as the admin.
- Availability toggle in the top bar.

### Facility Admin
- **Dashboard** — filter bar (date range, building) applying to all widgets; KPI tiles
  (Open, Unassigned, Blocked, Escalated, Resolved in period); Needs attention panel
  (escalated tickets and tickets unassigned > 24 h, each with an inline Assign button);
  charts (by status, by priority, by category group with click-to-drill into subcategories,
  by building); engineer workload table; blocked tickets grouped by reason; average
  time-to-assign / acknowledge / resolve tiles.
- **Tickets** — DataGrid with server-side pagination and sorting (ticket #, title, status,
  priority, group › subcategory, location, reporter, assignee, age, last updated) and a
  filter bar.
- **`AssignDialog`** — engineers sorted by specialty match then lowest active count,
  showing level, availability and capacity bar; backend `warnings` displayed before closing.
- **Facilities** — two-pane layout: left tree of buildings expanding to floors, right table
  of seats for the selected floor; dialogs for add/edit; Bulk add seats (paste one code per
  line, choose seat type); deactivate instead of delete when referenced.
- **Engineers** — table plus Add engineer dialog (name, email, level, specialty groups
  multi-select, home building, max active tickets). On save, show the temporary password
  once with a copy button.
- **Categories** — groups listed with subcategories nested beneath; add/edit/reorder
  (`sort_order`)/deactivate; edit a group's hint, icon and location detail.
- **Users** — table with role change and deactivate.

### Data layer
- `api/client.ts` — axios with `baseURL: '/api/v1'`, `withCredentials: true`, auth header
  injection, 401 → refresh → retry-once.
- A typed function per endpoint; TanStack Query hooks per feature; invalidate
  `['incident', id]`, `['incidents']`, `['reports']` after mutations.
- Forms use react-hook-form + zod mirroring backend limits; backend 422 field errors map
  onto form fields; other errors show in a Snackbar.

## 11. Dashboards and reporting

Computed with SQL aggregates (`COUNT(*) FILTER (...)`, `AVG` / `percentile_cont` over
`EXTRACT(EPOCH FROM ...)`), never Python loops. All accept `from`, `to` (default last 30
days) and optional `building_id`.

| Business question | Endpoint | Returns |
| --- | --- | --- |
| What's open and what status? | `/reports/summary` | Counts by status, priority, assignee; open/unassigned/blocked/escalated totals; created vs. closed per day |
| Most common categories? | `/reports/categories` | Counts per group, and per subcategory nested within each group |
| Which buildings/floors/seats have the most issues? | `/reports/locations` | Top 10 buildings, floors, seats by incident count |
| How fast are incidents acknowledged, assigned, resolved? | `/reports/response-times` | Median time-to-assign / -acknowledge / -resolve, overall and per priority |
| Engineer availability and work distribution? | `/reports/engineer-workload` | Per engineer: level, availability, active count by status, capacity used, resolved in period |
| What's escalated or blocked, and why? | `/reports/blocked-escalated` | BLOCKED tickets grouped by `blocked_reason_type` with age; escalated tickets with reasons |
| Are employees kept informed? | `/reports/communication` | % of resolved tickets with ≥1 PUBLIC staff note before resolution; median time to first PUBLIC staff note; reopen rate |
| Persona home counts | `/reports/me` | Counts for the caller's own tickets |

Stretch reports (Section 15): SLA compliance and at-risk/breached flags, p90 response
times, weekly trends, recurring-seat hotspots (same seat + same subcategory ≥ 3 times in
90 days), notification read rates.

## 12. Infrastructure and deployment

**We do not author infrastructure.** The scaffold's `infra/` and `bin/` are the deployment
system, and the participant IAM role cannot create a VPC, subnets or an API Gateway. The
full contract — service discovery, `/api/v1` routing, DB env vars, the ops-invoke
migration path, and the three permitted `infra/` edits — is documented in
[CLAUDE.md](../CLAUDE.md). Read it rather than duplicating it here.

Architecture as deployed:

```
Browser ──HTTPS──> CloudFront
                     ├── default (*)     -> S3 (private, OAC)  [React build]
                     └── /api/v1*        -> Lambda Function URL -> FastAPI (Mangum)
                                                                     └──> Aurora PostgreSQL
```

One CloudFront origin means no CORS and a working `SameSite=Strict` refresh cookie.
Locally, Vite's dev proxy provides the same same-origin property against uvicorn.

## 13. Git and GitHub

`main` protected; one feature branch per phase (e.g. `m4-incidents-workflow`); PRs require
CI to pass. Conventional commits (`feat:`, `fix:`, `test:`, `infra:`, `docs:`).

Never commit secrets. `ENVIRONMENT.config` holds live STS credentials and is already
gitignored — keep it that way.

The repo ships three security-only GitHub Actions workflows (Bandit over `backend/`,
`npm audit` over `frontend/`, Checkov over `infra/`). Add a lint-and-test workflow
alongside them: backend job (Postgres service container, `ruff`, `pytest`), frontend job
(`eslint`, `tsc --noEmit`, `vitest`).

## 14. Testing strategy

The rubric weights Testing as one of five equal competencies, and asks for 80%+ coverage
on both layers, 90%+ on API endpoints and error cases, and documented gaps.

- **Backend unit** — workflow transitions (every row, allowed and denied actors), the 7-day
  reopen window with an injected fixed "now", the RBAC matrix parametrized by role and
  engineer level, email domain validation including lookalikes, category depth and location
  rules.
- **Backend integration** — real Postgres via a test database; CRUD per resource, search by
  ticket number and full text, employees never receiving INTERNAL notes, uniqueness
  conflicts (409), report endpoints against fixtures with known expected numbers.
- **Frontend** — Vitest + React Testing Library for core journeys (login, report an issue,
  transition a ticket, filter a list) and error states.
- **End-to-end** — at least one full happy path (report → assign → resolve → confirm) with
  Playwright, or document its absence explicitly as a known gap.
- Record the commands, the results and the known gaps in the README.

## 15. Build phases

### MVP track (in order)

**M1 — Scaffold and walking skeleton**
`backend/v1/` with `/api/v1/health`; convert the frontend to TypeScript and add MUI, Router,
TanStack Query, react-responsive; a placeholder page showing API health; ruff/eslint
configs; the lint-and-test CI workflow; the three `infra/` edits. Deploy to AWS immediately
once credentials exist.
✅ The page shows the API's health response both locally and at the CloudFront URL. (Deploy
early — it surfaces account and permission issues while there is still time to fix them.)

**M2 — Data model, auth, RBAC**
All MVP tables and the initial migration (enums, extensions, sequence, indexes,
constraints); category seed data; auth endpoints; `require_roles`; the password-change gate;
the `migrate` and `seed_admin` ops actions (runnable locally and via Lambda invoke).
✅ Tests: domain validation including lookalikes, login, refresh rotation, logout, role
gates, password-change gate.

**M3 — Facilities, categories, engineers, users**
CRUD, facility tree, bulk seats, category tree with depth validation, engineer creation with
level and temp password, `active_ticket_count`, soft deactivation with 409 on referenced
deletes.
✅ Tests for CRUD, uniqueness conflicts, category depth rules, permissions.

**M4 — Incidents and workflow**
Create with questionnaire validation, list/detail/patch, visibility, search and filters,
`workflow.py`, transitions, allowed-transitions, assignment rules by engineer level,
pick-up, priority changes, escalate/clear, notes with visibility and edit window, activity
feed.
✅ Every workflow row tested (allowed and denied), 7-day reopen window, assignment matrix by
level, employees never receive INTERNAL notes, search by ticket number and full text.

**M5 — Frontend shell and auth**
Theme, AppShell (desktop sidebar, mobile bottom nav), login/register/change-password,
AuthProvider with in-memory token and refresh, route guards.
✅ Register, login, logout and forced password change work end to end; layout switches
correctly at 900 px.

**M6 — Persona screens**
Report questionnaire, incident detail with WorkflowStepper and activity timeline,
TransitionDialog, employee/engineer/admin pages from Section 10, AssignDialog, Facilities,
Engineers, Categories, Users.
✅ One ticket's full lifecycle (report → pick up or assign → block → resume → resolve →
confirm or close → reopen) completes through the UI with three accounts, at mobile and
desktop widths.

**M7 — Dashboards and demo data**
All MVP report endpoints with SQL tests against fixtures with known expected numbers;
employee home, engineer home, admin dashboard with charts linking to filtered lists.
`seed_demo`: 3 buildings, 4–6 floors each, 20–40 desks per floor plus 2–3 meeting rooms,
1 admin, 6 engineers (2 per level) with group specialties, 30 employees, ~300 incidents over
the last 90 days across all groups, with backdated events so timing metrics are meaningful,
including blocked, escalated, duplicate and reopened tickets.
✅ Each business question in the brief is answerable from the admin dashboard.

**M8 — Final deploy, README, guide, demo script**
Deploy, seed and verify on AWS. README with setup, architecture diagram, role/permission
summary, test commands and results, and known limitations. A 5-minute demo script walking
one ticket's life across all three personas, then the admin dashboard.

Finalize `docs/PROJECT-GUIDE.md`: add a front section that reads as a single coherent
introduction rather than eight stitched-together phase logs — a system overview, the data
model narrative, the complete rule-to-file map, an end-to-end request trace, and the merged
glossary. Verify every file path and code excerpt in it still matches the code.
✅ Everything above works at the CloudFront URL, and the guide explains the whole system to
a reader who has never seen it.

### Stretch track (only after M8, in this order)

- **S1 In-app notifications** — bell with unread badge (poll unread-count every 30 s),
  notifications page, creation on status change, assignment, PUBLIC staff notes, escalation
  cleared; add notification read-rate to the communication report.
- **S2 Kanban board** — "Board" nav item for engineers and admins; one column per status,
  card action menu using `allowed-transitions`, then drag-and-drop with `@dnd-kit` calling
  the same endpoint and dialog.
- **S3 SLA targets** — CRITICAL 1 h ack / 8 h resolve, HIGH 4 h / 24 h, MEDIUM 8 h / 72 h,
  LOW 24 h / 7 d (wall-clock); at-risk/breached chips and filter, p90 times, weekly trends,
  recurring-seat hotspot report.
- **S4 Similar-ticket suggestions** in the questionnaire after location and subcategory are
  chosen, plus "I'm affected too" (watchers get notifications; watcher counts feed hotspot
  reports).
- **S5 SVG workflow state diagram** on the incident detail page, highlighting the current
  status and the user's available transitions.
- **S6 Hardening** — login lockout (10 failures per email per 15 min), accessibility pass,
  error boundaries, 404 page, structured JSON logging.

## 16. Known limitations (document in README)

No email verification or email notifications; no file or photo attachments; no SSO; a single
global admin role (no per-building admins); response times use wall-clock hours; single
region; no custom domain.

Natural next steps: SES email notifications, photo attachments via S3, SSO, per-building
admin scoping, scheduled auto-close of RESOLVED tickets.

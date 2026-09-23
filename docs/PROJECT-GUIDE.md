# Project Guide — ACME Facility Incident Management

**Who this is for.** The owner of this repository, who did not write the code and
needs to understand every part of it in depth. It assumes you can read Python and
TypeScript but not that you know FastAPI, SQLAlchemy, Terraform, CloudFront or
this workshop's scaffold. Every non-obvious term is defined in the glossary of the
phase where it first appears.

**How this differs from the README.** The README is for graders: setup steps,
architecture summary, how to run the tests. This guide is the *why* — the
decisions, the alternatives that were rejected, and the things that will bite you.

**How it is written.** In two parts.

**[Part I](#part-i--the-system-as-a-whole) describes the system as it stands** — how the
pieces fit together, the data model as a narrative, every business rule and the one file
that owns it, a single request followed through every file it touches, where to start
reading, and one merged glossary. It was written last and checked against the code. **If
you are reading this guide for the first time, read Part I and stop there.**

**[Part II](#part-ii--the-build-phase-by-phase) is the build log** — one section per
phase, appended while the reasoning was still fresh, each covering what was built, why it
is shaped that way, what was rejected, and what bit us. It is a chronology, so an early
section describes code that later phases changed; Part I is the current account, and wins
where the two disagree.

[docs/BUILD-PLAN.md](BUILD-PLAN.md) says what each phase builds;
[docs/DECISION-LOG.md](DECISION-LOG.md) records the calls made without the owner present;
[CLAUDE.md](../CLAUDE.md) holds the scaffold constraints that are not negotiable.
Where a decision was *forced* by the scaffold or the AWS IAM boundary rather than
freely chosen, this guide says so explicitly — that distinction is invisible in finished
code and is the one thing a reader cannot reconstruct.

---

# Part I — The system as a whole

*This part was written last, in M8, and reads the codebase as it finally stands. The
phase sections in [Part II](#part-ii--the-build-phase-by-phase) are a chronology: they
record what was built when, and what was being argued about at the time. This part is a
description: it assumes you have never seen any of it and owes you no history.*

*Every file path, function name and route below was checked against the code at the time
of writing. Where this part and a phase section disagree, this part is right — a phase
section is a snapshot of a morning, and some of them are four phases old.*

---

## 1. System overview

### 1.1 The whole thing in one paragraph

ACME Facility Incident Management is a ticketing system for workplace problems. An
employee reports that their monitor flickers; an engineer picks the ticket up, works it,
and resolves it; the employee confirms the fix or says it is still broken; a facility
admin watches the whole estate on a dashboard and moves work around. It is **one
database, one backend process and one browser application**. There is no queue, no
worker, no cache, no second service and no external integration. Everything the system
knows is in PostgreSQL, and everything it does happens inside a single HTTP request.

That flatness is worth stating up front, because the interesting structure is not in the
topology — there is barely any — but in **where each rule is allowed to live**.

### 1.2 The four moving parts

**1. The React application** (`frontend/`) is a single-page app: React 19, TypeScript,
Vite, Material UI, TanStack Query, React Router. It is a static bundle. It holds no
business rules. Its job is to ask the API what the current user may do and render the
answer — a discipline pursued far enough that the workflow buttons on the ticket page
are drawn from an API response listing them, rather than from any table in the
TypeScript.

**2. The FastAPI application** (`backend/v1/app/`) is where every rule lives. It is
organised **layer-first**: `routers/` (HTTP), `services/` (rules), `repositories/`
(SQL), `models/` (tables), `schemas/` (wire shapes), `security/` (identity), each with
one module per domain. A router validates and delegates; it decides nothing. A service
decides everything and commits nothing. A router commits.

> The backend is layer-first and the frontend is feature-first — the two halves are
> organised on different axes because they have different reasons to change. The full
> directory tree is in [the README's Code layout section](../README.md#code-layout) and
> is not repeated here; what follows is why the layers exist rather than what is in them.

**3. PostgreSQL** holds ten tables and is not merely a store. Constraints that can be
expressed in the schema are expressed there (a `BLOCKED` ticket cannot exist without a
blocked reason), the full-text search document is a generated column the application
cannot desynchronise, and every number on the admin dashboard is computed by an
aggregate query rather than a Python loop.

**4. The Lambda wrapper** (`backend/v1/function.py`) is thirty-six lines. It adapts the
ASGI application to Lambda's event shape with Mangum, and routes any event carrying an
`action` key to `app/services/ops.py` instead — which is how migrations and seeding run
against a database no laptop can reach.

### 1.3 Why it is split that way

The split follows one rule, applied consistently: **a thing that can be decided in only
one place is put in exactly one place, and every other place asks.**

- *What may happen to a ticket* is decided in `app/workflow.py`, as a tuple of eleven
  `Transition` rows. The service that performs a transition reads that table; the
  endpoint that tells the frontend which buttons to draw reads that table; the unit test
  suite parametrises over that table, so a row added without a test is not possible.
  Nothing restates it — not the routers, not the React code.
- *Who may see which rows* is decided in `app/services/visibility.py`, as two functions
  that take a SQLAlchemy `Select` and return a narrower one. They are applied to the
  **query**, never to the serialised result, and the repository functions that need them
  take the already-narrowed statement as an argument rather than building their own —
  so there is no `select(IncidentNote)` at the point of use to forget to filter.
- *What time it is* is decided in `app/clock.py`, one function, and every rule that
  depends on the clock takes `now` as a parameter defaulting to it. That is why the
  seven-day reopen window and the fifteen-minute note-edit window are testable without
  sleeping or freezing time globally.
- *Which fields a dialog must collect* is decided by the same workflow row that decides
  the transition, travels to the browser as `required_fields`, and is rendered by
  `TransitionDialog` with no local mapping from "Resolve" to "resolution summary".

The layering is the mechanism that keeps those single places honest. A rule can only be
duplicated if two layers both know about it, so the layers are kept ignorant of one
another: repositories do not know who is asking (`services/incident_service.py`
`resolve_filters` turns "my tickets" into a concrete `reporter_id` before the repository
sees it), and routers do not know what the rules are.

### 1.4 What was forced on us, and by what

Four fifths of the unusual-looking decisions in this codebase are not preferences. They
come from the workshop scaffold — the pre-built `infra/` Terraform and `bin/` scripts we
were told to deploy with — and from the narrow AWS IAM boundary the participant role
runs under. In finished code these are invisible, so they are collected here.

| Constraint | Imposed by | What it forces |
| --- | --- | --- |
| **Exactly one backend service** | `infra/locals.tf` globs `backend/*/requirements.txt` one level deep and turns *every* match into its own Lambda — each with a public, unauthenticated Function URL | One service directory, `backend/v1/`. Creating `backend/anything-else/requirements.txt` silently provisions a second, open endpoint. |
| **The handler must be `function.handler`, the runtime python3.13** | hardcoded in `infra/locals.tf` (`local.backend_names_python`); `infra/lambda.tf` only reads `each.value.handler` / `each.value.runtime` back out of that map | `function.py` sits at the service root and exposes a module-level `handler`. It cannot be moved into the package. |
| **Every route starts with `/api/v1`** | `infra/cloudfront.tf` builds `path_pattern = "/api/<service-dir-name>*"` and forwards the **full, unmodified** path | The application owns the whole prefix (`API_PREFIX` in `app/config.py`), including the OpenAPI docs. The service directory is named `v1`, so the API version is a directory name. |
| **No API Gateway, no VPC, no state bucket** | `infra/policy.tftpl` grants no `apigateway:*`, `ec2:CreateVpc`, `ec2:CreateSubnet`, `eks:*` or `docdb:*` | Deployment is a Lambda Function URL behind CloudFront. The VPC and security group are pre-provisioned and adopted by `infra/data.tf`. |
| **Migrations cannot run from a laptop** | Aurora is `publicly_accessible = false` | `function.py` dispatches on a non-HTTP event shape to `app/services/ops.py`. Direct invoke is IAM-protected and is not routed by CloudFront, so `migrate`, `seed_admin` and `seed_demo` exist without a public maintenance endpoint or a second Lambda. |
| **A cold request can take ~15 seconds** | Aurora Serverless v2 runs at `min_capacity = 0.0` and sleeps when idle | `postgres_connect_timeout` defaults to 30 s, the engine uses `pool_pre_ping=True`, and the browser's query client retries once. A hung first request after a quiet period is usually this, not a bug. |
| **Connection details arrive as env vars** | `infra/locals.tf` injects `IS_LOCAL`, `POSTGRES_*` and `JWT_SECRET` | There is no `DATABASE_URL` and no `docker-compose.yml`. `app/config.py` builds the SQLAlchemy URL from the parts and appends `sslmode=require` when not local. |
| **CloudFront's 404 handling had to be replaced** | the scaffold mapped every 404 to `200 /index.html`, distribution-wide, including the API | Replaced with a CloudFront Function on the default behaviour only. Without this the API cannot return a real 404. See `docs/INFRA-CHANGES.md` item 1 — the one change with no workaround. |

Two consequences of that list are worth internalising, because they explain choices that
otherwise look arbitrary:

**Same-origin in both environments.** CloudFront fronts the S3 bundle and the Lambda
from one distribution; locally, Vite's dev proxy forwards `/api` to uvicorn *without
rewriting the path*. So the browser is same-origin with the API everywhere. That is what
makes a `SameSite=Strict; HttpOnly` refresh cookie work with no CORS configuration and
no environment-specific special case — and it is why `bin/proxy-server.js`, which strips
the `/api/<name>` prefix, is deliberately unused.

**One request at a time, per process.** A Lambda container handles one invocation at a
time. That is why `app/db.py` creates one engine per process with `pool_size=1`, and why
the ORM is used synchronously rather than with async sessions: there is no concurrency
inside the process for async to overlap.

### 1.5 What was chosen freely

For contrast, these were arguments we had with ourselves, not constraints:

- **Layer-first, not feature-first.** With eight domains and one team, `services/` next
  to `services/` makes the rule layer readable as a unit.
- **The workflow as data.** See §4 and `app/workflow.py`'s own docstring.
- **`allowed-transitions` as the UI's only source of workflow truth**, at the cost of an
  extra request per ticket view.
- **bcrypt used directly rather than through passlib**, with an explicit SHA-256 +
  base64 pre-hash so a long password does not hit bcrypt's 72-byte limit.
- **Two authenticated-user dependencies** (`get_authenticated_user` and
  `get_current_user`), which is how the forced-password-change gate is enforced in one
  place without a URL-matching middleware.
- **The access token in memory only**, with an `HttpOnly` cookie as the thing that
  survives a reload.
- **Period reports and current-state reports as two different shapes** — the decision
  that took three passes to get right (D5 → D9 → D10 → D11).

---

## 2. The data model as a narrative

Ten tables. Read them in this order — it is neither alphabetical nor the order they were
created in, but the order in which each one becomes necessary.

Everything below is defined in `backend/v1/app/models/`, one module per table, and
created by `backend/v1/alembic/versions/0001_initial_schema.py`. Two conventions are
declared once in `models/base.py` and then inherited, and **the exceptions to each are
the interesting part**:

- `UUIDPrimaryKeyMixin` gives a table `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
  Nine of the ten use it. The exception is `engineer_profiles`, whose primary key *is*
  `user_id` — it is an extension of a user, not an identity of its own (§2.2).
- `TimestampMixin` gives a table `created_at` and `updated_at` as UTC `timestamptz`.
  Eight of the ten use it. The exceptions are `incident_events` and `refresh_tokens`,
  which are written once and never modified, and say so by declaring `created_at`
  themselves and omitting `updated_at` (§2.7, §2.9).

So the mixins a model does *not* inherit tell you what kind of row it is before you read
a single column.

### 2.1 `users` — everyone, one role each

Start here because every other table eventually points at it. An account has an `email`
(`CITEXT`, so uniqueness and lookup are case-insensitive **in the database** rather than
depending on every caller remembering to lowercase first), a bcrypt `password_hash`, a
`full_name`, and exactly one `role` of `EMPLOYEE | ENGINEER | FACILITY_ADMIN`. There is
no role table and no many-to-many: the brief has three personas and a person is one of
them.

Three columns are worth noticing:

- `is_active` — accounts are deactivated, never deleted. A deleted user would take their
  name off every ticket they reported or worked.
- `must_change_password` — set on accounts whose password was generated by somebody
  else. While it is true, every endpoint except `/auth/*` returns 403 with
  `code: "PASSWORD_CHANGE_REQUIRED"`.
- `last_building_id` / `last_floor_id` / `last_seat_id` — nullable FKs, `ON DELETE SET
  NULL`, used to pre-fill the report form. Stored as three plain columns rather than
  derived from the user's most recent incident, so the pre-fill survives that ticket
  being closed or moved out of view.

`User.is_staff` is a property, not a column: `role in (ENGINEER, FACILITY_ADMIN)`.

### 2.2 `engineer_profiles` — the 1:1 extension, and why it is a table

Engineers carry five facts employees do not: a `level`, the category groups they cover,
a home building, a phone number, an availability state and a ticket ceiling. Those could
have been nullable columns on `users`. They are a separate table because that way they
are genuinely `NOT NULL` — `level` defaults to `JUNIOR` and is never null — and the
employee case stays uncluttered.

The primary key **is** `user_id`. There is no separate identity here; the row is an
extension of a user, `ON DELETE CASCADE`.

`specialty_group_ids` is a `UUID[]` rather than a join table. That is a deliberate
exception to normalising, and it is defensible for a specific reason: the array is only
ever read and written *whole* (an admin sets an engineer's specialties in one dialog;
the incident list filters with `category_id IN (SELECT id FROM categories WHERE
parent_id = ANY(...))`). It is never queried by membership alone, which is the thing an
array is bad at.

`max_active_tickets` carries a `CHECK (max_active_tickets > 0)`. "Active" is not defined
here — it is `ACTIVE_INCIDENT_STATUSES` in `models/enums.py`, so that an engineer's
`active_ticket_count`, the capacity warnings in `services/assignment.py`, and the live
escalation filters in the reports all mean the same thing.

### 2.3 `buildings` → `floors` → `seats` — where a problem is

A strict three-level hierarchy, one table per level, each child `ON DELETE CASCADE` from
its parent.

- `buildings` — `name` and `code` both unique. Codes are uppercased on the way in
  (`services/facilities.py::_normalise_code`) so `sfo-1` and `SFO-1` cannot both exist.
- `floors` — `UNIQUE(building_id, level_number)`, and `name` for display ("Level 3").
- `seats` — `UNIQUE(floor_id, code)`, with a `seat_type` of
  `DESK | MEETING_ROOM | COMMON_AREA | OTHER`.

**Meeting rooms are seats, not a fourth table.** They occupy exactly the same position in
the hierarchy and an incident can be reported against either, so a discriminator column
is the whole difference. The questionnaire relabels the field "Room" and filters to
`seat_type = MEETING_ROOM` when the category group calls for it — presentation, in
`display/labels.ts::seatFieldLabel`, not structure.

All three carry `is_active`. **Deactivation does not cascade**, deliberately: a floor of
a deactivated building keeps `is_active = true` in its own row, and the tree query simply
never reaches it. Reactivating the building therefore restores exactly what was there
before, rather than a flattened version of it.

### 2.4 `categories` — what kind of problem, in exactly two levels

One self-referencing table. `parent_id IS NULL` means a **group**; a non-null `parent_id`
means a **subcategory**. Seeded with five groups and 32 subcategories
(`app/seed/categories.py`), admin-editable thereafter.

**Why two levels rather than a flat list.** The report questionnaire asks two questions
and only two: "What kind of problem is it?" (five cards) and then "Which one?" (the
chosen group's children). A flat list of 32 makes the first question unanswerable and the
second a scroll. The two levels are not an arbitrary depth — they are the two questions,
made durable.

**Why two levels rather than arbitrary nesting.** Unbounded nesting turns the
questionnaire into a drill-down of unknown length, and makes the category report
(`/reports/categories`, which nests subcategory counts inside group totals) a recursive
structure that no chart can render. Two levels is the depth at which the data is still a
table.

**Why one table rather than `category_groups` + `categories`.** Both would carry the same
columns, every read would union or join them, and the admin screen edits both with one
dialog. The self-reference costs one nullable FK.

Depth is enforced by the **service layer, not the schema**:
`services/categories.py::_resolve_parent` refuses a `parent_id` that names a subcategory
(`CATEGORY_TOO_DEEP`, 422), and `CategoryUpdate` has no `parent_id` field at all — so
there is no re-parenting endpoint through which a third level could appear later.

Three columns belong to the group and are inherited by its children:
`location_detail` (`BUILDING | FLOOR | SEAT` — how precise a location this kind of
problem needs), `hint` (the line under the card) and `icon` (a Material UI icon name
rendered by `categoryIcons.ts`). Setting any of them on a subcategory is a 422
(`GROUP_ONLY_FIELDS`), and changing a group's `location_detail` rewrites its children in
the same transaction (`repositories/categories.py::set_children_location_detail`) so the
two cannot drift.

The unique constraint is `UNIQUE(parent_id, name)` **`NULLS NOT DISTINCT`** (PostgreSQL
15+). Without that modifier the constraint would silently never apply to groups at all,
because their `parent_id` is NULL and NULLs never collide — two groups called "Hardware"
would be legal.

### 2.5 `incidents` — the ticket everything else is about

The widest table, and the one that pulls the previous four together. Grouped by what each
part is for:

**Identity.** `ticket_number BIGINT UNIQUE` defaulting to `nextval('incident_ticket_seq')`
— a dedicated sequence, not a count and not the UUID, so numbers are stable and never
reused. Displayed as `INC-000123` by `format_reference()`, which exists as a module-level
function as well as an `Incident.reference` property because the reports read ticket
numbers out of aggregate rows rather than mapped objects, and the zero-padding must not
be written down twice.

**Content.** `title`, `description`. Their length bounds (5–120, 10–5000) live in
`schemas/incident.py`, not the schema.

**Classification.** `category_id` → `categories`, `ON DELETE RESTRICT`. It must be a
**subcategory**; the check is in `services/incident_service.py::_require_reportable_subcategory`
because the rule needs a lookup the schema cannot do.

**Location.** `building_id` `NOT NULL`, `floor_id` and `seat_id` nullable, all
`ON DELETE RESTRICT`. How many are required depends on the category group's
`location_detail` (`REQUIRED_LOCATION_FIELDS`), and consistency — floor in building, seat
on floor — is checked in the service, because a location path rendered on every screen
must not be a lie.

**Workflow.** `status`, `priority`, both indexed enums. `priority` sorts on the
PostgreSQL enum, whose declared order is `LOW < MEDIUM < HIGH < CRITICAL`, which is why
`-priority` really is "most urgent first" with no `CASE` expression.

**People.** `reporter_id` (`RESTRICT` — you cannot delete someone's history) and
`assignee_id` (`SET NULL`). Three foreign keys point at `users` from this table, which is
why each relationship names its FK explicitly, and why the escalation relationship is
called `escalator` while the column is `escalated_by`.

**Escalation.** `is_escalated`, `escalation_reason`, `escalated_at`, `escalated_by`. The
flag is raised by `escalate()` and lowered by exactly one thing, `clear_escalation()` —
closing a ticket does **not** lower it, on purpose, because "this was escalated before it
was fixed" is a fact worth keeping. That choice is why three reporting queries have to
say `status IN (OPEN, IN_PROGRESS, BLOCKED)` alongside `is_escalated`; see D10 and D11.

**Blocking.** `blocked_reason_type`, `blocked_reason`, and a table-level
`CHECK (status <> 'BLOCKED' OR blocked_reason_type IS NOT NULL)` — enforced by the
database so that no code path can produce a blocked ticket with no reason. The columns are
cleared when the ticket leaves `BLOCKED`; the history stays in the event log.

**Resolution.** `resolution_summary`, `close_reason`, `duplicate_of_id` (a self-reference,
`SET NULL`), `reopen_count`.

**Lifecycle timestamps.** `assigned_at`, `acknowledged_at`, `resolved_at`, `closed_at` —
all `timestamptz`. `assigned_at` and `acknowledged_at` are set once and never overwritten
(they answer "how long did this wait?", which a reassignment does not change);
`resolved_at` and `closed_at` are cleared on reopen. Revision `0002` exists solely to make
these timezone-aware: they were declared as bare `Mapped[datetime]` in `0001`, which
SQLAlchemy renders as `TIMESTAMP WITHOUT TIME ZONE`, and the reopen window's
`now - closed_at` is a `TypeError` against a naive column.

**Search.** `search_vector` — see §2.6.

### 2.6 `search_vector`, and why it is a generated column

```
setweight(to_tsvector('english', coalesce(title, '')),       'A') ||
setweight(to_tsvector('english', coalesce(description, '')), 'B')
```

A `tsvector` is PostgreSQL's parsed form of a document: each word reduced to its stem
(so "flickering" and "flickers" both become `flicker`) with its positions. `@@` asks
whether a `tsvector` matches a `tsquery`. The `ix_incidents_search_vector` **GIN** index
makes that match fast by storing a posting list per stem, the way a book index stores a
page list per word.

`setweight` tags each half with a label — `'A'` for the title, `'B'` for the description
— which `ts_rank` then scores differently, so a ticket with the search term in its title
outranks one that merely mentions it in the body.

The important part is `GENERATED ALWAYS AS (...) STORED`, expressed in SQLAlchemy as
`Computed(SEARCH_VECTOR_EXPRESSION, persisted=True)`. PostgreSQL computes and stores the
value on every insert and update of `title` or `description`. Nothing in the application
writes it, so:

- it **cannot drift** from the columns it summarises, which an application-maintained
  column or a trigger eventually does;
- editing a ticket's title reindexes it with no code path to remember;
- there is no backfill to run and no "rebuild the search index" maintenance action.

The cost is that the expression is part of the schema, so changing the weights or adding
a field to the document is a migration rather than a deploy.

### 2.7 `incident_events` — the append-only audit log

One row per thing that happened: `incident_id`, `actor_id` (nullable, so a
system-generated event is representable), `event_type`, `from_value`, `to_value`, `reason`,
`created_at`. Indexed on `(incident_id, created_at)`. **No `updated_at`**, because rows are
written and never modified — the class declares `created_at` itself rather than inheriting
`TimestampMixin`, and that omission is the type signature of "append-only".

`from_value` and `to_value` are `TEXT`, not enums, because one column carries statuses,
priorities *and* user ids depending on `event_type`. That is deliberate: storing the id of
the person a ticket was assigned to is right for an audit row (a name can change; an id
cannot) and unreadable on a screen, so `incident_service.resolve_event_labels()` resolves
every id in a timeline in one query and the router renders `from_label`/`to_label`
*alongside* the raw values rather than instead of them.

Events carry machine-readable from/to rather than a rendered message because they are read
by two very different consumers: the activity timeline a human reads, and the timing
metrics the reports compute. `repositories/reports.py::_blocked_since()` answers "how long
has this been blocked?" with `MAX(created_at)` over the `STATUS_CHANGED` events whose
`to_value` is `'BLOCKED'` — which is why there is no `blocked_at` column. The audit log
already holds that fact, exactly, and a column would be a second copy with its own write
path to keep in step (D6).

### 2.8 `incident_notes` — the conversation, and why it is not the same table

A note has an `incident_id`, an `author_id`, a `body`, a `visibility` of `PUBLIC` or
`INTERNAL`, an `edited_at` and a `deleted_at`.

**Why this is not `incident_events` with a `NOTE_ADDED` body.** The two tables look
adjacent — both are per-incident, chronological, actor-stamped — and they are genuinely
different kinds of thing:

| | `incident_events` | `incident_notes` |
| --- | --- | --- |
| Written by | every service that changes state | a person |
| Content | `from_value` / `to_value` / `reason`, machine-readable | prose |
| Mutable | never | `body` editable for 15 minutes; soft-deletable |
| Visible to | everyone who can see the ticket | filtered: employees never receive `INTERNAL` |
| Also read by | the reporting queries, as measurements | nothing but the timeline |

Merging them would mean one table with two disjoint sets of nullable columns, an audit
trail whose rows can be edited, a visibility filter that has to be careful not to hide
events, and reporting queries scanning prose to find status changes. There is deliberately
**no `NOTE_ADDED` event**: the note *is* the record, and writing both would put the same
fact in two places and double the timeline.

They are merged only at read time, in Python, by
`incident_service.load_activity()` — `[*events, *notes]` sorted by `created_at`. A SQL
`UNION` would require padding both sides with nulls to make the shapes match, and the
result is one ticket's history: tens of rows, not thousands.

That merge is the reason both tables override `created_at` to default to
`clock_timestamp()` rather than `now()` (revision `0003`). PostgreSQL's `now()` is the
**transaction** start time, so every row written by one request would share a timestamp
and the timeline's `ORDER BY created_at` would fall back to comparing random UUIDs — which
is precisely what happened to a request that writes two events, such as clearing an
escalation *and* changing the priority.

Deletion is soft. An audit trail does not get holes punched in it, and
`apply_note_visibility()` excludes `deleted_at IS NOT NULL` for every role — so "deleted"
and "internal" are two exclusions kept in one function, where no query can remember one
and forget the other.

### 2.9 `refresh_tokens` — the session, off to one side

`user_id`, `token_hash UNIQUE`, `expires_at`, `revoked_at`, `created_at`. No
`updated_at`: a row is written once and then, at most, has `revoked_at` set.

Only the **SHA-256 hash** of the token is stored, so a database leak does not hand out
usable sessions, exactly as with passwords. Plain SHA-256 rather than bcrypt is correct
here and not a shortcut: the token is 32 bytes of cryptographic randomness, so there is
nothing for a slow hash to defend against, and lookup has to be an indexed equality match,
which a salted hash cannot do.

This table is the only stateful part of authentication. Access tokens are stateless JWTs
and are never stored.

### 2.10 Where a new field goes

The point of the above is to make this predictable. The questions, in order:

1. **Is it a fact about a ticket, or a thing that happened to one?** A fact is a column on
   `incidents`. A thing that happened is a row in `incident_events` — and if you find
   yourself wanting both, you almost certainly want the event, plus a column only if a
   query needs to filter on the current value cheaply. `is_escalated` is exactly that pair,
   and D10 is the write-up of what it costs.
2. **Does it need a new status, or a new move between statuses?** That is a row in
   `TRANSITIONS` in `app/workflow.py` and a test. Nothing else — not the routers, not the
   React code.
3. **Is it presentation for a category group?** It joins `hint`, `icon` and
   `location_detail` on `categories`, goes into `GROUP_ONLY_FIELDS`, and is inherited by
   subcategories.
4. **Is it a fact about an engineer rather than a user?** `engineer_profiles`. If an
   employee could ever have it, it belongs on `users`.
5. **Is it a place?** The hierarchy is fixed at three levels. A new *kind* of place is a
   `seat_type`, not a table.

And the mechanical part, for a new column on `incidents`: a revision in
`alembic/versions/`, the column on `models/incident.py`, the field on the relevant
`schemas/incident.py` models (`IncidentCreate` / `IncidentUpdate` / `IncidentRead`), any
rule about it in `services/incident_service.py` (and a name in `CONTENT_FIELDS` or
`CLASSIFICATION_FIELDS` if it is permission-checked as content), then the TypeScript type
in `frontend/src/api/types.ts` and whatever renders it. Five files plus the migration, in
that order.
---

## 3. The complete rule-to-file map

Every business rule in the system and the single file that owns it. This merges the nine
partial maps in Part II, removes the duplicates, and was re-checked against the code:
every path exists and every symbol named is defined in the file beside it.

**How to use it.** Find the behaviour in the left column; the middle column is the file to
open; the right column is what to search for inside it. Backend paths are relative to
`backend/v1/`, frontend paths to `frontend/src/`.

**The one rule about this table.** If a behaviour appears twice, that is a bug in the
code, not in the table. Where two layers both touch a rule, the row says which one is
*authoritative* and what the other one is doing.

### 3.1 Identity, sessions and access

| Rule | File | Symbol |
| --- | --- | --- |
| Who may self-register (the `@acme.inc` rule) | `app/services/auth_service.py` | `normalise_email`, `ALLOWED_EMAIL_DOMAIN` |
| Why `x@acme.inc@evil.com` and `x@sub.acme.inc` are rejected | `app/services/auth_service.py` | `normalise_email` — split on the **last** `@`, then exact domain equality |
| New accounts are always EMPLOYEE | `app/services/auth_service.py` | `register_employee` hardcodes the role; and `RegisterRequest` (in `app/schemas/auth.py`) has no `role` field to ignore |
| Password length policy | `app/security/passwords.py` | `MIN_PASSWORD_LENGTH`, `MAX_PASSWORD_LENGTH` — mirrored (not decided) by `app/schemas/auth.py` |
| Password hashing, and the pre-hash that must never be removed | `app/security/passwords.py` | `BCRYPT_ROUNDS`, `hash_password`, `_prehash` |
| A failed login costs the same time whether the account exists | `app/services/auth_service.py` | `authenticate`, `_DUMMY_HASH` |
| Token lifetimes | `app/security/tokens.py` | `ACCESS_TOKEN_TTL` (15 min), `REFRESH_TOKEN_TTL` (7 days) |
| What is in an access token, and what is not trusted from it | `app/security/tokens.py` | `create_access_token`, `AccessTokenClaims` — role is re-read from the DB every request |
| Refresh-token rotation, and what a replayed token does | `app/services/auth_service.py` | `rotate_session` — a revoked token revokes **every** session for that user |
| Refresh tokens are stored hashed | `app/security/tokens.py` | `generate_refresh_token`, `hash_refresh_token` |
| Cookie name, path and flags | `app/security/dependencies.py` + `app/routers/auth.py` | `REFRESH_COOKIE_NAME`, `REFRESH_COOKIE_PATH`, `_set_refresh_cookie` |
| Whether the cookie is `Secure` | `app/config.py` | `Settings.cookie_secure` — false locally, true deployed |
| The forced-password-change gate | `app/security/dependencies.py` | `get_current_user` vs `get_authenticated_user`; `PASSWORD_CHANGE_REQUIRED` |
| Role permissions at the endpoint | `app/security/dependencies.py` | `require_roles`, and the `ADMIN_ONLY` / `STAFF_ONLY` / `SIGNED_IN` aliases |
| Engineer-level permissions at the endpoint | `app/security/dependencies.py` | `require_engineer_levels` — admins pass every level check |
| Who may see deactivated rows | `app/security/dependencies.py` | `get_include_inactive` — refuses the flag rather than ignoring it |
| Changing your own password ends every session | `app/services/auth_service.py` | `change_password`, which calls `revoke_all_refresh_tokens` in `app/repositories/users.py` |
| The first admin account | `app/services/auth_service.py` | `seed_first_admin`, reachable only via the `seed_admin` ops action |

### 3.2 The incident workflow

Everything in this block is in **one file**, `app/workflow.py`, and that is the point.

| Rule | Symbol in `app/workflow.py` |
| --- | --- |
| Which status changes exist at all | `TRANSITIONS` — eleven `Transition` rows |
| Who may make each one | `Transition.allowed_actors` |
| What a dialog must collect | `Transition.required_fields` |
| What the button says | `Transition.action_label` |
| Which close reason is recorded | `Transition.close_reasons`, `fixed_close_reason`, `caller_picks_close_reason` |
| Whether a move counts as a reopen | `Transition.is_reopen`, `Transition.event_type` |
| Who counts as REPORTER / ASSIGNEE / FACILITY_ADMIN on *this* ticket | `resolve_actors` — and a LEAD engineer is ASSIGNEE on any ticket |
| Which row wins when a caller holds two actor roles | `ACTOR_PRECEDENCE`, `_highest_precedence` |
| A ticket needs an assignee before work can start | `_requires_an_assignee` |
| Seven days to reopen, after which CLOSED is terminal | `REOPEN_WINDOW`, `_within_the_reopen_window` |
| Which moves are offered right now | `available_transitions`, `_reachable_statuses` |
| Which move an explicit request resolves to | `select_transition` |

And the part a table cannot express, in `app/services/incident_service.py`:

| Rule | Symbol |
| --- | --- |
| Executing a move, and refusing one with a 409 that lists the legal ones | `perform_transition`, `_describe` |
| The timestamps and fields entering a status implies | `_apply_transition_effects` — keyed on the status being **entered**, not on the transition |
| Required fields are actually present | `_require_transition_fields` |
| Validating a caller-chosen close reason | `_resolve_close_reason` |
| A duplicate must be a real, different ticket | `_resolve_duplicate_target` |
| Which moves to offer the frontend | `allowed_transitions` |

### 3.3 Incidents — creation, editing, permissions

| Rule | File | Symbol |
| --- | --- | --- |
| A ticket is filed against a subcategory, never a group | `app/services/incident_service.py` | `_require_reportable_subcategory` |
| How precise a location the category group demands | `app/services/incident_service.py` | `REQUIRED_LOCATION_FIELDS`, `_require_location_precision` |
| Floor must be in the building; seat must be on the floor | `app/services/incident_service.py` | `_require_floor_in_building`, `_require_seat_on_floor` |
| Which location message the form shows | `app/services/incident_service.py` | `_missing_location_message` |
| Who may edit a ticket's content and location | `app/services/incident_service.py` | `can_edit_content`, `CONTENT_FIELDS` |
| When the questionnaire rules are re-checked on an edit | `app/services/incident_service.py` | `CLASSIFICATION_FIELDS`, `_revalidate_classification` |
| Who may change priority, and for how long | `app/services/incident_service.py` | `can_change_priority` |
| Who may escalate, and in which statuses | `app/services/incident_service.py` | `may_escalate`, `can_escalate`, `ESCALATABLE_STATUSES` |
| Who may clear an escalation, and what clearing does | `app/services/incident_service.py` | `can_clear_escalation`, `clear_escalation` |
| Where the next report form is pre-filled from | `app/services/incident_service.py` | `_remember_location` |
| What `mine=` and `specialty=` mean for *this* caller | `app/services/incident_service.py` | `resolve_filters`, `_resolve_specialties` |
| Merging events and notes into one timeline | `app/services/incident_service.py` | `load_activity` |
| Turning recorded user ids into names | `app/services/incident_service.py` | `resolve_event_labels`, `_USER_VALUED_EVENTS` |
| Title and description bounds (authoritative) | `app/schemas/incident.py` | `IncidentTitle`, `IncidentDescription` |
| What `?assignee_id=unassigned` means | `app/schemas/incident.py` | `UNASSIGNED`, `AssigneeFilter` |
| How the location path is rendered | `app/routers/incidents.py` | `_location_summary` — using `LOCATION_SEPARATOR`, which is defined in `app/schemas/incident.py` |
| Which `can_*` flags the detail response carries | `app/routers/incidents.py` | `_to_read` |

### 3.4 Assignment

| Rule | File | Symbol |
| --- | --- | --- |
| Who may change an assignee at all (drives the button) | `app/services/assignment.py` | `can_assign` |
| Who may make *this* assignment (enforces it) | `app/services/assignment.py` | `_require_permission`, `_require_self_pick_up` |
| A senior may pick up only free, open tickets | `app/services/assignment.py` | `_is_free_to_pick_up` |
| Who may receive work | `app/services/assignment.py` | `_require_assignable_engineer` — 422, because the id came from a body as a value |
| Capacity and availability warn but never refuse | `app/services/assignment.py` | `_capacity_warnings`, `UNAVAILABLE_STATES` |
| `assigned_at` is set once and never overwritten | `app/services/assignment.py` | `assign` |
| Unassigning goes through the same path | `app/services/assignment.py` | `_unassign` |
| What counts as an active ticket, application-wide | `app/models/enums.py` | `ACTIVE_INCIDENT_STATUSES` |

### 3.5 Notes and visibility

| Rule | File | Symbol |
| --- | --- | --- |
| Who may write a note | `app/services/notes.py` | `can_add_note` |
| Who may write an INTERNAL note | `app/services/notes.py` | `can_add_internal_note`, `_require_internal_note_permission` |
| The fifteen-minute edit window | `app/services/notes.py` | `EDIT_WINDOW`, `can_modify_note`, `_require_modify_permission` |
| Deletion is soft | `app/services/notes.py` | `delete_note` |
| A note the caller may not see is a 404, not a 403 | `app/services/notes.py` | `get_note` |
| **Who sees INTERNAL notes** (and deleted ones) | `app/services/visibility.py` | `apply_note_visibility` — applied to the query |
| **Which incidents a user may read** | `app/services/visibility.py` | `apply_incident_visibility` — today a no-op, and the seam where per-building scoping would go |
| The base statements those filters narrow | `app/repositories/incidents.py` | `notes_query`, and `visible` as a parameter of `list_incidents` |

### 3.6 Search, filtering, sorting and paging

| Rule | File | Symbol |
| --- | --- | --- |
| What a ticket-number search looks like | `app/repositories/incidents.py` | `TICKET_NUMBER_PATTERN`, `parse_ticket_number` |
| Full-text search language and parser | `app/repositories/incidents.py` | `SEARCH_CONFIG`, `_tsquery` (`websearch_to_tsquery`) |
| Which of the two modes a query string picks | `app/repositories/incidents.py` | `_apply_search` |
| Sort orders, and relevance as the default while searching | `app/repositories/incidents.py` | `_SORT_TERMS`, `_order_by` |
| Every list filter | `app/repositories/incidents.py` | `_apply_filters` |
| Filtering by group without joining `categories` | `app/repositories/incidents.py` | `_subcategory_ids`, `_subcategory_ids_in` |
| Which relationships a list and a detail eager-load | `app/repositories/incidents.py` | `_list_loaders`, `_detail_loaders` |
| Re-reading a written row so its relationships are fresh | `app/repositories/incidents.py` | `reload` — `populate_existing=True` |
| Page size default and hard maximum | `app/schemas/common.py` | `DEFAULT_PAGE_SIZE` (25), `MAX_PAGE_SIZE` (100) |
| The list response envelope | `app/schemas/common.py` | `Page`, `build_page`, `Paging` |
| What a DELETE actually did | `app/schemas/common.py` | `DeleteResult` |
| Search wildcards are escaped | `app/repositories/users.py` | `_escape_like` |

### 3.7 Facilities

| Rule | File | Symbol |
| --- | --- | --- |
| Building name and code uniqueness | `app/services/facilities.py` | `_require_free_building_name`, `_require_free_building_code` |
| Building codes are uppercased | `app/services/facilities.py` | `_normalise_code` |
| One floor per level number per building | `app/services/facilities.py` | `_require_free_floor_level` |
| One seat per code per floor | `app/services/facilities.py` | `_require_free_seat_code` |
| A referenced facility cannot be deleted (409) | `app/services/facilities.py` | `delete_building`, `delete_floor`, `delete_seat` |
| What "referenced" means | `app/repositories/facilities.py` | `count_incidents_in_building`, `count_incidents_on_floor`, `count_incidents_at_seat` |
| Bulk seat creation: dedupe within the payload, skip what exists | `app/services/facilities.py` | `bulk_create_seats`, `_deduplicate` |
| Deactivation does not cascade | `app/repositories/facilities.py` | `load_tree` — the tree simply never reaches an inactive parent's children |

### 3.8 Categories

| Rule | File | Symbol |
| --- | --- | --- |
| The tree is exactly two levels | `app/services/categories.py` | `_resolve_parent` |
| Fields that belong to a group only | `app/services/categories.py` | `GROUP_ONLY_FIELDS`, `_reject_group_only_fields`, `_reject_group_only_changes` |
| Subcategories inherit `location_detail` | `app/services/categories.py` | `update_category` → `repositories/categories.py::set_children_location_detail` |
| Siblings may not share a name | `app/services/categories.py` | `_require_free_name` |
| A referenced category is **deactivated**, not deleted | `app/services/categories.py` | `delete_category`, `_deactivate` |
| Default location detail for a group that does not say | `app/services/categories.py` | `DEFAULT_LOCATION_DETAIL` |
| The seeded tree's contents | `app/seed/categories.py` | `CATEGORY_GROUPS` — 5 groups, 32 subcategories |

### 3.9 Engineers and users

| Rule | File | Symbol |
| --- | --- | --- |
| Engineer account and profile are created together | `app/services/engineers.py` | `create_engineer` |
| The temporary password is generated and shown once | `app/services/engineers.py` | `create_engineer`, `TEMPORARY_PASSWORD_BYTES` |
| Specialties must be top-level groups | `app/services/engineers.py` | `_require_group_ids` |
| A home building must exist | `app/services/engineers.py` | `_require_building` |
| What an engineer may change about themselves | `app/schemas/engineer.py` | `EngineerSelfUpdate` |
| Engineers are deactivated, never deleted | `app/services/engineers.py` | `deactivate_engineer` |
| How `active_ticket_count` is computed | `app/repositories/engineers.py` | `_active_ticket_count_column`, `count_active_tickets` |
| An admin cannot change their own role or deactivate themselves | `app/services/users.py` | `_reject_self_change` |
| Promotion to ENGINEER creates a profile; demotion keeps it | `app/services/users.py` | `_apply_role_change` |
| Deactivating a user ends their sessions | `app/services/users.py`, `app/services/engineers.py` | both call `revoke_all_refresh_tokens`, which is defined in `app/repositories/users.py` |
| Email and password are not admin-editable | `app/schemas/user.py` | `UserUpdate` has neither field |

### 3.10 Reports

| Rule | File | Symbol |
| --- | --- | --- |
| **Which reports cover a period and which describe the present** | `app/routers/reports.py` | `ReportPeriod` vs `ReportScopeDep` — two dependencies, so it cannot be got wrong by forgetting |
| What `from`/`to` filter on a period report | `app/repositories/reports.py` | `_window_clauses` — `created_at`, both ends inclusive |
| What a current-state report filters — the building, and nothing else | `app/repositories/reports.py` | `_scope_clauses` |
| Default period, UTC coercion, `from <= to` | `app/services/reporting.py` | `build_window`, `_as_utc` — the default length itself is `DEFAULT_WINDOW_DAYS` in `app/schemas/report.py` |
| The instant a current-state snapshot describes | `app/services/reporting.py` | `build_scope` → `ReportScope.as_of` |
| Which reports are admin-only | `app/routers/reports.py` | `dependencies=[ADMIN_ONLY]` on seven of the eight |
| Why `/reports/me` needs no role | `app/routers/reports.py` | `get_my_report` — the caller *is* the subject; there is no `?user_id=` |
| What `/reports/me` returns to whom | `app/services/reporting.py` | `my_report` — `reported` always, `assigned` only for engineers |
| When a ticket became blocked | `app/repositories/reports.py` | `_blocked_since` — read from the event log, not a column |
| What counts as an escalation somebody can still act on | `app/repositories/reports.py` | `_live_escalation_clauses` — used by all three current-state readers |
| What counts as "kept informed" | `app/repositories/reports.py` | `_first_public_staff_note`, `communication` |
| Which roles are staff for that purpose | `app/repositories/reports.py` | `STAFF_ROLES` |
| Hours, rounding, percentages, `NULL` at a zero denominator | `app/repositories/reports.py` | `_hours`, `_rounded`, `_percentage`, `SECONDS_PER_HOUR`, `MEDIAN` |
| Median rather than mean | `app/repositories/reports.py` | `_median_hours_since_created` — `percentile_cont(0.5)` |
| Every day appears in the daily series, zeroes included | `app/repositories/reports.py` | `summary_per_day`, `_counted_on_day` — `generate_series` supplies the calendar |
| Zeroes appear for unused statuses and priorities | `app/services/reporting.py` | `summary` iterates the enum, not the result rows |
| Top-N limits | `app/schemas/report.py` | `TOP_LOCATION_LIMIT` (10), `ESCALATED_TICKET_LIMIT` (50) |
| Ticket reference formatting in aggregate rows | `app/models/incident.py` | `format_reference` |

### 3.11 Ops, demo data and migrations

| Rule | File | Symbol |
| --- | --- | --- |
| HTTP request versus ops action | `function.py` | presence of an `action` key on the event |
| Which ops actions exist | `app/services/ops.py` | `ACTIONS`, `run_ops` |
| `migrate` also seeds the categories | `app/services/ops.py` | `_op_migrate` — a migrated but unseeded database cannot render the report form |
| Running Alembic without a working directory | `app/migrations.py` | `SERVICE_ROOT`, `build_alembic_config`, `upgrade_to_head` |
| Extensions, enum types and the ticket sequence exist before any table | `alembic/versions/0001_initial_schema.py` | `_create_enum_types`, `TICKET_SEQUENCE` |
| Which enum types exist at all | `app/models/enums.py` | `ENUM_TYPES` — the migration creates exactly these |
| Lifecycle timestamps are timezone-aware | `alembic/versions/0002_timestamptz_lifecycle_columns.py` | — |
| The timeline is stamped per row, not per transaction | `alembic/versions/0003_event_clock_timestamp.py` | `clock_timestamp()` on `incident_events` and `incident_notes` |
| `seed_demo` refuses to run outside local development | `app/services/ops.py` | `_op_seed_demo`, gated on `settings.is_local` |
| Which spec fields an invoke payload may override | `app/services/ops.py` | `SEED_DEMO_OVERRIDES`, `_seed_demo_overrides` |
| How much of everything the demo world contains | `app/seed/demo.py` | `DemoSpec`, `DEFAULT_SPEC` |
| Whether a second seed run does anything | `app/seed/demo.py` | `_existing_demo_building` |
| What a demo ticket's life can look like, and how far along it is | `app/seed/demo.py` | `PATH_WEIGHTS`, `_plan_steps`, `_walk`, `_enter` |
| How long each hop takes, and when tickets are reported | `app/seed/demo.py` | `RESPONSE_MEDIANS`, `_draw_hours`, `_draw_created_at`, `WORKING_HOURS` |
| Who gets assigned what | `app/seed/demo.py` | `_draw_assignee`, `ENGINEER_LOAD_WEIGHTS`, `ENGINEER_SEEDS` |
| Recurring problems at one seat | `app/seed/demo.py` | `_choose_hotspots` |
| The demo password | `app/seed/demo.py` | `DEMO_PASSWORD` |

### 3.12 Environment, errors and plumbing

| Rule | File | Symbol |
| --- | --- | --- |
| Every route starts with `/api/v1` | `app/config.py` | `API_PREFIX`, applied in `app/main.py` |
| Which settings exist and what they default to | `app/config.py` | `Settings` |
| A deployed environment refuses to start with the development signing key | `app/config.py` | `_reject_a_weak_deployed_secret`, `MIN_JWT_SECRET_BYTES` |
| How the database URL is built, and when TLS is required | `app/config.py` | `Settings.database_url` |
| Engine lifetime, pool size, pre-ping | `app/db.py` | `get_engine`, `get_session_factory` |
| The session time zone is pinned to UTC | `app/db.py` | `SESSION_TIME_ZONE`, `build_connect_args` |
| A session per request, always closed | `app/db.py` | `get_db` |
| What time it is | `app/clock.py` | `utc_now` |
| The error response shape | `app/errors.py` | `api_error_handler`, registered in `app/main.py` |
| Which exception means which status | `app/errors.py` | `ValidationError` 422, `AuthenticationError` 401, `AuthorizationError` 403, `NotFoundError` 404, `ConflictError` 409 |
| How a refused transition returns the legal ones | `app/errors.py` | `ConflictError.extra`, merged into the body |
| What "healthy" means | `app/services/health.py` | `build_health_report`, `check_database`, `API_VERSION` |
| Which routers are mounted | `app/main.py` | `create_app` |
| SPA deep links survive without touching `/api/*` | `infra/cloudfront.tf` | `aws_cloudfront_function.spa_router` |
| Lambda environment variables | `infra/locals.tf` | `local.env_vars` |
| Local `/api` proxying, path unchanged | `frontend/vite.config.ts` | `server.proxy` |

### 3.13 Frontend — the session

| Rule | File | Symbol |
| --- | --- | --- |
| Where the access token is kept | `api/client.ts` | a module variable; never `localStorage`, never a readable cookie |
| Which requests carry the bearer token | `api/client.ts` | the request interceptor |
| When a 401 is retried, and how often | `api/client.ts` | `shouldRetry`, `NO_RETRY_PATHS`, `retriedAfterRefresh` |
| That only one refresh ever runs at a time | `api/client.ts` | `refreshInFlight`, `refreshSession` |
| That the refresh call itself bypasses the interceptor | `api/client.ts` | `requestRefresh` |
| That repeated query parameters serialise the way FastAPI reads them | `api/client.ts` | `paramsSerializer: { indexes: null }` |
| How a session is restored on page load | `auth/AuthProvider.tsx` | the mount effect → `refreshSession()` then `fetchMe()` |
| How a session lost in the background is noticed | `auth/AuthProvider.tsx` + `api/client.ts` | `setSessionEndedHandler` |
| Who may open a route at all | `auth/RequireAuth.tsx` | — |
| That a pending password change blocks everything else | `auth/RequireAuth.tsx` | `skipPasswordGate`; **authoritatively** enforced by `app/security/dependencies.py::get_current_user` |
| Who may open a route given their role or level | `auth/RequireRole.tsx` | `isPermitted` — `levels` applies only to engineers |
| What the API's error bodies mean | `api/errors.ts` | `describeError`, `errorCode` |
| Which API failure lands on which form input | `features/auth/formErrors.ts` | `applyApiErrors` |
| Password length and the `@acme.inc` rule, client side | `features/auth/schemas.ts` | mirrors, never decides |

### 3.14 Frontend — rendering the rules rather than restating them

| Rule | File | Note |
| --- | --- | --- |
| **Which workflow buttons a user sees** | `features/incidents/IncidentActions.tsx` | `WorkflowButtons` maps over the `allowed-transitions` response. Nothing else. |
| **What a workflow dialog collects** | `features/incidents/TransitionDialog.tsx` | built from `transition.required_fields`; the one extra input, the duplicate ticket, is revealed by `close_reason === 'DUPLICATE'` |
| Which non-workflow actions a user sees | `features/incidents/IncidentActions.tsx` | `ContextualButtons`, from the `can_*` flags |
| Whether there is anything to show at all | `features/incidents/actionAvailability.ts` | `hasContextualActions`, `hasAnyAction` |
| Which spelling of assign — "Pick up" or "Assign…" | `features/incidents/IncidentActions.tsx` | presentation only; `can_assign` is still the gate |
| Which workflow buttons a **list row** shows | `features/incidents/InlineTransitionButtons.tsx` | asks the same endpoint; `only` filters what is drawn and can never add to it |
| Whether a ticket is blocked, and why | `features/incidents/WorkflowStepper.tsx` | renders it; `app/workflow.py` decides it |
| Which location fields the questionnaire asks for | `features/incidents/LocationPicker.tsx` | from the group's `location_detail`; **valid** is decided by the 422 from `app/services/incident_service.py` |
| Whether a seat is called "Desk" or "Room" | `display/labels.ts` | `seatFieldLabel` |
| Title and description bounds, client side | `features/incidents/reportSchema.ts` | mirrors `app/schemas/incident.py` |
| What an audit event *reads as* | `features/incidents/ActivityTimeline.tsx` | prefers `from_label`/`to_label`, which `app/services/incident_service.py::resolve_event_labels` fills |
| Who may read an INTERNAL note | `app/services/visibility.py` | in the query. The timeline only *styles* them |
| Which icons a category may use | `features/incidents/categoryIcons.ts` | `CATEGORY_ICON_NAMES` |

### 3.15 Frontend — lists, dashboards and presentation

| Rule | File | Symbol |
| --- | --- | --- |
| Every URL in the app | `routes.ts` | `paths`, `incidentPath` |
| Which route is guarded by what | `App.tsx` | the route table |
| What a list screen is *for* | `App.tsx` | the `preset` prop on `IncidentsPage` |
| What a list is filtered by | `features/incidents/useIncidentFilters.ts` | the URL query string; `toQuery`, `PAGE_SIZE` |
| Which filters are shown as removable chips | `features/incidents/AppliedFilterChips.tsx` | — |
| Which cache entries a mutation invalidates | `features/incidents/hooks.ts` | `invalidateIncidents` — the `['incidents']` and `['reports']` prefixes |
| Every query cache key | `api/queryKeys.ts` | `queryKeys` |
| Which reports may be given a date range | `api/reports.ts` | `ReportPeriodParams` vs `ReportScopeParams` — a type, so a wrong call will not compile |
| Which dashboard section a widget belongs in | `features/dashboard/AdminDashboardPage.tsx` | between the two scope headings |
| What a period heading says, and where its dates come from | `features/dashboard/ScopeHeading.tsx` | `PeriodScopeHeading` reads the **response's** `window`, not the picker |
| Whether a dashboard link carries dates | `features/dashboard/listLinks.ts` | `periodListLink` vs `currentListLink` |
| How long a ticket may go unowned before it needs attention | `features/dashboard/NeedsAttentionPanel.tsx` | `UNASSIGNED_HOURS` (24) |
| How many rows the attention panel shows | `features/dashboard/NeedsAttentionPanel.tsx` | `ROW_CAP` |
| Every chart colour, and the contrast checks behind them | `features/dashboard/chartPalette.ts` | `SERIES_PRIMARY`, `PRIORITY_RAMP` |
| Chart form: horizontal bars, one colour, labels outside | `features/dashboard/BreakdownChart.tsx` | — |
| Whether a JUNIOR sees the unassigned queue | `features/home/EngineerHomePage.tsx` | `mayPickUp`; the API enforces it in `services/assignment.py` |
| Whether "Needs your attention" renders | `features/home/EmployeeHomePage.tsx` | shown only when non-empty |
| "Priority then age" ordering on the engineer's home list | `features/home/sortTickets.ts` | `sortByPriorityThenAge` — client-side, over a fixed top-N |
| How engineers are ordered in the assign dialog | `features/engineers/hooks.ts` | `sortForAssignment`; the API decides who may actually be assigned |
| Who sees which navigation item | `layout/navigation.ts` | `navItemsFor`, `reportNavItem` |
| Which navigation item is highlighted | `layout/navigation.ts` | `activeNavPath` — longest matching prefix |
| Which items reach the mobile bottom bar | `layout/navigation.ts` | the `inBottomNav` flag |
| Where the desktop/mobile switch happens | `hooks/useBreakpoint.ts` | `MOBILE_MAX_WIDTH` = 899, aligned with MUI's `md` |
| Where a dialog is full screen | `components/ResponsiveDialog.tsx` | one place, so no screen forgets |
| Where confirmations appear | `components/SnackbarProvider.tsx` | top on a phone, bottom on desktop |
| What a status is called, and what colour it is | `display/labels.ts`, `display/statusColor.ts` | `statusLabel`, `statusChipColor` |
| What colour a workflow button is | `display/statusColor.ts` | `transitionButtonColor` |
| How a duration in hours is worded | `display/time.ts` | `formatHours` |
| How a bare `YYYY-MM-DD` is read without losing a day | `display/time.ts` | `parseCalendarDay` |
| How a role or level is worded for humans | `layout/roleLabels.ts` | `roleLabel`, `levelLabel`, `describeRole` |
| Global styling, palette, component defaults | `theme.ts` | `theme` — there are no `.css` files of ours |
| Which typeface is actually loaded | `fonts.ts` | side-effect imports; `theme.ts` only *asks* for it |

### 3.16 Two things in the code that own no rule

Recorded because a reader who finds them will look for the rule they enforce, and there
is not one. Neither is a bug; both are loose ends, and both were left alone rather than
tidied, because this pass changed documentation only.

- **`current_user_id(user)` in `app/security/dependencies.py`** is defined and **never
  called** — the only occurrence in the repository is its own `def`. Its docstring says
  it exists "so routes read declaratively", which was presumably the intent before
  `CurrentUser` made it unnecessary. Deleting it should break nothing; confirm with a
  grep before doing so.
- **`app/models/category.py` has an empty `if TYPE_CHECKING: pass` block.** Every other
  model uses that block to import the types its relationship annotations reference;
  `Category`'s relationships are self-referential and quote `"Category"`, so there is
  nothing to import. The block is vestigial.
---

## 4. One request, end to end

The richest path in the system: **an engineer resolves a ticket.** It touches identity,
the workflow table, a guard, side effects, the audit log, response assembly and cache
invalidation — every layer, in order. Every function named below exists; follow along with
the files open.

The setup: incident `INC-000482` is `IN_PROGRESS`, assigned to Nina, a SENIOR engineer.
Nina is looking at `/tickets/6f3a…` and clicks **Resolve**.

### Hop 1 — the button exists because the API said so

`features/incidents/IncidentDetailPage.tsx` has three queries running:

```ts
const incident    = useIncident(incidentId);              // ['incidents','detail',id]
const transitions = useAllowedTransitions(incidentId);    // …,'allowed-transitions'  staleTime: 0
const activity    = useActivity(incidentId);              // …,'activity'
const performTransition = useTransition(incidentId);
```

`useAllowedTransitions` has already fetched `GET /api/v1/incidents/{id}/allowed-transitions`.
For Nina, on an `IN_PROGRESS` ticket she is assigned to, the response is two entries — one
of them:

```json
{ "to_status": "RESOLVED", "action_label": "Resolve",
  "required_fields": ["resolution_summary"], "close_reason_choices": [] }
```

`IncidentActions.tsx`'s `WorkflowButtons` maps over that array and renders one `<Button>`
per entry, labelled with `action_label` and coloured by
`display/statusColor.ts::transitionButtonColor`. **There is no list of workflow buttons in
the TypeScript.** `staleTime: 0` on that query is deliberate: a cached list of moves is a
list of buttons that 409 when pressed.

### Hop 2 — the dialog is built from `required_fields`

The click calls `onTransition(transition)`, which sets the page's dialog state and renders
`TransitionDialog`. The dialog reads:

```ts
const requires = (field: string) => transition.required_fields.includes(field);
```

so it draws exactly one input — the `resolution_summary` textarea — and nothing else. There
is no mapping here from "Resolve" to "resolution summary"; that mapping is a field of a row
in `app/workflow.py`. Adding a required field to a transition changes this dialog without
anyone editing it.

On submit it assembles the payload onto `{ to_status: transition.to_status }`, adding only
the keys `required_fields` named, and calls `onSubmit` → `performTransition.mutateAsync`.

### Hop 3 — out of the browser

`features/incidents/hooks.ts::useTransition` → `api/incidents.ts::performTransition(id, payload)` →

```ts
apiClient.post<Incident>(`/incidents/${id}/transitions`, payload)
```

`apiClient`'s **request interceptor** (`api/client.ts`) attaches
`Authorization: Bearer <accessToken>` from the module-level `accessToken` variable — the
token lives in memory and nowhere else. `baseURL` is the constant `'/api/v1'`, so the
browser issues a relative, same-origin request to `/api/v1/incidents/{id}/transitions`.

### Hop 4 — across the network

**Locally:** Vite's dev server proxies `/api` to `http://localhost:8000` *without rewriting
the path* (`frontend/vite.config.ts`), so uvicorn sees `/api/v1/incidents/…`.

**Deployed:** CloudFront matches the `/api/v1*` cache behaviour and forwards the full,
unmodified path to the Lambda Function URL. `function.py::handler` runs, finds no `action`
key on the event, and hands it to `_asgi` — `Mangum(app, lifespan="off")` — which translates
the Lambda event into an ASGI scope and calls the FastAPI application.

Both paths arrive at the same place with the same URL. That is the entire point of the
prefix discipline in §1.4.

### Hop 5 — routing and dependencies

`app/main.py::create_app` mounted `incidents.router` with `prefix=API_PREFIX`, so the
request resolves to `app/routers/incidents.py::create_transition`.

FastAPI resolves its dependencies **before** the function body runs:

1. `session: DbSession` → `app/db.py::get_db` yields a `Session` from the process-wide
   `get_session_factory()`.
2. `user: CurrentUser` → `app/security/dependencies.py::get_current_user`, which depends on
   `get_authenticated_user`, which:
   - `get_bearer_token(request)` — pulls the token out of the `Authorization` header, 401
     `MISSING_TOKEN` if absent;
   - `app/security/tokens.py::decode_access_token(token)` — verifies the HS256 signature
     and the `exp`/`iat`/`sub` claims, 401 `INVALID_TOKEN` on failure;
   - `app/repositories/users.py::get_by_id` — loads the row. **The role is re-read from the
     database, never trusted from the token**, so an admin's change applies on the very next
     request;
   - 401 `INACTIVE_ACCOUNT` if the row is gone or `is_active` is false.

   `get_current_user` then adds the one thing `get_authenticated_user` does not: if
   `user.must_change_password` it raises 403 `PASSWORD_CHANGE_REQUIRED`. That split is the
   whole mechanism of the forced-password-change gate — `/auth/*` routes depend on the
   former, everything else on the latter.
3. `payload: TransitionRequest` — the body is parsed and validated by Pydantic
   (`app/schemas/incident.py`). A malformed body never reaches our code.

### Hop 6 — loading the ticket

```python
incident = incident_service.get_incident(session, incident_id)
```

`app/services/incident_service.py::get_incident` → `app/repositories/incidents.py::get`,
which selects the row with `_detail_loaders()` — six `selectinload` options plus
`escalator` and `duplicate_of`. A missing row becomes `NotFoundError` → 404
`INCIDENT_NOT_FOUND`.

### Hop 7 — the decision, in `perform_transition`

```python
updated = incident_service.perform_transition(
    session, incident=incident, user=user, payload=payload
)
```

Inside `app/services/incident_service.py::perform_transition`, in order:

1. **`moment = now or utc_now()`** — the clock is read once, from `app/clock.py`, and passed
   down. Every guard and timestamp below uses this one value, and a test passes `now=`
   instead.

2. **`workflow.resolve_actors(incident, user)`** — in what capacities is Nina acting on
   *this* ticket? `incident.assignee_id == user.id`, so `{ASSIGNEE}`. (Had she been a LEAD,
   she would count as ASSIGNEE on any ticket; had she reported it, REPORTER would be in the
   set too.)

3. **`workflow.select_transition(IN_PROGRESS, RESOLVED, actors)`** — scans `TRANSITIONS` for
   rows matching the status pair whose `allowed_actors` intersect hers, then
   `_highest_precedence` picks one using `ACTOR_PRECEDENCE`
   (`FACILITY_ADMIN → ASSIGNEE → REPORTER`, widest powers first, so being the reporter never
   costs an admin an option). One row matches:

   ```python
   Transition(
       from_status=IncidentStatus.IN_PROGRESS,
       to_status=IncidentStatus.RESOLVED,
       allowed_actors=frozenset({Actor.ASSIGNEE, Actor.FACILITY_ADMIN}),
       required_fields=("resolution_summary",),
       action_label="Resolve",
   )
   ```

   `None` here would raise `ConflictError` 409 `TRANSITION_NOT_ALLOWED`, carrying
   `extra={"allowed_transitions": _describe(...)}` — deliberately the same shape as
   `AllowedTransitionRead`, so a client recovering from a refusal can feed it straight back
   into whatever draws the buttons instead of making a second request.

4. **`workflow.check_guard(transition, incident, moment)`** — this row has no `guard`, so
   `None`. (The two rows that do: `_requires_an_assignee` on `OPEN → IN_PROGRESS`, and
   `_within_the_reopen_window` on `CLOSED → IN_PROGRESS`. A blocked guard is 409
   `TRANSITION_BLOCKED`, again carrying the legal moves.)

5. **`_require_transition_fields(transition, payload)`** — iterates `required_fields` and
   raises 422 `TRANSITION_FIELD_REQUIRED` with `field="resolution_summary"` if it is
   missing. The check is generic: the service never learns which transition it is handling.

6. **`_resolve_close_reason`** — `to_status != CLOSED`, so `None`.
   **`_resolve_duplicate_target`** — no close reason of `DUPLICATE`, so `None`.

7. **`_apply_transition_effects(...)`** — the side effects, written as *what it means to be
   in this status* rather than per-transition:

   ```python
   incident.status = IncidentStatus.RESOLVED
   incident.resolved_at = now
   incident.resolution_summary = payload.resolution_summary
   # ... and, in the else-branch of the BLOCKED check:
   incident.blocked_reason_type = None
   incident.blocked_reason = None
   ```

   Keying on the status entered rather than the move made is what guarantees a reopened
   ticket cannot keep a `closed_at` that the reports would then count — entering
   `IN_PROGRESS` clears the resolution and closure fields whether it was reached by starting
   work, resuming after a block, or reopening.

8. **`repository.add_event(...)`** — one row in `incident_events`:
   `event_type=transition.event_type` (`STATUS_CHANGED`, since `is_reopen` is false),
   `from_value="IN_PROGRESS"`, `to_value="RESOLVED"`, `actor_id=user.id`,
   `reason=payload.reason`. Its `created_at` is defaulted by PostgreSQL's
   `clock_timestamp()`, so it sorts after anything written a microsecond earlier in the same
   transaction.

9. **`repository.reload(session, incident)`** — `session.flush()`, then re-select with
   `_detail_loaders()` **and `execution_options(populate_existing=True)`**. That flag is
   load-bearing: without it the query finds the object already in the session's identity map
   and hands it back untouched, *including relationships loaded before the write*. This
   particular request does not change a relationship, but the assign and escalate paths do,
   and they share this function.

Nothing in this sequence decides *whether* the move is legal. That is `app/workflow.py`.
What happens here is only the part a table cannot express.

### Hop 8 — commit, then assemble the response

Back in `app/routers/incidents.py::create_transition`:

```python
session.commit()
return _to_read(updated, user)
```

**The service never commits; the router does.** That is the transaction boundary, and it is
why a service can raise halfway through and leave nothing behind. (One documented exception:
`auth_service.rotate_session` commits its own revocation, because that request is about to
fail and the security response must outlive it.)

`_to_read` is safe *after* `commit()` because the session factory sets
`expire_on_commit=False`; otherwise every attribute would have been expired and re-fetched
one at a time. It builds:

- `_to_list_item` → `_category_summary` (the subcategory flattened with its parent group),
  `_location_summary` (building code / floor name / seat code joined by
  `LOCATION_SEPARATOR`), `_user_summary` for reporter and assignee;
- then the detail fields, and finally **this caller's permissions**, each from the function
  that owns that rule:

  ```python
  can_edit             = incident_service.can_edit_content(incident, user)
  can_change_priority  = incident_service.can_change_priority(incident, user)
  can_escalate         = incident_service.can_escalate(incident, user)
  can_clear_escalation = incident_service.can_clear_escalation(incident, user)
  can_assign           = assignment.can_assign(incident, user)
  can_add_note         = note_service.can_add_note(incident, user)
  can_add_internal_note= note_service.can_add_internal_note(incident, user)
  ```

The response is an `IncidentRead`. Had anything raised, `app/errors.py::api_error_handler`
— registered once in `app/main.py` — would have rendered it as
`{detail, code?, field?}` plus any `extra`.

### Hop 9 — back in the browser

`useTransition`'s `onSuccess` calls `invalidateIncidents(queryClient)`:

```ts
Promise.all([
  queryClient.invalidateQueries({ queryKey: queryKeys.incidents.all }), // ['incidents']
  queryClient.invalidateQueries({ queryKey: queryKeys.reports.all }),   // ['reports']
])
```

TanStack Query matches keys by **prefix**, so `['incidents']` invalidates the detail, the
allowed-transitions, the activity *and* every list however it was filtered. That is broader
than strictly necessary and is the right default: working out which of those a given move
touched would put the workflow's side effects in a second place. `['reports']` goes with it
because every home-screen tile and the whole admin dashboard are built from `/reports/*` — a
tile still reading "1" under a list that just emptied is the kind of stale number that makes
a reader stop trusting the page.

### Hop 10 — what re-renders

| Query | What changes |
| --- | --- |
| `useIncident` | status chip → **Resolved**; `resolution_summary` appears in `DetailsCard`; the `can_*` flags shift (Nina can still add a note; `can_escalate` is now false because `RESOLVED` is not in `ESCALATABLE_STATUSES`) |
| `useAllowedTransitions` | now returns **Close ticket** (`CLOSED_BY_ENGINEER`) for Nina. For the *reporter* the same endpoint returns **Confirm fixed** and **Still broken** — same ticket, same moment, different rows of the same table |
| `useActivity` | the new `STATUS_CHANGED` row appears in `ActivityTimeline` |
| `WorkflowStepper` | advances to the Resolved step |
| the reporter's home screen | "Awaiting your confirmation" goes up by one, via `/reports/me` |

### The same trace, compressed

```
Resolve button (drawn from allowed-transitions)
  └─ TransitionDialog            ← required_fields
     └─ useTransition            → features/incidents/hooks.ts
        └─ performTransition     → api/incidents.ts
           └─ apiClient          → Bearer token attached (api/client.ts)
              └─ Vite proxy / CloudFront + Function URL + Mangum (function.py)
                 └─ routers/incidents.py::create_transition
                    ├─ get_db                                  (db.py)
                    ├─ get_current_user → decode_access_token  (security/)
                    ├─ get_incident → repositories/incidents.py::get
                    └─ incident_service.perform_transition
                       ├─ utc_now                              (clock.py)
                       ├─ workflow.resolve_actors
                       ├─ workflow.select_transition           ← THE decision
                       ├─ workflow.check_guard
                       ├─ _require_transition_fields
                       ├─ _apply_transition_effects            ← timestamps
                       ├─ repository.add_event                 ← audit row
                       └─ repository.reload                    ← populate_existing
                    ├─ session.commit()                        ← the only commit
                    └─ _to_read → can_* flags from four services
              ← IncidentRead
           ← invalidate ['incidents'] + ['reports']
        ← three queries refetch, four components re-render
```

---

## 5. Reading order

To understand this system in an afternoon, read in this order. The point of the sequence is
that each step makes the next one obvious.

**First, 20 minutes — the constraints, so nothing later looks arbitrary.**
1. `CLAUDE.md` — the scaffold's hard rules. Read §1.4 above alongside it.
2. `docs/INFRA-CHANGES.md` — the three Terraform edits and why each was unavoidable.

**Then, 30 minutes — the shape of the domain.**
3. `backend/v1/app/models/enums.py` — eleven enums, and the whole vocabulary of the system
   in 143 lines. Read this before any table.
4. `backend/v1/app/models/incident.py` — the central table, heavily commented.
5. §2 above, with `backend/v1/app/models/` open beside it.

**Then, 45 minutes — the one file that explains the architecture.**
6. `backend/v1/app/workflow.py`, start to finish including the module docstring. It is 340
   lines and it is the thesis of the codebase: rules as data, read by three consumers and
   restated by none.
7. `backend/v1/tests/unit/test_workflow.py` — it parametrises over `TRANSITIONS` itself.
   Reading it tells you what the table guarantees.

**Then, 45 minutes — one request all the way down.**
8. §4 above, with these four files open: `app/routers/incidents.py`,
   `app/services/incident_service.py`, `app/security/dependencies.py`,
   `app/repositories/incidents.py`.
9. `backend/v1/app/services/visibility.py` — 55 lines, and the clearest statement of the
   "one place, applied to the query" discipline in the repository.

**Then, 30 minutes — the frontend's contract with the backend.**
10. `frontend/src/api/client.ts` — the session, the token, and the 401 retry, in one file.
11. `frontend/src/features/incidents/IncidentActions.tsx` and `TransitionDialog.tsx` —
    where the UI refuses to know the rules.
12. `frontend/src/api/queryKeys.ts` and `features/incidents/hooks.ts` — how a change
    propagates back to the screen.

**Finally, 30 minutes — the parts that are their own world.**
13. `backend/v1/app/repositories/reports.py` module docstring, then `_window_clauses` and
    `_scope_clauses` — and `docs/DECISION-LOG.md` D9, D10, D11, which are the best worked
    example in the repository of a rule being got wrong, exposed, and fixed twice.
14. `backend/v1/app/seed/demo.py` docstring — only if you are going to change the demo data.

**What to skip on a first pass.** `app/seed/demo.py`'s body (1,730 lines of generator),
the admin CRUD screens (`features/facilities`, `features/categories`, `features/users`) —
they are conventional forms, and their rules are all in `services/facilities.py` and
`services/categories.py`, which you can read in fifteen minutes each — and the per-phase
sections of this guide, which are history rather than description.

**If you only have one hour:** §1 and §2 above, then `app/workflow.py`, then §4.

---

## 6. Glossary

Every non-obvious term in the codebase and in this guide, in one place. Each is one or two
sentences, written for someone meeting it for the first time. Terms the phase sections
defined locally are merged here; where a phase glossary and this one differ, this one is
current.

### 6.1 Hosting, AWS and the deployment path

| Term | Meaning |
| --- | --- |
| **ASGI** | Asynchronous Server Gateway Interface — the Python convention for how a web server hands a request to an application. FastAPI speaks it; uvicorn and Mangum are two different things that can drive it. |
| **Mangum** | A small adapter that makes an ASGI application callable as an AWS Lambda handler: it converts the Lambda event into an ASGI scope and the response back. `lifespan="off"` skips startup/shutdown hooks we do not have. |
| **uvicorn** | The ASGI server used in local development. In the cloud there is no server — Mangum plays that role per invocation. |
| **Lambda Function URL** | A dedicated HTTPS endpoint attached to a Lambda function. Used here instead of API Gateway, which the IAM boundary does not permit. |
| **Direct invoke** | Calling a Lambda through the AWS API (`aws lambda invoke`) rather than over HTTP. IAM-protected and not routed by CloudFront, which is why it is safe to run migrations through. |
| **CloudFront** | AWS's CDN. One distribution fronts both the S3 site and the Lambda, which is what makes the browser same-origin with the API. |
| **Cache behaviour** | A CloudFront rule matching a path pattern to an origin. `/api/v1*` → the Lambda; everything else → S3. |
| **CloudFront Function / viewer-request function** | A tiny JavaScript function CloudFront runs at the edge on the *incoming* request, before it reaches an origin. Ours rewrites extension-less paths to `/index.html` so SPA deep links work — attached to the default behaviour only, so it never touches `/api/*`. |
| **OAC (Origin Access Control)** | The mechanism that lets CloudFront read a private S3 bucket without the bucket being public. |
| **SPA routing / deep link** | A single-page app owns its URLs client-side, so a reload of `/tickets/abc` must serve `index.html` rather than 404. That is what the viewer-request function is for. |
| **Aurora Serverless v2** | A managed PostgreSQL that scales its capacity automatically. |
| **ACU (Aurora Capacity Unit)** | Aurora's unit of provisioned capacity (roughly 2 GiB of memory plus matching CPU). Ours has `min_capacity = 0.0`, so it sleeps when idle and takes about 15 seconds to wake — the cause of a slow first request. |
| **STS credentials** | Short-lived AWS credentials issued by Security Token Service. `./bin/setup-participant.sh` refreshes them into `ENVIRONMENT.config`, which is gitignored and must never be committed or echoed. |
| **IAM boundary** | The policy (`infra/policy.tftpl`) capping what the deploy role may do — here, most resources only on ARNs matching `coding-workshop*`, with no VPC, API Gateway, EKS or DocumentDB rights. |
| **Terraform / `terraform apply`** | The infrastructure-as-code tool the scaffold uses. We author none of it; we edited three provided files (see `docs/INFRA-CHANGES.md`). |

### 6.2 PostgreSQL

| Term | Meaning |
| --- | --- |
| **Extension** | An optional module adding types or functions. We enable two: `pgcrypto` and `citext`. |
| **pgcrypto** | Supplies `gen_random_uuid()`, the default for every primary key here. |
| **CITEXT** | A case-insensitive text type. `users.email` uses it, so uniqueness and lookup ignore case *in the database* rather than relying on every caller normalising first. |
| **Enum type** | A PostgreSQL type with a fixed set of allowed values. Ours are created explicitly by the first migration from `ENUM_TYPES` so that no table definition has to create one implicitly. |
| **Sequence / `nextval`** | A counter object the database increments atomically. `incident_ticket_seq` generates the human-facing ticket numbers, which are therefore stable, gap-tolerant and never reused. |
| **Generated column (`GENERATED ALWAYS AS … STORED`)** | A column PostgreSQL computes from other columns on every write. `search_vector` is one, which is why it can never drift from `title` and `description`. |
| **`tsvector`** | PostgreSQL's parsed form of a document: each word reduced to a stem, with positions. |
| **`to_tsvector(config, text)`** | Builds a `tsvector`. The `'english'` config supplies the stemming and stop words. |
| **Stemming** | Reducing words to a common root, so a search for "flickering" finds "flickers". |
| **`setweight`** | Tags part of a `tsvector` with a label `A`–`D` so `ts_rank` can score it differently. Title is `'A'`, description `'B'`. |
| **`tsquery` / `websearch_to_tsquery`** | The parsed form of a *search*. `websearch_to_tsquery` accepts what people actually type — quoted phrases, `or`, a leading `-` to exclude — and never raises a syntax error on stray punctuation, which `to_tsquery` does. |
| **`@@`** | The match operator between a `tsvector` and a `tsquery`. |
| **`ts_rank`** | Scores how well a document matches a query, honouring `setweight` labels. |
| **GIN index** | Generalised Inverted Index — stores a posting list per stem, the way a book index stores page numbers per word. What makes full-text search fast. |
| **`NULLS NOT DISTINCT`** | A PostgreSQL 15+ unique-constraint modifier making NULLs collide with each other. Without it, `UNIQUE(parent_id, name)` would silently never apply to category *groups*, whose `parent_id` is NULL. |
| **CHECK constraint** | A row-level condition the database enforces. Ours: a `BLOCKED` incident must have a `blocked_reason_type`; `max_active_tickets > 0`. |
| **`ON DELETE CASCADE / RESTRICT / SET NULL`** | What happens to a child row when its parent is deleted: delete it too, refuse the delete, or null the reference. All three are used, deliberately, per relationship. |
| **`timestamptz`** | `TIMESTAMP WITH TIME ZONE` — an absolute instant. Rendered in the session's time zone, which `app/db.py` pins to UTC so the same value serialises identically everywhere. |
| **`now()` vs `clock_timestamp()`** | `now()` is the **transaction** start time and is identical for every row one request writes. `clock_timestamp()` is read per call. The activity timeline orders by `created_at` across two tables, so both use `clock_timestamp()` (revision 0003). |
| **Naive vs aware datetime** | A naive `datetime` has no timezone; an aware one does. Mixing them raises in Python and skews silently in SQL — which is why revision 0002 exists. |
| **`EXTRACT(EPOCH FROM interval)`** | Converts a time interval to seconds. Every duration in the reports is this, divided by 3600. |
| **Aggregate function** | A function over many rows returning one value: `COUNT`, `AVG`, `MAX`. |
| **`FILTER (WHERE …)`** | A clause restricting a single aggregate to a subset of rows, so one scan can produce many segmented counts: `COUNT(*) FILTER (WHERE status = 'OPEN')` alongside a dozen siblings. |
| **Ordered-set aggregate / `WITHIN GROUP`** | An aggregate that needs its input sorted. `percentile_cont(0.5) WITHIN GROUP (ORDER BY x)` is the syntax. |
| **`percentile_cont(0.5)`** | The continuous median — interpolating between the two middle values. Used rather than `AVG` throughout so one ticket left over a long weekend cannot move a headline number. It ignores NULL inputs, which is exactly right: the median time to resolve is over tickets that *were* resolved. |
| **`percentile_disc`** | The discrete variant, which returns an actual observed value. Not used here. |
| **`NULLIF(x, 0)`** | Returns NULL when `x` is zero. Used to make a percentage NULL rather than a division error when nothing was in the denominator — "no tickets resolved" is not "0% informed". |
| **`COALESCE`** | Returns the first non-NULL argument. Used to fall back to `created_at` when a blocked ticket has no `STATUS_CHANGED` event. |
| **`generate_series`** | Produces a set of rows from a range. Supplies the calendar for the created-versus-closed daily series so days on which nothing happened come back as zeroes instead of being absent. |
| **Correlated subquery** | A subquery referring to a column of the outer query, evaluated per outer row. Used for `active_ticket_count` and `_blocked_since`. |
| **Scalar subquery** | A subquery returning exactly one value, usable anywhere an expression is. |
| **Window function** | A function computing across a set of rows related to the current one without collapsing them. Used to carry each category group's total alongside its subcategory rows. |
| **`ILIKE`** | Case-insensitive `LIKE`. User search uses it, with `%` and `_` escaped (`_escape_like`) so a user typing `%` does not match everything. |

### 6.3 SQLAlchemy and Alembic

| Term | Meaning |
| --- | --- |
| **ORM** | Object-Relational Mapper — maps table rows to Python objects. |
| **Engine** | The connection factory and pool, one per process. Creating it opens no connection, so it is safe even when the database is down. |
| **Session** | A unit of work: a transaction plus an identity map. One per request, via `get_db`. |
| **Identity map** | The session's cache of "objects I have already loaded", keyed by primary key. It is why re-querying a loaded row returns the same Python object — and why `populate_existing` exists. |
| **`flush` vs `commit`** | `flush` sends pending SQL so the database assigns ids and defaults, still inside the transaction. `commit` ends the transaction. Services flush; routers commit. |
| **`expire_on_commit=False`** | By default, committing marks every loaded object stale so the next attribute access re-queries. Turning it off lets a router build its response from objects it already has, after the commit. |
| **`populate_existing=True`** | Forces a query to overwrite the session's cached copy rather than returning it untouched. Without it, `reload()` would hand back an object whose *relationships* were loaded before the write — so a just-assigned ticket would report itself unassigned. |
| **`selectinload`** | An eager-loading strategy that fetches a relationship for a whole result set in one extra `SELECT … WHERE id IN (…)`. Turns a page of 25 incidents from 176 queries into nine. |
| **N+1 query** | The anti-pattern `selectinload` prevents: one query for a list, then one more per row per relationship. |
| **`Select`** | SQLAlchemy 2.0's statement object. Passing one between layers is what lets `visibility.py` narrow a query that `repositories/` will later execute. |
| **Declarative base** | The class every model inherits from, carrying the shared `MetaData`. Ours also carries a naming convention so Alembic emits stable constraint names. |
| **Alembic** | SQLAlchemy's migration tool. Each migration is a *revision* with `upgrade()` and `downgrade()`, chained by `down_revision`. |
| **head / `upgrade head`** | The newest revision in the chain. `upgrade_to_head()` applies everything not yet run. |
| **Autogenerate** | Alembic's ability to diff models against a live database and draft a migration. Useful as a draft; our migrations are hand-checked because enum creation order and `USING` casts matter. |

### 6.4 Authentication and security

| Term | Meaning |
| --- | --- |
| **JWT** | JSON Web Token — a signed, self-describing token. Ours carries `sub`, `role`, `type`, `iat`, `exp`. |
| **HS256** | HMAC with SHA-256: a symmetric signature, appropriate because one service both issues and verifies. |
| **Claims** | The fields inside a JWT. `role` is carried for convenience and **never trusted** — authorisation re-reads the user from the database each request. |
| **Access token vs refresh token** | The access token is a short-lived (15 min) stateless JWT, checked with no database round trip. The refresh token is a long-lived (7 day) opaque random string stored hashed, and therefore revocable — which is the whole reason it exists. |
| **Bearer token** | A token sent as `Authorization: Bearer <token>`; possession alone authorises. |
| **Refresh-token rotation** | Every use of a refresh token revokes it and issues a new one, so a stolen cookie has a short useful life. |
| **Reuse detection** | Presenting an *already revoked* refresh token means either theft or a client racing itself; both are answered by revoking **every** session for that user, turning silent theft into a visible logout. |
| **bcrypt / cost factor / salt** | A deliberately slow password hash. The cost factor (12 here, ~250 ms) sets how slow; the salt makes identical passwords hash differently. |
| **bcrypt pre-hash** | bcrypt refuses inputs over 72 bytes, so the password is first reduced to a SHA-256 digest and base64-encoded — 44 ASCII bytes, no entropy lost. Removing or reordering this step would invalidate every stored hash. |
| **`HttpOnly`** | A cookie flag making the cookie unreadable to JavaScript — the defence that makes a refresh cookie safer than a token in `localStorage`. |
| **`SameSite=Strict`** | A cookie flag suppressing the cookie on cross-site requests. Workable here only because the browser is same-origin with the API in *both* environments. |
| **`Secure`** | Sends the cookie over HTTPS only. Driven from config: false locally, true deployed. |
| **Cookie `Path`** | Limits which paths the browser sends a cookie to. Ours is `/api/v1/auth`, so the refresh token never rides along on a request to `/api/v1/incidents`. |
| **Same-origin / CORS** | Two URLs are same-origin if scheme, host and port match. Because ours always do, no CORS configuration exists anywhere in this codebase. |
| **XSS** | Cross-site scripting — injected JavaScript running on your page. The reason the access token is in memory and the refresh token is `HttpOnly`. |
| **RBAC** | Role-based access control. Here: three roles, plus three engineer *levels* checked separately, plus per-ticket relationships (reporter, assignee) that are not roles at all. |

### 6.5 FastAPI, Pydantic and the backend framework

| Term | Meaning |
| --- | --- |
| **FastAPI dependency / `Depends`** | A callable FastAPI resolves before the endpoint runs, injecting the result. Used for the session, the current user and role checks, so an endpoint declares its requirements in its signature. |
| **`APIRouter`** | A group of routes mounted under a prefix. One per domain, all mounted at `API_PREFIX` in `app/main.py`. |
| **Pydantic** | The validation library FastAPI uses. Our request and response models live in `app/schemas/`. |
| **pydantic-settings** | Pydantic's environment-variable loader. `app/config.py::Settings` is one. |
| **`model_validator(mode="after")`** | A Pydantic hook running once the model is built — used to refuse a deployed environment carrying the development JWT secret. |
| **`exclude_unset`** | Serialises only fields the caller actually sent, which is what makes `PATCH` genuinely partial: sending `{"is_active": false}` does not blank the address. |
| **OpenAPI** | The machine-readable API description FastAPI generates, served at `/api/v1/openapi.json` with docs at `/api/v1/docs`. |
| **`StrEnum`** | A Python enum whose members *are* strings, so a value from the database, from JSON or from a test all compare equal. |
| **Frozen dataclass** | `@dataclass(frozen=True)` — immutable and hashable. `Transition` is one, so a workflow row cannot be mutated at runtime. |
| **`frozenset`** | An immutable set. `allowed_actors` is one, so set intersection answers "may this caller use this row?" directly. |
| **Sentinel value** | A special value standing for a case a normal value cannot express — here the literal string `'unassigned'` for `?assignee_id=`, meaning "tickets nobody owns". |

### 6.6 React and the frontend

| Term | Meaning |
| --- | --- |
| **SPA** | Single-page application: one HTML document, with routing and rendering in the browser. |
| **React context / provider** | React's mechanism for passing a value down the tree without threading props. `AuthProvider` supplies the session; `SnackbarProvider` supplies notifications. |
| **Hook** | A function starting with `use` that plugs into React's state and lifecycle. Must be called unconditionally and in the same order every render. |
| **Route guard** | A component wrapping routes and deciding whether to render them. `RequireAuth` checks for a session; `RequireRole` checks role and level. |
| **`<Outlet />`** | React Router's placeholder for whichever child route matched — how a guard wraps many routes without listing them. |
| **`<Navigate replace>`** | A redirect rendered as an element; `replace` avoids leaving the blocked URL in history. |
| **TanStack Query** | The server-state library: caching, background refetching and invalidation, keyed by a query key. |
| **Query key** | The array identifying a cache entry, e.g. `['incidents','detail',id]`. Registered centrally in `api/queryKeys.ts`. |
| **Invalidation / prefix matching** | Marking cache entries stale so they refetch. Keys match by prefix, so invalidating `['incidents']` refreshes every incident query at once. |
| **`staleTime`** | How long a cached answer is considered fresh. Zero on `allowed-transitions`, because a stale list of moves is a list of buttons that 409. |
| **`placeholderData: keepPrevious`** | Keeps showing the previous data while new parameters load, so a dashboard does not flash empty when the date range changes. |
| **`useInfiniteQuery`** | Accumulates pages rather than replacing them — the phone's "Load more" list. |
| **Axios interceptor** | A hook into every request or response. Ours attaches the bearer token on the way out and handles a 401 on the way back. |
| **Single-flight** | Collapsing concurrent calls into one in-flight promise. Essential here because two simultaneous refreshes with the same cookie would trip reuse detection and log the user out. |
| **React `StrictMode`** | A development-only mode that deliberately double-invokes effects to surface bugs. It is the reason the bootstrap refresh had to be single-flight. |
| **Fast Refresh** | Vite's hot reloading for React. A module exporting both a component and a plain function loses it — which is why `AuthContext.ts`, `SnackbarContext.ts`, `categoryIcons.ts` and `actionAvailability.ts` are split from their components. |
| **Vite** | The dev server and bundler. Its dev proxy is what makes local development same-origin. |
| **react-hook-form / zod / resolver** | Form state, schema validation, and the adapter between them. The zod schemas *mirror* the API's limits; the API decides. |
| **Material UI (MUI)** | The component library. Styling is done in place with the `sx` prop, `styled()` and `theme.ts` — there are no stylesheets of ours. |
| **`sx` prop** | MUI's per-instance style prop, with access to theme tokens. |
| **`CssBaseline`** | MUI's CSS reset, the only one used. |
| **Media query / breakpoint** | A width threshold at which layout changes. One threshold here: 899 px, via `react-responsive`, aligned with MUI's `md`. |
| **FAB** | Floating action button — the phone's "Report an issue" shortcut. |
| **Code splitting / lazy route** | Loading part of the bundle only when needed. The admin dashboard is lazy-loaded because it is the only screen importing `@mui/x-charts`. |
| **`useSearchParams`** | React Router's hook for the URL query string, which is where every list filter lives so views are bookmarkable and shareable. |

### 6.7 Testing

| Term | Meaning |
| --- | --- |
| **Vitest** | The frontend unit/component test runner, Vite-native. |
| **Testing Library** | Renders components and queries them the way a user perceives them — by role and visible text rather than by CSS selector. |
| **`getBy` / `queryBy` / `findBy`** | Throw if absent / return null if absent / await appearance. Choosing the right one is how a test says whether it expects something to be there. |
| **`getByRole`** | The preferred query: finds an element by its accessibility role and name, so a passing test is also evidence the element is reachable. |
| **jsdom** | A DOM implementation in Node, so component tests need no browser. |
| **Playwright** | The end-to-end runner: a real browser against the real stack. |
| **Browser context** | An isolated cookie jar and storage within one browser. Three personas signed in at once need three contexts — two windows of one profile share a session. |
| **Fixture** | Test setup provided by the framework. Ours create accounts over the API rather than through the UI, and deactivate them afterwards. |
| **Viewport** | The browser window size a test runs at. Two projects: desktop 1440×900 and mobile 375×812. |
| **Savepoint** | A nested transaction marker. Integration tests run each test inside one outer transaction rolled back afterwards, so a real database stays clean. |
| **Coverage instrumentation** | Measuring which lines a test suite executes. Deliberately **not** installed — see D16 for why an unexamined percentage was judged worse than a named list of gaps. |

### 6.8 This project's own vocabulary

| Term | Meaning |
| --- | --- |
| **Actor** | The capacity in which someone acts on **one particular incident**: REPORTER, ASSIGNEE or FACILITY_ADMIN. Not a role — the same person is a different actor on a different ticket. |
| **Guard** | A precondition on the incident itself rather than on the caller's input, expressed as a function on a workflow row. Returns `None` when the move is allowed, or the message to show when it is not. |
| **Transition table** | `TRANSITIONS` in `app/workflow.py`: the entire state machine, as data. |
| **State machine** | A set of states plus the legal moves between them. Ours has five statuses and eleven moves. |
| **Audit log / append-only** | `incident_events`: rows are written and never modified. The absence of an `updated_at` column is the type signature of that promise. |
| **Ops action** | A maintenance task run by direct Lambda invoke rather than over HTTP: `health`, `migrate`, `seed_admin`, `seed_demo`. |
| **Idempotent** | Safe to run repeatedly with the same result. `migrate` and `seed_admin` are; `seed_demo` deliberately is **not**, and says so in its return payload rather than pretending (D12). |
| **Period report vs current-state report** | The D9 split. A report about *activity during a period* takes `from`/`to` and echoes a `window`. A report about *what is true now* takes neither, and echoes a `scope` — a building and an `as_of` instant. `/reports/blocked-escalated` and `/reports/me` are the two current-state reports. |
| **Scope vs window** | The two response shapes above. A response that echoed a period it had not applied would let a dashboard label a chart with a filter that never happened. |
| **Live work** | `ACTIVE_INCIDENT_STATUSES` — OPEN, IN_PROGRESS, BLOCKED. One definition, used by `active_ticket_count`, the capacity warnings and all three current-state escalation readers. |
| **Soft delete / deactivation** | Keeping a row but clearing `is_active`, or setting `deleted_at`. Used wherever deleting would damage history — users, engineers, categories, notes. |
| **Visibility filter** | `apply_incident_visibility` / `apply_note_visibility`: functions narrowing a `Select` before it runs. The alternative — filtering the serialised result — is the bug they exist to prevent, because `total` would still count the hidden row and paging would still skip over it. |
| **Capacity warning** | An advisory string returned alongside a successful assignment when the engineer is unavailable or at their limit. It warns; it never refuses. |
| **Walking skeleton** | A thin slice through every layer that does almost nothing useful but proves the whole path works. M1 was one. |
| **Vertical slice** | Building a phase as migration → endpoint → test → screen rather than all-backend-then-all-frontend, so the app is demoable at every point. |
| **Drill-down** | Clicking a chart segment or tile to open the pre-filtered list it counted. Period tiles link with dates; current-state tiles deliberately do not. |
| **Table twin** | The text view beside every chart, giving the same numbers to a keyboard, a screen reader or a printout — a hover is not available to any of them. |

---

# Part II — The build, phase by phase

*What follows is the build log: one section per phase, written as that phase finished.
It records the reasoning while it was fresh, including arguments that were later
revisited. For the current state of any rule, prefer [Part I](#part-i--the-system-as-a-whole).*

---

## Phase M1 — Scaffold and walking skeleton

A "walking skeleton" is a thin slice through every layer of the system that does
almost nothing useful, but proves the whole path works: browser → API → database,
locally and deployed. The point is to discover routing, packaging and permission
problems on day one instead of on the last day.

### 1. What was built

#### Backend — `backend/v1/`

| File | Responsibility |
| --- | --- |
| [function.py](../backend/v1/function.py) | AWS Lambda entry point. Routes each event either to the ASGI app (HTTP) or to an ops action (direct invoke). |
| [app/main.py](../backend/v1/app/main.py) | Builds the FastAPI application and mounts every router under `/api/v1`. |
| [app/config.py](../backend/v1/app/config.py) | `Settings` — reads the environment Terraform injects; builds the database URL. Owns the `API_PREFIX` constant. |
| [app/db.py](../backend/v1/app/db.py) | Creates the SQLAlchemy engine and session factory once per process; `get_db` is the FastAPI request dependency. |
| [app/routers/health.py](../backend/v1/app/routers/health.py) | `GET /api/v1/health`. Thin: takes a session, calls the service, returns the model. |
| [app/services/health.py](../backend/v1/app/services/health.py) | The actual health logic — probe PostgreSQL, assemble the report. Holds `API_VERSION`. |
| [app/services/ops.py](../backend/v1/app/services/ops.py) | The `ACTIONS` registry and `run_ops` dispatcher for direct-invoke operations. |
| [app/schemas/health.py](../backend/v1/app/schemas/health.py) | Pydantic response models. The frontend's TypeScript interfaces mirror these. |
| [requirements.txt](../backend/v1/requirements.txt) | **Runtime deps only.** Terraform reads this file to build the Lambda package. |
| [requirements-dev.txt](../backend/v1/requirements-dev.txt) | Test and lint tooling. Terraform never sees it. |
| [pyproject.toml](../backend/v1/pyproject.toml) | ruff and pytest configuration. Not a package definition. |
| `tests/unit/`, `tests/integration/` | 19 tests. Unit: settings and URL building, ops dispatch, handler routing. Integration: the health endpoint against a real PostgreSQL. |

#### Frontend — `frontend/`

Converted from the scaffold's JavaScript React app to TypeScript, and given the
libraries the rest of the build needs.

| File | Responsibility |
| --- | --- |
| [src/main.tsx](../frontend/src/main.tsx) | Mounts React and wraps the app in the four providers M1 needed: TanStack Query, MUI theme, `CssBaseline`, React Router. M5 added `AuthProvider` and `SnackbarProvider` — see the M5 section for the current list. |
| [src/App.tsx](../frontend/src/App.tsx) | The route table. One route today. |
| [src/theme.ts](../frontend/src/theme.ts) | MUI theme: palette, typography, corner radius. |
| [src/api/client.ts](../frontend/src/api/client.ts) | The shared axios instance. `baseURL: '/api/v1'`, `withCredentials: true`. |
| [src/api/health.ts](../frontend/src/api/health.ts) | `fetchHealth()` plus the TypeScript types mirroring `app/schemas/health.py`. |
| [src/api/queryKeys.ts](../frontend/src/api/queryKeys.ts) | Central registry of TanStack Query cache keys. |
| [src/hooks/useBreakpoint.ts](../frontend/src/hooks/useBreakpoint.ts) | `isMobile` / `isDesktop` from `react-responsive`, pinned to MUI's 900 px `md` breakpoint. |
| [src/features/status/useHealth.ts](../frontend/src/features/status/useHealth.ts) | The TanStack Query hook. Polls every 30 s. |
| [src/features/status/StatusPage.tsx](../frontend/src/features/status/StatusPage.tsx) | The placeholder page. Renders healthy / degraded / unreachable. |
| [src/test/viewport.ts](../frontend/src/test/viewport.ts) | A controllable `window.matchMedia` so responsive behaviour is testable. |
| [src/test/setup.ts](../frontend/src/test/setup.ts) | Vitest setup: jest-dom matchers, Testing Library cleanup, the matchMedia install. |
| [vite.config.ts](../frontend/vite.config.ts) | Dev server on :3000, the `/api` proxy, and the Vitest configuration. |
| `tsconfig*.json`, [eslint.config.js](../frontend/eslint.config.js) | TypeScript project references; TypeScript-aware flat ESLint config. |

Deleted from the scaffold: `App.jsx`, `main.jsx`, `App.css`, `index.css`,
`vite.config.js`, the Vite and React logos, and the empty `src/pages/` and
`src/services/` placeholder directories (the layout in BUILD-PLAN.md uses
`features/` and `api/` instead).

#### Infrastructure — the three permitted `infra/` edits

1. **[lambda.tf](../infra/lambda.tf)** — `memory_size` 128 → 512.
2. **[locals.tf](../infra/locals.tf)** — a `random_password.jwt_secret` resource, and
   `JWT_SECRET` added to `local.env_vars`.
3. **[cloudfront.tf](../infra/cloudfront.tf)** — deleted the distribution-wide
   `custom_error_response` (404 → 200 `/index.html`) and replaced it with a
   CloudFront Function bound to the default cache behaviour only.

#### CI

- **[.github/workflows/ci.actions.yml](../.github/workflows/ci.actions.yml)** (new) —
  a `backend` job (PostgreSQL 17 service container, `ruff check`, `ruff format
  --check`, `pytest`) and a `frontend` job (`eslint`, `tsc -b`, `vitest`, `vite build`).
- **[.bandit](../.bandit)** (new) + a one-line change to
  [.github/workflows/python.actions.yml](../.github/workflows/python.actions.yml) —
  see Gotchas.

### 2. Why it is shaped this way

**One service directory, named `v1`.** *Forced by the scaffold.*
`infra/locals.tf` globs `backend/*/requirements.txt` one level deep and turns every
match into its own Lambda with a **public, unauthenticated** Function URL.
`infra/cloudfront.tf` then routes `/api/<dir-name>*` to it. So the directory name
*is* the API version prefix. Creating `backend/anything-else/requirements.txt` would
silently publish a second, unprotected API.

**Routes carry the full `/api/v1` prefix.** *Forced by the scaffold.* CloudFront
forwards the path **unmodified**, so the Lambda genuinely receives
`/api/v1/auth/login`. Two consequences:

- Routers are mounted with `prefix=API_PREFIX`, and the OpenAPI docs live at
  `/api/v1/docs` — mounting them at `/docs` would make them unreachable in the
  cloud, because CloudFront only sends `/api/v1*` to the Lambda.
- Local development uses Vite's own proxy, **not** `bin/proxy-server.js`. That
  script strips the `/api/<name>` prefix, which would make local paths differ from
  deployed ones — exactly the class of bug a walking skeleton exists to prevent.

**Rejected:** FastAPI's `root_path`. It changes how URLs are *generated* but the
app would still need the prefix on incoming paths, so it adds indirection without
removing the constant.

**Layer-first code layout** (`routers/`, `services/`, `schemas/`, …) rather than
feature-first (`incidents/{router,service,schema}.py`). With eight domains and a
rubric that asks "where does rule X live?", one directory per layer makes the
answer mechanical. The trade-off — a change to one feature touches several
directories — is handled by the recipes in section 5.

**A `health` ops action, not just an ASGI passthrough.** `function.py` implements
the full dispatch shape from CLAUDE.md now, in M1, rather than bolting it on in M2
when migrations need it. Registering a real action (`health`) rather than an empty
registry means the mechanism is exercised and tested from day one, and gives us the
only way to check that the Lambda can reach Aurora — Aurora is
`publicly_accessible = false`, so nothing on your machine can connect to it.

**`GET /health` returns HTTP 200 even when the database is down**, with
`status: "degraded"` in the body. *Chosen, not forced.* The status page must be
able to *render* a database outage; if the endpoint returned 503, axios would throw
and the page would report "API unreachable", which is the wrong diagnosis. Nothing
in this stack reads the status code (CloudFront fronts a Lambda Function URL, not a
load balancer with health checks). If a real orchestrator is ever added, add a
separate strict endpoint rather than changing this one.

**Only the exception *type* is returned when the probe fails.** Driver error
messages can echo host names and connection parameters. The full traceback goes to
the CloudWatch log; the client sees `"OperationalError"`.

**`Settings.database_url` returns a SQLAlchemy `URL` object, not a string.**
Aurora generates passwords containing characters that are unsafe in a URL
(`/`, `@`, `:`, `#`). `URL.create()` escapes them; string interpolation would
silently produce a broken connection string. There is a test for exactly this.

**Development defaults live in `config.py`, values live in the environment.**
Every setting has a default matching the local PostgreSQL install, so `uvicorn`
starts with no setup. Terraform's injected variables override them in the cloud.
Nothing is hardcoded in the sense that matters: no cloud value ever appears in code.

**bcrypt/JWT/Alembic are *not* in `requirements.txt` yet.** They arrive in M2 with
the code that uses them. `requirements.txt` is the Lambda package manifest, so
every line in it is weight in the deployment zip.

**`memory_size` 512.** 128 MB is not enough to import FastAPI + SQLAlchemy +
psycopg. Lambda also scales CPU with memory, so the larger setting materially
reduces cold-start time.

**The CloudFront 404 fix.** The scaffold mapped *every* 404 on the distribution to
a 200 serving `/index.html`. That includes the API origin — so `GET
/api/v1/incidents/{unknown-id}` would reach the browser as **HTTP 200 with a page
of HTML**. That breaks REST semantics and the rubric. A viewer-request CloudFront
Function attached to the **default behaviour only** gives SPA deep links without
ever seeing `/api/v1*`, because those requests match the API `ordered_cache_behavior`
instead.

**Rejected:** keeping `custom_error_response` and scoping it somehow — CloudFront
custom error responses are distribution-wide and cannot be scoped to a behaviour.

**`JWT_SECRET` from `random_password`, not Secrets Manager.** The IAM boundary does
grant `secretsmanager` on matching ARNs, so Secrets Manager was possible; it was
rejected for M1 because it adds a runtime API call (and its failure modes) to every
cold start for a single value. The generated password lives in Terraform state,
which is in a private S3 bucket. If this were a real production system, Secrets
Manager with rotation would be the right answer — this is stated here so the
trade-off is visible rather than accidental.

**Frontend: TanStack Query rather than hand-rolled `useEffect` fetching.** Every
later screen needs caching, background refresh and invalidation after mutations.

**Frontend: no `VITE_API_URL`.** `bin/deploy-frontend.sh` exports one, and we
ignore it. All calls are relative to `/api/v1`, because the browser is always
same-origin with the API — CloudFront fronts both origins in the cloud, and the
Vite proxy does the same locally. Same-origin in *both* environments is what makes
the `SameSite=Strict` HttpOnly refresh cookie in M2 work without special cases.

### 3. How the pieces connect

One request, hop by hop. **Locally:**

```
Browser (localhost:3000)
  │  StatusPage.tsx renders, useHealth() runs
  ▼
useHealth.ts            TanStack Query, key ['health']  ──► cache miss
  ▼
api/health.ts           fetchHealth()
  ▼
api/client.ts           axios GET  baseURL '/api/v1'  +  '/health'
  ▼
vite.config.ts          server.proxy['/api'] → http://localhost:8000
                        path forwarded UNCHANGED: /api/v1/health
  ▼
uvicorn :8000 ──► app/main.py       FastAPI, routers mounted at /api/v1
  ▼
app/routers/health.py   read_health(session = Depends(get_db))
  ▼
app/db.py               get_db() → sessionmaker → engine (built from Settings)
  ▼
app/services/health.py  check_database(session) → SELECT version()
  ▼
PostgreSQL (localhost:5432)
  ▲
  │  DatabaseHealth(status='ok', version='PostgreSQL 18.6 …')
app/services/health.py  build_health_report() → HealthReport
  ▲
app/schemas/health.py   Pydantic serialises to JSON
  ▲
StatusPage.tsx          TanStack Query caches under ['health'], component re-renders
                        → chips: "API healthy", "Database ok", "Environment: local"
```

**Deployed**, the two middle hops change and nothing else does:

```
Browser (https://d1234.cloudfront.net)
  ▼
CloudFront
  ├─ /api/v1*   ordered_cache_behavior → Lambda Function URL      ← our request
  │              (managed policies: no caching, AllViewerExceptHostHeader)
  └─ everything else → default_cache_behavior → S3 (private, OAC)
                       with the spa_router CloudFront Function on viewer-request
  ▼
Lambda Function URL → function.handler(event, context)
  ▼
function.py             event has no "action" key → Mangum translates the
                        Lambda event into an ASGI scope
  ▼
app/main.py → … → Aurora PostgreSQL (private subnets, sslmode=require)
```

**The ops path** bypasses HTTP entirely:

```
aws lambda invoke --function-name coding-workshop-v1-<id> \
    --payload '{"action":"health"}' /dev/stdout
  ▼
function.handler → sees "action" → run_ops("health", event)
  ▼
app/services/ops.py  ACTIONS["health"] → _op_health
  ▼
app/services/health.py → Aurora
```

This is IAM-protected and has no CloudFront route, which is why migrations and
seeding can live here safely from M2 onwards.

### 4. Where the rules live

| Rule / behaviour | File | Detail |
| --- | --- | --- |
| Every route starts with `/api/v1` | [app/config.py](../backend/v1/app/config.py) | `API_PREFIX`, applied in `app/main.py` |
| Database connection details | [app/config.py](../backend/v1/app/config.py) | `Settings`; `database_url` adds `sslmode=require` when not local |
| Cookie `Secure` flag | [app/config.py](../backend/v1/app/config.py) | `Settings.cookie_secure` — false locally, true deployed |
| Connection pooling / engine lifetime | [app/db.py](../backend/v1/app/db.py) | One engine per process, `pool_size=1`, `pool_pre_ping` |
| What "healthy" means | [app/services/health.py](../backend/v1/app/services/health.py) | `build_health_report` |
| Which direct-invoke actions exist | [app/services/ops.py](../backend/v1/app/services/ops.py) | the `ACTIONS` dict |
| HTTP vs. ops routing | [function.py](../backend/v1/function.py) | presence of an `action` key |
| Mobile vs. desktop cut-off | [src/hooks/useBreakpoint.ts](../frontend/src/hooks/useBreakpoint.ts) | `MOBILE_MAX_WIDTH = 899` |
| API base path (frontend) | [src/api/client.ts](../frontend/src/api/client.ts) | `API_BASE_URL` |
| Query cache keys | [src/api/queryKeys.ts](../frontend/src/api/queryKeys.ts) | one registry |
| Local `/api` proxying | [frontend/vite.config.ts](../frontend/vite.config.ts) | `server.proxy`, path unchanged |
| SPA deep-link routing (deployed) | [infra/cloudfront.tf](../infra/cloudfront.tf) | `aws_cloudfront_function.spa_router` |
| Lambda env vars | [infra/locals.tf](../infra/locals.tf) | `local.env_vars` |

### 5. How to change it

**Add an API endpoint.**
1. `app/schemas/<domain>.py` — request and response models.
2. `app/services/<domain>.py` — the logic. Routes stay thin.
3. `app/routers/<domain>.py` — an `APIRouter`, one function per route.
4. `app/main.py` — `application.include_router(<domain>.router, prefix=API_PREFIX)`.
5. `tests/` — a unit test for the rule, an integration test for the endpoint.
6. `frontend/src/api/<domain>.ts` — the typed client function and its interfaces.

**Add a Lambda environment variable.**
1. `infra/locals.tf` — add it to `local.env_vars` (it is skipped automatically if empty).
2. `backend/v1/app/config.py` — add the matching field to `Settings`, with a
   development default.
3. Redeploy with `./bin/deploy-backend.sh`.

**Add a direct-invoke ops action** (this is how M2's `migrate` will land).
1. Write `def _op_<name>(event: dict[str, Any]) -> dict[str, Any]:` in
   `app/services/ops.py`.
2. Add it to the `ACTIONS` dict.
3. Add a test in `tests/unit/test_ops.py`.
4. Run it: `aws lambda invoke --function-name <fn> --payload '{"action":"<name>"}' /dev/stdout`.

**Add a page.**
1. `frontend/src/features/<feature>/<Page>.tsx`, plus a `use<Thing>.ts` query hook.
2. Add the `<Route>` to `src/App.tsx`.
3. Add a test beside the component.

**Change the mobile breakpoint.** One constant: `MOBILE_MAX_WIDTH` in
`src/hooks/useBreakpoint.ts`. Keep it one pixel below an MUI breakpoint so
`react-responsive` and MUI's `sx` breakpoints agree.

**Run everything locally.**
```sh
cd backend/v1 && .venv/bin/uvicorn app.main:app --reload --port 8000   # terminal 1
cd frontend   && npm run dev                                           # terminal 2 → :3000
```

**Run the checks** (the same ones CI runs):
```sh
cd backend/v1 && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/python -m pytest
cd frontend   && npm run lint && npm run typecheck && npm test && npm run build
cd infra      && terraform fmt -check && terraform validate
bandit --ini .bandit -r ./backend
```

### 6. Gotchas

**Never create a second `backend/<name>/requirements.txt`.** It provisions another
Lambda with a **public, unauthenticated** Function URL. The same trap exists in
`data/` — a `requirements.txt` there triggers EKS and Helm.

**The Lambda handler name is hardcoded to `function.handler`** in
`infra/locals.tf`. `function.py` must stay at the root of `backend/v1/` and expose
a module-level `handler`. The runtime is hardcoded to `python3.13`.

**The virtualenv must stay dot-prefixed.** The Lambda packaging patterns in
`infra/locals.tf` are `["!__pycache__/.*", "!\\..*"]` — the second excludes
anything starting with a dot, which is the only thing keeping `backend/v1/.venv`
(~150 MB) out of the deployment zip. A venv named `venv/` would be packaged and the
deploy would fail. The `tests/` directory *is* packaged; it is small and harmless,
and excluding it would mean editing `infra/locals.tf` beyond the permitted change.

**Aurora Serverless v2 runs at `min_capacity = 0.0`.** It sleeps when idle and
takes roughly 15 seconds to wake. A hung first request after a quiet period is
almost always this, not a bug. `postgres_connect_timeout` is 30 s for that reason,
and the frontend's TanStack Query default retries once.

**Aurora is not reachable from your machine** (`publicly_accessible = false`).
Migrations, seeding and any direct SQL must go through `aws lambda invoke` with an
`action` payload. This is a constraint, not a preference.

**`ENVIRONMENT.config` holds live AWS STS credentials.** It is gitignored. Never
commit it, echo it, or paste it anywhere. The credentials expire every few hours;
re-run `./bin/setup-participant.sh`.

**`npm ci` cannot be used.** The scaffold's `.gitignore` excludes
`package-lock.json`, so CI runs `npm install`. Dependency versions are therefore
resolved fresh on every CI run within the semver ranges in `package.json`.

**Bandit needed a config file.** `.github/workflows/python.actions.yml` runs
`bandit -r ./backend` on every push, and bandit exits non-zero on *any* finding —
including `B101` for the `assert` in every pytest test. Bandit does **not**
auto-discover `.bandit`, so the workflow was changed to `bandit --ini .bandit -r
./backend`. The config excludes only `backend/v1/.venv` and `backend/v1/tests`;
no rule is disabled and application code is scanned in full.

**Material UI v9 removed system props from components.** `alignItems`,
`justifyContent` and `fontWeight` are no longer accepted directly on `<Stack>` or
`<Typography>` — they must go inside `sx={{ … }}`. The TypeScript error for this
is long and unhelpful; the fix is always the same.

**jsdom has no layout, so `react-responsive` cannot work in tests** without help:
every width query reports `matches: false`. `src/test/viewport.ts` installs a
controllable `window.matchMedia`, and `src/test/setup.ts` calls it *before* any
test module loads — `react-responsive` captures `window.matchMedia` when it is
first imported, so stubbing it inside a test is too late.

**Testing Library does not auto-clean when Vitest globals are off.** We import
`describe`/`it`/`expect` explicitly, so `src/test/setup.ts` registers
`afterEach(cleanup)` by hand. Without it, each test's DOM leaks into the next
test's queries and failures become very confusing.

**`docs/` is not `data/`.** Leave `backend/_examples/`, `data/`, `infra/helm/`,
`infra/eks.tf` and `infra/documentdb.tf` alone — they belong to other workshop tracks.

### 7. Glossary

**ASGI** — Asynchronous Server Gateway Interface. The Python convention for how a
web server hands a request to a web framework. FastAPI speaks ASGI; uvicorn and
Mangum are two different things that can speak it to FastAPI.

**Mangum** — a small adapter that translates an AWS Lambda event into an ASGI
request and the ASGI response back into a Lambda response, so a FastAPI app can run
on Lambda unchanged. `lifespan="off"` skips the ASGI startup/shutdown hooks, which
we do not use.

**uvicorn** — the ASGI server used for local development. In the cloud there is no
server: Lambda invokes `function.handler` directly.

**Lambda Function URL** — a built-in HTTPS endpoint on a Lambda function, an
alternative to API Gateway. The workshop IAM boundary does not permit
`apigateway:*`, so this is how the API is exposed. `authorization_type = "NONE"`
means the URL itself is public — CloudFront is what puts it behind one origin.

**CloudFront** — AWS's CDN. Here it is doing routing, not just caching: one
distribution serves the React app from S3 and forwards `/api/v1*` to the Lambda, so
the browser sees a single origin.

**Cache behaviour** — a CloudFront rule matching a path pattern to an origin. The
`default_cache_behavior` catches everything not matched by an
`ordered_cache_behavior`.

**CloudFront Function** — a tiny JavaScript function CloudFront runs at the edge on
every request (`viewer-request`) or response. Restricted runtime, sub-millisecond,
no network access. Ours rewrites extension-less paths to `/index.html`.

**OAC (Origin Access Control)** — the mechanism that lets CloudFront read a private
S3 bucket. The bucket blocks public access; its policy grants `s3:GetObject` only to
the CloudFront service principal for this distribution.

**SPA routing / deep link** — a single-page app renders `/incidents/abc` in the
browser with JavaScript, but if you reload that URL the server is asked for a file
at that path, which does not exist. Rewriting to `/index.html` lets React Router
take over.

**Aurora Serverless v2** — a managed PostgreSQL that scales capacity automatically,
measured in **ACUs** (Aurora Capacity Units, roughly 2 GiB of RAM each).
`min_capacity = 0.0` means it can scale to zero and sleep.

**SQLAlchemy `Engine` / `Session`** — the `Engine` owns the connection pool and is
created once per process; a `Session` is a short-lived unit of work borrowed from
that pool for one request.

**`pool_pre_ping`** — SQLAlchemy sends a trivial query before handing out a pooled
connection, and transparently replaces it if it is dead. Necessary because Aurora
drops idle connections as it scales down.

**Pydantic / pydantic-settings** — Pydantic validates and serialises data from type
annotations; `BaseSettings` is the variant that reads those values from environment
variables and `.env` files.

**ruff** — a fast Python linter and formatter, replacing flake8, isort and black.
`ruff check` lints, `ruff format` formats.

**Bandit** — a static analyser that looks for common Python security mistakes
(hardcoded passwords, `eval`, insecure hashes).

**Vite** — the frontend build tool and dev server. `vite build` produces the static
`dist/` that is uploaded to S3.

**Vitest** — the test runner that shares Vite's config and transform pipeline.

**jsdom** — a JavaScript implementation of the DOM, so component tests can run in
Node without a browser. It parses and renders structure but does **no layout**,
which is why element sizes and media queries are not real.

**TanStack Query** — client-side server-state cache. A `queryKey` identifies cached
data; a mutation invalidates keys to trigger refetches.

**Flat ESLint config** — ESLint's current format: `eslint.config.js` exports an
array of config objects, replacing the older `.eslintrc` cascade.

**Conventional commits** — commit messages prefixed with a type (`feat:`, `fix:`,
`test:`, `infra:`, `docs:`) so history is scannable.

---

## Phase M2 — Data model, auth and RBAC

M1 proved a request could travel from the browser to PostgreSQL and back. M2 gives it
something to say: the full schema, accounts that can sign in, and the rules about who may
do what.

**Everything in this phase was verified against local PostgreSQL only** — AWS credentials
did not exist yet. What that leaves unproven is recorded, item by item with the exact
command to run, in [docs/DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md). Read that
before the first cloud deploy.

### 1. What was built

#### The schema — `app/models/`

| File | Responsibility |
| --- | --- |
| [base.py](../backend/v1/app/models/base.py) | `Base`, the constraint naming convention, the UUID-primary-key and timestamp mixins, and `pg_enum()`. |
| [enums.py](../backend/v1/app/models/enums.py) | All eleven domain enums as `StrEnum`, plus `ENUM_TYPES` — the one list the migration creates types from. |
| [building.py](../backend/v1/app/models/building.py) · [floor.py](../backend/v1/app/models/floor.py) · [seat.py](../backend/v1/app/models/seat.py) | The facility hierarchy. Meeting rooms are seats with `seat_type = MEETING_ROOM`. |
| [user.py](../backend/v1/app/models/user.py) | Accounts. `email` is `CITEXT`. `last_*_id` pre-fills the report form. |
| [engineer_profile.py](../backend/v1/app/models/engineer_profile.py) | Engineer-only attributes, keyed *by* `user_id` — no separate identity. |
| [category.py](../backend/v1/app/models/category.py) | The two-level tree. Self-referencing `parent_id`. |
| [incident.py](../backend/v1/app/models/incident.py) | The ticket. Ticket sequence, generated `search_vector`, lifecycle timestamps. |
| [note.py](../backend/v1/app/models/note.py) · [event.py](../backend/v1/app/models/event.py) | Comments (soft-deleted) and the append-only audit log. |
| [refresh_token.py](../backend/v1/app/models/refresh_token.py) | Issued tokens, stored hashed. |

#### Migration — `alembic/`

[alembic/versions/0001_initial_schema.py](../backend/v1/alembic/versions/0001_initial_schema.py)
builds everything in four ordered steps: extensions, enum types, the ticket sequence,
then tables. [alembic/env.py](../backend/v1/alembic/env.py) takes its URL from
`app.config.Settings`, so migrations can never connect somewhere the API does not.
[app/migrations.py](../backend/v1/app/migrations.py) pins the script path absolutely.

#### Reference data — `app/seed/categories.py`

Five groups, 32 subcategories, as a frozen dataclass table plus an idempotent
`seed_categories(session)`.

#### Security — `app/security/`

| File | Responsibility |
| --- | --- |
| [passwords.py](../backend/v1/app/security/passwords.py) | bcrypt cost 12, with a SHA-256 pre-hash. |
| [tokens.py](../backend/v1/app/security/tokens.py) | Access JWTs and opaque refresh tokens. |
| [dependencies.py](../backend/v1/app/security/dependencies.py) | `get_current_user`, `require_roles`, `require_engineer_levels`, the password-change gate, cookie constants. |

#### Auth — router, service, repository, schemas

[routers/auth.py](../backend/v1/app/routers/auth.py) (six endpoints) →
[services/auth_service.py](../backend/v1/app/services/auth_service.py) (every rule) →
[repositories/users.py](../backend/v1/app/repositories/users.py) (every query).
[errors.py](../backend/v1/app/errors.py) defines the one error shape.

#### Ops — `app/services/ops.py`

`migrate` and `seed_admin` joined `health` on the existing registry.

#### Tests — 155 total, up from 19

| File | Covers |
| --- | --- |
| `tests/unit/test_email_validation.py` | 32 cases: lookalikes, homographs, multiple `@`. |
| `tests/unit/test_passwords.py` | Long and multibyte passwords, salting, cost, fail-closed. |
| `tests/unit/test_tokens.py` | Expiry, forged keys, `alg=none`, wrong token type. |
| `tests/integration/test_auth.py` | All six endpoints, rotation, reuse detection. |
| `tests/integration/test_rbac.py` | The role × level × gate matrix. |
| `tests/integration/test_migration.py` | The schema Postgres actually built. |
| `tests/integration/test_seed_categories.py` | Idempotency and admin-edit survival. |
| `tests/integration/test_ops_actions.py` | Both actions through `function.handler`. |

### 2. Why it is shaped this way

**Enum types are created up front, and every column says `create_type=False`.**
SQLAlchemy will happily create a PostgreSQL enum type as a side effect of creating the
first table that uses it. That works right up until a second table uses the same type,
at which point the migration dies with "type already exists". Creating all eleven from
`ENUM_TYPES` at the top of the migration removes the trap before it can appear.

*Consequence:* `Base.metadata.create_all()` can no longer build this schema. That is
fine, and arguably better — the tests build their database with the real migrations
instead, so every test run is also a migration rehearsal.

**`UNIQUE (parent_id, name) NULLS NOT DISTINCT` on categories.** In SQL, `NULL != NULL`,
so a plain unique constraint on `(parent_id, name)` would silently never apply to
*groups* — whose `parent_id` is NULL — and two groups could both be called "Hardware".
`NULLS NOT DISTINCT` (PostgreSQL 15+) makes NULLs collide, which is what we want.
**Rejected:** a partial unique index on `(name) WHERE parent_id IS NULL`, which needs two
constraints to express one rule. That fallback is noted in the checklist in case Aurora
surprises us.

**`search_vector` is a generated column, not a trigger or an application field.**
PostgreSQL recomputes it from `title` and `description` on every write, so it cannot
drift. A trigger would do the same but lives outside the schema definition; an
application-maintained column drifts the first time anything writes SQL directly.

**Ticket numbers come from a sequence.** `COUNT(*) + 1` races under concurrency and
reuses numbers after deletes. A UUID is unreadable over the phone. A sequence gives
stable, never-reused integers; gaps after a rollback are harmless.

**bcrypt is fed a SHA-256 digest, not the password.** bcrypt 5.x *raises* on inputs over
72 bytes — it does not truncate. Our policy allows 128 characters, and a single emoji is
four bytes, so long passwords would simply fail. Reducing to a base64 SHA-256 digest
gives a constant 44 ASCII bytes with no entropy lost. This is what passlib calls
`bcrypt_sha256`. **The digest step can never be removed or reordered** — doing so
invalidates every stored hash.

**Two token mechanisms.** A stateless JWT is cheap to verify but cannot be revoked; an
opaque database-backed token can be revoked but costs a query. Using a short-lived JWT
for requests and a long-lived opaque token for renewal gets both properties: fifteen
minutes of exposure if an access token leaks, immediate revocation for everything else.

**Refresh tokens are SHA-256, not bcrypt.** A refresh token is 32 bytes of
cryptographic randomness, not a guessable human secret, so there is nothing for a slow
hash to defend against — and lookup has to be an indexed equality match, which a salted
hash cannot do.

**Refresh-token reuse revokes every session.** Presenting a token that was already
rotated away means either the cookie was stolen and replayed, or the legitimate client
raced itself. There is no way to tell them apart, and ending all sessions is safe in both
cases: the honest user signs in again, and the thief is locked out. Without this, a
stolen cookie is usable indefinitely as long as the thief refreshes it first.

**The password-change gate is two dependencies, not middleware.** The rule is "every
endpoint except `/auth/*` returns 403 while `must_change_password` is set". A middleware
would have to pattern-match URLs — fragile, and invisible from the route it governs.
Instead `get_authenticated_user` does authentication only and `get_current_user` adds
the gate; `/auth/*` uses the first, everything else uses the second. A route's
dependency says which it is, and the change-password endpoint stays reachable, which it
must be or the gate would be a trap with no exit.

**Role and engineer level are read from the database on every request.** The access
token carries `role` for convenience, but nothing authorises from it. An admin demoting
someone takes effect on their very next request, not fifteen minutes later. Both
directions are tested.

**Login is deliberately uninformative.** One message for unknown email, wrong password
and deactivated account — otherwise the endpoint is an account-existence oracle. The
password is verified against a dummy hash even when no user was found, so the *timing*
does not answer the question either.

**Category seeding lives in `migrate`, not in a separate action.** The questionnaire
cannot render without categories, so a migrated-but-unseeded database is not a usable
one. One command produces a working database. **Rejected:** rows in the migration —
categories are admin-editable, and a frozen migration is the wrong home for data that is
expected to change.

**`seed_admin` always sets `must_change_password`.** A password that has travelled
through an invoke payload and a terminal is not a password to keep, even one the caller
chose.

**Exceptions are named `...Error`.** `ValidationFailed` read better, but ruff's `N818`
enforces the PEP 8 convention and the house style follows the linter.

### 3. How the pieces connect

**Signing in**, hop by hop:

```
POST /api/v1/auth/login  {"email": "...", "password": "..."}
  ▼
routers/auth.py :: login
  │  LoginRequest validates shapes only — no business rules here
  ▼
services/auth_service.py :: authenticate
  ├─ repositories/users.py :: get_by_email     → SELECT ... WHERE email = :e   (CITEXT)
  ├─ security/passwords.py :: verify_password  → bcrypt(sha256(password))
  │     no user? verify against _DUMMY_HASH anyway, then fail identically
  └─ user.last_login_at = now()
  ▼
services/auth_service.py :: issue_session
  ├─ security/tokens.py :: create_access_token   → JWT, 15 min, HS256
  ├─ security/tokens.py :: generate_refresh_token → (raw, sha256)
  └─ repositories/users.py :: add_refresh_token  → INSERT (hash only)
  ▼
routers/auth.py :: _set_refresh_cookie
  │  HttpOnly; SameSite=strict; Path=/api/v1/auth; Secure ← Settings.cookie_secure
  ▼
{"access_token": "...", "token_type": "bearer", "user": {...}}
```

**A later authorised request:**

```
GET /api/v1/<anything>   Authorization: Bearer <jwt>
  ▼
security/dependencies.py :: get_bearer_token      → split the header
  ▼
security/tokens.py :: decode_access_token         → verify signature, exp, type
  ▼
repositories/users.py :: get_by_id                → SELECT user + engineer_profile
  │  role and level come from HERE, never from the token
  ▼
security/dependencies.py :: get_current_user      → 403 if must_change_password
  ▼
security/dependencies.py :: require_roles(...)    → 403 if role not allowed
  ▼
the route
```

**The ops path**, unchanged from M1 in shape:

```
aws lambda invoke --payload '{"action":"migrate"}'
  ▼
function.py :: handler        sees "action" → never touches the ASGI app
  ▼
services/ops.py :: run_ops → ACTIONS["migrate"] → _op_migrate
  ├─ app/migrations.py :: upgrade_to_head    → alembic upgrade head
  └─ app/seed/categories.py :: seed_categories → idempotent INSERTs
  ▼
{"ok": true, "result": {"schema": "...", "categories": {...}}}
```

### 4. Where the rules live

| Rule | File | Detail |
| --- | --- | --- |
| Who may register | [services/auth_service.py](../backend/v1/app/services/auth_service.py) | `normalise_email`, `ALLOWED_EMAIL_DOMAIN` |
| Password length policy | [security/passwords.py](../backend/v1/app/security/passwords.py) | `MIN/MAX_PASSWORD_LENGTH`, mirrored by `schemas/auth.py` |
| Password hashing | [security/passwords.py](../backend/v1/app/security/passwords.py) | `BCRYPT_ROUNDS`, `_prehash` |
| Token lifetimes | [security/tokens.py](../backend/v1/app/security/tokens.py) | `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` |
| Refresh rotation and reuse response | [services/auth_service.py](../backend/v1/app/services/auth_service.py) | `rotate_session` |
| Cookie flags and path | [routers/auth.py](../backend/v1/app/routers/auth.py) + [security/dependencies.py](../backend/v1/app/security/dependencies.py) | `_set_refresh_cookie`, `REFRESH_COOKIE_PATH` |
| Password-change gate | [security/dependencies.py](../backend/v1/app/security/dependencies.py) | `get_current_user` |
| Role permissions | [security/dependencies.py](../backend/v1/app/security/dependencies.py) | `require_roles`, `require_engineer_levels` |
| New accounts are EMPLOYEE | [services/auth_service.py](../backend/v1/app/services/auth_service.py) | `register_employee` hardcodes the role |
| Error response shape | [errors.py](../backend/v1/app/errors.py) | `api_error_handler` |
| Which enum types exist | [models/enums.py](../backend/v1/app/models/enums.py) | `ENUM_TYPES` |
| Blocked needs a reason | [models/incident.py](../backend/v1/app/models/incident.py) | `CheckConstraint`, enforced by the database |
| Category tree contents | [seed/categories.py](../backend/v1/app/seed/categories.py) | `CATEGORY_GROUPS` |
| Which ops actions exist | [services/ops.py](../backend/v1/app/services/ops.py) | `ACTIONS` |

### 5. How to change it

**Add a column to an existing table.**
1. Add the `mapped_column` to the model in `app/models/`.
2. `cd backend/v1 && POSTGRES_NAME=acme_incidents_dev .venv/bin/alembic revision --autogenerate -m "describe it"`.
3. **Read the generated file.** Autogenerate misses enum creation, generated columns and
   index methods — compare against `0001_initial_schema.py` for how those are written.
4. `alembic upgrade head`, then `alembic downgrade -1 && alembic upgrade head` to prove
   the round trip.
5. Add it to the matching schema in `app/schemas/`.
6. `pytest tests/integration/test_migration.py` — `test_models_and_migration_do_not_drift`
   catches a model changed without a migration.

**Add a new enum type.**
1. Add the `StrEnum` to `app/models/enums.py` **and** register it in `ENUM_TYPES`.
2. In the migration, `op.execute("CREATE TYPE ...")` before any table uses it, and add
   the matching `DROP TYPE` to `downgrade()`.
3. Use `pg_enum(YourEnum, "your_type_name")` on the column.

**Protect a new endpoint.**
```python
from app.security.dependencies import CurrentUser, require_roles

@router.get("/things")
def list_things(user: CurrentUser) -> ...:          # any signed-in user, gate applied
    ...

@router.post("/things")
def create_thing(
    admin: Annotated[User, Depends(require_roles(UserRole.FACILITY_ADMIN))],
) -> ...:
    ...
```
Never use `get_authenticated_user` outside `/auth` — it skips the password-change gate.

**Add an ops action.** `def _op_name(event) -> dict`, register it in `ACTIONS`, add a
test in `tests/integration/test_ops_actions.py`, and add a checklist entry in
`docs/DEPLOYMENT-CHECKLIST.md` for whatever about it can only be proven in the cloud.

**Change the category tree.** Edit `CATEGORY_GROUPS` in `app/seed/categories.py`, then
re-run `migrate`. Additions appear; renames create a *new* row and leave the old one, so
rename through the admin UI (M6) rather than here.

**Run the backend checks:**
```sh
cd backend/v1
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/python -m pytest
cd .. && backend/v1/.venv/bin/bandit --ini .bandit -r ./backend
```

### 6. Gotchas

**`Base.metadata.create_all()` cannot build this schema.** The enums use
`create_type=False`, and the extensions and sequence exist only in the migration. Use
`alembic upgrade head` — which is what the test fixtures do.

**The test database is dropped and recreated on every run.** Most tests roll their writes
back, but the ops-action tests go through `function.handler`, which owns its own session
and genuinely commits. Without the drop, `seed_admin creates an account` would pass once
and fail forever after. The name comes from `POSTGRES_TEST_NAME` (default
`acme_incidents_test`) and `_recreate_database` refuses to drop the `postgres`
maintenance database.

**A test that reads committed state needs to clear it first.** For the same reason,
`test_seed_categories.py` deletes all categories in an autouse fixture — otherwise it
sees the rows the ops tests committed. The delete is rolled back with the test.

**ruff's isort thinks `alembic` is first-party** because there is a local `alembic/`
directory. `known-third-party = ["alembic"]` in `pyproject.toml` fixes the import
grouping; without it `ruff check` and `ruff format` disagree with each other forever.

**`:table::regclass` breaks in a SQLAlchemy `text()`.** The `::` cast confuses bind
parameter parsing. Join `pg_class` instead — see `test_check_constraints_exist`.

**Bandit flags three constants as hardcoded passwords.** `PASSWORD_CHANGE_REQUIRED`,
`ACCESS_TOKEN_TYPE` and a `must_change_password` dict key all match its name heuristic.
Each carries an inline `# nosec B105` with the reason. Do not widen the `.bandit` config
to silence these — the point is that a *real* finding would still show up.

**Local PostgreSQL is 18.6; Aurora is 17.7.** Every feature used is PostgreSQL 15 or
earlier, so this should not matter, but it is unverified. See checklist item 2.3.

**`CREATE EXTENSION` on Aurora is the biggest open risk in the project.** The migration
creates `pgcrypto` and `citext`, and every table depends on both. Aurora's master user
holds `rds_superuser`, not superuser. Both extensions are on the RDS-supported list, so
it is expected to work — but if it does not, nothing gets created. Checklist item 2.1,
with a recovery plan.

**`must_change_password` blocks *everything* outside `/auth`.** If a deployed account
seems unable to do anything and every response is a 403 with
`code: "PASSWORD_CHANGE_REQUIRED"`, that is the gate working, not a bug. Change the
password.

**The temporary password from `seed_admin` is shown once.** It is stored only as a bcrypt
hash. Lose it and the fix is to seed a different admin email.

### 7. Glossary

**Alembic** — the migration tool for SQLAlchemy. Each migration is a Python file with
`upgrade()` and `downgrade()`; a table called `alembic_version` records which have run.

**Autogenerate** — Alembic comparing your models against a live database and writing a
migration for the difference. A starting point, not an answer: it misses enum creation,
generated columns and index methods.

**Migration head / `downgrade base`** — "head" is the newest revision; `base` is before
the first. `upgrade head` applies everything, `downgrade base` undoes everything.

**Extension** — an installable PostgreSQL add-on. `pgcrypto` provides
`gen_random_uuid()`; `citext` provides a case-insensitive text type.

**CITEXT** — text that compares case-insensitively. `users.email` uses it so
`Ada@acme.inc` and `ada@acme.inc` are the same row, enforced by the database rather than
by every caller remembering to lowercase.

**Generated column** — a column PostgreSQL computes from other columns. `STORED` means
the result is written to disk and can be indexed.

**`tsvector` / `to_tsvector` / `setweight`** — PostgreSQL's full-text search types.
A `tsvector` is a document reduced to normalised search terms; `setweight` tags terms
with an importance class (`'A'` beats `'B'`) so title matches outrank description matches.

**GIN index** — Generalised Inverted Index. Maps each term to the rows containing it,
which is what makes `tsvector` search fast. The right index type for "many values inside
one column".

**Sequence** — a database counter. `nextval()` is atomic and never returns the same
number twice, even under concurrency.

**`NULLS NOT DISTINCT`** — a PostgreSQL 15+ option making a unique constraint treat NULLs
as equal. Without it, rows with a NULL in the constrained column never collide.

**Enum type** — a PostgreSQL column type restricted to a fixed list of labels. Stricter
than a `CHECK`, and the labels have a defined sort order.

**`StrEnum`** — a Python enum whose members *are* strings, so `UserRole.EMPLOYEE ==
"EMPLOYEE"` is true. Values from the database, from JSON and from tests all behave
identically.

**ORM session / flush / commit** — a `Session` is a unit of work. `flush()` sends pending
SQL so the database assigns defaults and ids, but stays inside the transaction;
`commit()` ends the transaction and makes it permanent.

**Savepoint** — a named point inside a transaction you can roll back to. The test
fixtures use one so code under test can call `commit()` normally and still be undone.

**bcrypt / cost factor / salt** — a deliberately slow password hash. The cost factor is a
power of two (12 → 4,096 iterations); the salt is random per-hash, so identical passwords
produce different hashes and one precomputed table cannot attack them all.

**JWT** — JSON Web Token: base64 JSON with a signature. Anyone can *read* it; only the
key holder can *forge* it. Never put a secret in one.

**HS256** — HMAC-SHA256, a symmetric JWT signature. One key both signs and verifies,
which suits a single service. **`alg=none`** is the classic JWT attack — a token claiming
to need no signature — which is why `decode_access_token` pins the algorithm.

**Claims** — the fields inside a JWT. `sub` (subject), `iat` (issued at) and `exp`
(expires) are standard; `role` and `type` are ours.

**Refresh-token rotation** — issuing a brand-new refresh token every time one is used and
revoking the old one, so a stolen token is useful only until the real user refreshes.
**Reuse detection** is noticing a revoked one come back and ending every session.

**`HttpOnly` / `Secure` / `SameSite=Strict`** — cookie flags. `HttpOnly` hides it from
JavaScript; `Secure` sends it over HTTPS only; `SameSite=Strict` withholds it from
requests originating on another site, which is what blocks CSRF.

**Cookie `Path`** — the URL prefix a cookie is sent for. Ours is `/api/v1/auth`, so the
refresh token is not attached to ordinary API calls.

**RBAC** — Role-Based Access Control: permissions attach to roles, and users hold a role.

**FastAPI dependency** — a function FastAPI calls before the route, whose return value is
injected. Dependencies compose, which is how `require_roles` builds on `get_current_user`
which builds on `get_authenticated_user`.

---

## Phase M3 — Facilities, categories, engineers and users

M2 built the schema and the front door. M3 fills the reference data an incident
needs before it can exist: somewhere it happened (buildings → floors → seats), what
kind of problem it is (the category tree), who can be given it (engineers), and who
is who (users). Four resources, thirty-one endpoints, no frontend — the React shell
arrives in M5, and building admin screens before there is a login page would mean
building them twice.

**Everything here was verified against local PostgreSQL only**, as in M2: through the
294-test suite, and once end to end over HTTP against a throwaway database with a real
uvicorn server. What remains unproven in the cloud is in
[docs/DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md).

This section also covers two carry-overs from M2 that were fixed first.

### 0. The two carry-overs

#### The JWT secret could silently fall back to a public string

`app/config.py` gave `jwt_secret` a default of `local-development-secret-change-me`
so that a fresh clone runs with no setup. The danger was in how that default could be
reached in production. `infra/lambda.tf` filters the environment map:

```hcl
environment_variables = {
  for key, value in local.env_vars :
  key => trimspace(value) if try(trimspace(value), "") != ""
}
```

A `JWT_SECRET` that failed to apply therefore does not arrive as an empty string — it
does not arrive at all, `Settings` falls back to the default, and real sessions are
signed with a value published in this repository. Nothing looks wrong: tokens verify,
logins succeed, and anyone who has read the repo can mint an admin token.

The fix is a Pydantic `model_validator` that refuses to *build* the settings object:

```python
@model_validator(mode="after")
def _reject_a_weak_deployed_secret(self) -> Self:
    if self.is_local:
        return self
    if self.jwt_secret == DEVELOPMENT_JWT_SECRET:
        raise ValueError("JWT_SECRET is still the development default. ...")
    if len(self.jwt_secret.encode("utf-8")) < MIN_JWT_SECRET_BYTES:
        raise ValueError("JWT_SECRET must be at least 32 bytes outside local development; ...")
    return self
```

Startup rather than per-request, because a check that runs on every request either
costs something on every request or gets cached into the same silence. A Lambda that
cannot initialise is loud, immediate, and fixed by re-applying Terraform.

Why 32 bytes: RFC 7518 §3.2 requires an HS256 key at least as long as the hash output,
and SHA-256 produces 32 bytes. PyJWT only *warns* below that. The length is measured in
bytes, not characters — `len("é" * 16)` is 16 characters but 32 bytes, and it is the
bytes that go into the HMAC. `tests/unit/test_config.py` covers both refusals, both
acceptances, and the multibyte case.

#### A fresh clone pointed at an empty database

`postgres_name` defaults to `postgres`, the cluster's maintenance database, which is
the right default for the deployed case and a trap locally: the API starts,
`/api/v1/health` reports healthy because it only proves a *connection*, and every real
query then fails on a missing table.

Fixed with documentation rather than a different default, because the default is
correct for the environment it is written for:

- [backend/v1/.env.example](../backend/v1/.env.example) — every field on `Settings`,
  each with its default, plus the test-only `POSTGRES_TEST_NAME`. Committed, which
  needed a `!.env.example` line in `.gitignore`: the repo ignores `.env.*` wholesale
  and previously un-ignored only `.env.sample`.
- [README.md](../README.md) — a **Local development** section taking an empty
  PostgreSQL install to a running stack in five steps, with a troubleshooting table
  keyed by *symptom* (`relation "users" does not exist`) rather than by cause.
- This guide — see [§5, "Set up a local database from a fresh clone"](#5-how-to-change-it-2).

### 1. What was built

#### Schemas — `app/schemas/`

| File | Responsibility |
| --- | --- |
| [common.py](../backend/v1/app/schemas/common.py) | `Page[T]`, `PageParams`, the `Paging` dependency and `DeleteResult`. The paging contract lives here once instead of in five routers. |
| [facility.py](../backend/v1/app/schemas/facility.py) | Building, floor and seat create/update/read, the bulk-seat request and result, and the nested tree nodes. |
| [category.py](../backend/v1/app/schemas/category.py) | Category create/update/read plus `CategoryNode`, a group carrying its children. |
| [engineer.py](../backend/v1/app/schemas/engineer.py) | `EngineerCreate`, `EngineerUpdate`, `EngineerSelfUpdate` (deliberately smaller), `EngineerRead` with `active_ticket_count`, and `EngineerCreated` with the one-time password. |
| [user.py](../backend/v1/app/schemas/user.py) | Extended with `UserUpdate` — name, role, active flag; no email, no password. |

#### Repositories — `app/repositories/`

| File | Responsibility |
| --- | --- |
| [facilities.py](../backend/v1/app/repositories/facilities.py) | Paged lists per level, uniqueness lookups, the eager-loading tree query, and the three `count_incidents_*` reference checks. |
| [categories.py](../backend/v1/app/repositories/categories.py) | The two-level tree query, sibling-name lookup, child count, reference count, and the write that pushes a group's `location_detail` onto its children. |
| [engineers.py](../backend/v1/app/repositories/engineers.py) | The `User ⋈ EngineerProfile` join with `active_ticket_count` as a correlated subquery, plus its filters. |
| [users.py](../backend/v1/app/repositories/users.py) | Gained `search()` — role filter, `ILIKE` on name or email with wildcards escaped. Lost `count_by_role`, which M2 wrote and nothing called. |

#### Services — `app/services/`

| File | The rules it owns |
| --- | --- |
| [facilities.py](../backend/v1/app/services/facilities.py) | Uniqueness per level, building-code normalisation, delete-versus-409, and the rule that deactivation does not cascade. |
| [categories.py](../backend/v1/app/services/categories.py) | Two-level depth, group-only fields, inheritance of `location_detail`, sibling names, delete-versus-deactivate. |
| [engineers.py](../backend/v1/app/services/engineers.py) | Account and profile created together, generated one-time password, specialties must be groups, deactivate rather than delete. |
| [users.py](../backend/v1/app/services/users.py) | The self-edit guard, profile creation on promotion, session revocation on deactivation. |

#### Routers — `app/routers/`

[facilities.py](../backend/v1/app/routers/facilities.py) (17 routes),
[categories.py](../backend/v1/app/routers/categories.py) (5),
[engineers.py](../backend/v1/app/routers/engineers.py) (6) and
[users.py](../backend/v1/app/routers/users.py) (3), all mounted under `/api/v1` by
[main.py](../backend/v1/app/main.py).

#### Shared plumbing

- [errors.py](../backend/v1/app/errors.py) — added `NotFoundError` (404).
- [security/dependencies.py](../backend/v1/app/security/dependencies.py) — added
  `get_include_inactive` and the `SIGNED_IN` / `ADMIN_ONLY` / `STAFF_ONLY` /
  `AdminUser` / `StaffUser` aliases.
- [models/enums.py](../backend/v1/app/models/enums.py) — added
  `ACTIVE_INCIDENT_STATUSES`, the single definition of "live work".
- [models/building.py](../backend/v1/app/models/building.py),
  [models/floor.py](../backend/v1/app/models/floor.py) — `order_by` on the `floors`
  and `seats` relationships, so the tree is deterministically ordered.

**No migration.** Every table M3 uses was created by `0001_initial_schema.py`; this
phase adds endpoints over an existing schema.

#### Tests — 294 total, up from 155

| File | Covers |
| --- | --- |
| `tests/integration/test_facilities.py` (41) | CRUD at three levels, uniqueness, paging bounds, bulk create with repeats, the tree's filtering and ordering, referenced-delete 409s, permissions. |
| `tests/integration/test_categories.py` (29) | Depth refusal, inheritance and its rewrite, group-only field refusals, sibling uniqueness including two groups, delete-versus-deactivate. |
| `tests/integration/test_engineers.py` (35) | Creation and the password gate, `active_ticket_count` by status and by owner, every filter, self-service limits, deactivation and session revocation. |
| `tests/integration/test_users.py` (28) | Search including escaped wildcards, promotion creating a profile, demotion keeping one, the self-edit guard, deactivation. |
| `tests/unit/test_config.py` (+6) | The JWT secret validator, both branches and the byte-versus-character case. |
| `tests/factories.py` | Gained `make_admin`, `make_building`, `make_floor`, `make_seat`, `make_category`, `make_incident`. |

### 2. Why it is shaped this way

**A facility delete is a 409; a category delete is a deactivation.** These look
inconsistent and are not. Deleting a building an incident was filed in would make that
ticket's location unreadable, and an admin who typed the wrong id deserves to be
stopped — so the API refuses and says how many tickets are involved, and the UI can
offer "deactivate instead". Retiring a category is routine curation: an admin who
removes "Fax machine" means "stop offering this", not "and tell me about the 40 tickets
from 2019". So that one succeeds and reports what it did. `DeleteResult` carries
`deleted` and `deactivated` so the caller never has to infer which happened.
**Rejected:** one uniform rule. It would have made one of the two endpoints wrong.

**Deactivation does not cascade.** Deactivating a building leaves its floors and seats
with `is_active = true`; they simply never appear, because the tree query filters at
every level and never reaches them. The alternative — writing `false` down the subtree —
makes reactivation lossy: you cannot tell which floors were *already* closed before the
building was. The cost is that a floor can be "active" under an inactive building, which
is invisible in every read path.

**`include_inactive=true` is refused for non-admins, not ignored.** Quietly dropping a
flag means answering a different question than the one asked. Refusing with
`INCLUDE_INACTIVE_NOT_PERMITTED` is one line in
[`get_include_inactive`](../backend/v1/app/security/dependencies.py) and is testable.

**Permissions are declared in the route decorator.** `dependencies=[ADMIN_ONLY]` rather
than an `admin: AdminUser` parameter the handler never reads. Routes that genuinely need
the caller — `PATCH /users/{id}`, whose self-edit guard must know who is acting — take
it as a parameter instead. Both forms were already in `require_roles`'s docstring from
M2; M3 picks per route rather than per codebase.

**`active_ticket_count` is a correlated subquery, not a loop.**

```python
select(func.count(Incident.id))
    .where(Incident.assignee_id == User.id, Incident.status.in_(ACTIVE_INCIDENT_STATUSES))
    .correlate(User)
    .scalar_subquery()
```

Selected alongside `User` and `EngineerProfile`, so a page of twenty engineers is one
statement. **Rejected:** a `GROUP BY` join, which drops engineers with no tickets unless
written as an outer join, and a Python `len()` per engineer, which is the N+1 the build
plan forbids. "Active" means `OPEN`, `IN_PROGRESS` or `BLOCKED`, defined once in
`models/enums.py` because M4's capacity warnings must agree with this number.

**Uniqueness is checked in the service, then enforced by the database.** The pre-check
exists to produce a 409 naming the field, which is what a form needs; the constraint
exists because the pre-check has a race between its `SELECT` and its `INSERT`. Two
admins creating the same building code in the same instant get one 409 and one 500 —
see [§6](#6-gotchas).

**Names are compared case-insensitively even where the column is not.** `buildings.name`
is `TEXT`, so PostgreSQL would happily hold "SF HQ" and "sf hq". `func.lower(...) == ...`
in the repository closes that. `users.email` needs no such help — it is `CITEXT`.

**`EngineerSelfUpdate` is a separate, smaller model.** An engineer may set availability
and phone. Rather than checking fields at runtime, the self-service endpoint parses a
model that *has* no `level`, so `{"level": "LEAD"}` cannot be obeyed — there is nothing
to obey it with. The same trick keeps email out of `UserUpdate`.

**The engineer's password is generated, never chosen.** A password an admin types is one
an admin knows; `secrets.token_urlsafe(16)` plus `must_change_password` means the value
that appeared on an admin's screen stops working at first sign-in.

**An admin cannot demote or deactivate themselves.** That single rule is what makes the
last facility admin unremovable: removing an admin requires being a *different* admin,
so one always remains. **Rejected:** counting remaining admins on every write — more
code, and two admins demoting each other simultaneously could still slip through it.

**Promotion to ENGINEER creates a profile; demotion keeps it.** An `ENGINEER` with no
profile passes `require_roles(ENGINEER)` and then fails every `require_engineer_levels`
check — half-created and confusing. Keeping the row on demotion means a re-promotion
restores the level and specialties instead of silently resetting a LEAD to JUNIOR. The
row is inert while the role is not ENGINEER: `get_engineer` filters on the role, so a
demoted user is absent from `/engineers` entirely.

**Specialties must be top-level groups.** A group covers its subcategories by
definition, so accepting a subcategory id would promise a precision the assignment rules
in M4 do not implement.

### 3. How the pieces connect

One request, hop by hop — an admin pasting a floor plan into the bulk-seat dialog:

```
POST /api/v1/floors/{id}/seats/bulk   {"codes": ["3-A-01", "3-A-01", "3-A-02"], "seat_type": "DESK"}
  │
  ├─ main.py                     router mounted at /api/v1, so the path CloudFront
  │                              forwards unchanged matches as-is
  ├─ routers/facilities.py       dependencies=[ADMIN_ONLY]  →
  │      security/dependencies.py    require_roles(FACILITY_ADMIN)
  │        → get_current_user         → password-change gate
  │          → get_authenticated_user  → bearer token → decode_access_token
  │            → repositories/users.py get_by_id  (role read from the DB, not the token)
  ├─ schemas/facility.py         SeatBulkCreate: 1–500 codes, each 1–40 chars, trimmed
  ├─ services/facilities.py      bulk_create_seats
  │      ├─ get_floor(...)                   → 404 if the floor is unknown
  │      ├─ _deduplicate(codes)              → ["3-A-01", "3-A-02"], first occurrence wins
  │      ├─ repositories/facilities.py       existing_seat_codes  — ONE query for the batch
  │      └─ session.add(Seat(...)) per new code, then flush
  ├─ routers/facilities.py       session.commit()
  └─ SeatBulkResult              {created: [...], skipped_codes: [...], counts}
```

Two things to notice. The permission chain is three dependencies deep and every one of
them is the same code the auth endpoints use — M3 added no new authentication. And the
existence check is one `IN (...)` query rather than one per pasted line, which is the
difference between 2 statements and 41 for a forty-desk floor.

The tree read is the mirror image:

```
GET /api/v1/facilities/tree
  → services/facilities.py load_tree
    → repositories/facilities.py load_tree
        selectinload(Building.floors.and_(Floor.is_active))
          .selectinload(Floor.seats.and_(Seat.is_active))
      = 3 statements total: buildings, then all their floors, then all their seats
  → routers/facilities.py _to_building_node / _to_floor_node
      walk the already-loaded relationships — no further queries
```

`.and_()` on a `selectinload` is what keeps the filtering in SQL. Written as a plain
`selectinload` plus a Python comprehension, every inactive seat in the company would be
fetched and then discarded.

### 4. Where the rules live

| Rule | File | Detail |
| --- | --- | --- |
| Deployed JWT secret must be real | [config.py](../backend/v1/app/config.py) | `_reject_a_weak_deployed_secret`, `MIN_JWT_SECRET_BYTES` |
| Which settings exist and their defaults | [config.py](../backend/v1/app/config.py) + [.env.example](../backend/v1/.env.example) | `Settings` fields |
| Page size default and maximum | [schemas/common.py](../backend/v1/app/schemas/common.py) | `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE` |
| Who may see deactivated rows | [security/dependencies.py](../backend/v1/app/security/dependencies.py) | `get_include_inactive` |
| Building name and code uniqueness | [services/facilities.py](../backend/v1/app/services/facilities.py) | `_require_free_building_name`, `_require_free_building_code` |
| Building codes are uppercased | [services/facilities.py](../backend/v1/app/services/facilities.py) | `_normalise_code` |
| Floor level unique per building | [services/facilities.py](../backend/v1/app/services/facilities.py) | `_require_free_floor_level` |
| Seat code unique per floor | [services/facilities.py](../backend/v1/app/services/facilities.py) | `_require_free_seat_code` |
| A referenced facility cannot be deleted | [services/facilities.py](../backend/v1/app/services/facilities.py) | `delete_building` / `delete_floor` / `delete_seat` |
| What "referenced" means for a facility | [repositories/facilities.py](../backend/v1/app/repositories/facilities.py) | `count_incidents_in_building` and siblings |
| Bulk seats: dedupe and skip | [services/facilities.py](../backend/v1/app/services/facilities.py) | `bulk_create_seats`, `_deduplicate` |
| Category tree is two levels | [services/categories.py](../backend/v1/app/services/categories.py) | `_resolve_parent` |
| Group-only fields | [services/categories.py](../backend/v1/app/services/categories.py) | `GROUP_ONLY_FIELDS` |
| Subcategories inherit `location_detail` | [services/categories.py](../backend/v1/app/services/categories.py) | `update_category` → `set_children_location_detail` |
| Sibling category names | [services/categories.py](../backend/v1/app/services/categories.py) | `_require_free_name` |
| A referenced category is deactivated | [services/categories.py](../backend/v1/app/services/categories.py) | `delete_category` |
| Engineer creation and temp password | [services/engineers.py](../backend/v1/app/services/engineers.py) | `create_engineer`, `TEMPORARY_PASSWORD_BYTES` |
| Specialties must be groups | [services/engineers.py](../backend/v1/app/services/engineers.py) | `_require_group_ids` |
| What an engineer may change alone | [schemas/engineer.py](../backend/v1/app/schemas/engineer.py) | `EngineerSelfUpdate` |
| What "active ticket" means | [models/enums.py](../backend/v1/app/models/enums.py) | `ACTIVE_INCIDENT_STATUSES` |
| Engineers are deactivated, not deleted | [services/engineers.py](../backend/v1/app/services/engineers.py) | `deactivate_engineer` |
| An admin cannot demote themselves | [services/users.py](../backend/v1/app/services/users.py) | `_reject_self_change` |
| Promotion creates an engineer profile | [services/users.py](../backend/v1/app/services/users.py) | `_apply_role_change` |
| Deactivation ends sessions | [services/users.py](../backend/v1/app/services/users.py), [services/engineers.py](../backend/v1/app/services/engineers.py) | `revoke_all_refresh_tokens` |
| Search wildcards are escaped | [repositories/users.py](../backend/v1/app/repositories/users.py) | `_escape_like` |

### 5. How to change it

**Set up a local database from a fresh clone.** The API never creates its own database.

```sh
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres123';"
sudo -u postgres createdb acme_incidents_dev

cd backend/v1
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env          # the important line is POSTGRES_NAME=acme_incidents_dev

.venv/bin/python -c "from function import handler; print(handler({'action': 'migrate'}, None))"
.venv/bin/python -c "from function import handler; print(handler({'action': 'seed_admin', 'email': 'admin@acme.inc', 'full_name': 'Facility Admin'}, None))"
```

`migrate` upgrades the schema and seeds the categories; both halves are idempotent.
`seed_admin` prints a temporary password **once** — the account is flagged
`must_change_password`, so every endpoint outside `/auth` returns 403 with
`PASSWORD_CHANGE_REQUIRED` until it is changed. Self-registration only ever produces
an EMPLOYEE, so this is the only way to get an admin.

The test suite uses a *different* database (`acme_incidents_test`, from
`POSTGRES_TEST_NAME`) and drops and recreates it on every run. Never point that at
`acme_incidents_dev`.

**Add a field to a facility, category or engineer.** Five files, in this order:
1. `app/models/<thing>.py` — the column.
2. `alembic/` — a migration (see the M2 recipe; read what autogenerate produces).
3. `app/schemas/<domain>.py` — add it to the `*Create`, `*Update` and `*Read` models.
   Leaving it out of `*Update` is how a field is made read-only after creation.
4. `app/services/<domain>.py` — only if it has a rule. `update_*` applies
   `model_dump(exclude_unset=True)` generically, so a plain field needs no code.
5. `tests/integration/test_<domain>.py` — one test that it round-trips, one that a
   PATCH without it leaves it alone.

**Add an endpoint to an existing resource.**
```python
@router.post("/things/{thing_id}/action", response_model=ThingRead, dependencies=[ADMIN_ONLY])
def do_the_thing(thing_id: uuid.UUID, payload: ThingAction, session: DbSession) -> ThingRead:
    thing = service.do_the_thing(session, thing_id, payload)
    session.commit()
    return ThingRead.model_validate(thing)
```
The router validates shapes, names the permission and commits. It decides nothing:
every refusal comes from the service as an `ApiError` subclass.
`session.commit()` belongs in the router because one request is one transaction —
services `flush()` so their writes are visible to later queries in the same request,
but only the router ends it.

**Add a list endpoint with paging.** Take `paging: Paging`, pass
`limit=paging.page_size, offset=paging.offset` to the repository, count with the same
filtered statement (`_count` wraps it as a subquery so the filters cannot drift), and
return `build_page(items, total=total, params=paging)`.

**Make a resource admin-only.** `dependencies=[ADMIN_ONLY]` on the decorator. If the
service needs to know *which* admin, take `admin: AdminUser` as a parameter instead.
Never use `get_authenticated_user` outside `/auth` — it skips the password-change gate.

**Add a category group.** `POST /api/v1/categories` with `name`, `hint`, `icon` (a
Material UI icon name) and `location_detail`, then post its subcategories with
`parent_id`. Editing `CATEGORY_GROUPS` in `app/seed/categories.py` also works and is
what the seed replays, but a rename there creates a *new* row rather than renaming the
old one — the seed matches on `(parent_id, name)`.

**Change what counts as an engineer's workload.** Edit `ACTIVE_INCIDENT_STATUSES` in
`app/models/enums.py`. Both `active_ticket_count` and M4's capacity warnings read it.

### 6. Gotchas

**Route order decides what `/engineers/me` means.** FastAPI matches in declaration
order, so `PATCH /engineers/me` is declared *before* `PATCH /engineers/{user_id}`. The
other way round, `me` is parsed as a UUID and the request fails with a validation error
that says nothing about routing. The same trap waits for any future literal path
segment under a parameterised one.

**`PATCH` semantics come from `exclude_unset=True`, not from `None`.** Every update
service does `payload.model_dump(exclude_unset=True)`, so a field that was *absent* is
untouched and a field explicitly sent as `null` is applied. `{"address": null}` clears
an address; `{}` changes nothing. Any new update path must use the same call, or
"leave it alone" and "set it to null" collapse into each other.

**The uniqueness pre-check has a race.** `_require_free_building_code` does a `SELECT`,
then the `INSERT` happens. Two admins submitting the same code in the same instant get
one 409 and one `IntegrityError` rendered as a 500. The data stays correct — the unique
constraint is the real guarantee — and for admin reference data the window is
theoretical. Closing it would mean catching `IntegrityError` and mapping unique
violations back to fields, which is worth doing if these ever become high-traffic
endpoints.

**Deleting a building deletes its floors and seats.** The foreign keys cascade. This is
only reachable when *no* incident references anything in the subtree, which the 409
check proves first, but a single DELETE can still remove hundreds of rows. The UI should
confirm.

**A demoted engineer keeps an `engineer_profiles` row.** It is deliberate (see §2) and
invisible: `/engineers` filters on `role = ENGINEER`. If you query
`engineer_profiles` directly, join `users` and filter by role or you will count people
who are not engineers any more.

**`count_by_role` is gone.** M2 wrote it and nothing ever called it; the paged user
search counts with the same filters as the page. Mentioned only because it may appear
in an older reading of `repositories/users.py`.

**A blocked incident needs a blocked reason, even in tests.** `incidents` carries
`CHECK (status <> 'BLOCKED' OR blocked_reason_type IS NOT NULL)`. `make_incident` fills
one in automatically for `BLOCKED`; hand-written inserts must too.

**`sslmode` is not the only cloud difference in `Settings`.** `is_local` now also drives
the JWT secret check. A test that constructs `Settings(is_local=False, ...)` must pass a
real-looking `jwt_secret` or it will fail to build — `tests/unit/test_config.py` defines
`STRONG_JWT_SECRET` for exactly that.

### 7. Glossary

**Correlated subquery** — a subquery that refers to a column of the outer query, so the
database evaluates it once per outer row. `active_ticket_count` is one: it counts
incidents where `assignee_id` equals *this* row's user id.

**N+1 query** — fetching a list (1 query) and then issuing one more query per row (N).
Twenty engineers would mean twenty-one round trips. `selectinload` and correlated
subqueries are the two ways this phase avoids it.

**`selectinload`** — SQLAlchemy's eager-loading strategy that fetches a relationship for
a whole batch of parents in one extra `SELECT ... WHERE parent_id IN (...)`, rather than
one query per parent (`lazy`) or a row-multiplying `JOIN` (`joinedload`).

**`relationship.and_()`** — an extra condition attached to an eager load, so the filter
runs in SQL. `selectinload(Building.floors.and_(Floor.is_active))` loads only the active
floors instead of loading all of them and discarding some in Python.

**`ILIKE`** — PostgreSQL's case-insensitive `LIKE`. `%` matches any run of characters and
`_` matches exactly one, which is why user input has to be escaped before it is pasted
into a pattern.

**Soft delete / deactivation** — keeping a row and marking it inactive instead of
removing it, so the things that point at it still make sense. Used here for facilities,
categories and engineer accounts.

**Cascade delete** — `ON DELETE CASCADE` on a foreign key: removing the parent removes
the children automatically, inside the database rather than in application code.

**`ON DELETE SET NULL`** — the gentler variant: removing the parent nulls the reference.
`users.last_building_id` uses it, which is why deleting a building is not blocked by
someone's remembered location.

**Pagination envelope** — the `{items, total, page, page_size}` shape every list returns.
`total` counts every matching row, not the rows on this page, so a UI can render
"showing 25 of 312" without a second request.

**Pydantic `model_validator(mode="after")`** — a check that runs once the model's fields
are parsed, so it can compare them with each other. Raising inside it turns the
construction itself into an error, which is how the JWT secret check stops startup.

**`exclude_unset`** — a Pydantic dump option that omits fields the caller never sent,
which is what distinguishes "leave this alone" from "set this to null" in a PATCH.

**Temporary password** — a generated credential handed over once, paired with
`must_change_password` so it cannot outlive the first sign-in.

**RFC 7518 §3.2** — the JWT specification's rule that an HMAC key must be at least as
long as the hash output: 32 bytes for HS256.

---

## Phase M4 — Incidents and workflow

M3 filled in everything an incident needs before it can exist: somewhere it happened,
what kind of problem it is, and who can be given it. M4 builds the incident itself —
reporting one, finding it again, moving it through its lifecycle, assigning it,
escalating it, and talking about it.

Fifteen endpoints, and one file that matters more than the other twenty:
[app/workflow.py](../backend/v1/app/workflow.py). The workflow is written as **data**, and
three things read that data instead of restating it — the transitions endpoint, the
allowed-transitions endpoint the frontend will draw its buttons from, and the tests.

Still no frontend; the React shell arrives in M5. **Everything here was verified against
local PostgreSQL only** — through the 605-test suite, and once end to end over HTTP
against the real development database, walking one ticket from report through pick-up,
block, escalate, clear, resolve, confirm and reopen with three accounts. What remains
unproven in the cloud is in [docs/DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md).

This section starts with a carry-over from M2 that had to be fixed before any of it
would work.

### 0. The carry-over: seven naive timestamps

Revision 0001 declared the lifecycle timestamps as bare `Mapped[datetime]`:

```python
assigned_at: Mapped[datetime | None] = mapped_column(nullable=True)
```

SQLAlchemy renders that as `TIMESTAMP WITHOUT TIME ZONE`. Every *other* timestamp in the
schema carries an explicit `DateTime(timezone=True)`, because `TimestampMixin` says so —
so `incidents.created_at` was `timestamptz` and `incidents.closed_at`, two columns below
it, was not. Seven columns ended up naive:

```
incidents.assigned_at  acknowledged_at  resolved_at  closed_at  escalated_at
incident_notes.edited_at  deleted_at
```

Those are exactly M4's working set, and all three ways the mismatch goes wrong are
load-bearing here:

1. **Python raises.** The seven-day reopen window computes `now - incident.closed_at`.
   An aware `now` minus a naive `closed_at` is a `TypeError`, not a wrong answer — the
   endpoint would 500.
2. **Clients silently mis-render.** A naive value serialises without a `Z`, so a browser
   reads `14:03` as local time. A ticket resolved an hour ago displays as resolved eight
   hours from now.
3. **SQL silently skews.** M7's timing metrics subtract these columns from `created_at`.
   PostgreSQL casts the naive side using the session's `TimeZone`, so the same report
   returns different numbers depending on who runs it.

[Revision 0002](../backend/v1/alembic/versions/0002_timestamptz_lifecycle_columns.py)
converts all seven with `USING <column> AT TIME ZONE 'UTC'`, which *reinterprets* the
stored wall time as UTC rather than shifting it — correct because every value written so
far came from a UTC clock.

The test that guards it asserts the property rather than the seven names, so a future
`Mapped[datetime]` written without `DateTime(timezone=True)` fails immediately:

```python
# tests/integration/test_migration.py
naive = connection.execute(text(
    "SELECT table_name, column_name FROM information_schema.columns "
    "WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'"
)).all()
assert naive == [], f"naive timestamp columns: {naive}"
```

Worth noting why M2's existing drift test did not catch this. `test_models_and_migration_do_not_drift`
runs Alembic's `compare_metadata` with `compare_type: True` — but the models and the
migration *agreed*. Both were naive. A drift test proves the schema matches the code; it
cannot tell you the code is wrong.

### 1. What was built

#### The workflow — `app/workflow.py`

The state machine, as eleven `Transition` rows plus four functions that read them.
Nothing else in the application contains a status comparison chain.

| Name | What it is |
| --- | --- |
| `Actor` | REPORTER, ASSIGNEE, FACILITY_ADMIN — the capacity someone acts in on *one* ticket, not a role. |
| `Transition` | Frozen dataclass: from, to, allowed actors, required fields, button label, optional guard, the close reasons it may record, and whether it is a reopen. |
| `TRANSITIONS` | The eleven rows. The build plan's §6 table and this tuple are the same thing, one in prose and one executable. |
| `ACTOR_PRECEDENCE` | Which row wins when a caller matches several. |
| `REOPEN_WINDOW` | `timedelta(days=7)`. |
| `resolve_actors` | Incident + user → the set of capacities they hold on it. |
| `select_transition` | (from, to, actors) → the row they would use, or None. |
| `check_guard` | Whether a row's precondition holds right now. |
| `available_transitions` | Everything a caller can do to a ticket at this moment, one entry per reachable status. |

#### Schemas — `app/schemas/`

| File | Responsibility |
| --- | --- |
| [incident.py](../backend/v1/app/schemas/incident.py) | Create, update and read models; `TransitionRequest`; `AllowedTransitionRead`; `AssignRequest`/`AssignResult`; the escalation bodies; the nested `UserSummary` / `CategorySummary` / `LocationSummary`; and the two query models below. |
| [note.py](../backend/v1/app/schemas/note.py) | `NoteCreate`, `NoteUpdate`, `NoteRead` (with `can_edit`). |
| [event.py](../backend/v1/app/schemas/event.py) | `IncidentEventRead` and `ActivityEntry`, the merged timeline entry discriminated by `kind`. |

`IncidentQuery` and `IncidentFilters` are deliberately two models. The first is the query
string exactly as it arrives, including the two shortcuts whose meaning depends on who is
asking — `mine=reported|assigned` and `specialty=true`. The second is what the repository
applies, with every value already concrete.
`incident_service.resolve_filters` is the one function that turns one into the other, so
the repository never needs to know who is calling it.

#### Repository — `app/repositories/incidents.py`

Every statement the incident endpoints run: the filtered, sorted, eager-loaded list
query; the two search modes; the detail read; the audit-log append and read; and the note
queries. Two functions hand out a *base* statement rather than a result —
`notes_query()` and `list_incidents(visible=...)` — so that the visibility filter cannot
be skipped by a caller who writes their own `select(Incident)`.

#### Services — `app/services/`

| File | The rules it owns |
| --- | --- |
| [visibility.py](../backend/v1/app/services/visibility.py) | Who may see which rows. Two functions, both narrowing a `Select`. |
| [incident_service.py](../backend/v1/app/services/incident_service.py) | The questionnaire rules, per-field edit permissions, transition execution and side effects, escalation, and the activity feed. |
| [assignment.py](../backend/v1/app/services/assignment.py) | Who may give a ticket to whom, and the capacity warnings that do not refuse. |
| [notes.py](../backend/v1/app/services/notes.py) | Who may write, who may write INTERNAL, and the fifteen-minute edit window. |

#### Routers — `app/routers/`

[incidents.py](../backend/v1/app/routers/incidents.py) — eleven routes, plus the
response mappers that resolve an incident's four foreign keys into names and a rendered
path. [notes.py](../backend/v1/app/routers/notes.py) — four, under two path shapes:
`/incidents/{id}/notes` for creating and listing, `/notes/{id}` for editing and deleting.

```
GET    /api/v1/incidents                         list, search and filter
POST   /api/v1/incidents                         report
GET    /api/v1/incidents/{id}                    detail, with can_* flags
PATCH  /api/v1/incidents/{id}                    edit, permissioned per field group
GET    /api/v1/incidents/{id}/allowed-transitions  what you may do now
POST   /api/v1/incidents/{id}/transitions        do it
POST   /api/v1/incidents/{id}/assign             assign, or unassign with null
POST   /api/v1/incidents/{id}/pick-up            self-assign
POST   /api/v1/incidents/{id}/escalate           flag, with a reason
POST   /api/v1/incidents/{id}/clear-escalation   answer it, optionally re-prioritising
GET    /api/v1/incidents/{id}/activity           events + readable notes, merged
GET    /api/v1/incidents/{id}/notes              list
POST   /api/v1/incidents/{id}/notes              add
PATCH  /api/v1/notes/{id}                        edit, within the window
DELETE /api/v1/notes/{id}                        soft-delete
```

#### Shared plumbing

- [app/clock.py](../backend/v1/app/clock.py) — `utc_now()`. The one place the application
  asks what time it is, so every time-sensitive rule can take `now` as a parameter.
- [app/errors.py](../backend/v1/app/errors.py) — `ConflictError` gained `extra`, which is
  how a refused transition returns `allowed_transitions` in the same response.
- [app/models/incident.py](../backend/v1/app/models/incident.py) — an `escalator`
  relationship for `escalated_by` (no column change; three relationships now point at
  `users` from this table, so each names its foreign key explicitly).
- [app/db.py](../backend/v1/app/db.py) — `build_connect_args()`, which pins the session
  time zone to UTC. See §2.
- Migrations [0002](../backend/v1/alembic/versions/0002_timestamptz_lifecycle_columns.py)
  and [0003](../backend/v1/alembic/versions/0003_event_clock_timestamp.py). No new tables:
  M2 created `incidents`, `incident_notes` and `incident_events` up front.

#### Tests

| File | Covers |
| --- | --- |
| [tests/unit/test_workflow.py](../backend/v1/tests/unit/test_workflow.py) | 121 tests, almost all parametrised over `TRANSITIONS` itself. Table consistency, actor admission and refusal, guards, the reopen boundary, actor resolution, precedence. No database. |
| [tests/integration/test_incidents.py](../backend/v1/tests/integration/test_incidents.py) | 48. Reporting, the questionnaire's 422s, per-field edit permissions, both search modes, every filter, sorting, paging. |
| [tests/integration/test_transitions.py](../backend/v1/tests/integration/test_transitions.py) | 89. The full matrix, every timestamp side effect, the reopen window at its boundary, duplicates, and the endpoints. |
| [tests/integration/test_assignment.py](../backend/v1/tests/integration/test_assignment.py) | 28. The level matrix, who may receive work, warnings-not-refusals, `assigned_at`, pick-up, and escalation. |
| [tests/integration/test_notes.py](../backend/v1/tests/integration/test_notes.py) | 24. Who may write, INTERNAL notes from both reading paths, the edit window, soft deletion, the merged timeline. |

### 2. Why it is shaped this way

#### The workflow is data, and only data

The obvious way to write a state machine is a function with branches:

```python
# What app/workflow.py exists to avoid
def transition(incident, user, to_status):
    if incident.status == OPEN and to_status == IN_PROGRESS:
        if user.role != FACILITY_ADMIN and incident.assignee_id != user.id:
            raise AuthorizationError(...)
        ...
```

Three things go wrong with that, and all three are visible in the brief.

**The frontend has to know the same rules.** The incident detail page draws a button per
available action and a dialog with exactly the right fields. If the rules live in
branches, the React code grows a second copy of them and the two drift. With a table,
`GET /incidents/{id}/allowed-transitions` can *return* the rules, and the UI renders from
the response. That is why `Transition` carries `action_label` (the button text) and
`required_fields` (the dialog's inputs) rather than only the mechanics.

**The tests have to restate them.** `tests/unit/test_workflow.py` and
`tests/integration/test_transitions.py` parametrise over `TRANSITIONS` and ask the table
what should happen:

```python
expected = workflow.select_transition(transition.from_status, transition.to_status, actors)

if expected is None:
    with pytest.raises(ApiError) as refused:
        incident_service.perform_transition(...)
    assert refused.value.status_code == 409
    return

updated = incident_service.perform_transition(..., payload=payload_for(expected))
assert updated.status == transition.to_status
```

The allowed and denied halves of the matrix come from the same source the application
uses, so they cannot fall out of step, and a row added without a rule change fails on the
next run.

**Adding a transition stays small.** As branches, a new move means editing a function
that several other moves also run through, and re-reading all of them to be sure nothing
shifted. As a row, it is a row — plus one test for whatever is specific to it. §5 has the
recipe.

#### Several rows can share a move, separated by actor

`OPEN → CLOSED` means two different things. To the person who reported the ticket it is
"cancel my ticket", with no input and `CANCELLED_BY_REPORTER` recorded. To an admin it is
"close this", with a required `close_reason` chosen from `{DUPLICATE, INVALID,
ADMIN_CLOSED}` and a duplicate target when they pick the first. Same pair of statuses,
different label, different input, different record.

So a (from, to) pair can have several rows, separated by `allowed_actors`. That creates
one question the build plan does not answer: **a single person can be more than one
actor.** An admin who reported their own ticket is both REPORTER and FACILITY_ADMIN.

`ACTOR_PRECEDENCE` settles it, ordered widest-powers-first:

```python
ACTOR_PRECEDENCE: tuple[Actor, ...] = (Actor.FACILITY_ADMIN, Actor.ASSIGNEE, Actor.REPORTER)
```

The principle is that *being the reporter must never cost an admin an option*. The
alternative ordering — reporter first, on the grounds that it records the truer reason —
would mean an admin who happened to report a ticket could no longer close it as a
duplicate, because the reporter's row has no `close_reason` field at all. Losing a
capability is worse than recording `ADMIN_CLOSED` where `CONFIRMED_FIXED` would have been
slightly more precise.

The same decision let the build plan's one ambiguous row be split. §6 says
`RESOLVED → CLOSED` records "`CLOSED_BY_ENGINEER` **or** `ADMIN_CLOSED`" — depending on
who acted, with no caller input to disambiguate. Rather than a conditional in the service,
that is three rows here, one per actor:

| Actor | Label | Records |
| --- | --- | --- |
| REPORTER | Confirm fixed | `CONFIRMED_FIXED` |
| ASSIGNEE | Close ticket | `CLOSED_BY_ENGINEER` |
| FACILITY_ADMIN | Close ticket | `ADMIN_CLOSED` |

That keeps the recorded reason a property of the table rather than of a branch, and it
reduces the whole thing to one rule the service can apply without knowing which move it
is handling: one member in `close_reasons` means the service writes it; more than one
means the caller picks, and `close_reason` is then in `required_fields`. That invariant
is itself a test, parametrised over every row.

#### Guards take `now` instead of reading the clock

Two rules are conditions on the *incident* rather than on caller input: a ticket needs an
assignee before work can start, and a closed ticket can be reopened for seven days. Both
are `guard` functions on the row, with the signature
`(incident, now) -> str | None` — None when the move is allowed, the message to show when
it is not.

Taking `now` as an argument rather than calling `datetime.now()` inside is what makes the
window testable. [app/clock.py](../backend/v1/app/clock.py) holds the one real clock, and
every service that needs it follows the same shape:

```python
def perform_transition(..., *, now: datetime | None = None) -> Incident:
    moment = now or utc_now()
```

So the boundary is asserted rather than approximated — at exactly seven days, a second
past, and a month later — without sleeping, freezing a global clock, or monkeypatching a
module the test does not own. The 15-minute note edit window works the same way.

`utc_now()` rather than `datetime.utcnow()`: the latter returns a *naive* datetime whose
value happens to be UTC, which compares wrongly against every aware value in the schema.
It is deprecated in Python 3.12+ for exactly that reason, and §0 is what happens when
naive and aware meet.

#### Side effects are keyed on the status being entered

`_apply_transition_effects` is written as "what it means to *be* in this status", not as
one branch per transition:

```python
if transition.to_status == IncidentStatus.IN_PROGRESS:
    incident.acknowledged_at = incident.acknowledged_at or now
    incident.resolved_at = None
    incident.closed_at = None
    incident.close_reason = None
    incident.duplicate_of_id = None
```

Three different rows lead to IN_PROGRESS — starting work, resuming after a block, and
both reopens — and they all need the same thing to be true afterwards. Written per
transition, "reopening clears `closed_at`" is a rule that has to be remembered twice and
will eventually be remembered once. Written per status, a reopened ticket cannot keep a
`closed_at` that the reports would then count as a closure.

`acknowledged_at` is set with `or`, never overwritten: it answers "how long until someone
looked at this?", which resuming from a block does not change.

#### Visibility is a query filter, and it is the seam even where it does nothing

[services/visibility.py](../backend/v1/app/services/visibility.py) has two functions, both
taking a `Select` and returning a narrower one. `apply_note_visibility` is the one that
does work today: employees see PUBLIC only, and soft-deleted notes are excluded for
everyone in the same call, so no query can remember one exclusion and forget the other.

`apply_incident_visibility` returns the statement unchanged. That is deliberate and
documented in the function: the brief asks employees to be able to check whether a
problem is already reported, which only works if "All Tickets" really is all of them.
What an employee cannot do is *act* on someone else's ticket, and that is a permission
question answered by the `can_*` flags, not a visibility one.

It exists anyway, and every incident query goes through it, because the day that stops
being true — per-building admin scoping is already a listed known limitation — it is a
change to one function rather than an audit of every query in the application. The
repository reinforces it by having no `select(Incident)` to start from:

```python
def list_incidents(session, *, visible: Select[Any], filters, limit, offset):
```

The caller must hand in a statement, and the only thing that builds one is the service,
which builds it through the filter.

Filtering in a *serializer* is the specific bug this shape prevents. The row would still
travel out of the database, `total` would count it, paging would skip over it, and one
forgotten call site would leak it.

#### Two clocks, and a timeline that was in the wrong order

The activity feed merges `incident_events` and `incident_notes` into one stream ordered
by `created_at`. Both defaulted to `now()` — and PostgreSQL's `now()` is the **transaction**
start time, identical for every row one transaction writes. That produced two wrong
orderings:

1. Two events from one request — `ESCALATION_CLEARED` plus `PRIORITY_CHANGED` from a
   single clear-escalation call, `STATUS_CHANGED` plus `MARKED_DUPLICATE` from closing as
   a duplicate — carried the same timestamp, and the `(created_at, id)` tiebreak fell back
   to comparing random UUIDs.
2. Anything writing a note and an event under one transaction interleaved them by
   transaction start rather than by when each happened.

[Revision 0003](../backend/v1/alembic/versions/0003_event_clock_timestamp.py) switches
both columns to `clock_timestamp()`, which is read per row at insert time. Everything
else keeps `now()`, where a per-transaction timestamp is the more useful of the two.

The second ordering also explains why the *test suite* found this. Every request in the
suite runs inside one outer transaction that is rolled back afterwards, so under `now()`
the whole test shared a single timestamp — which is not how production behaves, and is
exactly the kind of difference that makes a passing suite mean less than it looks.

#### A stale relationship the test harness was hiding

`assignment.assign()` sets `incident.assignee_id`. It does not set `incident.assignee`,
which is a relationship that was loaded — as `None` — when the route read the incident.
`repositories/incidents.reload()` re-queries, but SQLAlchemy finds the object already in
the session's identity map and hands it back untouched, relationships included. The
response said `"assignee": null` immediately after a successful assignment.

The suite did not catch it, because `tests/conftest.py` built its session with the default
`expire_on_commit=True` while [app/db.py](../backend/v1/app/db.py) uses `False`. Committing
in the test expired every attribute, so the response was rebuilt from a fresh read and
looked right. The bug only appeared when the API was driven over HTTP against the
development database.

Both halves are fixed. The fixture now matches the application:

```python
session = Session(
    bind=connection,
    join_transaction_mode="create_savepoint",
    expire_on_commit=False,
)
```

which made three tests fail — assignee twice, `escalated_by` once — and `reload()` forces
a real refresh:

```python
statement = (
    select(Incident)
    .where(Incident.id == incident.id)
    .options(*_detail_loaders())
    .execution_options(populate_existing=True)
)
```

The general lesson is worth keeping: **a fixture that differs from production in a
behavioural setting will hide the class of bug that setting governs.** `expire_on_commit`
is one of those settings.

#### The database session is pinned to UTC

A `timestamptz` is rendered in the session's time zone, which defaults to the server's:
UTC on the Lambda, and whatever the VDI is set to locally. The same `resolved_at` came
back as `...-04:00` in development and would come back as `...+00:00` deployed — the same
instant, but a difference that only shows up after a deploy.
`build_connect_args()` sets `-c timezone=UTC`, and the test fixtures call the same
function so the suite sees what the application sees.

#### Two search modes behind one box

Users type both "INC-000482" and "flickering light" into the same field, so
`GET /incidents?q=` decides which they meant. `TICKET_NUMBER_PATTERN` matches `482`,
`INC482` and `inc-000482`; anything else is full-text.

`websearch_to_tsquery` rather than `to_tsquery`. It accepts what people actually type —
quoted phrases, `or`, a leading `-` to exclude — and, importantly, never raises a syntax
error on stray punctuation. `to_tsquery('english', '&&!')` raises, which would turn a typo
into a 500.

Ordering: a text search with no explicit `sort` is ranked by `ts_rank`, then newest first.
An explicit `sort` always wins, because a caller who asked for "most urgent first" meant
it whether or not they were also searching.

Priority sorting needs no `CASE` expression. The PostgreSQL enum's declared order is
`LOW < MEDIUM < HIGH < CRITICAL`, so `ORDER BY priority DESC` really is "most urgent
first". That is a property of `ENUM_TYPES` in `app/models/enums.py` being written in
ascending order — worth knowing before anyone reorders it.

#### Filters do not join to `categories`

Filtering by group, or by an engineer's specialties, is expressed as a subquery:

```python
statement.where(Incident.category_id.in_(select(Category.id).where(Category.parent_id == group_id)))
```

rather than a join. It keeps `ix_incidents_category_id` usable and keeps the eager-loading
options independent of which filters happen to be applied — a join added for a filter can
change how `selectinload` batches.

#### Capacity warns, it does not refuse

Assigning to someone who is at their `max_active_tickets` or marked OFF_DUTY succeeds and
returns `warnings` for the UI to show. A lead looking at their team knows things the
system does not, and a hard limit would simply be worked around by raising
`max_active_tickets` — which would then be wrong permanently instead of noisy once.

#### No `NOTE_ADDED` event

`EventType.NOTE_ADDED` exists in the enum (M2 created the database type) and nothing
writes it. The activity feed merges events *and notes*, so the note row already is the
timeline entry; emitting an event beside it would show every comment twice. M7's
communication report — "% of resolved tickets with a public staff note before resolution"
— reads `incident_notes` directly and does not need it either.

Removing the enum value would mean a migration for no benefit, so it stays, unused and
documented.

#### 404 for a note, 403 for an incident

An incident the caller may not act on returns 403: this API does not hide that tickets
exist, and M3 set the precedent that a role failure is never disguised as a missing row.

An INTERNAL note addressed directly returns **404**. The difference is that the existence
of an internal note is itself staff-only information, and a 403 would confirm it.

### 3. How the pieces connect

**An engineer resolving a ticket**, hop by hop. This is the request the whole phase is
built around:

```
POST /api/v1/incidents/{id}/transitions
     {"to_status": "RESOLVED", "resolution_summary": "Replaced the ballast and both tubes."}
  │
  ├─ main.py                       router mounted at /api/v1; CloudFront forwards the
  │                                full path, so it matches as written
  ├─ routers/incidents.py          create_transition
  │      user: CurrentUser  →  security/dependencies.py
  │        get_current_user          → password-change gate
  │          get_authenticated_user   → bearer token → decode_access_token
  │            repositories/users.py get_by_id   (role read from the DB, not the token)
  ├─ schemas/incident.py           TransitionRequest — shapes and lengths only; which
  │                                fields are *required* is the workflow's business
  ├─ services/incident_service.py  get_incident → 404 if unknown
  └─ services/incident_service.py  perform_transition(now=utc_now())
         │
         ├─ workflow.resolve_actors(incident, user)
         │      assignee_id == user.id            → {ASSIGNEE}
         │      (a LEAD would get ASSIGNEE on any ticket)
         │
         ├─ workflow.select_transition(IN_PROGRESS, RESOLVED, {ASSIGNEE})
         │      one matching row → Transition(required_fields=("resolution_summary",),
         │                                    action_label="Resolve")
         │      no match → 409 TRANSITION_NOT_ALLOWED, carrying available_transitions()
         │
         ├─ workflow.check_guard(...)        → None; this row has no guard
         ├─ _require_transition_fields(...)  → resolution_summary present, else 422 + field
         ├─ _resolve_close_reason(...)       → None; not a closing move
         ├─ _apply_transition_effects(...)   → status = RESOLVED
         │                                     resolved_at = now
         │                                     resolution_summary = payload's
         │                                     blocked_* cleared (not entering BLOCKED)
         ├─ repositories/incidents.add_event(STATUS_CHANGED, IN_PROGRESS → RESOLVED)
         │      created_at from clock_timestamp(), so it sorts after everything before it
         └─ repositories/incidents.reload(session, incident)
                re-reads with the detail loaders and populate_existing, so the
                relationships are refreshed rather than served from the identity map
  │
  ├─ routers/incidents.py          session.commit()
  └─ _to_read(incident, user)      IncidentRead + the can_* flags for *this* caller
         can_edit            → incident_service.can_edit_content
         can_assign          → assignment.can_assign
         can_add_note        → notes.can_add_note
```

The shape to notice: the router decides nothing, the schema checks shapes, the *table*
decides legality, and the service does the work the table implies. The 409 path is worth
following too — `ConflictError` carries `extra={"allowed_transitions": [...]}`, so a
client that asked for an impossible move is told what *is* possible in the same response
instead of making a second request to find out.

**The reverse direction** — the page that draws the buttons:

```
GET /api/v1/incidents/{id}/allowed-transitions
  → incident_service.allowed_transitions(incident, user, now=utc_now())
    → workflow.resolve_actors
    → workflow.available_transitions
        for each status reachable from incident.status (in table order):
          select_transition(...)            → resolves precedence, one row per status
          check_guard(...)                  → blocked moves are left out, not offered
  → routers/incidents.py _to_allowed_transition
      [{"to_status": "CLOSED", "action_label": "Close ticket",
        "required_fields": ["close_reason"],
        "close_reason_choices": ["ADMIN_CLOSED", "DUPLICATE", "INVALID"]}]
```

That response is everything the UI needs: the button text, which dialog fields to
collect, and what to put in the `close_reason` select. `available_transitions` returns one
entry per reachable status precisely so two rows for the same pair never become two
buttons that do different things, and it resolves precedence with the same
`select_transition` the POST will use — so the button drawn is the move that executes.

**A search**, which is where visibility and the repository meet:

```
GET /api/v1/incidents?q=flickering&status=OPEN&mine=reported&sort=-priority
  ├─ routers/incidents.py get_incident_query   sixteen query parameters → IncidentQuery
  │      _parse_assignee_filter   "unassigned" → the sentinel, else a UUID, else 422
  ├─ services/incident_service.py list_incidents
  │      resolve_filters(query, user)   mine=reported → reporter_id = user.id
  │                                     specialty=true → the caller's own groups
  │      apply_incident_visibility(select(Incident), user)   ← the seam
  └─ repositories/incidents.list_incidents(visible=..., filters=...)
         _apply_filters    status IN (...), reporter_id = ...
         _apply_search     "flickering" is not a ticket number →
                           search_vector @@ websearch_to_tsquery('english', ...)
         count             SELECT count(*) FROM (the same filtered statement)
         _order_by         explicit sort wins over ts_rank → priority DESC, ticket_number DESC
         _list_loaders     selectinload category→parent, building, floor, seat,
                           reporter, assignee
  → routers/incidents.py _to_list_item per row
         _location_summary   "SFO-1 > Level 3 > 3-A-01", from already-loaded relationships
```

**Nine statements for a page of any size**, measured rather than estimated: one count,
one for the page itself, and seven `selectin` follow-ups — building, category, seat,
floor, reporter, assignee, and the category's parent group, which is a second hop off the
first. Lazily loaded, a page of 25 would cost 1 + 25 x 7 = 176.

### 4. Where the rules live

| Rule | File | Detail |
| --- | --- | --- |
| Which status changes exist at all | [workflow.py](../backend/v1/app/workflow.py) | `TRANSITIONS` |
| Who may make each one | [workflow.py](../backend/v1/app/workflow.py) | `Transition.allowed_actors` |
| What a dialog must collect | [workflow.py](../backend/v1/app/workflow.py) | `Transition.required_fields` |
| What a button says | [workflow.py](../backend/v1/app/workflow.py) | `Transition.action_label` |
| Which close reason is recorded | [workflow.py](../backend/v1/app/workflow.py) | `Transition.close_reasons` |
| Who counts as REPORTER / ASSIGNEE / admin | [workflow.py](../backend/v1/app/workflow.py) | `resolve_actors` (a LEAD is ASSIGNEE anywhere) |
| Which row wins for a caller with two roles | [workflow.py](../backend/v1/app/workflow.py) | `ACTOR_PRECEDENCE` |
| A ticket needs an assignee before work starts | [workflow.py](../backend/v1/app/workflow.py) | `_requires_an_assignee` |
| Seven days to reopen | [workflow.py](../backend/v1/app/workflow.py) | `REOPEN_WINDOW`, `_within_the_reopen_window` |
| Timestamps and fields a transition writes | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `_apply_transition_effects` |
| A duplicate needs a real, other ticket | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `_resolve_duplicate_target` |
| Incidents are filed against subcategories | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `_require_reportable_subcategory` |
| How precise a location must be | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `REQUIRED_LOCATION_FIELDS`, `_require_location_precision` |
| Floor in building, seat on floor | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `_require_floor_in_building`, `_require_seat_on_floor` |
| Who may edit content | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `can_edit_content`, `CONTENT_FIELDS` |
| When the questionnaire rules are re-checked | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `CLASSIFICATION_FIELDS` |
| Who may change priority | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `can_change_priority` |
| Who may escalate, and when | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `may_escalate`, `ESCALATABLE_STATUSES` |
| Who may clear an escalation | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `can_clear_escalation` |
| What `mine` and `specialty` mean | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `resolve_filters`, `_resolve_specialties` |
| Where the next report form is pre-filled from | [services/incident_service.py](../backend/v1/app/services/incident_service.py) | `_remember_location` |
| Who may assign, by level | [services/assignment.py](../backend/v1/app/services/assignment.py) | `_require_permission`, `_require_self_pick_up` |
| Who may receive work | [services/assignment.py](../backend/v1/app/services/assignment.py) | `_require_assignable_engineer` |
| Capacity and availability warnings | [services/assignment.py](../backend/v1/app/services/assignment.py) | `_capacity_warnings`, `UNAVAILABLE_STATES` |
| `assigned_at` is set once | [services/assignment.py](../backend/v1/app/services/assignment.py) | `assign` |
| Who may write a note | [services/notes.py](../backend/v1/app/services/notes.py) | `can_add_note` |
| Who may write an INTERNAL note | [services/notes.py](../backend/v1/app/services/notes.py) | `can_add_internal_note` |
| The fifteen-minute edit window | [services/notes.py](../backend/v1/app/services/notes.py) | `EDIT_WINDOW`, `_require_modify_permission` |
| Who sees INTERNAL notes | [services/visibility.py](../backend/v1/app/services/visibility.py) | `apply_note_visibility` |
| Who sees which incidents | [services/visibility.py](../backend/v1/app/services/visibility.py) | `apply_incident_visibility` |
| What a ticket-number search looks like | [repositories/incidents.py](../backend/v1/app/repositories/incidents.py) | `TICKET_NUMBER_PATTERN` |
| Search language and parser | [repositories/incidents.py](../backend/v1/app/repositories/incidents.py) | `SEARCH_CONFIG`, `_tsquery` |
| Sort orders and the relevance default | [repositories/incidents.py](../backend/v1/app/repositories/incidents.py) | `_SORT_TERMS`, `_order_by` |
| What `?assignee_id=unassigned` means | [schemas/incident.py](../backend/v1/app/schemas/incident.py) | `UNASSIGNED`, `AssigneeFilter` |
| Title and description limits | [schemas/incident.py](../backend/v1/app/schemas/incident.py) | `IncidentTitle`, `IncidentDescription` |
| What time it is | [clock.py](../backend/v1/app/clock.py) | `utc_now` |
| The session time zone | [db.py](../backend/v1/app/db.py) | `SESSION_TIME_ZONE`, `build_connect_args` |

### 5. How to change it

**Add a workflow transition.** One row and one test.

```python
# app/workflow.py — inside TRANSITIONS
Transition(
    from_status=IncidentStatus.BLOCKED,
    to_status=IncidentStatus.CLOSED,
    allowed_actors=frozenset({Actor.FACILITY_ADMIN}),
    required_fields=("close_reason",),
    action_label="Abandon ticket",
    close_reasons=frozenset({CloseReason.INVALID, CloseReason.ADMIN_CLOSED}),
),
```

Then nothing else. The transitions endpoint will execute it, allowed-transitions will
offer it, and `_apply_transition_effects` already knows what entering CLOSED means.

Both test files pick it up on the next run without being edited — `test_workflow.py` and
the matrix in `test_transitions.py` parametrise over `TRANSITIONS`, so the new row is
immediately checked for table consistency, actor admission and refusal, its audit event,
and that each of its required fields really is required. Add a test by hand only for
behaviour specific to the row, such as a side effect no other transition has.

Two things the table will enforce on you: a row reaching CLOSED must carry at least one
close reason, and more than one means `close_reason` has to be in `required_fields`. Both
are asserted per row.

If the new move needs a condition on the incident, write a guard beside
`_within_the_reopen_window` and reference it — do not put an `if` in the service.

**Add a field to an incident.** Five files, in this order:
1. `app/models/incident.py` — the column. If it is a timestamp, write
   `mapped_column(DateTime(timezone=True), ...)`; §0 is what happens otherwise.
2. `alembic/versions/` — a migration.
3. `app/schemas/incident.py` — add it to `IncidentCreate` / `IncidentUpdate` /
   `IncidentListItem` or `IncidentRead`. Leaving it out of `IncidentUpdate` is how a
   field is made write-once.
4. `app/routers/incidents.py` — `_to_list_item` or `_to_read` if it is not on the base
   model already.
5. `tests/integration/test_incidents.py` — that it round-trips, and that a PATCH without
   it leaves it alone.

If the field takes part in the questionnaire rules, it belongs in `CONTENT_FIELDS`, and
in `CLASSIFICATION_FIELDS` too if changing it should re-run `_require_valid_location`.

**Add a list filter.** Three edits: the parameter on `get_incident_query` in
`app/routers/incidents.py`, the field on both `IncidentQuery` and `IncidentFilters` in
`app/schemas/incident.py` (pass it through in `resolve_filters`), and a clause in
`_apply_filters`. A filter whose meaning depends on the caller is resolved in
`resolve_filters`, never in the repository — that is the line between the two models.

**Add an event type.** Add it to `EventType` in `app/models/enums.py`, write a migration
(`ALTER TYPE event_type ADD VALUE ...`), and call `repository.add_event` where it
happens. The activity feed will carry it without changes; the frontend picks the timeline
icon from `event_type`.

**Change the reopen window or the edit window.** `REOPEN_WINDOW` in `app/workflow.py`,
`EDIT_WINDOW` in `app/services/notes.py`. Both are `timedelta`s and both have boundary
tests that read the constant, so the tests follow the change rather than failing on it.

**Change who may assign.** `_require_permission` in `app/services/assignment.py`, plus
`can_assign` beside it, which drives whether the button appears at all. They are two
functions on purpose: `can_assign` is the broad "could this person touch the assignee
field", `_require_permission` is the specific "may they make *this* assignment".

**Let an engineer report a ticket on someone's behalf.** Add `reporter_id` to
`IncidentCreate`, gate it on `user.is_staff` in `create_incident`, and leave
`_remember_location` pointed at the *caller* rather than the reporter — the pre-fill is a
convenience for whoever fills in the form.

**Scope visibility to a building.** One function:

```python
def apply_incident_visibility(statement, user):
    if user.role == UserRole.FACILITY_ADMIN and user.building_scope_id:
        return statement.where(Incident.building_id == user.building_scope_id)
    return statement
```

Every incident list and detail read already goes through it.

**Run one ticket's whole life locally.** With uvicorn on :8000 and an admin account:
report → `pick-up` as a senior engineer → `transitions` to IN_PROGRESS → BLOCKED with a
reason → back to IN_PROGRESS → RESOLVED with a summary → `transitions` to CLOSED as the
reporter → `transitions` back to IN_PROGRESS with a reason. Check `allowed-transitions`
as each persona between steps; it is the fastest way to see the table working.

### 6. Gotchas

**An admin who reported a ticket is treated as an admin.** `ACTOR_PRECEDENCE` puts
FACILITY_ADMIN first, so closing a ticket you reported *and* administer records
`ADMIN_CLOSED`, not `CONFIRMED_FIXED`. That is the deliberate trade (see §2) and it
matters for M7's reports: "confirmed fixed by the reporter" will not count tickets an
admin reported themselves. In real use the personas are distinct; in demo data made by
one account they may not be.

**A LEAD engineer is ASSIGNEE on every ticket.** `resolve_actors` grants it whether or
not the ticket is theirs, so a lead can start, block, resolve and close anything. It is
in the build plan and it is what lets a team cover for someone on leave, but it means
"the assignee did this" in the audit log does not imply "the person the ticket was
assigned to".

**`available_transitions` hides blocked moves rather than greying them out.** A ticket
with no assignee simply does not offer "Start work", and a ticket closed eight days ago
offers nothing at all. The frontend gets an empty list, not a list with reasons. If the
UI ever needs to explain *why* an action is missing, the guard messages exist — they are
returned by the POST — but the GET does not carry them.

**A ticket closed more than seven days ago is finished.** `available_transitions` returns
`[]` for everyone, including admins. The only way forward is a new ticket. This is
intentional, and it is the single hardest thing to discover by clicking around, because
the page simply has no buttons.

**`incident_events.created_at` and `incident_notes.created_at` use `clock_timestamp()`,
not `now()`.** Anything else that ends up on the timeline must too, or it will sort by
transaction start and interleave wrongly. Everything else in the schema keeps `now()`.

**`expire_on_commit=False` in the test fixture is load-bearing.** It matches `app/db.py`.
Setting it back to the default would make three currently-passing tests pass for the
wrong reason and hide any future stale-relationship bug (§2).

**After writing to an incident, use `repositories.incidents.reload()`.** A plain re-query
returns the identity-mapped object with its old relationships. `reload()` passes
`populate_existing=True`; a hand-rolled `select()` will not.

**A BLOCKED incident needs a blocked reason, even in tests.** Unchanged from M3 —
`CHECK (status <> 'BLOCKED' OR blocked_reason_type IS NOT NULL)`. `_apply_transition_effects`
clears both blocked fields whenever the target is not BLOCKED, which is what keeps the
constraint satisfied on the way out.

**The resolution summary survives a reopen.** "Still broken" clears `resolved_at` but
leaves `resolution_summary` standing, so the engineer's previous claim is still visible
while the ticket is worked again. A second resolve overwrites it; the events keep both.

**`priority` sorting depends on the enum's declared order.** `LOW, MEDIUM, HIGH, CRITICAL`
in `app/models/enums.py`, created in that order by revision 0001. Reordering those
members without a migration would silently invert `sort=-priority`.

**`specialty=true` with no specialties matches nothing.** An engineer whose
`specialty_group_ids` is empty gets an empty list, not everything. That is the honest
answer, and it is visible immediately — unlike the alternative, where a misconfigured
profile looks like a working one.

**`?assignee_id=unassigned` is parsed by hand.** It is not a UUID, so
`_parse_assignee_filter` in the router accepts either and returns a 422 with
`INVALID_ASSIGNEE_FILTER` for anything else. A new filter that wants a sentinel needs the
same treatment; FastAPI will not do it from the type alone.

**Date filters need URL encoding.** `created_from=2026-09-23T12:00:00+00:00` loses its
`+` to form decoding and fails to parse. Clients must percent-encode it (`%2B`), which
axios and `httpx`'s `params=` do automatically and hand-built query strings do not.

**Notes cannot change visibility after creation.** `NoteUpdate` has only `body`. Flipping
PUBLIC to INTERNAL after the reporter has read it hides nothing, and the other way
publishes something written on the understanding it was private. Deleting and rewriting is
the intended path.

**Deleting a note is soft, and `DeleteResult` says `deactivated: true`.** The shape is
shared with facilities and categories, where deactivation is a real state. For a note it
means "gone from every reading of the ticket, still a row".

**The activity feed is not paginated.** It is one ticket's history and only coherent read
whole. A ticket with hundreds of events would return all of them; if that becomes real,
the place to fix it is `load_activity`, not the two queries beneath it.

**A test fixture must not name a category after a seeded group.**
`tests/integration/test_ops_actions.py` runs the real `migrate` action through
`function.handler`, which owns its own session and genuinely **commits** — so the five
seeded groups (Hardware, Software, Network & Access, Meeting Rooms, Building &
Facilities) exist for every test that runs after that file alphabetically. A fixture that
creates a group with one of those names hits
`uq_categories_parent_id_name`, and only in a full run: the file passes on its own. M4's
fixtures let `make_category` generate a unique name and assert against
`subcategory.parent.name` rather than a literal. M2 solved the same problem differently in
`test_seed_categories.py`, with an autouse fixture that empties the table first; either
works, but a hard-coded seeded name does not.

**Two suites cannot share a database, and the failure does not look like one.**
`tests/conftest.py` drops and recreates `acme_incidents_test` with `WITH (FORCE)` at
session start, which terminates every other connection to it. A second `pytest` — another
terminal, a watcher, a forgotten run from hours ago that is still holding a transaction
open — therefore pulls the schema out from under the first. The symptom is
`psycopg.errors.AdminShutdown: terminating connection due to administrator command`
raised from a *fixture*, scattered across whichever file happened to be running, which
reads like a broken test rather than a broken environment. This happened three times
while M4 was being built.

Check before blaming the code:

```sh
ps -eo pid,etime,cmd | grep '[p]ytest'
psql -h localhost -U postgres -c \
  "select pid, datname, state from pg_stat_activity where datname like 'acme%'"
```

`state = idle in transaction` on a connection older than your run is the tell. Give your
run its own database rather than killing someone else's:

```sh
POSTGRES_TEST_NAME=acme_incidents_mine .venv/bin/pytest
```

### 7. Glossary

**State machine** — a set of allowed states and the moves between them. Here the states
are `incident_status` values and the moves are `TRANSITIONS`.

**Transition table** — the same thing expressed as data rather than control flow, so it
can be read, returned to a client and iterated over by tests.

**Actor** — the capacity someone acts in on one particular incident: REPORTER, ASSIGNEE
or FACILITY_ADMIN. Not the same as their role; the same person is a different actor on a
different ticket.

**Guard** — a precondition attached to a transition that depends on the incident rather
than on what the caller sent. "Has an assignee", "was closed less than seven days ago".

**Frozen dataclass** — `@dataclass(frozen=True)`: a small value object whose fields cannot
be reassigned after construction, which is what makes a module-level table safe to share.

**`frozenset`** — an immutable set. Used for `allowed_actors` and `close_reasons` so the
rows cannot be mutated by the code reading them.

**Audit log / append-only** — `incident_events` rows are written and never updated or
deleted. It is what makes "who changed this, and when" answerable, and why note deletion
is soft.

**`tsvector`** — PostgreSQL's parsed, normalised form of a document: words reduced to
stems with positions and weights. `incidents.search_vector` is a *generated stored*
column, so the database maintains it and it can never drift from `title` and
`description`.

**`tsquery` / `websearch_to_tsquery`** — the parsed form of a search. `websearch_to_tsquery`
accepts the syntax people type into search boxes (quoted phrases, `or`, leading `-`) and
never raises on punctuation, unlike `to_tsquery`.

**`ts_rank`** — how well a `tsvector` matches a `tsquery`, used to order results by
relevance. The `setweight(..., 'A')` on the title is why a title match outranks a body
match.

**GIN index** — Generalised Inverted Index: maps each word to the rows containing it, which
is what makes `search_vector @@ query` fast. `ix_incidents_search_vector` is one.

**Stemming** — reducing words to a common root so "flicker", "flickers" and "flickering"
all match. A property of the `english` text-search configuration.

**`now()` vs `clock_timestamp()`** — both PostgreSQL time functions. `now()` (and
`CURRENT_TIMESTAMP`) returns the *transaction* start time and is constant for the whole
transaction; `clock_timestamp()` reads the actual clock each time it is called.

**`timestamptz`** — `TIMESTAMP WITH TIME ZONE`: an absolute instant, stored in UTC and
rendered in the session's zone. `TIMESTAMP WITHOUT TIME ZONE` stores a wall-clock reading
with no zone attached, and the two do not compare.

**Naive vs aware datetime** — a Python datetime with no `tzinfo` versus one with. Python
raises `TypeError` rather than guessing when you subtract one from the other.

**Identity map** — SQLAlchemy's per-session cache of loaded objects by primary key. It is
why a second query for the same row returns the *same* Python object, and why
`populate_existing` exists.

**`populate_existing`** — an execution option telling SQLAlchemy to overwrite an
already-loaded object's attributes and relationships with what the new query returned,
rather than handing back the cached version.

**`expire_on_commit`** — a session setting: when true, every loaded object is marked stale
on commit and reloaded on next access. The application sets it false; the test fixtures
now match.

**Sentinel value** — a reserved value of a normal parameter that means something other
than a normal value. `?assignee_id=unassigned` is one.

**Soft delete** — marking a row deleted (`deleted_at`) instead of removing it, so
everything that points at it still makes sense.

**Optimistic vs advisory checks** — capacity and availability here are *advisory*: the
operation succeeds and returns `warnings`. Contrast the questionnaire rules, which refuse.

**Correlated subquery** — see M3's glossary; `active_ticket_count` is still the example,
and `assignment.py` reads it through `engineer_repository.count_active_tickets`.

---

## Phase M5 — Frontend shell and auth

M1 through M4 built an API with no client. The only page in the browser was the
walking-skeleton status card. M5 gives the application its frame: a session that
survives a reload, a shell that switches between a desktop sidebar and a mobile
bottom bar, guards that decide which routes a role may open, and the three screens
that have to work before any of the rest can — sign in, register, change password.

No feature screens yet. Every navigation item leads to a placeholder that names the
phase delivering it, which is deliberate: it means the navigation, the guards and the
layout switch are all exercisable now, at every width and in every role, rather than
waiting on M6.

**Verified against local PostgreSQL only.** 112 frontend tests, 606 backend tests, and
one end-to-end pass over HTTP through the Vite dev proxy against a scratch database —
register, login, the forced password change, and logout. What still needs the cloud is
in [docs/DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md).

This section starts, as M3 and M4 did, with a defect in an earlier phase that this
phase's verification uncovered.

### 0. The carry-over: a security response that rolled itself back

[auth_service.rotate_session](../backend/v1/app/services/auth_service.py) implements
**reuse detection**. Refresh tokens rotate: spending one revokes it and issues a
replacement. So presenting a token that is *already revoked* means either the cookie was
stolen and replayed, or the legitimate client raced itself. Either way the safe response
is to end every session that user has, which turns silent theft into a visible logout.

The code did that:

```python
if stored.revoked_at is not None:
    revoked = user_repository.revoke_all_refresh_tokens(session, stored.user_id, now=now)
    session.flush()          # <- the bug
    logger.warning(...)
    raise failure
```

`flush()` writes the rows inside the transaction and leaves the `commit()` to the caller,
which is the house convention: services flush, routers commit. But this caller never
commits. It **raises**, the request fails with a 401, and
[`get_db`](../backend/v1/app/db.py) closes the session in its `finally` without
committing — so the revocation is rolled back along with everything else.

The documented response to a stolen cookie therefore did not happen. Worse than a no-op:
the attacker's replay was refused, while the session it was supposed to protect carried
on unharmed.

It is invisible from the test suite. `test_reusing_a_revoked_token_kills_every_session`
passes both before and after the fix, because every request in it shares the test's
session through the `get_db` dependency override — a write that is merely *flushed* is
still visible to its assertions. In production each request gets its own session. This is
the same class of harness blind spot as M4's stale relationship, and the reason
`tests/conftest.py` sets `expire_on_commit=False`: the test client resembles production
closely, and the places it does not are exactly where bugs hide.

It showed up the first time the real server was driven over HTTP, while checking that
`AuthProvider`'s bootstrap refresh behaved:

```sh
curl -c A -X POST localhost:3000/api/v1/auth/login -d '{...}'   # 200, cookie A
curl -b A -c B -X POST localhost:3000/api/v1/auth/refresh       # 200, cookie B, A revoked
curl -b A -X POST localhost:3000/api/v1/auth/refresh            # 401  — reuse detected
curl -b B -X POST localhost:3000/api/v1/auth/refresh            # 200  — should be 401
```

The fix is one line and one comment: commit in that branch, since its caller cannot.

```python
if stored.revoked_at is not None:
    revoked = user_repository.revoke_all_refresh_tokens(session, stored.user_id, now=now)
    # Committed here, not flushed. This request is about to fail, so the
    # router never reaches its own `session.commit()` ... This is the one
    # place a service commits on its own.
    session.commit()
```

The accompanying test asserts the **mechanism** rather than the outcome — that this path
commits on its own — because the rollback fixture cannot observe a real commit. Asserting
the outcome is what let the bug through in the first place.

Both cookies now answer 401.

### 1. What was built

#### The session — `src/api/`

| File | Responsibility |
| --- | --- |
| [api/client.ts](../frontend/src/api/client.ts) | The axios instance, the in-memory access token, the `Authorization` header, the 401 refresh-and-retry, and the single-flight `refreshSession`. |
| [api/auth.ts](../frontend/src/api/auth.ts) | One typed function per auth endpoint: `register`, `login`, `logout`, `changePassword`, `fetchMe`. |
| [api/types.ts](../frontend/src/api/types.ts) | TypeScript twins of the Pydantic schemas: `User`, `CurrentUser`, `EngineerProfile`, `TokenResponse`, and the three enums. |
| [api/errors.ts](../frontend/src/api/errors.ts) | `describeError` — flattens the API's two error shapes into `{message, status, code, fieldErrors}`. |

#### The session in React — `src/auth/`

| File | Responsibility |
| --- | --- |
| [auth/AuthContext.ts](../frontend/src/auth/AuthContext.ts) | The context, the `AuthStatus` type, and the `useAuth` hook. No components, so Fast Refresh keeps working. |
| [auth/AuthProvider.tsx](../frontend/src/auth/AuthProvider.tsx) | Restores the session on mount, exposes `signIn` / `signOut` / `changeOwnPassword`, and reacts when the client reports the session gone. |
| [auth/RequireAuth.tsx](../frontend/src/auth/RequireAuth.tsx) | Route gate: no session → login; `must_change_password` → the change-password screen. |
| [auth/RequireRole.tsx](../frontend/src/auth/RequireRole.tsx) | Route gate by role, and optionally by engineer level. |

#### The frame — `src/layout/`

| File | Responsibility |
| --- | --- |
| [layout/AppShell.tsx](../frontend/src/layout/AppShell.tsx) | App bar, drawer or bottom bar, the content slot, and the mobile report FAB. |
| [layout/navigation.ts](../frontend/src/layout/navigation.ts) | `navItemsFor(user)` — who sees which item — and `activeNavPath`, which decides what is highlighted. |
| [layout/UserMenu.tsx](../frontend/src/layout/UserMenu.tsx) | The avatar menu: who you are, change password, log out. |
| [layout/roleLabels.ts](../frontend/src/layout/roleLabels.ts) | How a user is presented: role wording, and avatar initials. Users never see `FACILITY_ADMIN`. |
| [layout/DrawerAccountSection.tsx](../frontend/src/layout/DrawerAccountSection.tsx) | The account identity and its two actions, at the foot of the mobile drawer. |

#### The screens — `src/features/`

| File | Responsibility |
| --- | --- |
| [features/auth/LoginPage.tsx](../frontend/src/features/auth/LoginPage.tsx) | Sign in, and land on wherever the user was originally headed. |
| [features/auth/RegisterPage.tsx](../frontend/src/features/auth/RegisterPage.tsx) | Self-registration, followed by an automatic sign-in. |
| [features/auth/ChangePasswordPage.tsx](../frontend/src/features/auth/ChangePasswordPage.tsx) | Voluntary and forced password changes — one screen, two moods. |
| [features/auth/schemas.ts](../frontend/src/features/auth/schemas.ts) | The zod schemas mirroring the API's bounds and the `@acme.inc` rule. |
| [features/auth/formErrors.ts](../frontend/src/features/auth/formErrors.ts) | `applyApiErrors` — routes an API failure to the inputs that caused it. |
| [features/auth/AuthCard.tsx](../frontend/src/features/auth/AuthCard.tsx) | The frame the three signed-out screens share. |
| [features/home/HomePage.tsx](../frontend/src/features/home/HomePage.tsx) | The `/` route, which is a different screen per persona. |
| [features/placeholder/](../frontend/src/features/placeholder/) | `ComingSoonPage` and `NotPermittedPage`. |

#### Shared

| File | Responsibility |
| --- | --- |
| [src/routes.ts](../frontend/src/routes.ts) | Every path in the application, named once. |
| [src/fonts.ts](../frontend/src/fonts.ts) | The `@font-face` imports for both self-hosted families. The only reason the theme's typeface is the one that renders. |
| [src/App.tsx](../frontend/src/App.tsx) | The route table: open routes, the gate-exempt route, and the guarded routes inside the shell. |
| [src/theme.ts](../frontend/src/theme.ts) | Grown from M1's palette into the component defaults the whole app inherits. |
| [src/components/FullPageProgress.tsx](../frontend/src/components/FullPageProgress.tsx) | The whole-page waiting state, used while the session is restored. |
| `src/test/` | `factories.ts` (build a `CurrentUser`), `renderWithProviders.tsx` (render with a stubbed session), `apiError.ts` (build the rejection axios would raise). |

#### Tests — 101 frontend, up from 6

| File | Count | What it pins down |
| --- | --- | --- |
| `api/client.test.ts` | 10 | Header attachment, refresh-once-and-replay, no retry on login, 403 left alone, and one shared refresh between concurrent callers. |
| `api/errors.test.ts` | 9 | Both API error shapes, including FastAPI's `loc` paths and the network case. |
| `auth/AuthProvider.test.tsx` | 9 | Restore on load, the three statuses, sign in, sign out (including a failing one), password change, background session loss. |
| `auth/RequireAuth.test.tsx` | 6 | Loading, redirect to login, the password gate, and the exemption. |
| `auth/RequireRole.test.tsx` | 12 | The role and level matrix, including admins passing every level check. |
| `layout/navigation.test.ts` | 11 | Each role's items, the bottom-bar bound, and longest-prefix highlighting. |
| `layout/AppShell.test.tsx` | 20 | The 900 px switch from both sides, 375 / 768 / 1440, drawer overflow, the two drawer halves and their divider, and which control holds the trailing corner at each width. |
| `features/auth/*.test.tsx` | 24 | Validation, the domain rule, field-error mapping, and where each screen lands. |
| `theme.test.ts` | 4 | That the stack leads with the self-hosted family, ends generic, prefers Arial to Helvetica, and names no weight the bundle lacks. |
| `features/status`, `hooks` | 6 | Unchanged from M1. |

Added to `package.json`: `react-hook-form`, `zod`, `@hookform/resolvers` — the form stack
BUILD-PLAN section 10 specifies.

M1's `StatusPage` moved from `/` to `/status` and stayed **open**, because
[deployment checklist item 1.5](DEPLOYMENT-CHECKLIST.md) uses it to prove a fresh
environment before any account exists. It discloses nothing new: `GET /api/v1/health` has
no auth dependency either, by design.

### 2. Why it is shaped this way

#### The access token never touches storage

It lives in a module-level variable in [api/client.ts](../frontend/src/api/client.ts).
Not `localStorage`, not `sessionStorage`, not a readable cookie.

Anything persisted is readable by **any** script that reaches the page — an ambitious
dependency, a compromised CDN, a cross-site scripting hole — and it survives the tab, so
a token stolen on Monday still works on Tuesday. A variable dies with the page.

The cost is that a reload loses the token, which is precisely what the refresh cookie is
for. The cookie is `HttpOnly`, so JavaScript cannot read it at all, and its `Path` is
`/api/v1/auth`, so the browser attaches it to the handful of endpoints that need it and
to nothing else. The two halves are complementary: the readable half is short-lived (15
minutes) and the long-lived half is unreadable.

**Rejected:** `localStorage` with a short expiry. The expiry does not help — the window
between theft and use is seconds, not minutes.

#### One module owns the token, the header and the retry

`client.ts` is the largest file in `api/`, and the temptation was to split it into
`session.ts` (the token), `client.ts` (the instance) and `refresh.ts` (the rotation). Each
split produces an import cycle: the interceptor needs the refresh, the refresh needs the
token, the token is attached by the interceptor.

The three genuinely are one concern — "the HTTP client and the session it carries" — so
they are one module, and the cycle never exists. `auth.ts` beside it holds only endpoint
functions, which import the client and are imported by nobody below them.

#### Refreshes are single-flight, and that is correctness, not performance

```ts
export function refreshSession(): Promise<TokenResponse | null> {
  refreshInFlight ??= requestRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
```

Follow the consequence of *not* doing this. Two requests 401 at the same moment — which
is ordinary, since a dashboard fires several queries at once and they expire together.
Both call refresh. The first rotates the cookie and revokes the token it presented. The
second presents that same, now-revoked token, and the API's reuse detection reads it as a
stolen cookie and **revokes every session the user has**. The user is signed out by their
own browser.

The bootstrap has the same shape for a different reason: React `StrictMode` deliberately
invokes effects twice in development, so `AuthProvider`'s restore effect calls refresh
twice on every page load. With single-flight the second call joins the first and there is
one request. That is also why the fix is emphatically *not* to remove `StrictMode` — the
double invocation is a smoke detector, and it found a real fire.

#### `loading` is a status, not the absence of a user

```ts
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
```

On every page load the app has to ask the API whether the refresh cookie is still good,
and until that answers, "we have no user" and "there is no user" are different facts. A
guard that collapsed them would bounce a signed-in user to the login screen every time
they pressed reload, and then bounce them back a moment later — a flicker that looks
exactly like a broken session.

**Rejected:** rendering children optimistically and correcting afterwards. It shows the
user a page they may not be allowed to see.

#### Every route into a session ends at `/auth/me`

`POST /auth/login` and `POST /auth/refresh` both return a `TokenResponse`, whose `user` is
a `UserRead` — and `UserRead` has no engineer profile. The navigation needs the engineer's
**level**: only LEADs see Team, only SENIOR and LEAD see Unassigned. So `signIn` and the
bootstrap both follow their first call with `fetchMe()`, which returns `CurrentUserRead`
with the profile attached.

Two requests where one might do, but the alternative is worse: widening `TokenResponse` to
carry the profile would put engineer data in the login response for the 95% of accounts
that have none, and would make the login endpoint's shape depend on the navigation's
needs.

#### The password gate is read, not caught

The API answers 403 `PASSWORD_CHANGE_REQUIRED` on every endpoint outside `/auth` while an
account still owes a password change. The obvious frontend implementation is to catch that
code in the axios interceptor and redirect.

[RequireAuth](../frontend/src/auth/RequireAuth.tsx) reads `must_change_password` from
`/auth/me` instead, and redirects before a single feature request is made. The difference
shows up in what the user sees: the catching version fires several requests, fails all of
them, shows whatever error state the screen has for a 403, and only then redirects. The
reading version goes straight to a form.

The two are not mutually exclusive — the API's 403 is still the enforcement, and still
correct if the flag changes mid-session — but the redirect should not be the only thing
standing between a user and a wall of errors.

#### `skipPasswordGate`, rather than a second guard component

The change-password screen needs a signed-in user but must be exempt from the gate;
otherwise its guard redirects it to itself. That is one boolean of difference, so it is a
prop:

```tsx
<Route element={<RequireAuth skipPasswordGate />}>
  <Route path={paths.changePassword} element={<ChangePasswordPage />} />
</Route>
```

**Rejected:** a separate `RequireSession` component. Two components that share every rule
but one drift apart, and the reader has to diff them to find out which.

#### A refusal explains itself instead of redirecting

`RequireRole` renders [NotPermittedPage](../frontend/src/features/placeholder/NotPermittedPage.tsx)
rather than navigating home. A URL someone pasted into a chat should tell you why it will
not open; silently landing somewhere else reads as a bug, and the user tries again.

It also mirrors the API deliberately, including the rule from
`require_engineer_levels` that a facility admin passes **every** engineer-level check.
An admin opening the Team page and being told they lack permission would be wrong twice
over: wrong about the API, which would have served the request, and wrong about the
organisation, in which an admin outranks a lead.

#### Navigation is data

[navigation.ts](../frontend/src/layout/navigation.ts) returns a list; `AppShell` renders
it. The same reasoning as `workflow.py` on the backend: when the question is "why can this
user see that item?", one table answers it, and no amount of reading the layout component
will contradict the answer.

This is presentation, never permission. Hiding a link is a courtesy; `RequireRole` guards
the route and the API refuses the request.

#### One shell, two navigation surfaces

`AppShell` is a single component that branches on `isMobile` for the navigation surface
only. The app bar, the account menu and the content slot are written once.

**Rejected:** `DesktopShell` and `MobileShell`. They start as near-duplicates and end as
two different applications — a fix applied to one, a prop added to the other.

The bottom bar holds the three or four items `navigation.ts` marks for it, per BUILD-PLAN
section 10. An admin has six. Rather than hide two screens from anyone on a phone, the app
bar carries a menu button that opens the full list in a temporary drawer, so the bar is a
shortcut rather than a ceiling.

**The mobile app bar has exactly one trailing control, and it is the drawer button.** The
avatar menu is not there at all. A phone's top-right corner is the one a right thumb
reaches without regripping, and the drawer is opened far more often than the account menu
— so reach wins over the convention that puts an avatar in that corner. Desktop is
unchanged: reach is not a constraint with a mouse, and the avatar keeps its usual place.

**The mobile drawer therefore has two halves, separated by a `Divider`.** Work navigation
above, the account below: who you are, change password, log out. They are different
questions — "which tickets am I looking at" and "who am I signed in as" — and one
undifferentiated list makes both slower to scan. The work half is the one that scrolls, so
the account stays pinned to the bottom however long the navigation grows.

The desktop drawer deliberately has no account half. The top bar already holds those three
things, and giving one action two homes on the same screen is how the two copies start
disagreeing.

#### zod mirrors the API's rules, and says so

```ts
/** From `MIN_PASSWORD_LENGTH` in `app/security/passwords.py`. */
export const MIN_PASSWORD_LENGTH = 12;
```

CLAUDE.md says each business rule lives in exactly one place, and this looks like a
violation. The distinction that makes it not one: the schemas in
[features/auth/schemas.ts](../frontend/src/features/auth/schemas.ts) are a **cache for
fast feedback**, and the API re-checks every one of them. When the two disagree, the API
wins and the user sees it — `applyApiErrors` attaches the server's message to the field
the server named, so drift surfaces as a server error on an input the form thought was
fine, rather than as a hole.

The email rule is mirrored the same way and for the same reason, splitting on the **last**
`@` and comparing the domain for equality exactly as `normalise_email` does. Telling
someone their `@gmail.com` address is not eligible after a network round trip, when the
rule is a string comparison, is a worse trade than the duplication.

The one rule this project will never duplicate is a different kind: `allowed-transitions`
is the single source of truth for what a user may do to a ticket, and M6's buttons are
rendered from its response. A length bound is a constant; a workflow is a decision.

#### Registration signs you in

`POST /auth/register` issues no tokens, so the client has to log in afterwards regardless.
Doing it automatically makes two requests into one step.

The interesting case is the second request failing. The account **exists** at that point,
so an error implying nothing happened would send the user round the loop to meet
`EMAIL_TAKEN`. The fallback is the login screen with "Your account was created. Please
sign in."

#### The route paths are named once

[routes.ts](../frontend/src/routes.ts) is a map of constants. Guards, navigation,
redirects and tests all reference the same entry, so a path can be renamed without
something quietly continuing to point at the old one — which, in a router, fails silently
by rendering the catch-all rather than loudly by crashing.

#### The typeface is self-hosted, and that is a correctness fix

M5 shipped a theme that asked for `Inter, Roboto, Helvetica, Arial, sans-serif` and
installed none of them. Naming a font does not load one, so every browser fell through to
Helvetica — which on this build machine resolves to **Nimbus Sans**, and Nimbus is
unusually lopsided: its `hhea` ascent is 0.729em against a 0.718em cap height, so the
capitals almost touch the top of its own content box while the descent below stays a full
0.271em.

The consequence is visible in anything with a fixed height, measured here from MUI's real
box model rather than by eye:

| Container | Space above the capitals | Space below the baseline | Lean |
| --- | --- | --- | --- |
| Button (14px/1.75, 6px padding) | 11.40px | 15.04px | 3.64px high |
| Nav row (16px/1.5, 8px padding) | 12.18px | 16.34px | 4.16px high |
| Outlined input (16px, 16.5px padding) | 20.18px | 24.34px | 4.16px high |

Every label sat high in its container, with visibly more room underneath it than above.

Loading a real font fixes it, and which real font is a second decision. Two were
measured:

| Family | Button | Nav row | Input | |
| --- | --- | --- | --- | --- |
| Roboto | 0.38px | 0.44px | 0.44px | what renders |
| Inter | 0.00px | 0.00px | 0.00px | the bundled fallback |
| Nimbus Sans | 3.64px | 4.16px | 4.16px | what rendered before |

Inter is exactly symmetric — its `USE_TYPO_METRICS` flag points the browser at `OS/2`
typo values chosen to centre — and Roboto is not quite. **Roboto leads anyway.** 0.44px
is below the threshold of a single CSS pixel, where Nimbus's 4.16px was four of them, so
the reported fault is gone either way; and Roboto is the family Material UI's own
component heights, line-heights and paddings were drawn around. Matching the design
system its components assume is worth more than a fraction of a pixel that no display
can resolve.

Swapping the first two entries in `theme.ts` reverses that decision, and
`theme.test.ts` pins whichever order is chosen so the change is deliberate rather than
incidental.

**Rejected:** a Google Fonts `<link>`. It is a request to a third party on every cold
load, it fails closed in a locked-down network, and it puts a dependency outside the
distribution that serves everything else. `@fontsource` bundles the same files through
Vite, so they are emitted into `dist/assets/` with content hashes and served from the same
CloudFront distribution as the JavaScript, with no external origin in the built output at
all. Two numbers, and they are not the same one: 192 kB of woff2 is *emitted* across two
families and four weights each, while a normal load *fetches* the 96 kB of Roboto.

Both families are bundled, and the reasoning is worth being precise about, because "ship
one font" was the wrong instinct. A `@font-face` family is fetched **lazily** — only when
something needs it — so the fallback costs nothing on a normal load: Roboto is first,
Roboto renders, and Inter's files sit in S3 untouched. What it buys is that the second
rung of the stack becomes real. Before, if the first font's file 404'd or was blocked,
the browser fell past families nobody had installed and landed on Nimbus Sans — straight
back to the 4px lean. Now it lands on Inter, which is exactly symmetric.

The fallback order changed too, on the same evidence. `Arial` now precedes `Helvetica`,
because Arial resolves to metrics that centre to within 0.02em on every platform while
Helvetica is the one that resolves to Nimbus. It only matters if the webfont fails — but
if it fails, it should fail onto the better of the two.

#### No `.css` files

Per CLAUDE.md: `sx` for one-off layout, `theme.ts` for anything global. M5 grew the theme
from M1's palette into component defaults — `textTransform: 'none'` on buttons,
`fullWidth` on text fields, `variant="outlined"` on cards. Each of those is a line that
forty components no longer carry.

[src/fonts.ts](../frontend/src/fonts.ts) imports eight `@fontsource` stylesheets, and
that is not a breach of this rule — the rule is about *our* styling. What it forbids is
the `Catalog.tsx` + `Catalog.css` pattern, where the styling for one component lives in a
second file shadowing it. Importing a stylesheet a package ships is ordinary use of that
package, and each of these is one `@font-face` rule for one weight of one subset, the
narrowest form `@fontsource` offers. They are kept in one module so they are easy to find.

No exceptions were needed beyond that. No `@keyframes`, no `<style>` block, and no
stylesheet of our own.

### 3. How the pieces connect

**Opening the app with a session from yesterday.** This is the trace worth knowing,
because it is the one that runs on every page load and the one that involves every file.

```
Browser opens https://.../tickets/mine
  │
  ├─ CloudFront: no file extension → CloudFront Function rewrites to /index.html
  │              (locally: the Vite dev server does the same for an unknown path)
  ├─ main.tsx                      QueryClientProvider → ThemeProvider → CssBaseline
  │                                → BrowserRouter → AuthProvider → App
  │
  ├─ AuthProvider mounts           status = 'loading', user = null
  │    effect 1: setSessionEndedHandler(endSession)     ── tells client.ts where to report
  │    effect 2: restore()
  │       └─ client.refreshSession()
  │            refreshInFlight is null → requestRefresh()
  │              POST /api/v1/auth/refresh        (bare axios: no interceptors, no loop)
  │              cookie rides along — its Path is /api/v1/auth, and this is that path
  │                 │
  │                 ├─ routers/auth.py refresh
  │                 ├─ auth_service.rotate_session
  │                 │     token hash found, not revoked, not expired
  │                 │     revoke the presented token, issue a new pair
  │                 └─ _set_refresh_cookie(...)   HttpOnly, SameSite=strict,
  │                                               Secure from settings.cookie_secure
  │              ← 200 {access_token, user}
  │              accessToken = 'eyJ...'                  (module variable, never stored)
  │            (StrictMode's second invocation awaited this same promise)
  │
  ├─ App.tsx route table           /tickets/mine matches inside <RequireAuth>
  ├─ RequireAuth                   status is still 'loading' → <FullPageProgress />
  │
  ├─ restore() continues           authApi.fetchMe()
  │       GET /api/v1/auth/me
  │         apiClient request interceptor → Authorization: Bearer eyJ...
  │         routers/auth.py read_me → get_authenticated_user (no password gate here)
  │       ← 200 {user: {..., engineer_profile: {level: 'LEAD', ...}}}
  │    setUser(me); setStatus('authenticated')
  │
  ├─ RequireAuth re-renders        session present, must_change_password false → <Outlet />
  ├─ AppShell
  │    navItemsFor(user)           role ENGINEER, level LEAD → Home, My queue,
  │                                Unassigned, All tickets, Team
  │    useBreakpoint()             react-responsive matchMedia(max-width: 899px)
  │                                → 1440px desktop → permanent Drawer
  │    activeNavPath('/tickets/mine', items)
  │                                '/tickets/mine' and '/tickets' both match;
  │                                longest wins → My tickets is selected
  └─ <Outlet />                    the routed page renders inside the frame
```

**Signing in**, shorter, and the only path that writes the token twice:

```
LoginPage form submit
  ├─ zodResolver(loginSchema)      both fields non-empty, else nothing is sent
  ├─ useAuth().signIn(email, password)
  │    ├─ authApi.login()                POST /auth/login
  │    │     auth_service.authenticate — one error for wrong email or wrong password
  │    │     ← 200 {access_token, user}  + Set-Cookie: acme_refresh_token
  │    ├─ setAccessToken(access_token)   so the next request is authenticated
  │    └─ authApi.fetchMe()              GET /auth/me → the profile the nav needs
  │         setUser(me); setStatus('authenticated')
  └─ navigate(state?.from?.pathname ?? '/', {replace: true})
        replace, so Back does not return to the login form
```

and when it fails:

```
  └─ catch → applyApiErrors(error, fallback, ['email', 'password'], setError)
       describeError reads {detail, code, field}
         401 INVALID_CREDENTIALS has no `field`, by design — naming one would
         tell an attacker which half was right
       → nothing attaches → returned as the form-level message
       → <Alert severity="error">Incorrect email or password.</Alert>
```

**An access token expiring while the tab is open.** Fifteen minutes in, a query fires:

```
apiClient.get('/incidents')      Authorization: Bearer <15 minutes old>
  ← 401 {detail, code: 'INVALID_TOKEN'}
  │
  └─ response interceptor
       status is 401 ✓   url is not in NO_RETRY_PATHS ✓   not already retried ✓
       └─ refreshSession()                     (shared, if three queries 401 together)
            ├─ 200 → accessToken = new
            │        config.retriedAfterRefresh = true
            │        apiClient.request(config)  → request interceptor attaches the new
            │                                     token → 200, and the caller never knew
            └─ null → sessionEndedHandler()    → AuthProvider.endSession()
                       status = 'anonymous' → RequireAuth redirects to /login
```

The `NO_RETRY_PATHS` check is why a wrong password does not trigger a refresh: a 401 from
`/auth/login` is the answer, not a stale token.

### 4. Where the rules live

| Rule | File |
| --- | --- |
| Where the access token is kept, and for how long | [api/client.ts](../frontend/src/api/client.ts) — module variable, no persistence |
| Which requests carry the bearer token | `api/client.ts` request interceptor |
| When a 401 is retried, and how often | `api/client.ts` — `shouldRetry`, `NO_RETRY_PATHS`, `retriedAfterRefresh` |
| That only one refresh runs at a time | `api/client.ts` — `refreshInFlight` |
| What the API's error bodies mean | [api/errors.ts](../frontend/src/api/errors.ts) — `describeError` |
| Which API failure lands on which input | [features/auth/formErrors.ts](../frontend/src/features/auth/formErrors.ts) |
| How a session is restored, started and ended | [auth/AuthProvider.tsx](../frontend/src/auth/AuthProvider.tsx) |
| Who may open a route at all | [auth/RequireAuth.tsx](../frontend/src/auth/RequireAuth.tsx) |
| Who may open a route given their role or level | [auth/RequireRole.tsx](../frontend/src/auth/RequireRole.tsx) |
| That a password change blocks everything else | `auth/RequireAuth.tsx` (frontend) + `security/dependencies.py` (enforcement) |
| Who sees which navigation item | [layout/navigation.ts](../frontend/src/layout/navigation.ts) — `navItemsFor` |
| Which item is highlighted | `layout/navigation.ts` — `activeNavPath` |
| Which items reach the mobile bottom bar | `layout/navigation.ts` — the `inBottomNav` flag |
| Where the desktop/mobile switch happens | [hooks/useBreakpoint.ts](../frontend/src/hooks/useBreakpoint.ts) — 899 px, MUI's `md` |
| Password length and the `@acme.inc` rule, client side | [features/auth/schemas.ts](../frontend/src/features/auth/schemas.ts) |
| Password length and the `@acme.inc` rule, **authoritatively** | `app/security/passwords.py`, `auth_service.normalise_email` |
| Every URL in the app | [src/routes.ts](../frontend/src/routes.ts) |
| Which route is guarded by what | [src/App.tsx](../frontend/src/App.tsx) |
| Global styling, colours, component defaults | [src/theme.ts](../frontend/src/theme.ts) |
| How a role or level is worded for humans | [layout/roleLabels.ts](../frontend/src/layout/roleLabels.ts) |
| Which typeface is actually loaded, and in which weights | [src/fonts.ts](../frontend/src/fonts.ts) |
| Which typeface is *asked for*, and its fallbacks | [src/theme.ts](../frontend/src/theme.ts) |

### 5. How to change it

**To add a navigation item** — two files, in this order:

1. [src/routes.ts](../frontend/src/routes.ts): add the path.
2. [layout/navigation.ts](../frontend/src/layout/navigation.ts): add a `NavItem` to the
   role's list, with an icon and an `inBottomNav` flag. Keep each role's bottom-bar count
   at three or four — `navigation.test.ts` asserts it.
3. [src/App.tsx](../frontend/src/App.tsx): add the `<Route>`, inside the right
   `RequireRole` if it is not for everyone.

**To add a guarded route** for a role that does not have one yet:

```tsx
<Route element={<RequireRole roles={['ENGINEER', 'FACILITY_ADMIN']} levels={['LEAD']} />}>
  <Route path={paths.team} element={<TeamPage />} />
</Route>
```

`levels` is only consulted for `ENGINEER`; admins pass regardless, matching
`require_engineer_levels`.

**To call a new API endpoint** — three files:

1. [api/types.ts](../frontend/src/api/types.ts): add the TypeScript twin of the Pydantic
   schema.
2. `api/<domain>.ts`: a function per endpoint, using `apiClient`. The bearer token, the
   refresh and the retry come for free.
3. The feature's TanStack Query hook, with its key registered in
   [api/queryKeys.ts](../frontend/src/api/queryKeys.ts).

**To add a field to a form**:

1. The zod schema in [features/auth/schemas.ts](../frontend/src/features/auth/schemas.ts)
   (or the feature's own), with a bound that matches the API's.
2. The `defaultValues` on `useForm` — react-hook-form needs the key to exist.
3. The `<TextField {...field('name')} />`, with `error` and `helperText` wired to
   `errors.name`.
4. The field name in the `applyApiErrors` list, or the server's message for it will
   surface as a banner instead of under the input.

**To change a password or email rule**: change it in
`backend/v1/app/security/passwords.py` or `auth_service.normalise_email` **first** — that
is the authority — then mirror it in `features/auth/schemas.ts`, which names the constant
it mirrors in a comment.

**To add a role**: `api/types.ts` (`UserRole`), `layout/roleLabels.ts` (the wording),
`layout/navigation.ts` (its items), and `App.tsx` (its routes). The backend's
`app/models/enums.py` and a migration come first.

### 6. Gotchas

**`StrictMode` double-invokes the bootstrap, and that is the point.** In development React
runs effects twice to surface exactly the bug this app would otherwise have shipped: two
refreshes with one cookie, the second read as theft, every session revoked. The single-
flight promise absorbs it. If a future effect misbehaves under `StrictMode`, the effect is
wrong — removing `StrictMode` hides the evidence, it does not fix anything.

**Never route the refresh call through `apiClient`.** `requestRefresh` uses a bare
`axios.post`. A 401 from the refresh endpoint is the end of the session; sending it
through the interceptor that calls `requestRefresh` would be a loop. This is also why
`/auth/refresh` is in `NO_RETRY_PATHS` — belt and braces for a caller that uses
`apiClient` directly.

**The refresh cookie is not sent to most of the API, on purpose.** Its `Path` is
`/api/v1/auth`. A request to `/api/v1/incidents` does not carry it, so an XSS-adjacent
request cannot smuggle it out. The consequence to remember: anything needing the cookie
must be a call to a path under `/api/v1/auth`.

**`Secure` comes from configuration, not from a literal.** `settings.cookie_secure` is
false locally so plain-HTTP development works, and true behind CloudFront. Hard-coding
`Secure` would make local login silently fail — the browser would accept the response and
drop the cookie, and the symptom would be "refresh always 401s" with nothing in any log.

**`react-responsive` captures `window.matchMedia` when it is first imported.** That is why
`installMatchMedia()` runs from `src/test/setup.ts` and not from individual tests, and why
`setViewportWidth()` must be called **before** `render`, not after. A test that sets the
width afterwards silently tests 1440 px.

**MUI's temporary Drawer is not in the DOM while closed.** A mobile test looking for a nav
link has to click the menu button first. This is a feature — it is what
`AppShell.test.tsx` uses to prove the bottom bar really does omit the overflow items — but
it makes `getByRole('link', ...)` fail in a way that reads like a missing item.

**MUI v9 renamed some icons.** `AddCircleOutline` is now `AddCircleOutlined`; the old name
is a module that does not exist, and the error is a TypeScript "cannot find module" rather
than anything about icons. Relatedly, `@mui/icons-material` declares `SvgIconComponent`
but does not export it, so `navigation.ts` names the shape itself as
`ComponentType<SvgIconProps>`.

**A font named in a theme is not a font that is loaded.** This is worth stating plainly
because it failed silently for a whole phase: MUI renders, nothing warns, and the page
looks approximately right — it just leans. If a family is added to
[theme.ts](../frontend/src/theme.ts), it needs a matching import in
[fonts.ts](../frontend/src/fonts.ts) or it will never render. The same applies to
**weights**: `fonts.ts` bundles 400, 500, 600 and 700 of each family, and a theme asking
for 300 or 800 gets a browser-synthesised approximation — smeared or mechanically
emboldened — rather than an error. `theme.test.ts` pins both halves of that contract.
Note that `@fontsource/roboto` does ship a 600, which upstream Roboto historically did
not; a family swap is worth a weight check rather than an assumption.

**`package-lock.json` is gitignored by the scaffold** (`.gitignore` line 204). M5 added
three dependencies, and a fresh `npm install` will resolve them within their caret ranges
rather than to the versions tested here. Not ours to change mid-build, but worth knowing
if CI ever disagrees with a laptop.

**The bundle is 790 kB of JavaScript, 251 kB gzipped.** Alongside it sit 192 kB of woff2 — two families, four weights each — of which a normal load fetches the 96 kB of Roboto, since fallback families are only fetched when they are needed. The JavaScript is almost all Material UI. It is served
compressed by CloudFront and is not a problem yet, but M6 adds `@mui/x-data-grid` and M7
adds `@mui/x-charts`. If it needs attention, route-level `React.lazy` splitting is the
lever, and the admin screens are the natural split point.

**Navigation state is a contract between two screens.** `LoginLocationState` carries
`from` (set by `RequireAuth`) and `notice` (set by the register and change-password
screens). It is typed and exported from `LoginPage.tsx` so both writers and the reader
agree; a bare object literal would drift the day someone renames a key.

**There is still no real-browser end-to-end test.** The 112 frontend tests run in jsdom,
which has no layout engine — `useBreakpoint` is exercised against a stubbed `matchMedia`,
so the tests prove the *decision* at 375/768/1440 px, not that the result looks right. The
HTTP path was verified with curl through the Vite proxy rather than with a browser.
BUILD-PLAN section 14 allows this gap to be documented rather than closed; closing it
means Playwright, and the natural time is M6 when there is a full lifecycle to walk.

*(M6 closed it. The first browser run found a defect every jsdom test had passed — see
that phase's gotchas.)*

### 7. Glossary

**SPA (single-page application)** — the server sends one HTML file and the JavaScript
swaps the content as the user navigates; the URL changes without a page load.

**React context** — a value one component makes available to everything rendered inside
it, without passing it down through every layer in between. `AuthContext` carries the
session.

**Provider** — the component that supplies a context value. `<AuthContext value={...}>`
wraps the app, and anything inside can read it.

**Hook** — a function starting with `use` that lets a component tap into React features.
`useAuth()` reads the session; `useState` holds a value across renders; `useEffect` runs
code after rendering.

**Route guard** — a component wrapped around routes that decides whether to render them,
redirect, or wait. `RequireAuth` and `RequireRole` are guards.

**`<Outlet />`** — React Router's placeholder for "whichever child route matched". A
guard renders `<Outlet />` when it approves, and a `<Navigate>` when it does not.

**`<Navigate replace>`** — redirect without leaving a history entry, so pressing Back does
not return to the page that redirected.

**`MemoryRouter`** — a router that keeps its history in memory instead of the address bar.
Tests use it to start at any URL, and to carry navigation state.

**Bearer token** — a credential sent as `Authorization: Bearer <token>`, meaning "whoever
bears this is authorised". It is why an access token must never be persisted where a
script can read it.

**Access token vs refresh token** — the access token is short-lived (15 minutes), sent on
every request, and readable by the page's JavaScript. The refresh token is long-lived
(7 days), sent only to `/api/v1/auth`, and unreadable by JavaScript. One is for using, the
other for renewing.

**Axios interceptor** — a function axios runs on every request before it is sent, or on
every response before it reaches the caller. The request interceptor attaches the token;
the response interceptor handles the 401.

**Single-flight** — the pattern of collapsing concurrent calls into one shared in-progress
promise, so ten callers produce one request and all receive its result.

**XSS (cross-site scripting)** — an attacker getting their JavaScript to run on your page.
It is the threat that makes `HttpOnly` cookies and in-memory tokens worth the trouble:
injected script can read `localStorage`, but not an `HttpOnly` cookie.

**React `StrictMode`** — a development-only wrapper that deliberately double-invokes
effects and renders, to surface code that assumes it runs exactly once. It changes nothing
in a production build.

**Fast Refresh** — Vite's development feature that swaps an edited component without
reloading the page or losing state. It only works for modules that export components and
nothing else, which is why `useAuth` lives in `AuthContext.ts` rather than in
`AuthProvider.tsx`.

**Testing Library** — a testing approach that queries the rendered DOM the way a user
would — by role, by label, by visible text — rather than by class name or component
internals. `getByRole('button', {name: 'Sign in'})` is the style.

**`getBy` / `queryBy` / `findBy`** — Testing Library's three query families: `getBy`
throws when there is no match, `queryBy` returns null (for asserting absence), and
`findBy` waits for a match to appear (for anything asynchronous).

**react-hook-form** — a form library that keeps values in uncontrolled inputs and
re-renders as little as possible. `register('email')` wires an input to it.

**zod** — a schema library that validates a value and gives TypeScript its type. A
**resolver** is the adapter that lets react-hook-form validate with it.

**Media query / breakpoint** — a CSS condition on the viewport (`max-width: 899px`) and
the width at which a layout changes. MUI calls 900 px `md`; `useBreakpoint` is pinned to
899 so `react-responsive` and MUI's own responsive props always agree.

**`@font-face`** — the CSS rule that names a font family and says where to download it.
Without one, naming a family in CSS only asks for whatever the operating system already
has.

**woff2** — the compressed font format browsers use on the web. Already compressed, so
gzip at the CDN adds nothing to it.

**Self-hosting a font** — serving the font files from your own origin instead of linking
to a third party such as Google Fonts. One fewer external dependency, and nothing to
resolve at load time beyond the origin already serving the page.

**Line box** — the strip of vertical space one line of text occupies, its height set by
`line-height`. The glyphs sit inside it according to the font's own ascent and descent,
which is why two fonts at the same size can sit at different heights in the same box.

**Cap height** — the height of a capital letter above the baseline. Optical centring is
judged on this rather than on the full ascent-to-descent span, because that span includes
room for accents and descenders that most labels never use.

**Half-leading** — the leftover space when a line box is taller than the font's content
area, split equally above and below. Because it is equal on both sides, it never fixes an
asymmetry the font itself has.

**`USE_TYPO_METRICS`** — a flag in a font's `OS/2` table telling browsers to use its
typographic ascent and descent rather than the legacy `hhea` ones. Inter sets it, and its
typo values are the ones that centre.

**`font-display: swap`** — render text immediately in the fallback font, then swap when
the web font arrives. The alternative is invisible text while the font downloads.

**`sx` prop** — MUI's inline styling prop, with access to theme values: `sx={{ p: 2 }}` is
two theme spacing units of padding, not two pixels.

**`CssBaseline`** — MUI's CSS reset, applied once at the root. The only reset this project
has, since it has no stylesheets.

**FAB (floating action button)** — the round button pinned above the mobile bottom bar.
Here it opens "Report an issue" for employees.

---

## Phase M6 — Persona screens

M5 built the frame and left every navigation item pointing at a placeholder. M6 fills
them: the report questionnaire, the incident detail page every persona shares, the four
ticket lists, and the four screens a facility admin maintains the system from.

It also closes the gap M5 recorded. M5's 112 Vitest tests run in jsdom, which has no
layout engine — they can prove what `useBreakpoint` *decides* at 375 px but not that
anything is laid out at 375 px, because nothing is laid out at all. This phase adds
Playwright, and the first thing it found was a defect that only exists in a browser.

**Verified against local PostgreSQL only.** 211 frontend tests (up from 112), 609
backend tests (up from 606), and 12 Playwright tests across two viewports, all passing.
What still needs the cloud is in [docs/DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md).

### 0. Two carry-overs, both the same shape

Both are M4-era code that was correct as far as it went and stopped one layer short of
being usable — and both stayed invisible for two phases, because the layer they stopped
at is the one nothing existed to call until now. Neither is a wrong answer that a test
agreed with, which is what M3's and M4's carry-overs were. These are right answers that
never reached a screen.

#### A column nothing could read

[BUILD-PLAN section 7](BUILD-PLAN.md) asks the report questionnaire to pre-fill the
location from where you last reported something, and M4 implemented the half of that
which lives in the database. `services/incident_service.py` has kept three columns
current on every successful create since then:

```python
reporter.last_building_id = building.id
reporter.last_floor_id = floor.id if floor is not None else None
reporter.last_seat_id = seat.id if seat is not None else None
```

`tests/integration/test_incidents.py` asserted it, and the assertion passed, because it
read the columns straight off the ORM object:

```python
db_session.refresh(employee)
assert employee.last_building_id == building.id
```

What no test asked was whether a **client** could see them — and none could. `UserRead`
does not carry them, `CurrentUserRead` inherits from `UserRead`, and `/auth/me` returns
`CurrentUserRead`. Three columns were written on every report, for a feature whose only
consumer had no way to read them.

The fix is three fields, and *where* they go is the interesting part:

```python
class CurrentUserRead(UserRead):
    """The caller's own record, with their engineer profile when they have one.

    The three `last_*_id` fields are on *this* model rather than on `UserRead`
    deliberately. They exist so the report questionnaire can pre-fill where you
    were the last time you reported something, which is only ever a question
    about yourself; an admin listing accounts has no business being told where
    each of them sits.
    """
```

`UserRead` is what `GET /users` returns to an admin, one row per account. Putting a
person's usual desk on that model would turn a user-administration screen into a seating
chart, which is not what anyone asked for and not something anyone consented to. The
accompanying test asserts the reachability rather than the column, which is what the
original test should have done:

```python
after = client.get("/api/v1/auth/me", headers=employee_headers).json()["user"]
assert after["last_building_id"] == str(building.id)
```

#### A timeline that printed a UUID at a person

The second was found by looking at the finished detail page, where the activity read:

```
Sam Senior   5m ago
Assigned: f6ac2cf4-0330-415e-a327-0af55964e5d6
```

`services/assignment.py` records an assignment like this, and it is right to:

```python
repository.add_event(
    session, incident_id=incident.id, actor_id=actor.id,
    event_type=EventType.ASSIGNED,
    from_value=str(previous_assignee_id) if previous_assignee_id else None,
    to_value=str(assignee.id),
)
```

An audit row should hold the **id**. A name can change; an id cannot, and an audit trail
that says "Assigned: Sam Senior" is ambiguous the day two people share a name or one of
them marries. The `from_value`/`to_value` columns are `str` because most events store a
word — `OPEN`, `HIGH` — and these two store an id.

So the recorded value is correct and unreadable, and `GET /activity` had been returning
it verbatim since M4. Nothing noticed, because until M6 nothing rendered it.

The fix is a **presentation** field rather than a change to what is stored:

```python
from_label: str | None = Field(
    default=None,
    description="Readable form of `from_value` when it is a user id.",
)
```

`incident_service.resolve_event_labels` collects every id the timeline refers to and
resolves them in **one** query — a ticket reassigned six times names at most a handful
of people, usually the same two — and the router fills the labels in alongside the raw
values. `ActivityTimeline` prefers the label and falls back to the value, so the audit
trail keeps its ids for anyone reading it as an audit trail.

This one has an epilogue worth keeping. The first version of the resolver's helper was
called `_as_uuid`, and `incident_service.py` already had a private `_as_uuid` two hundred
lines further down — one that *raises* when a value is not an id, because it narrows
something the schema has already guaranteed. Python took the later definition, and every
call to `/activity` on an assigned ticket answered `422 INVALID_ID`. Ruff did not catch
it: `F811` flags a redefinition of an **unused** name, and the first one had been used.
The helper is `_parse_user_id` now, and its docstring says why it is not the other one.

### 1. What was built

#### The API client — `src/api/`

M5 had `auth.ts` and `health.ts`. M6 adds one module per domain, mirroring
`app/routers/`, each a thin typed function per endpoint.

| File | Responsibility |
| --- | --- |
| [api/incidents.ts](../frontend/src/api/incidents.ts) | List, read, create, edit, transition, assign, pick up, escalate, clear escalation, activity. |
| [api/notes.ts](../frontend/src/api/notes.ts) | Writing notes. Reading them happens through `fetchActivity`, which merges them with events. |
| [api/categories.ts](../frontend/src/api/categories.ts) | The two-level tree, and an admin's edits to it. |
| [api/facilities.ts](../frontend/src/api/facilities.ts) | Buildings, floors, seats, the bulk insert, and the whole tree in one call. |
| [api/engineers.ts](../frontend/src/api/engineers.ts) | The roster, creation with its one-time password, and an engineer's own availability. |
| [api/users.ts](../frontend/src/api/users.ts) | Listing accounts, changing a role, deactivating. |
| [api/types.ts](../frontend/src/api/types.ts) | Grown from four interfaces to the twin of every Pydantic schema. |
| [api/queryKeys.ts](../frontend/src/api/queryKeys.ts) | Every cache key, as widening prefixes so one invalidation can cover a family. |

One change to an M5 file, and it is load-bearing:

```ts
export const apiClient = axios.create({
  // ...
  paramsSerializer: { indexes: null },
});
```

FastAPI reads a repeatable query parameter as `status=OPEN&status=CLOSED`. Axios's
default is `status[]=OPEN&status[]=CLOSED`, which arrives as a parameter the API has
never heard of and is silently ignored — a status filter that appears to work and
returns everything.

#### Presentation helpers — `src/display/`

| File | Responsibility |
| --- | --- |
| [display/labels.ts](../frontend/src/display/labels.ts) | Every enum's human wording, and the ordered lists filters offer. |
| [display/time.ts](../frontend/src/display/time.ts) | "2h ago" for a list, a full local date and time for a detail page. |
| [display/statusColor.ts](../frontend/src/display/statusColor.ts) | The status palette, shared by the chips and by the workflow buttons. |

Called `display/` and not the conventional `lib/` because the scaffold's `.gitignore`
blocks any directory named `lib` — line 18, a rule meant for Python build output. A
`src/lib/` would have type-checked, linted, passed its tests and never reached the
repository. See the gotchas.

#### Shared components — `src/components/`

| File | Responsibility |
| --- | --- |
| [StatusChip](../frontend/src/components/StatusChip.tsx), [PriorityChip](../frontend/src/components/PriorityChip.tsx), [EscalatedFlag](../frontend/src/components/EscalatedFlag.tsx) | A ticket's state, drawn the same way on every screen. |
| [ResponsiveDialog](../frontend/src/components/ResponsiveDialog.tsx) | Every dialog in the app. Full screen below 900 px. |
| [QueryState](../frontend/src/components/QueryState.tsx) | The loading, error and empty states, written once. |
| [PageHeader](../frontend/src/components/PageHeader.tsx) | One `h1` per screen, in the same place, with the screen's own actions. |
| [SnackbarContext](../frontend/src/components/SnackbarContext.ts) / [SnackbarProvider](../frontend/src/components/SnackbarProvider.tsx) | The app's one-line confirmations. Split for the same Fast Refresh reason `AuthContext` is. |

#### The questionnaire — `src/features/incidents/`

| File | Responsibility |
| --- | --- |
| [ReportPage.tsx](../frontend/src/features/incidents/ReportPage.tsx) | The five questions, revealing as each is answered. |
| [ReportSection.tsx](../frontend/src/features/incidents/ReportSection.tsx) | One numbered question. |
| [SelectableCard.tsx](../frontend/src/features/incidents/SelectableCard.tsx) | One choice in a grid of them, behaving as a radio button. |
| [LocationPicker.tsx](../frontend/src/features/incidents/LocationPicker.tsx) | Building, floor and seat, asked at the precision the category needs. |
| [CategoryIcon.tsx](../frontend/src/features/incidents/CategoryIcon.tsx) + [categoryIcons.ts](../frontend/src/features/incidents/categoryIcons.ts) | Turning `categories.icon` into a component. |
| [reportSchema.ts](../frontend/src/features/incidents/reportSchema.ts) | The title and description bounds, mirroring `app/schemas/incident.py`. |

#### The detail page — `src/features/incidents/`

| File | Responsibility |
| --- | --- |
| [IncidentDetailPage.tsx](../frontend/src/features/incidents/IncidentDetailPage.tsx) | The layout, the three queries, and which dialog is open. |
| [WorkflowStepper.tsx](../frontend/src/features/incidents/WorkflowStepper.tsx) | Where the ticket is in its life. Four steps; BLOCKED is not one of them. |
| [ActivityTimeline.tsx](../frontend/src/features/incidents/ActivityTimeline.tsx) | Events and notes as one stream, internal notes shaded and labelled, ids rendered as names. |
| [NoteComposer.tsx](../frontend/src/features/incidents/NoteComposer.tsx) | Adding a note, with the staff-only switch when the API allows one. |
| [IncidentActions.tsx](../frontend/src/features/incidents/IncidentActions.tsx) | `WorkflowButtons`, `ContextualButtons`, and the two shapes they render in. |
| [actionAvailability.ts](../frontend/src/features/incidents/actionAvailability.ts) | Whether a viewer has anything to do — read by both shapes and by the page reserving room for one. |
| [DetailsCard.tsx](../frontend/src/features/incidents/DetailsCard.tsx) | Who, where, when, and why it is blocked or closed. |
| [TransitionDialog.tsx](../frontend/src/features/incidents/TransitionDialog.tsx) | Exactly the fields `required_fields` named. |
| [AssignDialog.tsx](../frontend/src/features/incidents/AssignDialog.tsx) | Engineers by specialty then load, with the API's warnings. |
| [AssignButton.tsx](../frontend/src/features/incidents/AssignButton.tsx) | The same dialog, from a row in a list. |
| [EditIncidentDialog.tsx](../frontend/src/features/incidents/EditIncidentDialog.tsx), [EscalateDialog.tsx](../frontend/src/features/incidents/EscalateDialog.tsx), [ClearEscalationDialog.tsx](../frontend/src/features/incidents/ClearEscalationDialog.tsx), [PriorityDialog.tsx](../frontend/src/features/incidents/PriorityDialog.tsx) | The four actions that are not status changes. |

#### The lists — `src/features/incidents/`

| File | Responsibility |
| --- | --- |
| [IncidentsPage.tsx](../frontend/src/features/incidents/IncidentsPage.tsx) | All four ticket lists. They differ by one preset. |
| [useIncidentFilters.ts](../frontend/src/features/incidents/useIncidentFilters.ts) | The filters, stored in the URL and nowhere else. |
| [IncidentFilterBar.tsx](../frontend/src/features/incidents/IncidentFilterBar.tsx) | Inline on desktop, a bottom drawer on a phone. |
| [IncidentTable.tsx](../frontend/src/features/incidents/IncidentTable.tsx) | Eight columns and server-side sorting, for a desktop. |
| [IncidentCardList.tsx](../frontend/src/features/incidents/IncidentCardList.tsx) | The same tickets as cards, for a phone. |

#### The admin screens

| File | Responsibility |
| --- | --- |
| [features/facilities/FacilitiesPage.tsx](../frontend/src/features/facilities/FacilitiesPage.tsx) | A tree of buildings and floors, and the selected floor's seats. |
| [features/facilities/FacilityDialogs.tsx](../frontend/src/features/facilities/FacilityDialogs.tsx) | Building, floor, seat, and the bulk paste. |
| [features/categories/CategoriesPage.tsx](../frontend/src/features/categories/CategoriesPage.tsx) | Groups with their subcategories nested beneath. |
| [features/categories/CategoryDialog.tsx](../frontend/src/features/categories/CategoryDialog.tsx) | One dialog for four cases, showing only the fields that exist. |
| [features/engineers/EngineersPage.tsx](../frontend/src/features/engineers/EngineersPage.tsx) | The roster, and adding to it. |
| [features/engineers/EngineerRoster.tsx](../frontend/src/features/engineers/EngineerRoster.tsx) | The table both Engineers and Team render. |
| [features/engineers/TeamPage.tsx](../frontend/src/features/engineers/TeamPage.tsx) | A lead's view: who has room, then what needs an owner. |
| [features/engineers/TemporaryPasswordDialog.tsx](../frontend/src/features/engineers/TemporaryPasswordDialog.tsx) | The one-time password, with a copy button. |
| [features/engineers/CapacityBar.tsx](../frontend/src/features/engineers/CapacityBar.tsx) | How much of an engineer's soft limit is spoken for. |
| [features/users/UsersPage.tsx](../frontend/src/features/users/UsersPage.tsx) | Role changes and deactivation. |

#### The shell grows two controls

[TicketSearchField](../frontend/src/layout/TicketSearchField.tsx) and
[AvailabilityToggle](../frontend/src/layout/AvailabilityToggle.tsx), both desktop-only.
At 375 px the app bar holds a title and one control, and that control is the drawer
button — see M5's reasoning about which corner a thumb reaches.

#### Tests — 211 frontend and 12 end-to-end, up from 112 and none

| File | Count | What it pins down |
| --- | --- | --- |
| `features/incidents/IncidentActions.test.tsx` | 12 | That the actions come from the API — including a label the backend invented, rendered unchanged — and the two spellings of assign. |
| `features/incidents/TransitionDialog.test.tsx` | 10 | Which inputs each `required_fields` list produces, the conditional duplicate field, and a 422 landing on the input the API named. |
| `features/incidents/useIncidentFilters.test.tsx` | 14 | The URL round trip, an unreadable value being ignored, paging reset, and a preset that cannot be filtered away. |
| `features/incidents/ReportPage.test.tsx` | 9 | The progressive reveal, changing a group clearing its subcategory, which location fields each `location_detail` asks for, and what is posted. |
| `features/incidents/LocationPicker.test.tsx` | 9 | The three precision levels, the "Room" relabelling, and the cascade that clears a stale floor or seat. |
| `features/incidents/WorkflowStepper.test.tsx` | 9 | Four steps, blocked as an error state on the second, and the reopen count. |
| `features/engineers/sortForAssignment.test.ts` | 6 | Specialty before load, load before name, and that someone on leave stays in the list. |
| `features/incidents/ActivityTimeline.test.tsx` | 10 | That a status change reads in words, that an assignment names a person rather than printing their id, and that an internal note is labelled. |
| `display/labels.test.ts`, `display/time.test.ts` | 19 | That no raw enum reaches a screen, that an absent timestamp renders as an em dash rather than "Invalid Date", and which transition destinations are coloured. |
| `layout/AppShell.test.tsx` | +1 | That the report FAB is absent on the report page — M5's file, one row added. |
| `e2e/lifecycle.spec.ts` | 1 × 2 widths | The acceptance criterion, end to end, in a browser. |
| `e2e/assignment.spec.ts` | 1 | The assign-and-close branch, plus escalation. |
| `e2e/responsive.spec.ts` | 5 × 2 widths | The geometry jsdom cannot see. |

Added to `package.json`: `@playwright/test` and `@types/node`, both dev-only. No new
runtime dependency — the bundle grows because there are sixty more components, not
because anything was installed.

### 2. Why it is shaped this way

#### Two API answers decide what every persona sees

The incident detail page is one component. An employee, an engineer and an admin opening
the same ticket get the same JSX, and what differs is the data:

```tsx
<WorkflowButtons transitions={transitions.data ?? []} ... />
{incident.can_escalate ? <Button ...>Escalate</Button> : null}
```

`allowed-transitions` returns the moves this caller can make *now*, each with the label
to print on its button. The `can_*` flags on `GET /incidents/{id}` cover everything that
is not a status change. There is no role check in the page, no status check, no table
mapping "reporter + RESOLVED" to "Confirm fixed".

Follow what that buys. `workflow.py` has two rows from RESOLVED to CLOSED, split by
actor: the reporter's is labelled "Confirm fixed" and records `CONFIRMED_FIXED`, the
assignee's is labelled "Close ticket" and records `CLOSED_BY_ENGINEER`. The frontend
knows about neither. Each user's browser asks what it may do and prints the answer, and
the two of them see different buttons on the same screen because the API sent different
lists.

The same holds for the dialog. `TransitionDialog` renders inputs from
`transition.required_fields`:

```tsx
const requires = (field: string) => transition.required_fields.includes(field);
// ...
{requires('resolution_summary') ? <TextField label="What did you do?" ... /> : null}
```

Adding `"reason"` to the OPEN → IN_PROGRESS row of `app/workflow.py` would make that
dialog collect a reason, with no React change at all.

**Rejected:** a `TRANSITIONS` constant in the frontend mirroring the backend's, the way
`features/auth/schemas.ts` mirrors the password length. The distinction M5 drew holds
here: a length bound is a constant and a workflow is a decision. A mirrored constant
that drifts produces a server error on a field the form thought was fine — visible and
recoverable. A mirrored workflow that drifts produces a button that 409s, or worse, a
button that is *missing* for someone entitled to press it, which nobody reports because
it looks like the feature does not exist.

#### The one rule the UI does read: which spelling of "assign"

`ContextualButtons` has exactly one line that is not a `can_*` flag:

```tsx
const canPickUp = incident.can_assign && user.role === 'ENGINEER' && !incident.assignee;
```

This deserves explaining, because it looks like the thing the previous section says not
to do.

`assignment.can_assign` means "may change this ticket's assignee at all". It is true for
an admin, for a LEAD, and for a SENIOR on an unassigned open ticket — the last because
they may pick it up, even though they may not hand it to anyone else. So one flag covers
two different buttons, and something has to choose between them.

What it does **not** do is re-derive a permission. `can_assign` is still the gate;
`role === 'ENGINEER'` and "has no assignee" only pick the spelling. A JUNIOR never
reaches this line with a true flag. And a SENIOR who opens the full dialog and picks
somebody else is refused **by the API**, with the message `services/assignment.py`
writes, shown in the dialog. Copying "only a LEAD may assign others" into the page to
pre-empt that would be the second copy of a rule, for the sake of avoiding an error that
explains itself.

#### BLOCKED is not a step

`WorkflowStepper` has four steps — Open, In progress, Resolved, Closed — and renders
BLOCKED as the "In progress" step in an error state, with the reason beneath it.

A fifth column would say something false. It would imply a ticket passes *through*
blocked on its way to resolved, when `workflow.py` only ever goes back to IN_PROGRESS
from it:

```
IN_PROGRESS → BLOCKED    "Mark blocked"
BLOCKED     → IN_PROGRESS "Resume work"
```

Blocked is in-progress work that has stalled, and drawing it as a stage between starting
and finishing is the wrong mental model in a picture whose whole job is to convey the
model.

The reopen count sits outside the stepper for the mirror-image reason. A ticket reopened
twice has walked back through steps it had already completed, and the stepper shows only
where it is now — so "In progress" on a twice-reopened ticket would look like a ticket
nobody has ever finished. `Reopened ×2` under it says what the four steps cannot.

#### One list component, four screens

My Tickets, All Tickets, My Queue and Unassigned differ by a title, a sentence, and one
or two API filters:

```tsx
<IncidentsPage
  title="My queue"
  preset={{ mine: 'assigned' }}
  ...
/>
```

The `preset` is spread **after** the user's filters in `toQuery`, so it cannot be
filtered away: My Queue narrowed to OPEN is still My Queue.

Four components would have been four places to fix a column, four filter bars, four
paging controls — and the three that are not the one someone is currently looking at
would get the fix late or not at all.

#### Filters live in the URL, and only in the URL

```ts
const [searchParams, setSearchParams] = useSearchParams();
const filters = useMemo<IncidentFilters>(() => ({ ... }), [searchParams]);
```

There is no `useState` mirroring this. The address bar *is* the state, so the back
button, a reload and a pasted link all produce the same screen, and there is no second
copy to fall out of step.

The practical reason is that a filtered list is a thing people send each other — "the
blocked tickets in SFO-1" should be a link — and the structural reason arrives in M7,
when the dashboard's chart segments and KPI tiles become links into exactly these views.
A chart that can only say "there are 14 blocked tickets" is a worse chart than one whose
bar you can click.

The search box is the single exception, and it holds a local copy because a request per
keystroke would put a full-text query on the database for every letter. It is
reconciled with the URL **during render** rather than in an effect:

```tsx
if (filters.q !== termFromUrl) {
  setTermFromUrl(filters.q);
  setSearch(filters.q);
}
```

React re-runs the component before touching the DOM, so there is no flash of the stale
term and no second render pass. An effect would produce both, and
`react-hooks/set-state-in-effect` says so.

#### A table and a card list, not one responsive table

The desktop list has eight columns. At 375 px those are either unreadable or a
horizontal scroll that hides half of them, so the phone gets
[IncidentCardList](../frontend/src/features/incidents/IncidentCardList.tsx) instead —
four facts per card, the whole card a link, a target a thumb can hit.

They page differently, and that is deliberate rather than an oversight. A table has
numbered pages; a card list has "Load more", because scrolling and then losing your
place to a page control is the wrong feel on a phone. So the screen calls both hooks and
lets `enabled` decide which one fetches:

```tsx
const paged = useIncidents(query, !isMobile);
const accumulated = useIncidentsInfinite(query, isMobile);
```

Both are called on every render so the hook order never changes when the viewport
crosses 900 px — a conditional hook is a crash, not a layout bug.

**Rejected:** `@mui/x-data-grid`, which BUILD-PLAN section 10 suggests. It brings column
resizing, density controls and virtualisation, none of which a 25-row page needs, at a
package size comparable to the rest of the application — and M5's notes already flag the
bundle as one to watch. It would also have solved only the desktop half, leaving the
card list to be written anyway.

#### The timeline is built by hand

BUILD-PLAN section 10 asks for MUI's `Timeline`. It lives in `@mui/lab`, whose only
release compatible with Material UI 9 is `9.0.0-beta.9`. A whole additional package, at
beta, in a project graded on stability, for a vertical rule and a column of dots — the
component is about sixty lines of `Box` without it.

What the hand-built version does carry is the thing that matters: INTERNAL notes are
shaded, bordered and labelled "Internal". Note that this is **presentation only**. An
employee's `/activity` response contains no internal notes to hide, because
`services/visibility.py` filters them in the query. If one reaches this component, the
viewer is entitled to it.

#### `useState` in the questionnaire, react-hook-form everywhere else

Every other form in the app uses react-hook-form with a zod resolver, which is the house
pattern from M5. The report questionnaire does not, and the reason is what
react-hook-form is *for*: keeping values out of React state so typing in one field does
not re-render the form.

This form is the opposite case. Four of its five answers decide what is **shown** next —
choosing a group reveals its subcategories, choosing a subcategory reveals the location
fields that group requires — so all four have to be watched, and watching them
re-renders exactly as much as `useState` does. What would be left is `Controller`
wrappers around four card grids that are not `<input>`s at all.

The zod schema is kept for the two fields that *are* ordinary text, and the API's 422
maps onto the inputs by field name exactly as it does on the auth screens.

#### The questionnaire asks what the category says to ask

`LocationPicker` decides which of building, floor and seat to show from the group's
`location_detail`, which is a column an admin edits on the Categories screen:

| `location_detail` | Building | Floor | Seat |
| --- | --- | --- | --- |
| BUILDING | required | behind "Add more detail" | behind "Add more detail" |
| FLOOR | required | required | optional |
| SEAT | required | required | required |

And it relabels the seat field "Room" for meeting rooms, filtering to
`seat_type = MEETING_ROOM`, because a room problem reported against a desk is the wrong
question asked twice.

The three fields are one component rather than three because they are not independent: a
floor only exists inside a building, a seat only inside a floor, and changing a building
has to clear both. Split into three, that cascade would live in whichever parent used
them — which is two parents, since the edit dialog uses the same picker.

`services/incident_service.py` enforces all of it again, and its 422 names the field.
This component decides what to *ask*; it never decides what is valid.

#### Two workflow buttons are coloured, and the rest deliberately are not

This one went through three versions, and the middle one is the instructive part.

**First**, every transition button was `contained` and primary. That put a large blue
**Cancel ticket** in an employee's actions card, because on their own open ticket it is
the only move `allowed-transitions` offers them. Cancel read as the recommendation.

**Second**, the button took the colour of the status it produces, reusing the chip
palette in `display/statusColor.ts` — so "Resolve" was the green of the Resolved chip
and "Cancel ticket" the neutral grey of Closed. Looking at the result showed the
problem. A reporter on a *resolved* ticket sees two buttons: **Confirm fixed** (→ CLOSED)
and **Still broken** (→ IN_PROGRESS). Outcome colouring drew the happy path grey and
the complaint blue. It had traded one mis-emphasis for its mirror image.

**Third**, and current:

```ts
export function transitionButtonColor(toStatus: IncidentStatus): ButtonProps['color'] {
  if (toStatus === 'RESOLVED') return 'success';
  if (toStatus === 'BLOCKED') return 'warning';
  return 'primary';
}
```

Only two destinations mean the same thing to everyone. **Resolve** is always "I have
fixed it"; **Mark blocked** is always "this has stalled". Those two get the colour of
their outcome, and it is real information.

CLOSED is the one that cannot be coloured, because a single (from, to) pair carries
different meanings for different actors — `RESOLVED → CLOSED` is "Confirm fixed" to the
reporter and "Close ticket" to the assignee, and `OPEN → CLOSED` is "Cancel ticket". A
happy path and a discard share a destination. Telling them apart in the frontend means
keeping a copy of `app/workflow.py` there, which is the thing this application spends
the most effort not doing.

So the ambiguous case is left plain rather than confidently mis-coloured, and the label
— which the API supplies — does the work. `statusChipColor` stays as it was: that is the
palette from BUILD-PLAN section 10, and it is about what a ticket *is*, not about what a
button will do to it.

#### The admin screens each take the shape of their data

**Facilities** is two panes because the data is a tree whose leaves are a table. A floor
has forty desks; forty desks nested inside an expander is a scroll, not a list. The tree
answers "where am I" and the table answers "what is here". The whole hierarchy arrives
in one `GET /facilities/tree`, so expanding a building and selecting a floor are both
instant — a facility is tens of rows, and paginating it would cost a request per click
and buy nothing.

**Categories** nests subcategories under their groups because the nesting *is* the
model, and because it is the order the questionnaire asks the two questions in. An
accordion per group mirrors what a reporter sees, and "which group is this under?" never
has to be asked.

**Engineers** ends its create flow in a dialog rather than a snackbar. The temporary
password exists in that one response and nowhere else — the database holds a bcrypt hash
— so a confirmation that disappears after five seconds is the wrong container for the
only copy of a credential. It is rendered monospaced, where `l` and `1` are
distinguishable, with a copy button, because an admin retyping it into a chat window is
how a working account becomes a support ticket.

**Users** offers two controls per row because two is what the API allows. Email is the
sign-in identity and the key every audit trail is read by, so changing it would be an
account migration; a password can only be set by its owner. The controls are disabled on
your own row, matching `_reject_self_change` — locking the last admin out is the failure
with no recovery path from inside the application.

#### "Remove", never "Delete"

Every destructive button on the admin screens says Remove, and reports what actually
happened:

```tsx
const result = await deleteCategory.mutateAsync(category.id);
notify(result.detail, result.deactivated ? 'warning' : 'success');
```

`DeleteResult` carries `deleted` and `deactivated` separately because the API does one
or the other depending on whether anything references the row. A category an incident
was filed under is deactivated so that ticket keeps its category. Labelling the button
"Delete" would promise something the system deliberately does not always do.

#### Mutations invalidate a whole prefix

```ts
function invalidateIncidents(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.incidents.all });
}
```

`['incidents']` is the prefix of every incident key — the lists, the detail, the
allowed transitions, the activity — and TanStack Query matches by prefix, so one call
re-reads all of them.

That is broader than strictly necessary and it is the right default here. A single
transition can change the ticket, the moves available on it, its activity **and** its
membership of any list filtered by status. Working out which of those a given move
touched would put the workflow's side effects in a second place, which is the thing this
codebase spends the most effort not doing. The exception is assignment, which also
invalidates `['engineers']`, because `active_ticket_count` has just changed for two
people and every capacity bar drawn from it is stale.

#### Playwright, and what it is for

The Vitest suite runs in jsdom, which parses HTML and runs JavaScript but has no layout
engine. Every `getBoundingClientRect()` it returns is zero by zero. So
`AppShell.test.tsx` can prove that at a stubbed 375 px the shell *decides* to render a
bottom bar — a real and useful assertion — and can prove nothing about whether the
result is usable at 375 px, because nothing is laid out at all.

That is the first reason. The second is more pointed: **three defects in this project
were visible only over HTTP.** M5's refresh-reuse rollback passed its test suite and
failed against a real server, because the test client shares one session where
production gives each request its own. The same class of gap is why
`tests/conftest.py` sets `expire_on_commit=False`.

So M6 adds real-browser tests, and they found a fourth. See the gotchas.

**Two projects, one viewport each.** 1440×900 and 375×812, the two widths BUILD-PLAN
section 10 names. The mobile project uses a plain viewport rather than
`devices['iPhone 13']`, because a device preset also brings touch emulation and a mobile
user agent — and a failure under all three at once is ambiguous about which caused it.
The layout switch is on width alone.

**Three browser contexts, not one page signing in and out.** Each context has its own
cookie jar, so the employee's session and the engineer's session exist simultaneously
and a test moves between them in one statement. Signing out and in between every step
would work, and would mean a bug in `POST /auth/logout` failing a test about resolving a
ticket.

**Accounts are created through the API, per worker, with a unique suffix.** Not through
the database, because a fixture that writes rows directly can produce states the
application cannot — and then the test proves something about a state that never occurs.
Not through the UI, because sign-up and engineer creation have their own tests, and
re-driving them at the top of every lifecycle test would make a failure there look like
a failure here. They are deactivated on teardown; the tickets they created stay, because
they are ordinary data.

**Queries are by role and visible text**, never by CSS class or position. A test that
clicks `.MuiButton-root:nth-child(2)` passes after a change that moves the button
somewhere useless. There is exactly one `data-testid` in the application, on the detail
page's status chip, and it exists because "In progress" appears twice on that page — in
the chip and as the stepper's current step — so "what status is this ticket?" has no
unambiguous accessible query. The alternative is a test that knows which match comes
first, which is a test that breaks on a layout change.

### 3. How the pieces connect

**Resolving a ticket.** The trace worth knowing, because it touches the workflow, the
two API answers the UI is built from, and the cache.

```
Engineer presses "Resolve" on /tickets/<id>
  │
  ├─ IncidentActions.WorkflowButtons
  │     the button exists because GET /allowed-transitions returned
  │     {to_status: "RESOLVED", action_label: "Resolve",
  │      required_fields: ["resolution_summary"]}
  │     its colour is transitionButtonColor("RESOLVED") -> success, because
  │     "Resolve" means the same thing to every actor
  │  onTransition(transition)
  │
  ├─ IncidentDetailPage        setDialog({kind: 'transition', transition})
  ├─ TransitionDialog          requires('resolution_summary') -> true
  │                            renders one field: "What did you do?"
  │                            (no table here maps Resolve to that field —
  │                             required_fields did)
  │  submit
  │
  ├─ useTransition(id).mutateAsync({to_status: 'RESOLVED', resolution_summary})
  │  └─ api/incidents.performTransition
  │       POST /api/v1/incidents/<id>/transitions
  │         apiClient request interceptor -> Authorization: Bearer ...
  │         │
  │         ├─ routers/incidents.create_transition
  │         ├─ incident_service.perform_transition
  │         │    workflow.resolve_actors(incident, user) -> {ASSIGNEE}
  │         │    workflow.select_transition(IN_PROGRESS, RESOLVED, {ASSIGNEE})
  │         │      -> the row whose allowed_actors contains ASSIGNEE
  │         │    _require_transition_fields  resolution_summary present ✓
  │         │    _apply_transition_effects   status = RESOLVED, resolved_at = now
  │         │    repository.add_event        STATUS_CHANGED, IN_PROGRESS -> RESOLVED
  │         └─ session.commit()
  │       <- 200 IncidentRead
  │
  ├─ onSuccess: invalidateQueries({queryKey: ['incidents']})
  │     prefix match, so all four re-fetch:
  │       ['incidents','detail',id]                     -> status RESOLVED,
  │                                                        can_add_note still true
  │       ['incidents','detail',id,'allowed-transitions']
  │                                                     -> now "Confirm fixed" for
  │                                                        the reporter, "Close
  │                                                        ticket" for this engineer
  │       ['incidents','detail',id,'activity']          -> the new event
  │       ['incidents','list',{...}]                    -> the row's status column
  │
  ├─ notify('INC-000482: resolve.')                 snackbar, top on a phone
  └─ re-render
       StatusChip              success/green
       WorkflowStepper         activeStep 2, steps 0–1 completed
       ActionsCard             the buttons the *new* allowed-transitions returned
```

The step to notice is the second query. The engineer did not tell the page what to
offer next; the page asked again and got a different answer, and it would have got a
different one still if a reporter were looking at the same screen.

**Reporting an issue**, which is where the category tree drives the form:

```
/report
  ├─ useCategoryTree()     GET /categories        cached 1 hour (reference data)
  ├─ useFacilityTree()     GET /facilities/tree   cached 1 hour
  │
  ├─ step 1  group cards from tree.groups, icon via categoryIcons.ts
  │     click "Hardware"  ->  setGroupId, setCategoryId(null)
  ├─ step 2  revealed: group.children
  │     click "Monitor"   ->  setCategoryId
  ├─ step 3  revealed: LocationPicker, locationDetail = group.location_detail
  │     Hardware is FLOOR -> building and floor required, seat optional
  │     pre-filled from user.last_building_id / last_floor_id / last_seat_id
  ├─ step 4  revealed once the location is complete for that detail level
  ├─ step 5  revealed once title and description are non-blank
  │
  └─ submit
       reportTextSchema.safeParse  -> field errors, or
       POST /api/v1/incidents
         incident_service.create_incident
           subcategory, not a group                       else 422 category_id
           location matches the group's location_detail    else 422 floor_id/seat_id
           reporter.last_*_id = this location              <- the carry-over above
       <- 201 IncidentRead
       notify('INC-000482 created.')
       navigate('/tickets/<id>')
```

**Filtering a list**, which is shorter and lives entirely in the URL:

```
User ticks "Blocked" in the status filter
  ├─ IncidentFilterBar  setFilters({statuses: ['BLOCKED']})
  ├─ useIncidentFilters  builds URLSearchParams, page resets to 1
  │                      setSearchParams(params, {replace: true})
  ├─ the URL is now /tickets?status=BLOCKED
  ├─ useSearchParams re-renders IncidentsPage
  ├─ toQuery(filters, preset) -> {status: ['BLOCKED'], sort: '-created_at', page: 1, ...}
  ├─ useIncidents(query)  key ['incidents','list',{...}] — a new key, so a fetch
  │     GET /api/v1/incidents?status=BLOCKED&sort=-created_at&page=1&page_size=25
  │       paramsSerializer {indexes: null} — NOT status[]=BLOCKED, which FastAPI
  │       would ignore, returning every ticket and looking like a broken filter
  └─ IncidentTable re-renders

  ...and the URL is now something the user can send to someone else.
```

### 4. Where the rules live

| Rule | File |
| --- | --- |
| Which workflow buttons a user sees | `GET /incidents/{id}/allowed-transitions`, rendered by [IncidentActions.tsx](../frontend/src/features/incidents/IncidentActions.tsx) |
| What a workflow dialog collects | `required_fields` on that response, rendered by [TransitionDialog.tsx](../frontend/src/features/incidents/TransitionDialog.tsx) |
| Which non-workflow actions a user sees | the `can_*` flags on `GET /incidents/{id}` |
| Which spelling of assign — "Pick up" or "Assign…" | [IncidentActions.tsx](../frontend/src/features/incidents/IncidentActions.tsx) — `can_assign` plus the role, presentation only |
| Whether a ticket is blocked, and why | rendered by [WorkflowStepper.tsx](../frontend/src/features/incidents/WorkflowStepper.tsx); decided by `app/workflow.py` |
| Which location fields the questionnaire asks for | the group's `location_detail`, applied in [LocationPicker.tsx](../frontend/src/features/incidents/LocationPicker.tsx) |
| Which location fields are **valid** | `app/services/incident_service.py` — the 422 is the authority |
| Whether a seat is called "Desk" or "Room" | [display/labels.ts](../frontend/src/display/labels.ts) — `seatFieldLabel` |
| Title and description bounds, client side | [reportSchema.ts](../frontend/src/features/incidents/reportSchema.ts) |
| Title and description bounds, **authoritatively** | `app/schemas/incident.py` |
| Who may read an INTERNAL note | `app/services/visibility.py`, in the query. The timeline only styles them |
| What an audit event *records* | `app/services/assignment.py` and `incident_service.py` — ids, because a name can change |
| What an audit event *reads as* | `incident_service.resolve_event_labels` fills `from_label`/`to_label`; `ActivityTimeline` prefers them |
| What a status is called, and what colour it is | [display/labels.ts](../frontend/src/display/labels.ts), [display/statusColor.ts](../frontend/src/display/statusColor.ts) |
| What colour a workflow button is | `display/statusColor.ts` — `transitionButtonColor`, which colours only the two unambiguous destinations |
| What a list is filtered by | the URL query string, read by [useIncidentFilters.ts](../frontend/src/features/incidents/useIncidentFilters.ts) |
| What a list screen is *for* | the `preset` prop in [App.tsx](../frontend/src/App.tsx) |
| Which rows a list may show at all | `app/services/visibility.py` — `apply_incident_visibility`, before any user filter |
| How engineers are ordered in the assign dialog | [features/engineers/hooks.ts](../frontend/src/features/engineers/hooks.ts) — `sortForAssignment` |
| Who may actually be assigned | `app/services/assignment.py`. The dialog offers; the API decides |
| Whether a delete deletes or deactivates | the API's `DeleteResult`, reported by the screen |
| Which cache entries a mutation invalidates | the feature's `hooks.ts`, keyed through [api/queryKeys.ts](../frontend/src/api/queryKeys.ts) |
| Which icons a category may use | [features/incidents/categoryIcons.ts](../frontend/src/features/incidents/categoryIcons.ts) |
| Where a dialog is full screen | [components/ResponsiveDialog.tsx](../frontend/src/components/ResponsiveDialog.tsx) — one place, so no screen forgets |
| Where confirmations appear | [components/SnackbarProvider.tsx](../frontend/src/components/SnackbarProvider.tsx) — top on a phone, bottom on desktop |

### 5. How to change it

**To add a workflow transition** — still one row and one test, and now no frontend
change at all:

1. `backend/v1/app/workflow.py`: add a `Transition` to `TRANSITIONS`.
2. `backend/v1/tests/unit/test_workflow.py`: the suite parametrises over `TRANSITIONS`,
   so add the allowed and denied actor cases.
3. Nothing else. The button appears with its `action_label`, coloured by its
   `to_status`, and `TransitionDialog` collects whatever `required_fields` names — as
   long as the field is one of the five it knows how to render. A genuinely new field
   needs a sixth branch there and a field on `TransitionRequest`.

**To add a field to a ticket** — five files, in this order:

1. `app/models/incident.py` and an Alembic revision.
2. `app/schemas/incident.py`: the create, update and read models.
3. `app/services/incident_service.py`: whatever validates it.
4. [api/types.ts](../frontend/src/api/types.ts): the twin on `Incident`.
5. The screens: [ReportPage.tsx](../frontend/src/features/incidents/ReportPage.tsx) to
   collect it, [DetailsCard.tsx](../frontend/src/features/incidents/DetailsCard.tsx) to
   show it, [EditIncidentDialog.tsx](../frontend/src/features/incidents/EditIncidentDialog.tsx)
   to correct it.

**To add a list filter** — four places, all small:

1. `app/routers/incidents.py`: the query parameter, on `get_incident_query`.
2. `app/repositories/incidents.py`: the `WHERE` clause.
3. [api/incidents.ts](../frontend/src/api/incidents.ts): the field on `IncidentQuery`.
4. [useIncidentFilters.ts](../frontend/src/features/incidents/useIncidentFilters.ts):
   read it from `searchParams`, write it back in `setFilters`, count it in
   `activeCount`; then a control in
   [IncidentFilterBar.tsx](../frontend/src/features/incidents/IncidentFilterBar.tsx).

**To add a ticket list screen**: a `<Route>` rendering `<IncidentsPage>` with a
`preset`, plus a path in [routes.ts](../frontend/src/routes.ts) and an item in
[navigation.ts](../frontend/src/layout/navigation.ts). No new list component.

**To add a category icon**: one entry in
[categoryIcons.ts](../frontend/src/features/incidents/categoryIcons.ts). It appears in
the admin's picker automatically, because `CATEGORY_ICON_NAMES` is the table's keys.

**To add an end-to-end test**: a file in `frontend/e2e/`, importing `test` from
`./fixtures/test` rather than from `@playwright/test` — that is what supplies the three
signed-in pages. Use the helpers in `fixtures/ticket.ts` to reach a state rather than
re-driving the questionnaire by hand.

**To run the end-to-end tests against a different stack**: `E2E_BASE_URL` for the
origin, `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` for the account that creates
engineers. The suite reuses an already-running dev server and starts one if there is
none.

### 6. Gotchas

**The first thing Playwright found was a snackbar sitting on the controls.** The mobile
lifecycle test failed at "Start work" with Playwright's clearest possible message:

```
<div class="MuiSnackbarContent-root"> intercepts pointer events
```

The engineer had just pressed "Pick up", which confirms with a snackbar. The snackbar
was anchored bottom-centre with `bottom: 72px` — clear of the shell's 56 px bottom
navigation, which is what it was written for — and the incident detail page's sticky
action bar sits at `bottom: 56px`, in exactly that space. "You have picked this ticket
up" covered "Start work".

Every jsdom test passed. They always would: jsdom has no layout, so nothing can overlap
anything, and a `fixed` element is just a `<div>` in the tree.

The fix moves the snackbar to the **top** on a phone:

```tsx
anchorOrigin={
  isMobile
    ? { vertical: 'top', horizontal: 'center' }
    : { vertical: 'bottom', horizontal: 'center' }
}
```

Material Design puts snackbars at the bottom, and this deliberately does not, because on
a phone this application puts its *controls* at the bottom — the navigation bar, the
report FAB, and the detail page's action bar. A confirmation that covers the buttons it
is confirming is worse than no confirmation at all.

**`lib/` is gitignored by the scaffold.** Line 18 of `.gitignore`, a rule from the
standard Python template meant for `build/lib/`, matches a directory named `lib`
anywhere in the tree — including `frontend/src/lib/`. The presentation helpers were
written there first. They type-checked, linted, passed their tests and were invisible to
`git add`; the only symptom was `git status` staying quiet.

They live in `src/display/` now. If a future phase wants the conventional `src/lib/`,
the fix is a negation in `.gitignore` — but renaming avoided editing scaffold config
for a directory name.

**Axios sends `status[]=OPEN` unless you tell it not to.** FastAPI reads a repeatable
query parameter as `status=OPEN&status=CLOSED`; axios's default serialisation is
`status[]=OPEN&status[]=CLOSED`, which arrives as a parameter the API does not declare
and is silently dropped. The filter does nothing and the list returns everything, which
looks like a filter that "isn't working yet" rather than a bug. `paramsSerializer:
{ indexes: null }` on the shared client fixes it for every caller.

**MUI puts the required asterisk in the accessible name.** A required `TextField`
labelled "Building" has the accessible name `"Building *"`, so
`getByLabel('Building', { exact: true })` finds nothing. The first version of the
Playwright helper did exactly that, skipped the field because its "is it visible?"
check said no, and failed three steps later on a form that had never been filled in.
Match labels as a prefix, and make a field that must exist assert its own presence
rather than skipping quietly.

**`getByRole('button')` matches the `SelectableCard`s.** The questionnaire's group,
subcategory and priority cards are `ButtonBase` with `aria-pressed`, which is correct —
a card that behaves as a radio button should be reachable by keyboard and announced as
pressed — but it means `getByRole('button', { name: 'Monitor' })` matches a card, and
`{ name: /^Hardware/ }` is needed because a group card's accessible name includes its
hint.

**The mobile bottom navigation items are buttons, not links.** `AppShell` drives them
through `BottomNavigation`'s `onChange` and `navigate`, so there is no anchor element.
`getByRole('link', { name: 'Home' })` finds the *drawer's* link on mobile and nothing in
the bottom bar.

**`@mui/lab` has no stable release for Material UI 9.** `Timeline`, `TreeView` and the
rest are on `9.0.0-beta.x`. Anything reaching for them should either build the thing by
hand — as `ActivityTimeline` does — or accept a beta dependency deliberately.

**MUI v9 renames icons, and the error does not say so.** M5 recorded this for
`AddCircleOutline`; M6 hit it twice more. `HelpOutline` is `HelpOutlined` and
`ChatBubbleOutline` is `ChatBubbleOutlineOutlined`. The failure is TypeScript's "cannot
find module", which reads like a missing package.

**A capitalised local holding a component trips `react-hooks/static-components`.**
`CategoryIcon` looks up a component from a table and renders it. Written as
`const Icon = lookup(name); return <Icon {...props} />` the rule objects, because it
cannot tell a lookup from a definition — and defining a component during render really
does remount its subtree on every keystroke. `createElement(lookup(name), props)` says
what is actually happening.

**Playwright's fixture parameter must be a destructuring pattern**, even an empty one:
Playwright reads the source of that parameter to work out which fixtures a function
depends on. `async ({}, provide, workerInfo) => {}` is required and
`no-empty-pattern` objects, hence the one `eslint-disable-next-line` in `e2e/`. The
second parameter is renamed from Playwright's `use` to `provide` for a related reason:
a function called `use` outside a component trips `react-hooks/rules-of-hooks`.

**The end-to-end suite writes to the development database.** It creates accounts with a
unique suffix, creates tickets, and deactivates the accounts afterwards — it never drops
or truncates anything, and the tickets stay. That is a deliberate difference from the
pytest suite, which recreates `acme_incidents_test` on every run. Point it elsewhere
with `E2E_BASE_URL` if that matters.

**Two queries on every list screen, one of them idle.** `useIncidents` and
`useIncidentsInfinite` are both called on every render, with `enabled` deciding which
fetches. That is not waste — a disabled query issues no request — and it is what keeps
the hook order stable when a window is resized across 900 px. A conditional hook is a
crash, not a layout glitch.

**A private helper can shadow another one two hundred lines away.** `incident_service.py`
now has `_parse_user_id` and `_as_uuid`, which do nearly opposite things — one answers
None for a value that is not an id, the other raises. The first version of the former was
also called `_as_uuid`, Python took the later definition, and every call to `/activity`
on an assigned ticket answered `422 INVALID_ID`. Ruff's `F811` did not fire, because it
flags a redefinition of an *unused* name and the first had been used. In a module this
size, check before naming a private helper.

**The bundle has grown.** M6 adds no runtime dependency, and the JavaScript still grows
because there are now sixty more components. Route-level `React.lazy` remains the lever,
and the admin screens remain the natural split point; M7 adds `@mui/x-charts`, which is
when it will matter.

### 7. Glossary

**End-to-end test** — a test that drives the real application in a real browser against
a real server and a real database, rather than rendering a component in isolation. It is
the only kind that can catch two correct things overlapping.

**Playwright** — the browser automation library these tests use. It drives Chromium,
waits for elements rather than sleeping, and fails with the reason — including "this
other element intercepts pointer events", which is how the snackbar defect announced
itself.

**Browser context** — an isolated browser session: its own cookies, its own storage. The
tests give each persona one, so three people can be signed in at once.

**Fixture** — in Playwright, a value a test declares in its arguments and the framework
supplies. `worker` scope means once per parallel worker; the default is once per test.

**Viewport** — the size of the browser window's content area. The two projects set 1440
× 900 and 375 × 812, and nothing else differs between them.

**`getByRole`** — Playwright's and Testing Library's preferred query: find the element by
what it *is* to an assistive technology ("a button named Resolve") rather than by class
or position. A test written this way breaks when the interface becomes unusable, which
is when it should.

**`data-testid`** — an attribute added purely so a test can find something. Used once
here, on the detail page's status chip, because two elements on that page legitimately
have the same accessible text.

**Progressive disclosure** — showing the next question only once the previous one is
answered, on one page. Distinct from a wizard, which puts each step on its own page and
makes going back a navigation.

**`useSearchParams`** — React Router's hook for the URL query string, read and written
like state. Using it *as* the state is what makes a filtered list bookmarkable.

**TanStack Query key** — the array identifying a cached query. Keys nest, so
`['incidents']` is a prefix of `['incidents', 'detail', id]` and invalidating the former
invalidates the latter.

**Invalidation** — marking cached data stale so it is re-fetched. The alternative is
writing the new value into the cache by hand, which means the client reconstructing what
the server just did.

**`useInfiniteQuery`** — TanStack Query's hook for "load more": it keeps the pages
fetched so far and appends the next one, rather than replacing.

**Optimistic** — updating the interface before the server confirms. The availability
select does this in appearance only, reverting on failure, because a control that does
nothing for 300 ms reads as broken.

**Debounce** — waiting for a pause in typing before acting. The list's search box waits
350 ms, so a five-letter query is one full-text search rather than five.

**Soft limit** — a bound that warns rather than refuses. `max_active_tickets` is one:
assigning past it succeeds and returns a warning, because an admin who has decided to
overload a lead is making a judgement the system should record, not overrule.

**Sticky / fixed positioning** — CSS that takes an element out of the page's flow and
pins it to the viewport. The phone's action bar is `fixed`, which is why the detail page
reserves the height it occupies — otherwise the last line of the note composer would sit
underneath it permanently.

**Pointer-events interception** — one element sitting over another and receiving the
clicks meant for it. Invisible to a test framework without layout; the first thing a
real browser notices.

**Accessible name** — the text an assistive technology announces for a control. Usually
its label or its content, and it is what `getByRole(..., {name})` matches — including,
for a required Material UI field, the asterisk.

**`aria-pressed`** — the attribute marking a toggle button as on or off. The
questionnaire's cards carry it, which is what makes a grid of styled buttons behave like
a radio group for a screen reader.

**Full-text search vs ticket-number search** — `GET /incidents?q=` branches on the
shape of the term: something like `INC-000482` or a bare number is looked up by ticket
number, anything else goes to PostgreSQL's `websearch_to_tsquery`. One box, two
searches, decided on the server.

---

## Phase M7 — Dashboards and demo data

M7 is three passes. This section covers **pass 1: the report endpoints.** Passes 2
(`seed_demo`) and 3 (the three dashboard screens) append their own sections below when
they land, so if you are reading this and there is nothing after it, that is why.

BUILD-PLAN section 11 lists eight business questions and one endpoint each. All eight now
exist, all eight are computed by PostgreSQL rather than by Python, and all eight are
tested against a fixture world small enough to check by hand.

**Verified against local PostgreSQL only.** 665 backend tests (up from 609), ruff check
and ruff format clean. No AWS credentials exist, so nothing here has met Aurora; what
that leaves unproven is in [docs/DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md).

### 1. What was built

| File | Responsibility |
| --- | --- |
| `app/schemas/report.py` | The window model, the scope model and one response model per report. Also the three tuning constants: `DEFAULT_WINDOW_DAYS`, `TOP_LOCATION_LIMIT`, `ESCALATED_TICKET_LIMIT`. |
| `app/repositories/reports.py` | Every aggregate, as SQL. Nothing else in the application issues an aggregate over incidents. |
| `app/services/reporting.py` | Resolves and validates the window (or, for the two current-state reports, the scope); maps aggregate rows onto response models; nests subcategories under their group. No arithmetic. |
| `app/routers/reports.py` | The eight endpoints, the two query-parameter dependencies (period and scope), and the admin-only/self split. |
| `app/models/incident.py` | Gained a module-level `format_reference(ticket_number)`; the `Incident.reference` property now calls it. |
| `app/main.py` | Mounts `reports.router` under `/api/v1`. |
| `tests/factories.py` | `make_incident` gained `created_at`, `escalated_at` and `blocked_reason_type`; new `make_event`. |
| `tests/integration/test_reports.py` | 56 tests. The fixture table at the top of the file is the specification the assertions are read off. |

The endpoints, and the question each answers:

| Endpoint | Answers | Who |
| --- | --- | --- |
| `GET /api/v1/reports/summary` | What is open, how urgent, whose, and the daily created-versus-closed flow | admin |
| `GET /api/v1/reports/categories` | What people report most, per group and per subcategory | admin |
| `GET /api/v1/reports/locations` | Top 10 buildings, floors and seats | admin |
| `GET /api/v1/reports/response-times` | Median time to assign / acknowledge / resolve, overall and per priority | admin |
| `GET /api/v1/reports/engineer-workload` | Level, availability, live load by status, capacity used, resolved this period | admin |
| `GET /api/v1/reports/blocked-escalated` | What is blocked **right now**, grouped by reason with age; what is escalated right now and why | admin |
| `GET /api/v1/reports/communication` | Share of resolved tickets whose reporter was told something first; median time to that; reopen rate | admin |
| `GET /api/v1/reports/me` | The caller's own counts, **as they stand now** | anyone signed in |

**Six of them cover a period** and take `from`, `to` (default: the last 30 days) and an
optional `building_id`. Their responses echo a `window`.

**Two of them describe the present** — `/reports/blocked-escalated` and `/reports/me` —
and take `building_id` only. They declare no `from`/`to` at all, and their responses carry
a `scope` (`as_of`, `building_id`) instead of a `window`. That split is
[decision D9](DECISION-LOG.md), which partially reversed D5 and D7.

### 2. Why it is shaped this way

#### The aggregates are SQL, and that is the whole point of the phase

Every number is computed by PostgreSQL. `COUNT(*) FILTER (WHERE ...)` for the segmented
counts, `percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ...))` for the
medians, `AVG`/`MAX` for the blocked ages, a window function for the category group
totals, `generate_series` for the daily calendar.

The alternative — select the rows, add them up in Python — is not merely slower; it is
slower *in proportion to how well the platform is doing*. Eleven segments of the summary
are eleven `FILTER` clauses over one scan, and adding a twelfth costs nothing:

```python
columns.extend(
    func.count().filter(Incident.status == status).label(status_label(status))
    for status in IncidentStatus
)
```

One place where the line is worth drawing precisely: the service layer *does* loop, over
rows the database has already aggregated, to nest subcategories under their group. That
is assembling a tree out of finished totals, not computing totals. The totals themselves
arrive complete, including each group's, via `sum(count(*)) OVER (PARTITION BY group)` in
the same pass.

#### Medians, not means, and no `FILTER` on them

Every duration is a median. A single ticket that sat over a long weekend moves a mean and
does not move a median, and the headline number on a dashboard is read by people who will
not check the distribution.

`percentile_cont` needs no `FILTER` clause, which surprised me until it did not: an
incident that was never resolved contributes `NULL` to `EXTRACT(EPOCH FROM (resolved_at -
created_at))`, and aggregate functions ignore `NULL`. So the median time to resolve is
automatically over the tickets that were resolved. The counts published beside each
median — `resolved_count` and friends — exist so that a reader knows how many rows it
rests on, because "median 2 hours" over one ticket is not the same claim as over two
hundred.

#### `NULL` is a real answer and survives all the way out

A period in which nothing was resolved has no median time to resolve. That is not zero.
Every hours field and every percentage is `float | None`, `NULLIF` guards the two
divisions, and there is a test asserting that a twelve-hour window with nothing in it
returns `null` rather than `0`:

```python
assert body["informed_pct"] is None
assert body["reopen_rate_pct"] is None
assert body["median_first_public_note_hours"] is None
```

A dashboard that renders "0% of reporters were informed" for a quiet Tuesday is lying
about the business, and the lie starts here if it starts anywhere.

#### Counts come back as lists, with their zeroes

`by_status` always carries five rows and `by_priority` always carries four, including the
ones nobody used. A `GROUP BY` would omit them, and then the client has to decide whether
a missing key means "none" or "the server forgot". Making the aggregate a row of
`FILTER` columns rather than a grouped query is what makes this free.

#### The window rule, in two halves

> **A report about *current state* is not window-scoped. A report about *activity during a
> period* is.**

On the six period reports, `from`/`to` filter `created_at`, with three exceptions that
name their own timestamp: the closed series in `summary.per_day` (`closed_at`),
`engineer-workload.resolved_in_period` (`resolved_at`), and engineer-workload's active
counts (no date filter — "how loaded is Nina" is a question about today).

The two current-state reports take no period at all. `/reports/blocked-escalated` answers
"which incidents *are* blocked or escalated, and why", and `/reports/me` feeds home tiles
that read Open / In Progress / Blocked / Awaiting your confirmation. Both are present
tense. A thirty-day window on the first hides the ticket that has been blocked since June —
the one row an admin opens that report to find — and on the second it silently drops an
employee's own ticket from February that is still open.

They keep `building_id`, because that is a **scope** filter and not a **time** filter: it
narrows which tickets are in view, not when they happened.

This started as one rule (D5, applied to `/reports/me` by D7) and became two
([D9](DECISION-LOG.md), which reversed both in part). The cost is that a reader has to
know which kind of report they are looking at; three things make that cheap:

* the distinction follows from the tense of the business question, not from taste;
* the response says which it is — a `window` or a `scope`;
* the router enforces it with two dependencies, `get_report_window` and
  `get_report_scope`, so a route cannot quietly get the wrong one. The two current-state
  routes do not *accept* `from`/`to`, rather than accepting them and ignoring them: a
  parameter that is documented and silently discarded is how a dashboard ends up labelling
  a chart with a period nobody applied.

Each half is written down once — `_window_clauses()` and `_scope_clauses()` in
`app/repositories/reports.py`.

#### Present tense means *live*, not merely *flagged*

The two halves of `/reports/blocked-escalated` were filtered differently, and only
one of them was right. "Blocked" is a status, so `status == BLOCKED` drops closed
work without anyone having to think about it. "Escalated" is a boolean column, and
the escalated half asked for `is_escalated` and nothing else.

That column is raised by `escalate` and lowered by exactly one thing,
`clear_escalation`. **Closing or resolving a ticket does not clear it**, on purpose:
the flag is a fact about the ticket's history and `incident_events` records both
`ESCALATED` and `ESCALATION_CLEARED`. So the usual ending — an engineer fixes the
thing that was escalated about and the ticket closes, with no admin ever clicking
Clear — left a row flagged for ever.

Until D9 the thirty-day window hid this: stale escalations aged out and nobody saw
them pile up. Removing the window did not create the bug, it uncovered one that was
always there. Uncovered, it is worse than untidy — `ESCALATED_TICKET_LIMIT` caps the
list at 50, so fifty closed-but-flagged tickets would push every live escalation off
the end of the panel, and `escalated_total` would count work nobody can act on.

Both the list and the count now also require `ACTIVE_INCIDENT_STATUSES` — the same
tuple in `app/models/enums.py` that defines an engineer's `active_ticket_count` and
the capacity warnings in `services/assignment.py`, so "active" means one thing
everywhere. The two terms sit in one helper, `_live_escalation_clauses()`, shared by
the count and the list, because a count and a list that filtered differently is
precisely the defect being fixed.

The alternative — clear `is_escalated` when a ticket closes — was rejected: it
changes the state machine to satisfy a report, it destroys a fact the detail screen
and `GET /incidents?is_escalated=` both read, and it gives the flag a second writer.
See [decision D10](DECISION-LOG.md).

`/reports/me` had the identical defect and now shares the identical fix
([decision D11](DECISION-LOG.md)). `personal_counts` counted `is_escalated` with no
status term, so an employee whose ticket was escalated, fixed and closed carried
"1 escalated" on their home screen permanently — and that count, unlike the admin
panel's, is capped by nothing and has no list under it to contradict it. It now
counts through `_live_escalation_clauses()` too, which corrects both capacities at
once: an engineer's `assigned` block runs through the same function with
`Incident.assignee_id` in place of `Incident.reporter_id`.

So every present-tense read of the flag goes through one helper — three of them,
`blocked_escalated_totals`, `escalated_tickets` and `personal_counts` — and the one
period reader, `summary.escalated_total`, deliberately does not and says why. The
rule is not "always filter on status"; it is that **the tense of the question
decides**, which is D9's rule reaching the last place it had not been applied.

#### Where "blocked since" comes from

There is no `blocked_at` column, deliberately: `incident_service.py` clears
`blocked_reason_type` when a ticket leaves BLOCKED, because `incident_events` already
holds the history. So the age is read from the event log, `COALESCE`d to `created_at` for
rows whose blocking predates their events. [Decision D6](DECISION-LOG.md).

```python
latest = (
    select(func.max(IncidentEvent.created_at))
    .where(
        IncidentEvent.incident_id == Incident.id,
        IncidentEvent.event_type == EventType.STATUS_CHANGED,
        IncidentEvent.to_value == IncidentStatus.BLOCKED.value,
    )
    .correlate(Incident)
    .scalar_subquery()
)
return func.coalesce(latest, Incident.created_at)
```

This is the event log's docstring claim — that events carry `from_value`/`to_value`
"rather than a rendered message" so the reports can read them — being cashed in for the
first time.

#### `now` is a parameter, never `now()`

Ages are measured against an instant the caller passes in — `scope.as_of`, defaulting to
`app.clock.utc_now()` in `build_scope`. That is the same convention M4 established for the reopen window,
and it is what lets `test_blocked_age_is_measured_from_when_the_ticket_became_blocked`
assert `96.0` exactly rather than approximately.

#### Permissions: seven admin reports and one that needs no role

The seven aggregate reports describe the organisation, so they are admin-only through the
existing `require_roles` dependency — expressed as `dependencies=[ADMIN_ONLY]` per route
rather than on the router, because `/reports/me` must not inherit it.

`/reports/me` takes **no user parameter**. There is no `?user_id=` to tamper with; the
subject is whoever the access token says it is. That is what makes it safe to expose to
everyone, and it is why the permission test suite parametrises over the seven and treats
the eighth separately.

### 3. How the pieces connect

One real request, hop by hop — an admin's dashboard asking for the response-time chart:

```
browser
  → GET /api/v1/reports/response-times?from=...&to=...&building_id=...
  → Vite dev proxy (frontend/vite.config.ts), /api forwarded unchanged
  → app/main.py                       router mounted at /api/v1
  → app/routers/reports.py            get_response_times
      ├─ Depends(ADMIN_ONLY)          security/dependencies.require_roles(FACILITY_ADMIN)
      │     └─ get_current_user       token → user, password-change gate
      ├─ Depends(get_report_window)   the three query parameters
      │     └─ services/reporting.build_window   defaults, UTC, from <= to
      └─ Depends(get_db)              app/db.py session
  → app/services/reporting.response_times
      ├─ repositories/reports.response_times_overall      one row
      └─ repositories/reports.response_times_by_priority  one row per priority
           └─ SQL: percentile_cont(0.5) WITHIN GROUP (
                     ORDER BY EXTRACT(epoch FROM (resolved_at - created_at)) / 3600.0)
  → _to_response_times: Decimal → float, NULL preserved
  → ResponseTimesReport  (FastAPI serialises by alias, so `date_from` → "from")
  → TanStack Query cache → chart re-renders
```

The two things in that trace that are easy to get wrong: the window is resolved by a
dependency, so no route can forget it; and the `Decimal` → `float` conversion is explicit
in `_as_float`, because `round(numeric, 2)` comes back as a `Decimal` and `None` has to
survive the trip.

### 4. Where the rules live

| Rule | File |
| --- | --- |
| What `from`/`to` filter, and the building filter, on a period report | `app/repositories/reports.py` → `_window_clauses` |
| What a current-state report filters — the building, and nothing else | `app/repositories/reports.py` → `_scope_clauses` |
| Which reports are period and which are current state | `app/routers/reports.py` → `ReportPeriod` vs `ReportScopeDep` |
| Default period, UTC coercion, `from <= to` | `app/services/reporting.py` → `build_window` |
| The instant a current-state snapshot describes | `app/services/reporting.py` → `build_scope` |
| Which reports are admin-only | `app/routers/reports.py` → `dependencies=[ADMIN_ONLY]` per route |
| Who may be an assignee (hence `/reports/me`'s shape) | `app/services/assignment.py` |
| When a ticket became blocked | `app/repositories/reports.py` → `_blocked_since` |
| What counts as an escalation somebody can still act on (all three current-state readers) | `app/repositories/reports.py` → `_live_escalation_clauses` |
| What counts as live work, application-wide | `app/models/enums.py` → `ACTIVE_INCIDENT_STATUSES` |
| What counts as "kept informed" | `app/repositories/reports.py` → `_first_public_staff_note` + `communication` |
| Which roles are staff for that purpose | `app/repositories/reports.py` → `STAFF_ROLES` |
| Hours, rounding, percentages, `NULL` handling | `app/repositories/reports.py` → `_hours`, `_rounded`, `_percentage` |
| Top-N limits | `app/schemas/report.py` → `TOP_LOCATION_LIMIT`, `ESCALATED_TICKET_LIMIT` |
| Ticket reference formatting | `app/models/incident.py` → `format_reference` |

### 5. How to change it

**To add a segment to an existing report** — say, a count of tickets closed as duplicates
— add one `func.count().filter(...)` column in `app/repositories/reports.py`, one field on
the response model in `app/schemas/report.py`, one line in the mapping in
`app/services/reporting.py`, and one assertion in `tests/integration/test_reports.py`
with the number worked out from the fixture table at the top of that file. Four files, no
new query.

**To add a whole report** — one function in the repository, one in the service, one route
in the router, one response model, one test class. Follow `/reports/categories`: it is the
shortest one that does something non-trivial.

**To change what the window means** — `_window_clauses` for the six period reports,
`_scope_clauses` for the two current-state ones. Read D5 and D9 before you do, and note
which side of the split the report you are changing sits on: moving a report across that
line means swapping its dependency in the router and its echo field (`window` ↔ `scope`)
in the response model, not just editing a `WHERE`.

**To add a fixture incident** — add a row to *both* tables in the
`tests/integration/test_reports.py` docstring, then to `_build_incidents`, then fix every
assertion the new row changes. That will be most of them, which is deliberate: a fixture
world small enough that one more ticket moves twenty numbers is a fixture world you can
still reason about.

### 6. Gotchas

**`count(*)` versus `count(column)` on an outer join.** `/reports/engineer-workload`
LEFT JOINs incidents onto engineers so that an engineer holding nothing still appears.
`count(*)` would score that engineer 1, because the join manufactures a row of nulls.
Every count in that query is `count(Incident.id)`. This is the single most likely place
for a future edit to introduce a wrong number that looks plausible.

**A `GROUP BY` cannot produce a zero.** Hence the `FILTER`-columns-in-one-row shape for
the status and priority segments, and `generate_series` for the daily series. If you
convert either to a grouped query for tidiness, quiet days and unused statuses vanish.

**Casting a `timestamptz` to a `date` uses the session time zone.** The daily series does
this twice per row — `cast(column, Date) == cast(day, Date)` in `_counted_on_day`, which is
`::date` in SQL. `app/db.py` pins the session zone to UTC via `build_connect_args`, and the
test fixtures build their engine the same way. Without that pin, the series would bucket
differently on a developer's machine than in the Lambda — the same instants, different days.
(`date_trunc` has the same dependency, and is the function to reach for if the series ever
needs hours or weeks rather than days.)

**Naive datetimes in the query string.** `?from=2026-09-01` parses to a naive datetime.
`_as_utc` attaches UTC explicitly rather than letting the comparison against a
`timestamptz` column be resolved by the session default. Same value today; not an
accident tomorrow.

**`/reports/blocked-escalated` and `/reports/me` ignore no parameters — they do not
accept them.** Sending `?from=...&to=...` to either is not an error (FastAPI discards
query parameters a route did not declare) and it changes nothing. If you are debugging a
number on one of those two and reaching for the window, that is the wrong lever: the only
filter they have is `building_id`. Their responses carry `scope`, not `window`, so a
client that reads `body["window"]["from"]` will `KeyError` rather than quietly label a
chart with a period that was never applied. That is deliberate.

**A window of 30 days spans 31 calendar days.** Both ends are inclusive, matching
`GET /incidents`'s `created_from`/`created_to`. `test_summary_reports_created_and_closed_for_every_day_in_the_window`
asserts `len(per_day) == 31`, which looks off by one until you remember that.

**`is_escalated` is never cleared by closing a ticket.** Only `clear_escalation` lowers
it, so a closed ticket can and often does still carry the flag, its reason and its
`escalated_at`. That is deliberate — it is history, and the detail screen and
`GET /incidents?is_escalated=` both read it. The consequence is that **`is_escalated` on
its own never means "needs attention"**: any present-tense query over it has to add a
status filter, which is what `_live_escalation_clauses()` exists for, and all three
current-state readers call it — `blocked_escalated_totals`, `escalated_tickets` and
`personal_counts` (`/reports/me`, both capacities). `/reports/summary`'s
`escalated_total` deliberately does not add one, because it is a period report counting
what happened during the window. If you add a fourth place that reads the flag, decide
which of those two questions you are asking before you write the `WHERE`. See
decisions [D10](DECISION-LOG.md) and [D11](DECISION-LOG.md).

**`CLOSED` keeps `resolved_at`.** Closing a ticket does not erase the fact that it was
resolved first, so `communication.resolved_total` counts closed tickets too, and
`engineer-workload.resolved_in_period` credits an engineer for a ticket that has since
been closed. Reopening *does* clear it — `_apply_transition_effects` nulls `resolved_at`
and `closed_at` on entering IN_PROGRESS — which is exactly why that code says it is
written as "what it means to be in this status".

**The fixture world is anchored to `utc_now()` at fixture-build time**, not to a literal
date, so the default-window test is meaningful. Only two assertions depend on the server's
clock as well as the fixture's, and both use `pytest.approx` with 0.05-hour slack; the
exact-age assertions go through the service with an explicit `now`.

### 7. Glossary

**Aggregate function** — SQL that collapses many rows into one value: `count`, `avg`,
`max`. All of them ignore `NULL` inputs except `count(*)`, which is why the medians here
need no `FILTER` clause.

**`FILTER (WHERE ...)`** — a per-aggregate condition, so one scan can produce many
differently-conditioned counts. `count(*) FILTER (WHERE status = 'OPEN')` beside
`count(*) FILTER (WHERE status = 'BLOCKED')` in the same `SELECT`.

**Ordered-set aggregate** — an aggregate that needs its input sorted, written
`f(args) WITHIN GROUP (ORDER BY ...)`. `percentile_cont` is one.

**`percentile_cont(0.5)`** — the continuous median. With an even number of values it
*interpolates* between the two middle ones rather than picking one: `[5, 9, 12, 20]` gives
10.5, not 9 or 12. `percentile_disc` would pick an actual data point instead.

**`EXTRACT(EPOCH FROM interval)`** — an interval as a number of seconds. Subtracting two
`timestamptz` values gives an interval; this is how it becomes arithmetic.

**Window function** — an aggregate evaluated over a frame of rows without collapsing
them, written `f(...) OVER (PARTITION BY ...)`. `sum(count(*)) OVER (PARTITION BY group)`
puts each group's total on every one of its subcategory rows.

**Correlated subquery** — a subquery that refers to a column of the enclosing query and is
therefore evaluated per outer row. `_blocked_since()` and `_first_public_staff_note()` are
both correlated on `incidents.id`.

**Scalar subquery** — a subquery used where a single value is expected, in a `SELECT` list
or a comparison. In SQLAlchemy, `.scalar_subquery()`.

**`generate_series`** — a set-returning function producing a sequence; here, one row per
calendar day, so that days with no incidents appear in the series as zeroes.

**`NULLIF(x, 0)`** — returns `NULL` when `x` is zero. Used as the denominator of every
percentage, so an empty period yields `NULL` rather than a division error.

**`COALESCE`** — the first non-`NULL` of its arguments. `COALESCE(blocked_event_time,
created_at)` is what stops a missing event producing a `NULL` age.

**`table_valued()` / `render_derived()`** — SQLAlchemy's way of putting a set-returning
function in the `FROM` clause with a column alias: `generate_series(...) AS calendar(day)`.

**Ordered-set versus grouped** — `GROUP BY priority` produces one row per priority *that
has rows*. A row of `FILTER` columns produces one row with a column per priority, present
whether or not it has rows. The reports use both, deliberately, and the choice is always
about whether zeroes must appear.

## Phase M7 — Dashboards and demo data (pass 2: `seed_demo`)

Pass 1 built the eight report endpoints. This pass builds the thing that makes them worth
looking at: an ops action that fills a **local** database with a plausible ninety days of
ACME. Pass 3 is the three dashboard screens, and appends its own section below.

**Verified against local PostgreSQL only.** 683 backend tests (up from 666), ruff check
and ruff format clean. A full default seed takes **0.9 seconds** and writes 300 incidents,
~1,800 events and ~500 notes. What that leaves unproven in the cloud is items 7.5 to 7.8
in [docs/DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md) — chiefly that the production
guard's `IS_LOCAL` really arrives on the deployed Lambda.

### 1. What was built

| File | Responsibility |
| --- | --- |
| `app/seed/demo.py` | The whole generator: the static world (buildings, engineers, names, weights), the lifecycle planner, the timeline walk, and the row writers. |
| `app/services/ops.py` | `_op_seed_demo` — the environment guard, the payload overrides, and the registry entry beside `migrate` and `seed_admin`. |
| `tests/integration/test_seed_demo.py` | 13 tests against a 60-incident spec. Shape, not values. |
| `tests/unit/test_ops.py` | 4 more: the registry, the production refusal, and payload validation. No database needed for any of them. |
| `docs/DEPLOYMENT-CHECKLIST.md` | Items 7.5–7.8. |

It is invoked exactly as `migrate` and `seed_admin` are — a direct Lambda invoke, or the
same handler called locally:

```sh
python -c "import function, json; print(json.dumps(
    function.handler({'action': 'seed_demo'}, None), default=str))"
```

What a default run produces, and what each number is for:

| | Count | Why |
| --- | --- | --- |
| Buildings | 3 | Weighted 50 / 32 / 18, so `/reports/locations` ranks rather than ties. |
| Floors | 4–6 each (~14) | |
| Desks | 20–40 per floor (~420) | |
| Meeting rooms | 2–3 per floor (~34) | `seat_type = MEETING_ROOM`; the Meeting Rooms category group reports against these and nothing else. |
| Admin | 1 | `demo.admin@acme.inc`. |
| Engineers | 6 | Two per level, specialties covering all five category groups, uneven load weights. |
| Employees | 30 | Two deactivated, so the users screen has both states. |
| Incidents | 300 over 90 days | ~60% CLOSED, the rest live. |
| Events | ~1,800 | Backdated. This is the point. |
| Notes | ~500 | PUBLIC and INTERNAL, backdated. |

Every account shares the password `AcmeDemo2026!`, reported in the invoke payload, and
none is flagged `must_change_password`.

### 2. Why it is shaped this way

#### The status is an outcome, not an input

The obvious generator picks a status from a distribution and back-fills whatever
timestamps that status implies. This one does the opposite. Each incident gets a full
intended **path** — assigned after *n* hours, acknowledged after *m*, perhaps blocked,
resolved, closed, perhaps reopened — with a duration drawn for every hop, and then `_walk`
applies the steps in time order and **stops at the first one later than `now`**:

```python
for step in plan.steps:
    if step.when > now:
        break
    outcome.last_activity = step.when
    _apply_step(step, plan, outcome, events, notes, worker_id=worker_id, admin=admin)
```

A ticket reported eighty days ago with a thirty-hour path is therefore closed; one
reported this morning is still open; one whose block outlasts the run is still blocked,
with a real age. The alternative — pick a status, then back-fill the timestamps it
implies — is [decision D12](DECISION-LOG.md), part 1. The age distribution and the status distribution come out consistent with
each other because they are the same fact looked at twice, and nothing has to be
reconciled afterwards.

The effects in `_apply_step`/`_enter` mirror `_apply_transition_effects` in
`services/incident_service.py` one for one — entering IN_PROGRESS clears the resolution
and closure fields, anything other than BLOCKED clears the blocked reason, a reopen
increments `reopen_count`. So the generator cannot produce a row the state machine could
not have produced, and it does not need to import the service layer to manage it.

#### Backdating the event log is the phase, not a detail of it

`incident_events.created_at` defaults to `clock_timestamp()` and `incidents.created_at` to
`now()`. Leave either alone and the whole dataset is stamped with the moment of seeding.
Every count in the application still works. Every number the phase exists for does not:

| Report | What it reads | What "created now" gives you |
| --- | --- | --- |
| `/reports/response-times` | `assigned_at - created_at` and friends | zeroes |
| `/reports/blocked-escalated` | `MAX(incident_events.created_at)` for the STATUS_CHANGED → BLOCKED row | every block zero hours old |
| `/reports/communication` | first PUBLIC staff note vs `resolved_at` | a median of zero |
| `/reports/summary` | `per_day` over `created_at` / `closed_at` | one spike on today, 30 empty days |

So every row is written with an explicit timestamp taken from the plan, including the
notes. There is no `blocked_at` column by design (decision D6) — the blocked age is read
back out of the event log — which means a generator that wrote correct incident columns
and a lazy event log would still produce a blocked report full of zeroes. Both halves have
to be right.

`test_every_event_is_backdated_and_in_order` is the test that would fail: it asserts that
each ticket opens with a CREATED event at exactly `incident.created_at`, that no event
precedes its own ticket or postdates `now`, that each log is in time order, and that the
events as a whole span more than ten distinct days.

#### Why there are seven paths, not one

The first working version gave every ticket a path to CLOSED. Measured, that produced a
database **85% closed** after ninety days — 254 of 300, with two blocked tickets, one
resolved and ten in progress. Every live-work dashboard was empty. Real queues carry work
that stalled, so the stalling is modelled rather than left to the tail of a distribution:

```python
PATH_WEIGHTS = {
    "normal": 0.58,               # runs all the way to CLOSED
    "never_assigned": 0.09,       # nobody picked it up — stays OPEN
    "assigned_not_started": 0.04, # in an engineer's list, not started — stays OPEN
    "stalled": 0.07,              # started, engineer pulled away — stays IN_PROGRESS
    "stuck_blocked": 0.07,        # blocked on a vendor since July — stays BLOCKED
    "awaiting_confirmation": 0.05,# fixed, reporter never confirmed — stays RESOLVED
    "duplicate": 0.05,
    "invalid": 0.05,
}
```

That gives roughly 60–65% CLOSED and the rest live, spread across all four other
statuses in double figures. Each of the five stopping paths exists because a specific
tile or column was empty without it —
`assigned_not_started` was added after `/reports/engineer-workload` returned `open_count:
0` for all six engineers, which is not a thing that happens in a real facilities team.

#### Nothing is uniform, because a uniform world answers no questions

BUILD-PLAN section 11 lists eight business questions. Several of them — which building has
the most problems, who is overloaded, are there recurring problems at the same location —
have no answer at all if everything is drawn uniformly. So the weights are in the file,
named and commented: `BUILDING_WEIGHTS`, `CATEGORY_GROUP_WEIGHTS`, `PRIORITY_WEIGHTS`,
`ENGINEER_LOAD_WEIGHTS`, `BLOCKED_REASON_WEIGHTS`, and a decaying weight per subcategory
so each group's "Other" stays rare.

Two of them do more than tilt a bar chart:

* **`_draw_assignee` multiplies the load weight by 4 when the ticket's group is one of the
  engineer's specialties.** The workload report and the engineers screen then agree with
  each other, which they would not if assignment were random.
* **`_choose_hotspots` picks a few (seat, subcategory) pairs and repeats them** across the
  ninety days. In a default run those three seats top the list at 9, 6 and 5 tickets
  against a background of 2, which is a visible answer to "are there recurring problems at
  the same location?" rather than a noise floor.

Durations are lognormal about a published median (`RESPONSE_MEDIANS`), not uniform,
because that is the shape response times actually have — a cluster near the median and a
thin tail. It also means the medians `/reports/response-times` computes come back
recognisably as the numbers in that table, so the dashboard can be checked against this
file by eye. A default run gives 0.4 h to assign for CRITICAL against 16.6 h for LOW, and
6.6 h to resolve against 141 h.

#### The resolution note lands *after* the resolution

A subtle one, and it was wrong at first. `/reports/communication` counts a reporter as
"kept informed" when the first PUBLIC staff note is at or before `resolved_at` — it is
asking whether they heard anything *while the ticket was open*. The first version wrote
the resolution note at exactly `resolved_at`, which satisfied that test on every resolved
ticket and pinned the report at **100.0%**.

`_resolution_steps` now schedules the note a few minutes after the resolve step, which is
also the order the two really happen in: marking a ticket resolved is one request and
writing a note is another, and nobody types the summary before pressing the button. The
note the metric is actually about is the early "I've picked this up" update, written
`PUBLIC_UPDATE_PROBABILITY` (72%) of the time. The report now reads around 70–80%, and
`test_the_communication_report_is_neither_zero_nor_a_perfect_score` asserts strictly
between 0 and 100 so it cannot silently go back to being perfect.

#### The demo data deliberately contains the bug D10 and D11 fixed

A default run produces both live escalations and closed-but-still-flagged ones, a dozen
or more of each. That is not an oversight: `is_escalated` is lowered only by `clear_escalation`, so
the ordinary ending — an engineer fixes the thing and the ticket closes — leaves the flag
standing, and a demo world without that case would let a regression in
`_live_escalation_clauses()` go unnoticed on every screen.
`test_the_blocked_report_reads_a_real_age_out_of_the_event_log` asserts that every row in
the escalated list is in `ACTIVE_INCIDENT_STATUSES`, over data that contains counterexamples.

#### One bcrypt hash, reused across every demo account

`hash_password` at twelve rounds costs about a quarter of a second by design. Hashing
thirty-seven identical demo passwords separately would add roughly nine seconds to a seed
that otherwise takes under one, and would protect nothing: the password is printed in the
return payload. So it is hashed once in `_seed_people` and the string is reused. This is
confined to demo data — every real account still goes through `hash_password` per user —
and it is the single reason the whole seed fits in under a second. What keeps it safe is
the guard below, which is why that guard reads the same `IS_LOCAL` everything else does.
[Decision D12](DECISION-LOG.md), part 3.

#### Refusing to run, and where the refusal lives

CLAUDE.md requires `seed_demo` to refuse in production. The check is `settings.is_local`,
which is the same flag that drives `sslmode=require`, the `Secure` cookie flag and the
weak-JWT-secret startup refusal in `app/config.py`. Using it rather than inventing a
second environment test means there is one answer in this codebase to "is this
production", and one place to be wrong. It returns a payload rather than raising, matching
`seed_admin`'s treatment of a missing email: an ops action that is refused should say why
in the invoke response, not produce a stack trace in CloudWatch.

The payload may override four fields — `incidents`, `employees`, `days`, `random_seed` —
and nothing else. The shape of the world stays in the file where it can be read and
reviewed, rather than being assembled out of an invoke payload.

#### Not idempotent, and saying so out loud

Running it twice does not top up or refresh. Half of what it writes is unique-constrained
(building names and codes, user emails) and half is not, so a blind second run would
either fail an insert or silently double the incident count. Instead it looks for its own
buildings first and returns without writing:

```json
{"created": false,
 "detail": "Demo data is already present ('Austin Campus' exists). Nothing was changed:
            seed_demo does not top up or refresh. Drop and recreate the database, run
            migrate, then run seed_demo again."}
```

That is the honest version of idempotence for a generator: **safe** to run twice, not
*useful* to. Matching on natural keys the way `seed_categories` does was considered and
does not apply — three hundred generated incidents have no natural key
([decision D12](DECISION-LOG.md), part 2). The requirement said "idempotent or clearly documented as not", and this is
the second, documented in the return payload, the module docstring, the action docstring
and here. Decision D4 already prescribes dropping and recreating the review database
before seeding, so the recovery path is one somebody is following anyway.

### 3. How the pieces connect

```
aws lambda invoke --payload '{"action":"seed_demo"}'     (or function.handler locally)
  → function.py handler                    sees `action`, never touches Mangum
  → app/services/ops.run_ops               registry lookup
  → app/services/ops._op_seed_demo
      ├─ get_settings().is_local           False → refuse here, nothing is written
      ├─ _seed_demo_overrides(event)       four optional positive integers
      ├─ replace(DEFAULT_SPEC, ...)        the DemoSpec for this run
      └─ _with_session(seed)               one session, committed by the wrapper
  → app/seed/demo.seed_demo
      ├─ _existing_demo_building           already seeded? return, write nothing
      ├─ _category_groups                  the five groups `migrate` seeded
      ├─ _seed_facilities                  buildings → floors → seats  (flush between:
      │                                    each level needs the level above's id)
      ├─ _seed_people                      one bcrypt hash → admin, 6 engineers
      │                                    (+ profiles, pointed at their specialty
      │                                    groups), 30 employees
      └─ _seed_incidents               (given a `_World`: the buildings, the floor and
           │                               seat lookups, the category tree and the people,
           │                               bundled so five functions do not take nine
           │                               parameters each)
           ├─ _plan_all                    hotspots first, then the rest, sorted by
           │     └─ _plan_incident         created_at so ticket numbers follow time
           │           └─ _plan_steps      the whole intended life, as timestamps
           ├─ _walk (per incident)         apply steps up to `now`; stop
           │     └─ _apply_step / _enter   mirrors _apply_transition_effects
           ├─ session.add_all(incidents); flush     → ids and ticket_numbers exist
           ├─ _link_duplicates             point each duplicate at an earlier ticket
           ├─ _write_events_and_notes      explicit created_at on every row
           └─ _summarise                   the counts in the invoke response
  → DemoSeedResult → asdict → invoke response
```

The three-pass order at the bottom is forced: events, notes and duplicate links all need
`incident.id`, which does not exist until the incidents are flushed.

### 4. Where the rules live

| Rule | File |
| --- | --- |
| Refuse to seed outside local development | `app/services/ops.py` → `_op_seed_demo` |
| Which spec fields a payload may override | `app/services/ops.py` → `SEED_DEMO_OVERRIDES` |
| How much of everything to generate | `app/seed/demo.py` → `DemoSpec` / `DEFAULT_SPEC` |
| Whether a second run does anything | `app/seed/demo.py` → `_existing_demo_building` |
| What a ticket's life can look like | `app/seed/demo.py` → `PATH_WEIGHTS`, `_plan_steps` |
| How much of that life has happened yet | `app/seed/demo.py` → `_walk` |
| What entering a status means | `app/seed/demo.py` → `_enter` (mirrors `services/incident_service._apply_transition_effects`) |
| How long each hop takes | `app/seed/demo.py` → `RESPONSE_MEDIANS`, `_draw_hours` |
| When a ticket is reported | `app/seed/demo.py` → `_draw_created_at`, `WORKING_HOURS` |
| Who gets assigned what | `app/seed/demo.py` → `_draw_assignee`, `ENGINEER_LOAD_WEIGHTS` |
| Which engineer covers which group | `app/seed/demo.py` → `ENGINEER_SEEDS` |
| Recurring problems at one seat | `app/seed/demo.py` → `_choose_hotspots` |
| Where a ticket is allowed to happen | `app/seed/demo.py` → `_random_placement` (honours `location_detail`) |
| The demo password | `app/seed/demo.py` → `DEMO_PASSWORD` |

### 5. How to change it

**To make the demo bigger or smaller** — pass `incidents` in the payload, or edit
`DEFAULT_SPEC`. Nothing else scales off a hard-coded number.

**To add a kind of ticket** — add a weight to `PATH_WEIGHTS`, a branch to `_plan_steps`
that stops (or does not) where you want it to, and, if it introduces a new moment, a
branch to `_apply_step`. Then add an assertion to
`test_the_dataset_contains_the_awkward_cases_the_dashboards_are_for`. Three places, and
the walk needs no changes at all.

**To add a field to incidents** — set it in `_build_incident`. If it has to change over
the ticket's life, put it on `_Outcome` and set it from `_apply_step`, not from
`_build_incident`.

**To change the mix** — every weight is a module-level dict with a comment saying what the
dashboard looks like without it. Change the numbers, re-run against a throwaway database,
and read the `by_status` / `by_priority` / `by_engineer` block in the return payload; it is
there so you do not have to write a query to find out what you just made.

**To verify a change by hand** — never against `acme_incidents_dev` (decision D4: the
owner resets it themselves). Use a throwaway:

```sh
createdb acme_scratch
POSTGRES_NAME=acme_scratch python -c "import function, json; print(json.dumps(
    function.handler({'action':'migrate'}, None)))"
POSTGRES_NAME=acme_scratch python -c "import function, json; print(json.dumps(
    function.handler({'action':'seed_demo'}, None), default=str))"
dropdb acme_scratch
```

### 6. Gotchas

**`seed_demo` needs `migrate` to have run first**, and not only for the schema. It reads
the five category groups and their subcategories, which `seed_categories` writes as part
of the `migrate` action rather than in the Alembic migration. Against a migrated-but-not
-seeded database it raises a `KeyError` on the group name. The integration tests call
`seed_categories` in their fixture for this reason.

**The tests never run the ops action against the database.** They call
`seed_demo(db_session, ...)` directly, inside the transaction the fixture rolls back.
`_with_session` opens its own session and commits, and the suite recreates the test
database only once per session — so a committed demo world would be visible to every test
that ran afterwards, including `test_reports.py`, which asserts exact counts over its own
ten-incident fixture. The action wrapper is tested in `tests/unit/test_ops.py`, where the
three things worth testing all return before a session is opened.

**The leak runs the other way too, and that one did bite.** `test_ops_actions.py`
commits four `seed_admin` accounts, and integration files run in alphabetical order, so
by the time `test_seed_demo.py` runs those rows are in `users`. A test asserting
"`seed_demo` created exactly one admin" by counting every row in the table therefore
passed on its own and failed in the full suite — `1 failed, 682 passed`. The `users_before`
fixture takes a snapshot of the ids that already exist and the assertions run over the
difference. **Anything in this file that counts a table has to ask whether an ops-action
test writes to it**: `users` and `categories` are the two that survive, and `categories`
is safe only because `seed_categories` is idempotent and seeds the same five groups.

**Determinism is per-spec, not per-run.** `DemoSpec.random_seed` seeds one
`random.Random`, and every draw comes from it in order — so adding a draw anywhere
reshuffles everything after it. That is fine (nothing asserts a specific value) but it
means "the same seed gives the same world" only holds for the same version of this file.
Note bodies are the exception: `_pick_note` keys off the step's own timestamp rather than
the shared generator, so changing how many notes an earlier ticket gets does not rewrite
the text on every ticket after it.

**`_random_placement` honours `location_detail`, and more precision is allowed.** A
Meeting Rooms ticket (SEAT) always names a meeting room; a Building & Facilities ticket
(FLOOR) names a floor and, 65% of the time, a desk as well. That is legal —
`_require_location_precision` in `services/incident_service.py` checks a *minimum* — and
it is necessary, because a location report over tickets that only name a building has
nothing to rank.

**Two engineers can exceed 100% capacity** in a default run, and one of them is
`ON_LEAVE` holding seven active tickets. Both are deliberate: `capacity_used_pct` above
100 is exactly the condition `/reports/engineer-workload` exists to surface, and somebody
going on leave without handing their queue over is the reason an admin looks at it.

**`escalated_on_closed` in the payload is not a defect count.** It is how many closed
tickets still carry `is_escalated`, which is correct behaviour (decisions D10 and D11) and
is generated on purpose so the live-escalation filter has something to filter.

### 7. Glossary

**Lognormal distribution** — what you get when the *logarithm* of a value is normally
distributed. Multiplicative rather than additive, so it cannot go negative and has a long
right tail: most repairs take about the median, a few take twenty times it. `_draw_hours`
uses `random.lognormvariate(0, 0.62)` as a multiplier on a published median.

**Weighted choice** — picking from a list where each item has its own probability.
`random.choices(population, weights=...)`. Every "not uniform random" decision in this
file is one of these.

**Deterministic generator** — a random generator seeded from a fixed number, so the same
seed produces the same sequence. `random.Random(spec.random_seed)`, never the module-level
`random` functions, which share global state with anything else that touches them.

**Scale factor** — running a generator at a fraction of its real size to test its shape
cheaply. Here it is a whole `DemoSpec` rather than a multiplier, so the tests state the
sixty they expect instead of computing it.

**Idempotent** — an operation that can be applied repeatedly without changing the result
beyond the first application. `migrate` and `seed_admin` are idempotent in the strong
sense (they converge on a state). `seed_demo` is idempotent only in the weak sense: the
second run is a no-op, but it will not repair or refresh a partial world.

**Ops action** — a task run by invoking the Lambda directly with a payload carrying an
`action` key, rather than over HTTP. IAM-protected and not routed by CloudFront, which is
what lets migrations and seeding exist without a public maintenance endpoint. See
`function.py` and `app/services/ops.py`.

---

## Phase M7 — Dashboards and demo data (pass 3: the three persona screens)

Pass 1 built the eight report endpoints. Pass 2 built `seed_demo`, which fills a local
database with ninety days of plausible ACME so those endpoints return something worth
drawing. This pass draws it: the employee home, the engineer home and the admin
dashboard, replacing the three placeholders M5 wired to `/`.

**Verified.** 271 frontend tests (up from 211), 32 Playwright cases across two viewports
of which 25 run and 7 are deliberate viewport skips (up from 14 and 12), eslint +
`tsc -b` + `vite build` clean. Backend untouched — no server file
changed in this pass, so the 683-test suite is unaffected and was not re-run for it.
The screens were developed and screenshotted against `acme_demo`; `backend/v1/.env` is
restored to `POSTGRES_NAME=acme_incidents_dev`.

**The one thing to understand before changing any of this** is in section 2 below: the
admin dashboard shows two kinds of number under a single filter bar, the difference is
real, and every label on the page exists to keep them apart.

### 1. What was built

**The data layer.**

| File | Responsibility |
| --- | --- |
| `src/api/reports.ts` | One typed function per report endpoint, and the response types. Carries the period/current-state split **in the parameter types**: `fetchBlockedEscalated` and `fetchMyReport` take `ReportScopeParams`, which has no date field. |
| `src/api/queryKeys.ts` | `queryKeys.reports.*`. Period and current-state keys take different parameter types, so two requests that differ in whether a window applied can never share a cache entry. |
| `src/features/dashboard/hooks.ts` | A TanStack Query hook per report. The six period hooks hold the previous answer while a new one is fetched, so moving the date picker does not collapse the page into spinners. |

**Shared dashboard pieces.**

| File | Responsibility |
| --- | --- |
| `src/features/dashboard/StatTile.tsx` | One number, its name, and a **required** `caption` saying what it is scoped to. A tile cannot be added without someone deciding that. Plus `StatTileGrid`, an auto-fit grid. |
| `src/features/dashboard/ScopeHeading.tsx` | `PeriodScopeHeading` and `CurrentScopeHeading` — the two section headers that say which question the widgets below them answer. |
| `src/features/dashboard/chartPalette.ts` | Every colour a chart uses, with the validator results that justify each one recorded beside it. |
| `src/features/dashboard/BreakdownChart.tsx` | A horizontal bar chart of one measure across categories, with a table twin behind a toggle. Every bar is a link or a drill-down. |
| `src/features/dashboard/FlowChart.tsx` | Reported against closed, per day. The only two-series chart. |
| `src/features/dashboard/listLinks.ts` | `periodListLink` and `currentListLink` — two builders, not one with a flag, so the choice is visible at each call site. |
| `src/features/dashboard/useDashboardFilters.ts` | The dashboard's filters in the URL, and the resolution of a preset into two instants. |
| `src/features/dashboard/DashboardFilterBar.tsx` | The one filter row, above everything it scopes. |

**The three screens.**

| File | Responsibility |
| --- | --- |
| `src/features/home/HomePage.tsx` | The `/` route's branch on role. Lazy-loads the admin dashboard. |
| `src/features/home/EmployeeHomePage.tsx` | Greeting, full-width Report an issue, four tiles, "Needs your attention" when non-empty, recent tickets. |
| `src/features/home/EngineerHomePage.tsx` | Four tiles, active tickets by priority then age, the unassigned queue for SENIOR/LEAD, the sentence for a JUNIOR. |
| `src/features/home/HomeTicketRow.tsx` | One ticket with room for its own buttons. |
| `src/features/home/sortTickets.ts` | `sortByPriorityThenAge`. |
| `src/features/dashboard/AdminDashboardPage.tsx` | The dashboard, and `CategoryBreakdown` with its one level of drill-down. |
| `src/features/dashboard/NeedsAttentionPanel.tsx` | Escalated tickets and tickets unassigned over 24 h, each row with an inline Assign. |
| `src/features/dashboard/EngineerWorkloadTable.tsx` | Who holds what, with the period column named in its own header. |
| `src/features/dashboard/BlockedByReasonPanel.tsx` | Blocked tickets grouped by reason, with ages. |

**Changed, not new.**

| File | Change |
| --- | --- |
| `src/features/incidents/useIncidentFilters.ts` | Four more URL filters — `category_id`, `assignee_id`, `created_from`, `created_to` — so a dashboard link lands on exactly the tickets its tile counted. |
| `src/features/incidents/AppliedFilterChips.tsx` | New. Renders those four as removable chips above the list, because a filter that is applied but invisible is worse than one that is missing. |
| `src/features/incidents/InlineTransitionButtons.tsx` | New. Workflow buttons for one ticket in a list, still drawn only from `allowed-transitions`. |
| `src/features/incidents/AssignButton.tsx` | Now takes four ids rather than a whole `IncidentListItem`, so it also serves the report rows in the Needs attention panel. |
| `src/features/incidents/hooks.ts` | Mutations invalidate `['reports']` as well as `['incidents']`. |
| `src/display/time.ts` | `formatHours` — hours under a day, days above, and `—` for `null`. |
| `src/theme.ts` | Unchanged. Every chart colour lives in `chartPalette.ts`, not the theme, for the reason in section 2. |

### 2. Why it is shaped this way

#### The split that everything else follows from

Decision [D9](DECISION-LOG.md) divided the eight reports in two. Six cover a **period**
and take `from`/`to`; two describe the **present** and refuse those parameters outright,
because "what is blocked" is a question about now and a thirty-day window would hide the
ticket that has been blocked since February.

That split was made in the API for the sake of this screen. A dashboard has one filter
bar, and the temptation is to make it look as though the bar reaches everything. Against
`acme_demo`, `summary.blocked_total` is **11** and `blocked-escalated.blocked_total` is
**21** — the first is "tickets reported in the last thirty days that are blocked now",
the second is "tickets blocked now". Both are correct. A tile labelled "Blocked · 21"
under a heading that says "last 30 days" is the exact failure D9 exists to prevent.

So the dashboard is two sections with two headings, and the difference is stated three
times over: once in the filter bar's own caption, once per section heading, and once more
in an alert under the live tiles for the case where the two figures visibly disagree.
The period heading reads its dates **off the response's `window`**, never off the picker —
the server is the only thing that knows what period it actually applied.

The second guard is in the types. `fetchBlockedEscalated` and `fetchMyReport` take
`ReportScopeParams`:

```ts
export interface ReportScopeParams {
  building_id?: string;
}
```

Deliberately not `Omit<ReportPeriodParams, 'from' | 'to'>`: an optional property set to
`undefined` still satisfies an `Omit`, so a caller could write `{ from: undefined }` and
believe it meant something. A separate interface with one field cannot be handed a date
at all, and a screen that tried would not compile.

`building_id` survives on both kinds, because it narrows *which* tickets are in view
rather than *when* they happened. That is a scope filter, not a time filter, and D9 kept
it for the same reason.

#### Why the chart colours are not the chip colours

The obvious move for a "by status" chart is the palette the status chips already use —
blue Open, purple In progress, orange Blocked, green Resolved, grey Closed. A reader has
already learned it everywhere else in the app.

It fails as a chart palette. Run against this application's own chart surface — the white
of `background.paper`, not a tool's default grey — the five-colour set fails two checks:
blocked-orange beside resolved-green measures ΔE 3.2 under protanopia against a floor of
8, and closed-grey falls below the chroma floor entirely. The two failing colours are
**adjacent in workflow order**, and workflow order is not something a chart may rearrange.

The resolution is that a chip and a chart mark have different jobs. A chip is a small
token beside its own word, so its colour never has to stand alone; a chart mark is a block
of colour a reader may have to tell from the one next to it. So:

- **One series, many nominal categories** (status, category group, building) → one colour
  for every bar, and the axis label carries identity. This is the correct treatment
  regardless: shading each bar by its own value would encode the bar's length twice and
  spend the only free channel on information the length already shows.
- **A genuinely ordered scale** (priority) → a single-hue ramp, light to dark, so
  more-urgent-is-darker is information. Validated: monotone lightness, every adjacent step
  gap above 0.06, hue spread 3°, lightest step 2.11:1 against white.
- **Two series that must be told apart** (reported vs closed) → two categorical hues with
  a legend. Validated: worst CVD ΔE 24.7, normal-vision ΔE 33.6, both well clear.

All of it is in `chartPalette.ts` with the numbers written down, so the next person to
touch a hex knows what the old one was holding up. `chartPalette.test.ts` guards the
structure — the ramp stays monotone and one hue, the two slots stay far apart — without
re-deriving OKLab, which would only be testing its own arithmetic.

#### A calendar day is not an instant

`summary.per_day[].day` is a bare `YYYY-MM-DD`. ECMAScript parses that as **UTC
midnight**, and `toLocaleDateString` then renders it in the reader's zone, so in any zone
west of Greenwich every label on the daily-flow axis came out a day early: the axis began
"Sep 15" under a heading reading "Counted over Sep 16, 2026 – Sep 23, 2026". It looks like
an off-by-one in the data and is one in the parse.

`parseCalendarDay` in `display/time.ts` appends a time, so the same string parses as
**local** midnight — which is what a row the server grouped by date means. A full ISO
timestamp is passed through untouched: it carries a zone and must keep it.

This was wrong against the demo database too, where the axis began "Aug 23" for a window
starting Aug 24, and it went unnoticed there because the heading was far enough up the
page to compare against. It was only obvious once the app was pointed back at the sparse
dev database and a seven-day range put the two within a screen of each other.

#### Why every bar's value is drawn outside the bar

The library centres bar labels inside the bar by default. On the darkest step of the
priority ramp the dark label was close to unreadable, and on a short bar it spilled past
the end. Outside, every label sits on the card in ordinary secondary ink at the same
contrast whatever colour the bar is.

That change then hid the largest number on each chart: the longest bar ran flush to the
plot's right edge and had nowhere to put its label, so Material UI dropped it. The value
axis now carries 15% headroom past the largest value. Both were found by looking at a
screenshot, not by a test.

#### Why a period link and a current-state link are two functions

`periodListLink` appends `created_from`/`created_to`; `currentListLink` cannot. One
function with a flag would have been shorter and would have made the decision invisible at
the call site — and the decision is the whole point. A live number opened through a
windowed list shows fewer tickets than the tile claimed, which is D9's failure one layer
up from the API.

The property this buys is checkable end to end, and `dashboards.spec.ts` checks it: read
the tile's number, click it, read the list's total, assert they are equal. That assertion
needs to know neither number, which is why it survives a reseed.

#### Why "Needs your attention" is hidden rather than emptied

A heading that demands attention in order to report that none is needed is worse than no
heading, and an empty one would push the recent tickets below the fold to do it. The
section renders only when the resolved-tickets query comes back non-empty.

Its buttons come from `allowed-transitions`, not from `status === 'RESOLVED'`. The
shortcut would have saved one request per row and would have kept drawing "Still broken"
past the reopen window, where the API refuses it. See D14.

#### Why the admin dashboard is lazy-loaded

It is the only screen importing `@mui/x-charts`, which is about a third of the bundle,
and `RequireRole` already keeps every other persona off it. One `lazy()` and one
`Suspense` took the main bundle from 406 kB gzipped to 301 kB, with a 106 kB chunk that
only an admin ever fetches. The cut follows a line the permission model already draws.

### 3. How the pieces connect

**An admin opens the dashboard and clicks the "Still open" tile.**

1. `App.tsx` matches `/` inside `RequireAuth` → `AppShell` → `features/home/HomePage.tsx`.
2. `HomePage` reads `useAuth()`, sees `FACILITY_ADMIN`, and renders the lazy
   `AdminDashboardPage` inside a `Suspense`. The browser fetches
   `AdminDashboardPage-*.js` — the chart chunk — for the first time.
3. `AdminDashboardPage` calls `useDashboardFilters()`. It reads `useSearchParams()`,
   finds no `range`, defaults to `30d`, and resolves that against a `now` **frozen at
   mount** into `periodParams = { from, to, building_id: undefined }` and
   `scopeParams = { building_id: undefined }`.
4. Six period hooks and one scope hook fire, keyed by those objects:
   `GET /api/v1/reports/summary?from=…&to=…`, and
   `GET /api/v1/reports/blocked-escalated` with no dates on it at all.
5. Vite's dev proxy forwards `/api` to uvicorn unchanged → `routers/reports.py`.
   `get_report_window` collects the three parameters for the six; `get_report_scope`
   collects one for the other. `ADMIN_ONLY` guards all but `/reports/me`.
6. → `services/reporting.py` → `repositories/reports.py`. `_window_clauses()` applies
   `created_at BETWEEN …`; `_scope_clauses()` applies only the building. One SQL statement
   per report, `COUNT(*) FILTER (…)` throughout.
7. The responses land in the TanStack cache. `summary.data.window` — the period the server
   *actually* used — flows into `PeriodScopeHeading`, which renders "Counted over 24 Aug
   2026 – 23 Sep 2026", and into `scope`, the object `periodListLink` builds hrefs from.
8. The "Still open" tile renders `by_status.OPEN` with
   `to={periodListLink(scope, { statuses: ['OPEN'] })}` →
   `/tickets?status=OPEN&created_from=…&created_to=…`.
9. The click is a `RouterLink`. `App.tsx` matches `paths.allTickets` → `IncidentsPage`.
10. `useIncidentFilters()` reads the query string, including the two new date filters, and
    `toQuery()` turns them into `GET /incidents?status=OPEN&created_from=…&created_to=…`.
11. `IncidentFilterBar` renders `AppliedFilterChips`, which draws a removable chip reading
    "Reported between 24 Aug 2026 and 23 Sep 2026" — so the reader can see what arrived
    with the link.
12. `routers/incidents.py` applies the same `created_at` bounds the report applied, and the
    table's footer reads "1–20 of 20" against a tile that said 20.

**An employee confirms a ticket fixed from their home screen.**

`EmployeeHomePage` → `useIncidents({ mine: 'reported', status: ['RESOLVED'] })` gives the
rows → each row renders `InlineTransitionButtons`, which calls
`useAllowedTransitions(id)` → `GET /incidents/{id}/allowed-transitions` → the API returns
`Confirm fixed` and `Still broken` **if this caller may make those moves now** → the
button is drawn from `action_label` → clicking opens `TransitionDialog`, built from
`required_fields` → `POST /incidents/{id}/transitions` → `useTransition`'s `onSuccess`
invalidates both `['incidents']` and `['reports']`, so the tile above the list and the
list itself both re-fetch and the count drops as the row disappears.

### 4. Where the rules live

| Rule | File |
| --- | --- |
| Which reports may be given a date range | `api/reports.ts` — the two parameter types |
| Which section of the dashboard a widget belongs in | `AdminDashboardPage.tsx` — between the two scope headings |
| What a period heading says, and where its dates come from | `ScopeHeading.tsx` |
| Whether a link carries dates | `listLinks.ts` — `periodListLink` vs `currentListLink` |
| Every chart colour, and the checks behind it | `chartPalette.ts` |
| Chart form: bars horizontal, one colour, labels outside | `BreakdownChart.tsx` |
| Which filters survive in a ticket-list URL | `features/incidents/useIncidentFilters.ts` |
| Which filters are shown as chips | `features/incidents/AppliedFilterChips.tsx` |
| Whether a JUNIOR sees the unassigned queue | `EngineerHomePage.tsx` — `mayPickUp`; the API enforces it in `services/assignment.py` |
| Whether "Needs your attention" renders | `EmployeeHomePage.tsx` — `needsAttention.length > 0` |
| Which workflow buttons a list row shows | `InlineTransitionButtons.tsx` — from `allowed-transitions`, never from status |
| How long a ticket may go unowned before it needs attention | `NeedsAttentionPanel.tsx` — `UNASSIGNED_HOURS` |
| How many rows the attention panel shows | `NeedsAttentionPanel.tsx` — `ROW_CAP` |
| How a duration in hours is worded | `display/time.ts` — `formatHours` |

### 5. How to change it

**To add a KPI tile.** Decide first whether its number is period-scoped or current-state;
everything else follows. Then: (1) put a `<StatTile>` in the right section of
`AdminDashboardPage.tsx`; (2) write a `caption` that says what it is scoped to — the prop
is required for this reason; (3) give it a `to` built with `periodListLink` or
`currentListLink` to match, or **no `to` at all** if no list matches the number; (4) add
a case to `AdminDashboardPage.test.tsx` asserting the value and the link's shape.

**To add a chart.** If it is one measure across categories, build a `BreakdownDatum[]` and
hand it to `BreakdownChart` — you get the bars, the table twin, the links and the palette.
Only reach for `@mui/x-charts` directly if the form is genuinely different, and load the
data-visualisation guidance before choosing a colour.

**To add a colour.** Put it in `chartPalette.ts`, never in `theme.ts`, and record the
validator result beside it in a comment, as the existing entries do. **The validator is
not in this repository** — it came from the data-visualisation guidance used while M7 was
built, invoked as
`node <that tool>/validate_palette.js "#hex,#hex" --mode light --surface "#ffffff"`. If
you no longer have it, any contrast and colour-vision checker will do, but pass the
**surface** colour explicitly: a contrast figure computed against the wrong background
means nothing, and the cards these charts sit on are not white.

**To add a filter to the ticket list.** Five places, in order: `IncidentQuery` in
`api/incidents.ts`; `IncidentFilters` and the three blocks of `useIncidentFilters.ts`
(read, write, `toQuery`); `activeCount`; then either a control in `IncidentFilterBar` or a
chip in `AppliedFilterChips` — but not neither, or the filter becomes invisible.

**To change what a persona's home screen counts.** The counts come from `/reports/me`,
which is current state. If the number you want is about a period, it does not live there
and widening that endpoint would undo D9 — see D14 §4 for the same problem and how it was
answered.

### 6. Gotchas

- **A bare `YYYY-MM-DD` from the API is not a `new Date()` argument.** Use
  `parseCalendarDay`. See the section above; this is the subtlest bug in the phase.
- **`useDashboardFilters` freezes `now` at mount, and must.** A fresh `new Date()` on
  every render puts a new instant in every query key; TanStack Query sees eight new
  queries per pass, each answer triggers the next render, and the page refetches itself
  for ever. The frozen value is never displayed — headings read their dates off the
  response — so nothing goes stale on screen.
- **The chart class names are `MuiBarChart-element` and `MuiBarChart-label`**, not
  `MuiBarElement-root` / `MuiBarLabel-root`. The plausible-looking names match nothing, so
  an `sx` block written against them fails silently: the bars had no pointer cursor and
  the labels ignored their ink for an afternoon. A Playwright assertion that a bar exists
  is what found it. If you style a chart, assert on the element you styled.
- **The value axis needs headroom or the biggest label vanishes.** A bar that reaches the
  plot edge has nowhere to draw its outside label and Material UI drops it silently, so
  the largest number on the chart is the one that disappears.
- **`AssignButton` takes ids, not a ticket.** The escalated half of
  `/reports/blocked-escalated` returns `EscalatedTicket`, which is not an
  `IncidentListItem` — a report row is not a ticket row. It has no category group, so the
  assign dialog orders by load alone there rather than by specialty match.
- **A `<button>` inside an `<a>` is invalid HTML and browsers resolve it by making the
  button part of the link.** That is why home-screen rows are `HomeTicketRow` rather than
  `IncidentCardList`: the latter wraps the whole card in a link, so "Confirm fixed" would
  have navigated to the ticket instead of closing it.
- **The unassigned-over-24h count is computed from one page of 50.** The API has no
  "older than" filter, so the panel asks for open unowned tickets **oldest first** and cuts
  at the age. Exact while fewer than fifty tickets are that stale; past that it
  under-reports. Noted in `DEPLOYMENT-CHECKLIST.md`.
- **`summary.escalated_total` and `blocked-escalated.escalated_total` will differ.** They
  are supposed to. See D10 and the alert on the dashboard that says so to the reader.
- **Playwright against `acme_demo` needs the doubled exclamation mark.**
  `E2E_ADMIN_PASSWORD='AcmeLocalDev2026!!'` — the fixture's default is the dev database's
  single-`!` password, and a wrong one fails with a loud message from `apiLogin` rather
  than a confusing timeout.
- **e2e assertions must not name a seeded number.** `seed_demo` is not idempotent (D12)
  and every Playwright run adds tickets, so "Blocked is 21" would pass today and fail
  after a demo. Assert shapes and agreements instead.

### 7. Glossary

**Period report / current-state report** — the two halves of this project's reporting API.
A period report counts incidents *created between* two instants; a current-state report
counts what is in a state *now* and takes no dates. The distinction is D9's, and every
label on the admin dashboard exists to carry it to the reader.

**Scope vs window** — what a report echoes back about its own filtering. A `window` is
`{from, to, building_id}`; a `scope` is `{as_of, building_id}`. A response that carried a
window it had not applied would let a dashboard label a chart with a period that was never
used.

**KPI tile** — a single headline number with a label and, here, a required caption naming
its scope. The right form when the data is one value; a one-bar bar chart is the wrong one.

**Drill-down** — clicking a chart segment to see the level beneath it. The category chart
drills a group into its subcategories; the level lives in the URL (`?group_id=`) so a
drilled view is a link somebody can send.

**Table twin** — the same numbers a chart shows, as text, behind a toggle in the card's
header. A chart puts its values behind a hover, and a hover is unavailable to a keyboard,
a screen reader and a printout.

**Categorical / sequential / ordinal palette** — three jobs colour can do. *Categorical*
distinguishes entities that have no order (use distinct hues). *Sequential* encodes
magnitude (one hue, light to dark). *Ordinal* encodes an ordered set of categories, which
is what priority is — hence the one-hue ramp on the priority chart and one flat colour on
every other.

**CVD ΔE** — how far apart two colours are for a viewer with a colour-vision deficiency,
measured in OKLab × 100 after simulating the deficiency. Eight is the floor these charts
are held to; the status-chip palette scored 3.2 on one adjacent pair, which is why it is
not the chart palette.

**Lazy route / code splitting** — deferring a module's download until something needs it.
`React.lazy()` plus a `Suspense` boundary makes the bundler emit a separate chunk; here
the admin dashboard and its charting library are one such chunk.

**`placeholderData: keepPrevious`** — a TanStack Query option that holds the last
successful answer on screen while a new one is fetched, instead of returning to a pending
state. It is what stops the dashboard from collapsing into spinners and jumping several
hundred pixels every time the date range changes.

**Auto-fit grid** — `repeat(auto-fit, minmax(190px, 1fr))` in CSS Grid: as many equal
columns as fit above a minimum width, re-flowing on their own. Five tiles become five
columns on a desktop and one on a phone without a breakpoint per count.

---

## Phase M8 — The README, the demo script, this guide's front section (deploy deferred)

M8 in BUILD-PLAN section 15 is "final deploy, README, guide, demo script". No AWS
credentials exist for this build, so the deploy half cannot run and is not attempted;
[D1](DECISION-LOG.md) records that choice and `docs/DEPLOYMENT-CHECKLIST.md` holds every
step that needs the cloud, with its command and its expected output. This phase is the
other half: the documents a reviewer, and later you, will actually read.

**Verified.** No application code changed — `git diff` for this phase touches `README.md`
and four files under `docs/` and nothing else, so the 683 backend / 271 frontend / 25
end-to-end figures carry over from M7 untouched and no suite was re-run for it. What *was*
verified is every claim the new documents make: the route list was read out of the running
OpenAPI document, the workflow table out of `app/workflow.py`, the test counts from the
owner's own run, the demo logins out of `acme_demo` through the application's own
`verify_password`, and every quoted dashboard figure by SQL against that database.

**The one thing to understand before changing any of this**: the README is now a claim
surface. Every sentence in it is checkable in one hop — a file path, a command, a number
that can be re-queried. Section 6 lists what that cost and where it nearly went wrong.

### 1. What was built

| File | Responsibility |
| --- | --- |
| [README.md](../README.md) | Rewritten end to end, 281 lines → ~615. The repository's front door for someone with fifteen minutes and no context. |
| [docs/DEMO-SCRIPT.md](DEMO-SCRIPT.md) | A five-minute walkthrough of one ticket across all three personas, written to be read aloud while clicking. New file. |
| [docs/DECISION-LOG.md](DECISION-LOG.md) | D15–D18 appended: what survives from the upstream template, why no coverage figure is published, why the demo runs on one database, and the two demo details that were nearly got wrong. |
| [docs/BUILD-STATUS.md](BUILD-STATUS.md) | Position moved to M8; what is done and what is deliberately left. |
| **[Part I](#part-i--the-system-as-a-whole) of this guide** | The front section BUILD-PLAN §15 asks for: system overview, the data model as a narrative, the complete rule-to-file map, one full end-to-end trace, a reading order, and the merged glossary. ~1,330 lines, written last and checked against the code rather than against the phase sections. |
| This section | The M8 entry in this guide. |

**Why Part I exists.** By M8 this guide was eight stitched-together phase logs: excellent
on *why a decision was made that morning*, useless for *where is X now*. A reader wanting
to know who may resolve a ticket had to know that incidents were M4, and then that M4's
rule map was written before the workflow table was extended. Part I is the answer to the
second question — one description of the system as it currently stands, with every path
and symbol re-verified — and the phase sections keep the first, which is the thing no
amount of reading the code recovers.

**What verifying it found.** All 372 markdown links in the file (176 distinct targets)
resolve, and of 818 backticked identifiers two in the **existing phase sections** were
wrong, both in rule-map tables rather than in prose:
`apply_visibility`, which has been two functions (`apply_incident_visibility` and
`apply_note_visibility`) since M4, and a gotcha attributing the daily series' timezone
dependency to `date_trunc` when the code casts with `::date`. Both are corrected in place
and noted in section 6. The rest of the phase sections held up — which is the argument for
writing each one while its phase was fresh rather than reconstructing it here.

**What a second pass found in Part I itself**, and the reason it is worth recording: a
first check asked "does this identifier exist in the source?" and everything passed. A
second check asked the stricter question the map actually promises — "is it *defined* in
the file beside it?" — and six rows failed, because an imported name is present in a file
without being defined there. Two of the six (`LOCATION_SEPARATOR`, `DEFAULT_WINDOW_DAYS`)
are constants that live in `schemas/` and are used in `routers/` and `services/`; one
(`revoke_all_refresh_tokens`, twice) is a repository function called from three services;
one was a Terraform claim that Part I and the M1 section disagreed about. All are fixed.

**The lesson, if you ever re-verify this file:** grep for the name and grep for its
*definition* are different questions, and a rule map is only worth having if it answers
the second. The check that works is `def NAME` / `class NAME` / `^NAME =` in the file the
row points at — not `NAME` anywhere in the tree.

**What the README now contains**, in the order a reviewer meets it: what the application
does and for whom; the architecture as two Mermaid diagrams (deployed, then local) plus a
table of how the two differ; the code layout and the three rules that each live in exactly
one file; the three roles and a permission matrix; the workflow as a state diagram and as
the eleven rows that are actually in the code; getting started, every command re-checked
against the repository as it stands; testing — commands, current numbers, what each level
covers, and eight named gaps; the trade-offs a reviewer is most likely to ask about; the
known limitations; and one section covering the fork's origin, licence and attribution.

**What was removed**, and it is most of the old file: the "Coding Workshop" title, the
brief reproduced verbatim, a Roadmap section pointing at the *upstream* repository's issue
tracker, and a Feedback section asking the reader to star the repository. [D15](DECISION-LOG.md)
sets out the test each section was put to.

**What was kept and corrected.** `LICENSE` is untouched and unmodifiable by us — Apache-2.0,
`Copyright 2023 Citigroup, Inc.` The old README said "This library is licensed under the
MIT-0 License", which was never true of this repository. The new one states Apache-2.0 and
says in a parenthesis that the earlier claim was wrong, because a licence statement that
changes without explanation is exactly what a reviewer should distrust.

### 2. Why it is shaped this way

**The architecture is two diagrams, not one.** `docs/full-stack.md` ships a single diagram
with both environments folded into one picture ("AWS CloudFront (Local: Port 3000)"), plus
DocumentDB and a LocalStack S3 that this project does not use. Folding them together hides
the only thing about this topology worth explaining: local and deployed are *the same
shape on purpose*, the browser talks to one origin in both, and the path `/api/v1/...` is
byte-identical in both because CloudFront forwards the prefix unstripped and Vite's proxy
does not rewrite it. Two diagrams and a difference table say that; one merged diagram
cannot. The scaffold's Mongo and LocalStack boxes are absent because this project ships
neither, and a diagram that draws components that do not exist is worse than no diagram.

**The workflow section was written from `app/workflow.py`, not from BUILD-PLAN section 6.**
They agree on nine rows and differ on one: the plan has a single "RESOLVED → CLOSED,
assignee or admin, close_reason = CLOSED_BY_ENGINEER or ADMIN_CLOSED" row, and the code
splits it into two rows, one per actor, so the recorded reason is a property of the table
rather than a conditional in the service. The README documents eleven rows because eleven
is what ships. The general rule for this repository: **the plan is the intent, the code is
the contract, and documentation describes the contract.**

**The permission matrix is BUILD-PLAN section 5, spot-checked against the code rather than
copied.** Four rows were re-derived from source before being written down: `can_edit_content`
(reporter, OPEN *and* unassigned), `can_change_priority` (reporter, OPEN — deliberately
wider, it survives assignment), `ESCALATABLE_STATUSES`, and the note `EDIT_WINDOW` of 15
minutes. Two facts that the matrix alone would mislead a reader about are called out in
prose beneath it: every signed-in user may read every ticket (`apply_incident_visibility`
returns the query unchanged, on purpose), and internal notes are filtered in SQL rather
than in a serializer.

**Testing is documented as commands, numbers, coverage-by-description, and gaps — in that
order.** The rubric asks for "test artifacts (commands, results, and known gaps)
documented clearly", and the gaps are the part a project is tempted to soften. Eight are
named, including the four admin screens with no component tests and the fact that nothing
has run against AWS. [D16](DECISION-LOG.md) explains why no coverage percentage is
published: no coverage tooling is installed, and a number generated on the last day, which
nobody then acts on, is worth less than an accurate list of what is missing.

**Trade-offs are summarised with links, not re-explained.** The decision log is 18 entries
and ~800 lines; a README that absorbed it would be read by nobody. Six decisions are
summarised at a paragraph each — chosen because a reviewer would ask about them — and the
rest are a link. The reversals are in, prominently: D5 and D7 chose one elegant rule, both
entries flagged in writing the case that would break it, the case broke it, and
[D9](DECISION-LOG.md) reversed it; D10 and D11 then found the latent defect the original
rule had been concealing. A decision revisited when evidence arrived is the strongest
thing in the log, and burying it would be the wrong instinct.

**The demo script is a script, not a description.** Exact accounts, exact clicks, and the
sentences to say in blockquotes, because the failure mode of a demo document is a
presenter reading prose and improvising the clicks. It carries times, a three-minute setup
section that has to happen before anyone is watching, a troubleshooting table, and a list
of things the presenter will see that the script does not mention (318 incidents rather
than 300, deactivated `e2e.*` accounts on the Users screen) so that nothing is discovered
live. [D17](DECISION-LOG.md) covers why the whole thing runs on `acme_demo`;
[D18](DECISION-LOG.md) covers the three-cookie-jar problem and how the logins were checked.

### 3. How the pieces connect

There are five documents and they are not interchangeable. A reader arrives through one of
three doors:

**A grader, fifteen minutes, no context.** `README.md` top to bottom. It answers what this
is, how it is built, who may do what, how to run it, what is tested, what was traded away
and what is missing — and links out rather than expanding. Nothing else is required
reading, which is the constraint the rewrite was designed against.

**Someone about to demo it.** `docs/DEMO-SCRIPT.md` — setup section first, hours before;
then the walkthrough. It links back to the README only for installation.

**You, later, changing something.** This guide, at the phase that built the thing you are
changing; then `docs/DECISION-LOG.md` for why it is that way; then `CLAUDE.md` for the
scaffold constraints that are not negotiable; then `docs/DEPLOYMENT-CHECKLIST.md` before
anything reaches AWS.

Tracing one claim end to end, which is the property the rewrite was trying to buy — the
README says *"the frontend renders action buttons exclusively from `allowed-transitions`"*:

`README.md` (Architecture → the three rules table)
→ `backend/v1/app/workflow.py` `TRANSITIONS`, eleven `Transition` rows
→ `app/routers/incidents.py` `GET /incidents/{id}/allowed-transitions`
→ `app/services/incident_service.py` resolves the caller's actors, drops guarded moves
→ `frontend/src/api/incidents.ts` typed fetch
→ `frontend/src/features/incidents/IncidentActions.tsx` L44–62, one `<Button>` per entry
  whose text **is** `transition.action_label` from the API — no label is spelled in the
  frontend
→ `frontend/src/features/incidents/TransitionDialog.tsx`, which builds its fields from
  `required_fields`
→ `backend/v1/tests/unit/test_workflow.py`, which parametrises over `TRANSITIONS` itself.

Every hop is a file you can open. That is what "verified" means in section 1: not that the
sentence sounded right, but that the chain was walked.

### 4. Where the rules live

The documentation map — which file answers which question, so no question has two homes:

| Question | Document |
| --- | --- |
| What is this, how do I run it, what is tested, what is missing? | `README.md` |
| How do I show it to someone in five minutes? | `docs/DEMO-SCRIPT.md` |
| How does the whole system fit together, and where does rule X live? | `docs/PROJECT-GUIDE.md` [Part I](#part-i--the-system-as-a-whole) |
| What was built in each phase, and why is it shaped this way? | `docs/PROJECT-GUIDE.md` [Part II](#part-ii--the-build-phase-by-phase) |
| Why was *this* call made, and what was rejected? | `docs/DECISION-LOG.md` (D1–D18) |
| What does the scaffold force on us? | `CLAUDE.md` |
| What was the plan, and what does each phase have to prove? | `docs/BUILD-PLAN.md` |
| Where has the build got to? | `docs/BUILD-STATUS.md` |
| What must be checked the first time credentials exist? | `docs/DEPLOYMENT-CHECKLIST.md` |
| What did we change in the provided Terraform, and why? | `docs/INFRA-CHANGES.md` |
| What is this project graded on? | `docs/full-stack.md` (the scaffold's, not ours) |

Facts that live in more than one document, and which copy wins:

| Fact | Authority | Who else states it |
| --- | --- | --- |
| The workflow transitions | `app/workflow.py` | README (all 11 rows), BUILD-PLAN §6 (10 rows, pre-split) |
| Test counts | the suites themselves | README, BUILD-STATUS, this guide |
| Demo logins | the `users` table in `acme_demo` | DEMO-SCRIPT, BUILD-STATUS, D13 |
| Which `infra/` files changed | `git diff` against upstream `4b54f45` | INFRA-CHANGES, CLAUDE.md |
| The API surface | the running OpenAPI document | README (41 paths / 61 operations), BUILD-PLAN §9 |
| Where a business rule lives | the code | this guide's [Part I §3](#3-the-complete-rule-to-file-map) map, **and** the nine per-phase §4 maps it merges. Part I is the one to keep current; a per-phase map is a record of what was true at that phase. |

### 5. How to change it

**You added a workflow transition.** One row in `app/workflow.py`, one test — and then
three documentation edits: the transition table in `README.md`, the state diagram above it
if the new row adds an edge, and BUILD-PLAN §6 if you want the plan to stay honest. The
frontend needs nothing.

**You added or changed an endpoint.** The README quotes "41 paths / 61 operations"; re-derive
it rather than adjusting it by hand:

```sh
cd backend/v1 && .venv/bin/python -c "
from app.main import app
spec = app.openapi()['paths']
ops = sum(1 for p in spec for m in spec[p] if m in ('get','post','patch','put','delete'))
print(len(spec), 'paths', ops, 'operations')"
```

(Note for FastAPI 0.141: `app.routes` holds lazy `_IncludedRouter` objects, so iterating it
finds three routes and no endpoints. Read the OpenAPI document instead.)

**The test numbers moved.** They appear in `README.md` (twice — the summary table at the
top and the results table), `docs/BUILD-STATUS.md` and this guide's phase headers. Change
all of them in one commit or they will disagree within a day.

**You want the demo data fresh.** `seed_demo` will not top up or refresh:

```sh
sudo -u postgres dropdb acme_demo && sudo -u postgres createdb acme_demo
cd backend/v1
POSTGRES_NAME=acme_demo .venv/bin/python -c "from function import handler; print(handler({'action':'migrate'}, None))"
POSTGRES_NAME=acme_demo .venv/bin/python -c "from function import handler; print(handler({'action':'seed_demo'}, None))"
```

Then re-check the figures the demo script quotes — they are all live counts.

**You are about to demo.** Run the four pre-flight checks in DEMO-SCRIPT "Before you start
→ Thirty seconds of dry run". The one that matters most is the date range: the seeded
history is 90 days ending at seed time, so a dashboard opened weeks later shows an empty
"Reported in this period" section under the default 30-day window, and looks broken when it
is merely old.

**Credentials arrived and you are deploying.** `docs/DEPLOYMENT-CHECKLIST.md` top to
bottom, then update the README's status paragraph, the "Deployed (AWS) — designed and
configured, not yet verified" heading, and known-limitation item 4. Those three are written
to be changed together on that day.

### 6. Gotchas

- **`bcrypt.checkpw` against a stored hash returns False for the correct password.**
  `app/security/passwords.py` reduces every password to a base64-encoded SHA-256 digest
  before bcrypt — the `bcrypt_sha256` construction — so a naive check bypasses the pre-hash
  and fails. The first pass at verifying the demo logins did exactly that and reported that
  all six accounts had wrong passwords, which was nearly written into the demo script as a
  warning. Always verify through `app.security.passwords.verify_password`.
- **`acme_demo` is not only `seed_demo`'s output.** It holds 318 incidents, not 300, plus
  deactivated `e2e.*` accounts, because Playwright was pointed at it during M7. Nothing is
  broken; but any document quoting "300 incidents" is quoting the specification rather than
  the database.
- **Every "right now" figure in the demo script is perishable.** 21 blocked, 16 live
  escalations, 26 unassigned over 24 hours — all true on 2026-09-23 and all drifting. The
  script says to say "about twenty".
- **Two Escalated numbers on one screen is correct and looks like a bug.** 16 live against
  12 in the period. If a reader is going to be shown this page without narration, the alert
  under the live tiles is the thing to point at.
- **Mermaid renders on GitHub and in few other places.** VS Code needs an extension, and
  plain `cat` shows a code fence. Both README diagrams are written to be readable as text
  if they never render: node labels are full sentences, not `A`/`B`.
- **README anchor links are generated from heading text.** `#known-gaps`, `#known-limitations`
  and `#upstream-scaffold-and-licence` are linked from several places; renaming a heading
  silently breaks them, and nothing in CI checks it.
- **Line counts in commit messages age instantly.** This phase's say "281 → ~615"; treat
  them as the shape of the change, not a measurement to re-verify.
- **BUILD-PLAN's M8 also asks for a front section on this guide.** It is now
  [Part I](#part-i--the-system-as-a-whole), written in a second M8 pass. Two things about
  it are worth knowing. First, **it is the current account and the phase sections are
  not** — where they disagree, Part I was checked against the code and a phase section was
  checked against the morning it was written. Second, **its rule-to-file map is the merge
  of all nine per-phase maps**, so a rule added in a future phase needs adding in two
  places, or the map stops being the thing that answers "where is X" in one hop.
- **Two claims in the phase sections were stale, and both were in tables.** Corrected in
  place during that pass:
  - the M6 rule map named `apply_visibility` in `app/services/visibility.py`. There has
    never been a function of that name — M4 shipped it as two, `apply_incident_visibility`
    and `apply_note_visibility`, because notes and incidents are filtered by different
    rules. (`CLAUDE.md` still says `apply_visibility(query, user)`; that file is the
    pre-implementation specification and is deliberately left as written.)
  - the M7 gotcha about the daily series' timezone dependency attributed it to
    `date_trunc`. The statement is true of `date_trunc` but the code does not use it —
    `_counted_on_day` casts with `cast(column, Date)`, which is `::date`. The dependency,
    and therefore the need for `app/db.py` to pin the session zone, is identical.

  Both were wrong in a way that grep would not catch and reading the prose would not
  notice: a table cell naming a symbol that does not exist. **If you add a row to a rule
  map, open the file and confirm the symbol.** Nothing in CI checks these.

### 7. Glossary

**Mermaid** — a text-to-diagram syntax that GitHub renders natively inside a
` ```mermaid ` code fence. `graph TD` draws boxes and arrows top-down;
`stateDiagram-v2` draws a state machine. It is used here so the diagrams live in the same
file as the prose and change in the same commit.

**State diagram** — a picture of a state machine: the states a thing can be in, and the
labelled transitions between them. The README's is generated by hand from `TRANSITIONS`
and shows the nine distinct edges between five statuses; several edges carry more than one
table row, because who you are changes what the move is called and what it records.

**Apache License 2.0** — the licence this repository is under, inherited from the Citi
scaffold. Permissive: you may use, modify and redistribute, including commercially. Its
§4 obligations are the ones that matter to a fork — keep the licence text with the work,
state that you changed files, and preserve attribution notices. Hence `LICENSE` untouched
and a section of the README that says plainly which parts are the scaffold's.

**MIT-0** — "MIT No Attribution", a permissive licence that drops even the attribution
requirement. The old README claimed it; the repository has never been under it. The
distinction matters precisely because MIT-0 would remove the obligation Apache-2.0 keeps.

**DCO (Developer Certificate of Origin)** — a per-commit assertion that you wrote the
contribution or have the right to submit it, made by signing a commit (`git commit -s`,
which appends a `Signed-off-by:` line). Citi requires it on contributions to their
repositories; `DCO.md` holds the text being agreed to.

**Coverage instrumentation** — a tool that records which lines or branches ran during a
test suite (`pytest-cov` for Python, `@vitest/coverage-v8` for the frontend). Neither is
installed here, which is why the README names no percentage; see [D16](DECISION-LOG.md).

**Cookie jar** — the store of cookies a browser profile keeps. Two windows of one profile
share one jar, which is why three personas signed in at once need three *profiles* rather
than three windows: the refresh cookie is scoped to `localhost:3000` and the second sign-in
overwrites the first.

**Pre-flight check** — a thing you verify before an audience exists, because its failure
mode during a demo is indistinguishable from the application being broken. The demo
script's are: health endpoint, a non-empty unassigned queue, and a dashboard whose date
range still covers the seeded history.

# Project Guide — ACME Facility Incident Management

**Who this is for.** The owner of this repository, who did not write the code and
needs to understand every part of it in depth. It assumes you can read Python and
TypeScript but not that you know FastAPI, SQLAlchemy, Terraform, CloudFront or
this workshop's scaffold. Every non-obvious term is defined in the glossary of the
phase where it first appears.

**How this differs from the README.** The README is for graders: setup steps,
architecture summary, how to run the tests. This guide is the *why* — the
decisions, the alternatives that were rejected, and the things that will bite you.

**How it is written.** One section per build phase, appended while the reasoning
was still fresh. [docs/BUILD-PLAN.md](BUILD-PLAN.md) says what each phase builds;
[CLAUDE.md](../CLAUDE.md) holds the scaffold constraints that are not negotiable.
Where a decision was *forced* by the scaffold or the AWS IAM boundary rather than
freely chosen, this guide says so explicitly.

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
| [src/main.tsx](../frontend/src/main.tsx) | Mounts React and wraps the app in the four providers: TanStack Query, MUI theme, `CssBaseline`, React Router. |
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

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
| Which rows a list may show at all | `app/services/visibility.py` — `apply_visibility`, before any user filter |
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
| What counts as an escalation somebody can still act on | `app/repositories/reports.py` → `_live_escalation_clauses` |
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

**`date_trunc` and `::date` on a `timestamptz` use the session time zone.** `app/db.py`
pins it to UTC via `build_connect_args`, and the test fixtures build their engine the same
way. Without that pin, the daily series would bucket differently on a developer's machine
than in the Lambda — the same instants, different days.

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
status filter, which is what `_live_escalation_clauses()` exists for. `/reports/summary`'s
`escalated_total` deliberately does not add one, because it is a period report counting
what happened during the window. If you add a third place that reads the flag, decide
which of those two questions you are asking before you write the `WHERE`. See
[decision D10](DECISION-LOG.md).

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

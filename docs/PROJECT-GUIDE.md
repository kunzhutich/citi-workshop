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

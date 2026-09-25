# CLAUDE.md — ACME Facility Incident Management Platform

## What this is

A Citi coding-workshop submission built **inside the provided scaffold** at
`github.com/citi/coding-workshop-participant`. We are implementing a facility
incident management platform for "ACME Inc." (employees report workplace/facility
issues; admins define facilities and assign work; engineers resolve tickets).

The full build plan lives in [readme/BUILD-PLAN.md](readme/BUILD-PLAN.md). Read it before
starting a phase.

**This repo is not an empty starter.** `infra/` and `bin/` are pre-built, and the AWS
role we deploy with has a narrow IAM boundary. Most "just write some Terraform"
instincts are wrong here. The constraints below are non-negotiable — they come from
the harness, not from preference.

## Hard constraints (violating these breaks the deploy)

### Backend service discovery
`infra/locals.tf` globs `backend/*/requirements.txt`, one level deep, skipping dirs
starting with `_` or `.`. Every match becomes its own Lambda.

- We ship **exactly one** service: `backend/v1/`.
- `backend/v1/requirements.txt` and `backend/v1/function.py` must sit at that
  directory's root.
- The Lambda handler is hardcoded to **`function.handler`**. `function.py` must
  expose a module-level `handler`.
- Runtime is hardcoded to **python3.13**. Not 3.12.
- **Never** create another `backend/<name>/` dir with a `requirements.txt` — it
  silently provisions a second Lambda with a *public, unauthenticated* Function URL.
- Same trap in `data/`: a `requirements.txt` there triggers EKS + Helm. Leave it alone.

### API paths
`infra/cloudfront.tf` creates `path_pattern = "/api/<service-dir-name>*"` and forwards
the **full, unmodified path** to the Lambda. Our service dir is named `v1`, so:

- All routes are mounted under **`/api/v1/...`**.
- The Lambda sees `/api/v1/auth/login` — the prefix is **not** stripped.
- Local dev must match. Use Vite's own dev proxy (`frontend/vite.config.ts`) forwarding
  `/api` to uvicorn on :8000 unchanged. **Do not use `bin/proxy-server.js`** — it strips
  the `/api/<name>` prefix and would make local paths differ from deployed ones.

### Database
Postgres locally, Aurora PostgreSQL 17.7 in the cloud. Same wire protocol, same SQL,
same Alembic migrations — write standard PostgreSQL and it works in both.

Connection details arrive as env vars injected by `infra/locals.tf`. Never hardcode them:

| Var | Local | Cloud |
| --- | --- | --- |
| `IS_LOCAL` | `true` | `false` |
| `POSTGRES_HOST` | `172.17.0.1` (docker bridge) | Aurora endpoint |
| `POSTGRES_PORT` | `5432` | `5432` |
| `POSTGRES_NAME` | `postgres` | `codingworkshop` |
| `POSTGRES_USER` | `postgres` | `superadmin` |
| `POSTGRES_PASS` | `postgres123` | generated |

Build the SQLAlchemy URL from these, and append `sslmode=require` when
`IS_LOCAL == "false"`. There is **no** `DATABASE_URL` env var and no `docker-compose.yml`
— local Postgres is installed on the host.

Aurora is `publicly_accessible = false`, so it is **unreachable from the VDI**.
Migrations and seeding run via direct Lambda invoke (see below), never from a laptop.

Aurora Serverless v2 has `min_capacity = 0.0`: it sleeps when idle and takes ~15s to
wake. A hung first request after a quiet period is usually this, not a bug.

**Confirmed deployed, and it can be worse than a hang:** the first `migrate` invoke failed
with `server closed the connection unexpectedly` and succeeded on an immediate retry.
**Retry once before investigating.** Before a demo, load the page about a minute ahead.

### Migrations and seeding
`function.py` dispatches on a non-HTTP event shape so we need no second Lambda and no
public endpoint:

```python
_asgi = Mangum(app, lifespan="off")

def handler(event, context):
    action = (event or {}).get("action")
    if action:                       # direct invoke only, never via CloudFront
        return run_ops(action, event)   # "migrate" | "seed_admin" | "seed_demo"
    return _asgi(event, context)
```

Run with `aws lambda invoke --payload '{"action":"migrate"}'`. This is IAM-protected.
Refuse `seed_demo` when the environment is production — **unless** the payload carries
`"i_understand_this_publishes_demo_credentials": true`, the deliberate opt-in that lets a
sandbox demo have real data. It was used once on the deployed database, which therefore
holds 37 accounts sharing a password published in this repo. There is no `unseed_demo`.

## Local development

```sh
# terminal 1 — API
cd backend/v1 && uvicorn app.main:app --reload --port 8000

# terminal 2 — UI
cd frontend && npm run dev          # :3000, proxies /api -> :8000
```

No LocalStack, no Lambda emulation, no Docker needed for day-to-day work. LocalStack is
only relevant if we deliberately test the packaged Lambda path.

Because the browser only ever talks to `localhost:3000`, local is **same-origin** just
like CloudFront is. `SameSite=Strict` HttpOnly refresh cookies therefore work in both;
drive the `Secure` flag from config (false locally, true deployed).

## Deployment

Use the provided scripts. Do not write parallel ones.

```sh
./bin/setup-participant.sh      # refresh STS creds (they expire every few hours)
source ENVIRONMENT.config
./bin/deploy-backend.sh         # terraform apply; auto-discovers backend/v1
./bin/deploy-frontend.sh        # npm run build -> S3 -> CloudFront invalidation
```

The IAM boundary (`infra/policy.tftpl`) grants `s3/lambda/rds/sqs/logs/iam/secretsmanager`
**only** on ARNs matching `coding-workshop*1bd1dfd7*`, plus unrestricted `cloudfront:*`
and read-only `ec2:Describe*`. It does **not** grant `ec2:CreateVpc`, `ec2:CreateSubnet`,
`apigateway:*`, `eks:*` or `docdb:*`.

So: do not author a VPC, subnets, an API Gateway, or a Terraform state bucket. The VPC and
security group are pre-provisioned and adopted by `infra/data.tf`; the state bucket already
exists. Deployment is Lambda Function URLs behind CloudFront — there is no API Gateway.

**Deployed and live (2026-09-23): <https://d3jo3ezb7ss05m.cloudfront.net>** — Lambda
`coding-workshop-v1-1bd1dfd7`, Aurora `coding-workshop-rds-1bd1dfd7`, account `332991882156`
(shared with other participants), `us-east-2`. The IAM boundary permits everything `infra/`
asks for. See `readme/BUILD-STATUS.md` § "The AWS deployment" and `readme/DEPLOYMENT-CHECKLIST.md`,
where 30 of 68 cloud checks now carry an observation and 36 do not.

Permitted `infra/` edits, kept minimal and commented:
- `lambda.tf` — raise `memory_size` from 128 (too small for FastAPI + SQLAlchemy) to 512.
- `locals.tf` — add app env vars (e.g. `JWT_SECRET`) to `local.env_vars`.
- `cloudfront.tf` — `compress = true` on the default and API behaviours. Approved by the
  workshop organisers and applied; 994 kB raw against 309 kB gzipped. See D37.
- `cloudfront.tf` — **must fix**: the distribution-wide `custom_error_response` maps 404 →
  200 `/index.html`, which would rewrite our API's 404s and directly violate the rubric.
  Replace it with a CloudFront Function on the default behavior that rewrites
  extension-less paths to `/index.html`, so SPA routing survives without touching `/api/*`.

`ENVIRONMENT.config` holds live STS credentials. It is gitignored. Never commit it, never
echo its contents, never paste them into logs or chat.

## Conventions

Derived from `.github/instructions/` (written for Copilot; they are the house style and
graders will read the code with them in mind).

**Python** — snake_case, PEP 8, type annotations on everything, docstrings on public
members. Prefer explicit readable code over clever one-liners: clear names, small
functions, early returns, no deeply nested comprehensions.

**React/TypeScript** — we use TypeScript (`.tsx`), which supersedes the instructions'
PropTypes guidance; keep the camelCase/PascalCase and Airbnb-style conventions. Material
UI for components, `react-responsive` for layout switching.

**Styling — no component stylesheets.** What this rules out is the `Catalog.tsx` +
`Catalog.css` pattern: a hand-written stylesheet shadowing a component, so the styling
for one thing lives in two files. Style components *in place* instead:

- `sx={{ ... }}` for one-off layout, spacing and colour on a specific instance.
- `styled()` when the same treatment is reused, or when a plain element needs theming.
- `theme.ts` for anything global — palette, typography, shape, component default props
  and variants. `CssBaseline` is the only reset we need.

Hand-written stylesheets, CSS modules and utility-class frameworks are out. Prefer theme
tokens (`theme.palette.*`, `theme.spacing()`) over literal values so the look stays
consistent.

This is a rule about *our* styling, not a ban on the string `.css`. Importing a
stylesheet a third-party package ships — `@fontsource/inter/latin-400.css`, say — is
ordinary use of that package and needs no justification: it is not a stylesheet shadowing
a component of ours. Keep such imports together in one module so they are easy to find.

Genuine exceptions do exist — `@keyframes`, a `<style>` block with no MUI equivalent.
**Judging those is Claude's call:** take the exception when it is clearly right, keep it
as small and local as possible, and note it in the phase summary rather than stopping to
ask.

**Terraform** — snake_case, comment every resource we add, `terraform validate` before
committing.

**Git** — conventional commits (`feat:`, `fix:`, `test:`, `infra:`, `docs:`), one branch
per phase.

## Architecture rules

- Business rules live in exactly one place each. The workflow state machine is
  `app/workflow.py` as **data** (a transition table), never `if/else` chains in routes.
  Permission checks live in `security/dependencies.py` plus the service layer. Visibility
  filtering is one function applied to the query, never in a serializer.
- `GET /api/v1/incidents/{id}/allowed-transitions` is the single source of truth for what
  actions a user may take. The frontend renders buttons and dialog fields **exclusively**
  from it — workflow rules are never duplicated in the UI.
- Code layout is **layer-first**: `routers/`, `services/`, `repositories/`, `models/`,
  `schemas/`, `security/`, each holding one module per domain.
- Every phase ships with tests for the rules it introduces. Build each phase as a
  **vertical slice** (migration → endpoint → test → screen) so the app is demoable
  end-to-end at all times.

## The living guide — `readme/PROJECT-GUIDE.md`

This project has a second audience beyond the graders: **the repo owner, who needs to
understand every part of it in depth after it is built.** Assume they did not write the
code and will read the guide cold.

Maintain `readme/PROJECT-GUIDE.md` **as you build, not afterwards.** Every phase's
stop-and-summarize step includes appending that phase's section. A guide written at the
end from memory is worth a fraction of one written while the reasoning is fresh.

Each phase's section covers:

1. **What was built** — the files added or changed, and the responsibility of each.
2. **Why it is shaped this way** — the decision *and the alternatives rejected*. "Layer-first
   because…", "bcrypt directly rather than passlib because…". Reasoning, not restatement.
3. **How the pieces connect** — trace one real request end to end, hop by hop, naming every
   file it passes through. For example: browser click → axios `api/incidents.ts` → Vite proxy
   → `routers/incidents.py` → `security/dependencies.py` → `services/incident_service.py` →
   `workflow.py` → `repositories/incidents.py` → SQL → response → TanStack Query cache → re-render.
4. **Where the rules live** — a rule-to-file map, so any behavior can be located in one hop.
5. **How to change it** — short recipes: "to add an incident field, touch these five files in
   this order"; "to add a workflow transition, add one row to `workflow.py` and one test".
6. **Gotchas** — anything surprising, easy to break, or discovered the hard way.
7. **Glossary** — plain-language definitions of every non-obvious term as it first appears:
   ASGI, Mangum, Alembic, `tsvector`, GIN index, OAC, ACU, refresh-token rotation, and so on.
   One or two sentences each, written for someone meeting the term for the first time.

Prefer concrete file paths, real code excerpts and diagrams over abstract prose. When a
decision was forced by the scaffold or the IAM boundary rather than chosen freely, say so
explicitly — that distinction matters to the reader.

This is **not** the README. The README is setup and architecture for graders; the guide is a
deep explanation for the owner. Keep them separate.

## Project structure

```
backend/v1/                  # the one Lambda
├── function.py              # handler = Mangum(app) + ops dispatch
├── requirements.txt
├── alembic.ini  alembic/versions/
├── app/
│   ├── main.py  config.py  db.py  workflow.py
│   ├── routers/       auth users facilities categories engineers incidents notes reports
│   ├── services/      incident_service assignment categories reporting visibility
│   ├── repositories/  incidents facilities engineers
│   ├── models/        user engineer_profile building floor seat category incident note event
│   ├── schemas/       (mirrors models)
│   └── security/      passwords.py tokens.py dependencies.py
└── tests/             unit/ integration/ conftest.py

frontend/src/
├── api/  auth/  layout/  hooks/  components/
└── features/  incidents facilities categories engineers users dashboards
```

Leave `backend/_examples/`, `data/`, `infra/helm/`, `infra/eks.tf` and
`infra/documentdb.tf` untouched — they belong to other workshop tracks.

# Deployment Checklist

Everything that **cannot be verified without live AWS credentials**, with the exact
command to run and what a correct result looks like.

---

## ✅ The deployment has run — 2026-09-23

**This list is no longer hypothetical.** Every item below used to say "unrun". The stack
is now live, and each item carries a status line recording what was actually observed
against it.

**Live URL: <https://d3jo3ezb7ss05m.cloudfront.net>**

| | |
| --- | --- |
| CloudFront distribution | `E2VHVFRYPQ6HKT` |
| Lambda | `coding-workshop-v1-1bd1dfd7` |
| Aurora cluster | `coding-workshop-rds-1bd1dfd7` — PostgreSQL **17.7**, database `codingworkshop` |
| S3 bucket | `coding-workshop-website-1bd1dfd7` |
| AWS account | `332991882156` — **shared with other workshop participants** |
| Region | `us-east-2` |

**What the apply did.** `terraform apply` reported **`10 added, 1 changed, 0 destroyed`**
on its first run. This was an *update*, not a cold start: infrastructure from an earlier
partial deploy on **2026-09-22** — Aurora, CloudFront and S3 — was already present from
before the application existed. The additions were the **Lambda**, its **SQS dead-letter
queue**, **`JWT_SECRET`**, and the **CloudFront Function** for SPA routing.

**The IAM boundary permits everything `infra/` asks for.** That was the open question
behind every "will the deploy even run" worry in this file, and the answer is yes.

### How each item is marked

Each numbered item now opens with one of four status lines. **Read the words, not the
symbol** — several items are only partly answered, and a partial answer is not a pass.

| Marker | Means |
| --- | --- |
| **✅ VERIFIED** | Observed in the cloud. The item's own success criterion was met. |
| **🟡 PARTLY VERIFIED** | Something real was observed, but not the whole check. The status line says exactly which half is proven and which is not. |
| **⬜ STILL UNVERIFIED** | The deployment did not exercise this. The item stands as written; run it. |
| **♻️ SUPERSEDED** | The premise changed. The item as written is wrong and the status line says what replaced it. |

**Nothing here was inferred from a green test run.** Every ✅ traces to something measured
against the deployed stack. Where an item's conclusion rests on a chain of reasoning
rather than on that exact command being run, the status line says so.

### The new totals

| Status | Items | |
| --- | --- | --- |
| ✅ **Verified** | **16** | 1.1 – 1.4, 1.6, 2.1, 2.3, 2.5, 2.8, 3.1, 4.1, 5.5, 5.6, 7.8, 8.1, 9.1 |
| 🟡 **Partly verified** | **14** | 1.5, 2.6, 3.3, 3.6, 5.2, 5.8, 6.7, 7.1, 7.3, 7.9, 7.10, 8.6, 8.8, 9.4 |
| ♻️ **Superseded** | **2** | 7.5, 7.6 |
| ⬜ **Still unverified** | **36** | everything else |
| **Total** | **68** | |

**So: 30 of 68 items now carry a cloud observation, and 36 do not.** The deployment
proved the things that would have stopped it dead — the IAM boundary, the Lambda package,
`CREATE EXTENSION`, `JWT_SECRET`, the CloudFront 404 fix, the migration path — and left
most of the per-endpoint behavioural checks (M4, M6, S6's logging and lockout items)
untouched. Those are the ones to walk next.

**The actionable count changed.** This file used to say 66 actionable checks, because 7.8
was unrunnable while 7.5 stood and 9.5 is a statement rather than a check. **7.5 no longer
stands** (the seeder gained an explicit opt-in), 7.8 has now run, and so there are **67
actionable checks** with 9.5 the only item that is not one.

### What deploying found that nothing else could

Two defects, both fixed before this pass and both recorded:

- **[D38](DECISION-LOG.md#d38--correcting-d36-the-login-loop-was-a-redirect-not-a-cache)** —
  a login loop between the change-password screen and the sign-in screen. Found by
  item **5.5**, which is the whole reason that item exists.
- **[D36](DECISION-LOG.md#d36--the-deployed-app-could-not-be-signed-into-and-only-the-deployed-app)** —
  API responses carried no `Cache-Control` header, so a browser was free to invent a
  freshness lifetime for `/auth/me`. Found while chasing D38.

Neither could appear locally: the Vite dev proxy does not cache, and a redirect loop
needs a real session revocation behind a real distribution. See **D39** for what that
costs and what it bought.

---

Built up phase by phase while the reasoning was fresh. Nothing here is a known defect —
each item is something that was designed and tested locally but whose cloud behaviour
depends on Aurora, Lambda, CloudFront or the participant IAM role, none of which are
reachable from the VDI.

**How to use this now:** the first walk has happened. Work through the ⬜ items; re-run
the whole list after a deploy that changes infrastructure.

**How much there is.** **68 numbered items** across nine phase sections, numbered `N.M`
where `N` is the phase:

| Section | Items | | ✅ | 🟡 | ♻️ | ⬜ |
| --- | --- | --- | --- | --- | --- | --- |
| Before anything else | — | credentials, no numbered items | — | — | — | — |
| M1 — Scaffold and walking skeleton | 6 | 1.1 – 1.6 | 5 | 1 | — | — |
| M2 — Data model, auth and RBAC | 8 | 2.1 – 2.8 | 4 | 1 | — | 3 |
| M3 — Facilities, categories, engineers, users | 6 | 3.1 – 3.6 | 1 | 2 | — | 3 |
| M4 — Incidents and workflow | 7 | 4.1 – 4.7 | 1 | — | — | 6 |
| M5 — Frontend shell and auth | 8 | 5.1 – 5.8 | 2 | 2 | — | 4 |
| M6 — Persona screens | 8 | 6.1 – 6.8 | — | 1 | — | 7 |
| M7 — Dashboards and demo data (three passes) | 12 | 7.1 – 7.12 | 1 | 4 | 2 | 5 |
| S6 — Hardening | 8 | 8.1 – 8.8 | 1 | 2 | — | 5 |
| S1 — In-app notifications | 5 | 9.1 – 9.5 | 1 | 1 | — | 3 |
| **Total** | **68** | | **16** | **14** | **2** | **36** |

Below the items, "Not yet verifiable, by design" lists a further **8 declared gaps** which
are not items and have no commands. **Two of those eight are no longer blocked** — see
that section.

There are no `- [ ]` checkboxes — this is prose organised by numbered headings, and the
numbered headings are the items.

> **Numbering note.** S1's items were `10.1`–`10.5` until this pass and are now
> `9.1`–`9.5`. There was never a section 9; the jump was a slip, and S1 is the ninth
> section. Nothing outside this file referenced the old numbers.

## Before anything else

```sh
./bin/setup-participant.sh          # refresh STS credentials (they expire in hours)
source ENVIRONMENT.config
aws sts get-caller-identity         # expect an account id, not ExpiredToken
```

✅ **Done, 2026-09-23.** `setup-participant.sh` works and the account is provisioned:
`332991882156`, region `us-east-2`. Credentials still expire in hours, so this step is
still the first thing to do on any later pass.

⚠️ **The account is shared with other workshop participants.** Everything you create is
visible to them and, for CloudFront, writable by them — see
[`INFRA-CHANGES.md`](INFRA-CHANGES.md) § "What the deployment revealed about the IAM
boundary". Scope your commands by the participant id (`1bd1dfd7`) rather than listing
and acting on whatever comes back.

---

## M1 — Scaffold and walking skeleton

### 1.1 Lambda packaging excludes the virtualenv

> ✅ **VERIFIED, 2026-09-23.** `terraform apply` succeeded — `10 added, 1 changed, 0
> destroyed` — and the function runs. That is the failure mode this item guards: an
> unfiltered 150 MB package breaks the 250 MB limit and **fails the apply outright**, so
> a successful apply plus a working Lambda is the proof. **Not captured:** the actual
> `CodeSize` figure. Run the `get-function-configuration` query below if you want the
> number on record.

**Why it needs the cloud.** The exclusion is done by
`patterns = ["!__pycache__/.*", "!\\..*"]` in `infra/locals.tf`, interpreted by the
`terraform-aws-modules/lambda` module at package time. It is read from config, never
executed locally.

**Risk if wrong.** `backend/v1/.venv` is roughly 150 MB. Lambda's hard limit is 250 MB
unzipped, so an unfiltered package fails the deploy outright.

```sh
./bin/deploy-backend.sh
```

✅ **Correct result:** apply succeeds. Then confirm the package is small:

```sh
aws lambda get-function-configuration \
  --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --query 'CodeSize'
```

✅ Expect roughly 30–60 MB (FastAPI, SQLAlchemy, psycopg binary). ❌ Over 150 MB means
the venv was packaged — check the `.venv` directory is still dot-prefixed.

### 1.2 Memory of 512 MB is enough to import the app

> ✅ **VERIFIED, 2026-09-23.** A 512 MB Lambda imports FastAPI, SQLAlchemy and psycopg
> within its timeout. No `Runtime.OutOfMemory`, and the function serves requests.
> **Not captured:** the `Max Memory Used` figure from the log tail, so there is no
> recorded headroom margin — only that it fits. Worth grabbing on the next pass, because
> "fits" and "fits comfortably" are different answers if a dependency is ever added.

**Why it needs the cloud.** Cold-start memory use in the Lambda runtime is not
observable locally.

```sh
aws lambda invoke --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --payload '{"action":"health"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

✅ **Correct result:** `{"ok": true, ...}`. Then check the reported memory:

```sh
aws logs tail "/aws/lambda/coding-workshop-v1-${PARTICIPANT_ID}" --since 5m \
  | grep "Max Memory Used"
```

✅ Expect Max Memory Used comfortably under 512 MB. ❌ A `Runtime.OutOfMemory` error or
a figure at the 512 ceiling means raise `memory_size` in `infra/lambda.tf` again.

### 1.3 CloudFront forwards `/api/v1` without stripping the prefix

> ✅ **VERIFIED, 2026-09-23.** The whole routing design rests on this and it holds. An
> unauthenticated call to an API path returns **401 from the application** — which it
> could only do if the request reached FastAPI *at the path FastAPI expects*. A stripped
> prefix produces a FastAPI "Not Found" instead, and a non-matching path pattern produces
> a CloudFront 404. Neither happened, and the deployed app signs users in and serves
> data. **Not captured:** the `/api/v1/health` body, so `"environment": "aws"` and
> `"database": {"status": "ok"}` are not on record verbatim.

**Why it needs the cloud.** The whole routing design rests on this. Locally the Vite
proxy is *configured* to behave the same way, but that is our configuration, not
CloudFront's behaviour.

```sh
CF=$(cd infra && terraform output -raw cloudfront_distribution_url)
curl -s "https://$CF/api/v1/health" | jq .
```

✅ **Correct result:** the health JSON, with `"environment": "aws"` and
`"database": {"status": "ok", ...}`. ❌ A 404 means the path pattern did not match; a
FastAPI "Not Found" means the prefix *was* stripped.

### 1.4 The SPA CloudFront Function does not touch the API

> ✅ **VERIFIED, 2026-09-23. This is the important one, and it works.**
>
> - **The API is not rewritten.** An unauthenticated API call returns **401**, not a 200
>   serving `index.html`. That is the rubric violation this change exists to prevent, and
>   it is gone.
> - **SPA deep links survive.** `/tickets` returns **200**.
>
> The `infra/cloudfront.tf` change — the one item in
> [`INFRA-CHANGES.md`](INFRA-CHANGES.md) with **no workaround** — is confirmed working in
> the cloud.
>
> **Not captured:** the literal `/api/v1/no-such-route` → 404 call. A 401 proves the
> behaviour is not being rewritten just as well as a 404 would, but the 404 is the case
> the item names, so run it for completeness. 3.3 and 8.6 cover the same ground.

**Why it needs the cloud.** `aws_cloudfront_function.spa_router` runs only at a
CloudFront edge. There is no local equivalent.

This is the item that most directly protects the rubric: the scaffold's
`custom_error_response` was replaced precisely so the API's own 404s survive.

```sh
curl -s -o /dev/null -w '%{http_code}\n' "https://$CF/api/v1/health"        # expect 200
curl -s -o /dev/null -w '%{http_code}\n' "https://$CF/api/v1/no-such-route" # expect 404
curl -s -o /dev/null -w '%{http_code}\n' "https://$CF/"                     # expect 200
curl -s -o /dev/null -w '%{http_code}\n' "https://$CF/some/deep/link"       # expect 200
curl -s "https://$CF/some/deep/link" | head -3                              # expect index.html
```

✅ **Correct result:** exactly as annotated above. ❌ If `/api/v1/no-such-route` returns
**200 with HTML**, the old `custom_error_response` is still in place — the deploy did not
pick up the `infra/cloudfront.tf` change.

### 1.5 The status page renders against the real API

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven, and more strongly than this item asks:**
> the deployed frontend renders against the real API — sign-in works for the demo
> accounts, persona home screens load, and the dashboard renders. That is the whole of
> what a walking-skeleton status page was ever a proxy for.
>
> **Not done:** nobody opened `/status` itself
> (`frontend/src/features/status/StatusPage.tsx`, routed at `/status` in
> `frontend/src/App.tsx`), so the three literal strings — "API healthy", "Database ok",
> "Environment: aws" — are not on record. It is a public route and a five-second check.

```sh
./bin/deploy-frontend.sh
```

✅ **Correct result:** opening the CloudFront URL shows "API healthy", "Database ok" and
"Environment: aws". ❌ "The API could not be reached" means 1.3 failed.

### 1.6 Aurora cold start

> ✅ **VERIFIED — and it is worse than the item predicted. 2026-09-23.**
>
> **The cold start is real and was observed twice, in two different shapes:**
>
> 1. **The first `{"action":"migrate"}` invoke failed outright** with `server closed the
>    connection unexpectedly`. The second, immediately after, succeeded. So the first
>    request against a sleeping cluster does **not** reliably "take 15–25 s and then
>    succeed" — it can be **dropped**. That is a correction to this item's success
>    criterion, not a defect in the application.
> 2. **Six seconds after signing in**, the engineer home screen still showed **three
>    "Loading…" spinners** while Aurora woke.
>
> **What this means for a demonstration:** load the deployed page **about a minute
> before** anybody is watching. That is the entire mitigation and it is free.
> `docs/DEMO-SCRIPT.md` § "Demonstrating from the deployed URL" carries the instruction.
>
> **The alternative, deliberately not taken:** raising `min_capacity` from 0 to 0.5 would
> remove the wait, but it bills continuously on a **shared sandbox account** and deviates
> from the scaffold's default. Not worth it for a workshop demonstration.
>
> **Not captured:** a timed `/api/v1/health` after a measured ~15-minute idle, so there is
> no single number for "how long the wake takes". The two observations above bracket it.

**Why it needs the cloud.** `min_capacity = 0.0` has no local analogue.

Leave the app idle for ~15 minutes, then request `/api/v1/health` and time it.

✅ **Correct result:** the first request takes roughly 15–25 s and then succeeds;
subsequent requests are fast. ❌ A timeout means `postgres_connect_timeout` (30 s in
`app/config.py`) is too low for this cluster.

⚠️ **Amended by what was observed.** Treat a **dropped connection** on the first call as
the expected cold-start behaviour too, not only a slow one. Retry once before
investigating anything: that is what worked for the migration invoke.

---

## M2 — Data model, auth and RBAC

### 2.1 The migration's `CREATE EXTENSION` succeeds on Aurora

> ✅ **VERIFIED, 2026-09-23. The single highest-risk item in this file, and it passed.**
>
> **`pgcrypto` and `citext` both create on Aurora** as `superadmin`. Every primary key in
> the schema depends on `gen_random_uuid()` and `users.email` is `CITEXT`, so nothing
> would have existed without this. The `{"action":"migrate"}` invoke upgraded the schema
> to head and seeded **5 category groups**, which is this item's expected
> `groups_created: 5`.
>
> The recovery plan below — a separate bootstrap step for the two `op.execute` calls — is
> **not needed** and can stay unread.
>
> ⚠️ **It took two invokes.** The first was dropped by a sleeping Aurora (see
> [1.6](#16-aurora-cold-start)); the second succeeded. That is a cold start, not a
> permission failure — the two look nothing alike in the response, so read the error
> before concluding anything.
>
> **Not captured:** the `subcategories_created: 32` half of the response, only the groups
> count.

**Why it needs the cloud.** Locally we connect as a PostgreSQL superuser. On Aurora the
master user is `superadmin`, which holds `rds_superuser`, **not** true superuser.
`pgcrypto` and `citext` are both on the RDS-supported extension list, so this is
expected to work — but "expected" is not "verified", and every table in the schema
depends on it: `gen_random_uuid()` is the default for every primary key and `CITEXT` is
the type of `users.email`.

**This is the single highest-risk item in the checklist.** If it fails, no table gets
created at all.

```sh
aws lambda invoke --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --payload '{"action":"migrate"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

✅ **Correct result:**

```json
{"ok": true, "action": "migrate", "result": {
  "schema": "upgraded to head",
  "categories": {"groups_created": 5, "subcategories_created": 32, "already_present": 0,
                 "groups": ["Hardware", "Software", "Network & Access",
                            "Meeting Rooms", "Building & Facilities"]}}}
```

❌ `permission denied to create extension "pgcrypto"` means the master user lacks the
grant. Recovery: run `CREATE EXTENSION` once as `superadmin` via a separate one-off
ops action, or move the two `op.execute` calls out of the migration into a bootstrap
step. Do not change the primary key defaults — that would fork the schema from the
models.

### 2.2 The migration is idempotent against Aurora

> ⬜ **STILL UNVERIFIED.** `migrate` was invoked twice, but the **first attempt failed on
> a dropped connection** before it did any work — so there has only ever been **one
> completed run** against Aurora. A completed second run reporting `"already_present":
> 37` with zero created has not been seen.
>
> This is a one-command check and it is cheap. Run it.

Run the exact same command a second time.

✅ **Correct result:** `"already_present": 37` and `groups_created: 0`,
`subcategories_created: 0`. Nothing is duplicated. ❌ Any non-zero created count on the
second run means the `(parent_id, name)` lookup is not matching — check that the
`NULLS NOT DISTINCT` unique index exists (2.3).

### 2.3 Schema objects Aurora may treat differently

> ✅ **VERIFIED — for creation. 2026-09-23.** The engine is **PostgreSQL 17.7**, as
> expected. All four objects in the table below are DDL in revision `0001`
> (`backend/v1/alembic/versions/0001_initial_schema.py`), and the migration **reached
> head without error**, so Aurora accepted every one of them:
>
> - `uq_categories_parent_id_name` — `postgresql_nulls_not_distinct=True`, line 130
> - `incidents.search_vector` — `sa.Computed(..., persisted=True)`, line 221
> - `ix_incidents_search_vector` — `postgresql_using='gin'`, line 244
> - `incident_ticket_seq` — `nextval(...)` default, line 196
>
> The fallback to a partial unique index is **not needed**.
>
> ⚠️ **What is proven is that Aurora *created* them, not that they *behave*.** Nobody has
> confirmed on Aurora that `NULLS NOT DISTINCT` actually refuses a duplicate group name,
> or that the GIN index is used rather than sequentially scanned. Those are
> [2.2](#22-the-migration-is-idempotent-against-aurora) and
> [4.3](#43-full-text-search-works-on-auroras-english-configuration), both still open.

**Why it needs the cloud.** Verified locally on PostgreSQL **18.6**; Aurora is
PostgreSQL **17.7**. Every feature used is 15-or-earlier, so this should hold, but the
version gap is real and worth one explicit check.

Run via a one-off `psql` from the Lambda is not possible, so check through the migration
test's assertions after deploy by invoking `{"action":"health"}` and then inspecting:

```sh
aws rds describe-db-clusters --db-cluster-identifier "coding-workshop-${PARTICIPANT_ID}" \
  --query 'DBClusters[0].EngineVersion'
```

✅ Expect `17.7`. The specific objects to confirm, all asserted by
`tests/integration/test_migration.py` locally:

| Object | Feature | Introduced in |
| --- | --- | --- |
| `uq_categories_parent_id_name` | `UNIQUE ... NULLS NOT DISTINCT` | PostgreSQL 15 |
| `incidents.search_vector` | `GENERATED ALWAYS AS ... STORED` | PostgreSQL 12 |
| `ix_incidents_search_vector` | GIN index on `tsvector` | long-standing |
| `incident_ticket_seq` | `CREATE SEQUENCE AS BIGINT` | PostgreSQL 10 |

❌ If `NULLS NOT DISTINCT` is rejected, two category groups could share a name. Fall back
to a partial unique index on `(name) WHERE parent_id IS NULL`.

### 2.4 `seed_admin` creates a usable first account

> ⬜ **STILL UNVERIFIED.** No `seed_admin` invoke was recorded against Aurora.
>
> **But it is no longer the only way in.** `seed_demo` has since run against the deployed
> database ([7.6](#76-seeding-the-review-database-if-you-decide-you-want-demo-data-there)),
> and it creates `demo.admin@acme.inc` — a `FACILITY_ADMIN` whose
> `must_change_password` is false. So the deployed app **does** have a working admin, and
> the premise of this item ("the only way to get an admin into the deployed database") is
> weaker than when it was written.
>
> Run it anyway if you want the forced-password-change path proven from a fresh account;
> [5.5](#55-the-seeded-admins-forced-password-change-works-end-to-end) is the item that
> depends on it, and 5.5 **was** exercised — see its status line.

**Why it needs the cloud.** It is the only way to get an admin into the deployed
database — self-registration always produces an EMPLOYEE.

```sh
aws lambda invoke --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --payload '{"action":"seed_admin","email":"admin@acme.inc","full_name":"Facility Admin"}' \
  --cli-binary-format raw-in-base64-out /dev/stdout
```

✅ **Correct result:** `"created": true` and a `temporary_password` in the response.
**Capture it now — it is shown exactly once and is stored only as a bcrypt hash.**
The account has `must_change_password: true`, so the first sign-in must change it.

⚠️ The invoke response is written to your terminal. It is not logged by the application,
but do not paste it into chat, a ticket or a shared shell transcript.

❌ `"created": false` with "already exists" means an admin was seeded before; use that
account, or pick a different email.

### 2.5 `JWT_SECRET` reaches the Lambda

> ✅ **VERIFIED, 2026-09-23.** `JWT_SECRET` reaches the Lambda and is **64 characters**,
> which is `random_password.jwt_secret` arriving intact through `infra/locals.tf`. The
> `trimspace(value) != ""` guard in `infra/lambda.tf` did not filter it out.
>
> This was the addition that most needed proving out of the four the apply made, and the
> application signs and verifies real tokens with it — every demo account signs in.
>
> ⚠️ **Note on numbering.** This item is **2.5**. It is occasionally referred to as "7.5";
> 7.5 is the unrelated `seed_demo` guard. `JWT_SECRET` is 2.5, and its negative
> counterpart — what happens when the secret is absent — is
> [3.1](#31-the-lambda-refuses-to-start-without-a-real-jwt_secret).

**Why it needs the cloud.** Locally the value comes from a development default in
`app/config.py`. In the cloud it comes from `random_password.jwt_secret` via
`infra/locals.tf`.

```sh
aws lambda get-function-configuration \
  --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --query 'Environment.Variables.JWT_SECRET' --output text | wc -c
```

✅ **Correct result:** 65 (64 characters plus a newline). ❌ `None` means the variable was
filtered out by the `trimspace(value) != ""` guard in `infra/lambda.tf` — check the
`random_password` resource applied.

⚠️ Do not print the value itself. Rotating it later invalidates every live access token,
which is a forced logout for all users, not a data-loss event.

### 2.6 The refresh cookie survives CloudFront

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven:** the deployed application sustains a
> signed-in session. The D36/D38 reproductions were driven headless **against the
> deployed URL** through a login → change-password → login sequence, and sign-in now
> lands on the dashboard rather than looping. A distribution that stripped `Set-Cookie`
> entirely could not produce that.
>
> **Not measured:** the header itself. Nobody has looked at the `set-cookie` line to
> confirm `HttpOnly; Secure; SameSite=strict; Path=/api/v1/auth`, and the `Secure` flag
> in particular has **never been exercised deliberately** — it is off locally by design.
> Nor has a `curl` rotation against `/api/v1/auth/refresh` been run.
>
> Run the two `curl`s below. They take a minute and they close the only remaining doubt
> about the cookie.

**Why it needs the cloud.** `SameSite=Strict` and `Secure` both depend on real HTTPS and
a real origin. The `Secure` flag in particular is **off** locally by design
(`Settings.cookie_secure` is driven from `IS_LOCAL`), so its deployed behaviour has never
been exercised.

There is a second, subtler risk: the API cache behaviour uses the managed
`AllViewerExceptHostHeader` origin request policy, which forwards cookies — but the
**managed cache policy** `4135ea2d-...` (CachingDisabled) must not strip `Set-Cookie` on
the way back.

```sh
curl -s -i -X POST "https://$CF/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@acme.inc","password":"<the temporary password>"}' \
  | grep -i set-cookie
```

✅ **Correct result:** one `set-cookie` header containing
`acme_refresh_token=...; HttpOnly; Secure; SameSite=strict; Path=/api/v1/auth`.
❌ No `set-cookie` header at all means CloudFront stripped it — the API cache behaviour
needs an origin request policy that forwards cookies both ways.

Then confirm rotation works through the distribution:

```sh
curl -s -X POST "https://$CF/api/v1/auth/refresh" \
  -b "acme_refresh_token=<value from above>" | jq .access_token
```

✅ **Correct result:** a new JWT. ❌ 401 means the cookie did not reach the Lambda.

### 2.7 The `/api/v1/auth` cookie path is correct behind CloudFront

> ⬜ **STILL UNVERIFIED.** Nobody opened the devtools Network tab against the deployed
> app to confirm the cookie is sent on `POST /api/v1/auth/refresh` and **not** on
> `GET /api/v1/health`. Its dependency, [1.3](#13-cloudfront-forwards-apiv1-without-stripping-the-prefix),
> is now verified, so this is unblocked and is a two-minute look.

**Why it needs the cloud.** The cookie `Path` is deliberately narrow, and CloudFront does
not rewrite paths on the API behaviour — but that is exactly what 1.3 verifies, so this
depends on it.

✅ **Correct result:** after logging in through the deployed UI, the browser sends
`acme_refresh_token` on `POST /api/v1/auth/refresh` but **not** on
`GET /api/v1/health`. Check in the browser devtools Network tab. ❌ If the cookie is sent
on every request, `REFRESH_COOKIE_PATH` in `app/security/dependencies.py` is wrong.

### 2.8 bcrypt's native wheel runs on the Lambda runtime

> ✅ **VERIFIED, 2026-09-23.** The wheel built by the VDI's pip runs on the Lambda
> runtime. Proven from **both ends**, which is exactly how this item says it would be:
>
> - **Hashing** — `seed_demo` ran inside the Lambda and created **37 users**, every one
>   with a bcrypt hash written by that wheel.
> - **Verifying** — the demo accounts then **sign in to the deployed app**, which is a
>   hash comparison in the same runtime.
>
> No `ImportError`, no `_bcrypt` symbol error. `build_in_docker = true` is **not needed**.

**Why it needs the cloud.** `bcrypt` ships a compiled extension. Terraform builds the
package with the VDI's local pip (`build_in_docker = false`), so the wheel is whatever
matches this machine — Linux x86_64, CPython 3.13, which *should* match the Lambda
runtime exactly.

Covered implicitly by 2.4 (seeding hashes a password) and 2.6 (login verifies one). If
either fails with an `ImportError` or a `_bcrypt` symbol error, the wheel is wrong:
rebuild with `build_in_docker = true` in `infra/lambda.tf`.

---

## M3 — Facilities, categories, engineers and users

### 3.1 The Lambda refuses to start without a real `JWT_SECRET`

> ✅ **VERIFIED — the positive half. 2026-09-23.** `IS_LOCAL = false` in the deployed
> Lambda, and the settings object **builds**: the app starts, serves requests and signs
> tokens. So the validator ran on its deployed branch and passed — `JWT_SECRET` is
> present, is not the development default, and is at least 32 bytes (it is 64, per
> [2.5](#25-jwt_secret-reaches-the-lambda)).
>
> The same `IS_LOCAL = false` is what applies **`sslmode=require`** to the Aurora
> connection, which is also confirmed working.
>
> **Deliberately not exercised:** the refusal itself. Proving it would mean deploying a
> broken `JWT_SECRET` on purpose, and rotating the secret is a forced logout for every
> live session. The local unit test covers the branch; this item covers the wiring, and
> the wiring is proven.

**Why it needs the cloud.** `IS_LOCAL=false` is only ever true in the deployed Lambda,
and that is the branch the new check runs on. Locally the validator is a no-op by
design.

This is the counterpart to 2.5: that item proves the variable *arrives*, this one proves
what happens if it does not. Run it **after** a successful deploy, not instead of one.

```sh
# Confirm the function is healthy first.
aws lambda invoke --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --payload '{"action":"health"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

✅ **Correct result:** `"status": "ok"`. The settings object built, so `JWT_SECRET` is
present, is not the development default, and is at least 32 bytes.

❌ A 500 with `ValidationError` naming `jwt_secret` in the CloudWatch log is the check
firing: `random_password.jwt_secret` did not apply, and `infra/lambda.tf` dropped the
empty value rather than passing an empty string. Re-run `./bin/deploy-backend.sh` and
confirm with 2.5 that the variable is set. **This is the intended behaviour, not a
regression** — before M3 the same situation started cleanly and signed real tokens with
a string published in this repository.

⚠️ Do not "fix" it by setting a short secret by hand. Rotating `JWT_SECRET` invalidates
every live access token, which is a forced logout for all users.

### 3.2 `include_inactive` and the admin listings work through CloudFront

> ⬜ **STILL UNVERIFIED, and this one matters more than its length suggests.** No
> query-string forwarding check was run against the distribution.
>
> Do **not** treat "the dashboard rendered" as evidence. This item's failure mode is a
> wrong answer that looks like a right one: if CloudFront strips query strings, every
> filter, every page and `?include_inactive=true` silently return page one of the active
> rows, and every screen still looks fine. Nothing observed so far would have caught
> that.
>
> The `page_size=1` versus `page_size=2` pair below is the cheapest check in this file.
> Run it before trusting any filtered screen in the deployed app.

**Why it needs the cloud.** CloudFront's cache policy decides which query strings reach
the Lambda. If it strips or ignores them, `?include_inactive=true`, `?page=2` and every
filter silently return page one of the active rows — a wrong answer that looks like a
right one.

```sh
TOKEN=...   # an admin access token from POST /api/v1/auth/login
BASE="https://${CLOUDFRONT_DOMAIN}/api/v1"

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/buildings?page_size=1" | head -c 200; echo
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/buildings?page_size=2" | head -c 200; echo
```

✅ **Correct result:** the two responses differ — one item versus two, and `page_size`
echoed back as 1 then 2.

❌ Identical responses mean the query string is not reaching the Lambda. The `/api/v1*`
behaviour in `infra/cloudfront.tf` should carry the two managed policies it ships with:
cache policy `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` (CachingDisabled) and origin request
policy `b689b0a8-53d0-40ab-baf2-68738e2966ac` (AllViewerExceptHostHeader), which forwards
every query string and header except `Host`. Confirm with:

```sh
aws cloudfront get-distribution-config --id "${CLOUDFRONT_ID}" \
  --query 'DistributionConfig.CacheBehaviors.Items[?contains(PathPattern, `api`)].[PathPattern,CachePolicyId,OriginRequestPolicyId]'
```

Also worth one check that a rejection survives the distribution:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  "$BASE/buildings?include_inactive=true"
```

✅ **Correct result:** `403`. A `200` means the flag never reached the application.

### 3.3 Error status codes survive CloudFront

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven:** an API error reaches the browser as a
> real status code, not as a 200 page of HTML — an unauthenticated API call returns
> **401**. The class of failure this item exists to catch is therefore disproven, and the
> `custom_error_response` really is gone from the distribution.
>
> **Not measured:** the two specific codes named here, **404** on a missing building and
> **409** on a duplicate, and the JSON bodies carrying `detail` and `code`. The "Dup
> Check" building was never created, so there is nothing to clean up.

**Why it needs the cloud.** The distribution-wide `custom_error_response` that mapped
404 → 200 `/index.html` was replaced in M1 by a CloudFront Function on the default
behaviour. M3 is the first phase whose API returns 404 and 409 on ordinary paths, so it
is the first chance to prove that replacement actually holds.

```sh
# A UUID that does not exist.
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "$BASE/buildings/00000000-0000-0000-0000-000000000000"

# Create a building twice.
curl -s -X POST "$BASE/buildings" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Dup Check","code":"DUP-1"}' > /dev/null
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/buildings" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Dup Check","code":"DUP-1"}'
```

✅ **Correct result:** `404` then `409`, each with a JSON body carrying `detail` and
`code`.

❌ A `200` with HTML is the SPA fallback swallowing an API error — the rubric violation
CLAUDE.md warns about. ❌ A `403` from CloudFront rather than the application means the
request never reached the Lambda.

Clean up afterwards: `DELETE $BASE/buildings/{id}` for the "Dup Check" building.

### 3.4 `POST /engineers` hashes a password inside the Lambda

> ⬜ **STILL UNVERIFIED — as an HTTP call.** No engineer was created against the deployed
> API, so no `deploy.check@acme.inc` exists and nothing needs deactivating.
>
> **But the risk this item guards is gone.** Its stated failure mode is the bcrypt wheel
> not matching the Lambda runtime, and
> [2.8](#28-bcrypts-native-wheel-runs-on-the-lambda-runtime) settled that: 37 hashes
> written inside the Lambda and verified on sign-in. What is left unproven here is the
> narrower question of whether one bcrypt hash at cost 12 fits inside the request path's
> timeout — and `seed_demo` wrote 37 of them in one invoke, so the per-hash cost is not
> plausibly the problem.

**Why it needs the cloud.** It is the second place bcrypt runs in production (2.8
covers the first), and the first one reachable over HTTP. If the native wheel is wrong
for the Lambda runtime, seeding may have hidden it.

```sh
curl -s -X POST "$BASE/engineers" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"deploy.check@acme.inc","full_name":"Deploy Check","level":"JUNIOR"}'
```

✅ **Correct result:** `201` with an `engineer` object and a `temporary_password` of
about 22 characters.

⚠️ The password is in your terminal. It is never logged by the application — do not
paste it anywhere. Deactivate the account afterwards with
`DELETE $BASE/engineers/{user_id}`, or keep it and change its password if you want a
second test account.

❌ A 500 with an `ImportError` or a `_bcrypt` symbol error means the wheel does not
match the runtime: rebuild with `build_in_docker = true` in `infra/lambda.tf`.

### 3.5 Aurora accepts the array and `ILIKE` queries

> ⬜ **STILL UNVERIFIED.** Neither the `uuid[]` containment filter
> (`?group_id=`) nor the escaped-wildcard user search (`?q=%25`) was run against Aurora.
>
> Now cheaper than when it was written: the deployed database holds **37 users and 6
> engineers with real specialty groups**, so `?group_id=` will return a populated page
> rather than an empty one, and the `?q=%25` check has 37 accounts to fail to match.

**Why it needs the cloud.** `specialty_group_ids` is a PostgreSQL `uuid[]` filtered with
the containment operator `@>`, and the user search uses `ILIKE` with escaped wildcards.
Both are standard PostgreSQL 17 and both are exercised by the local suite, but Aurora is
the only place the *deployed* query plan runs.

```sh
GROUP_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/categories" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["groups"][0]["id"])')

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/engineers?group_id=$GROUP_ID" | head -c 200; echo
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/users?q=%25" | head -c 200; echo
```

✅ **Correct result:** the first returns a page (possibly empty) without error; the
second returns `"total": 0` — the literal `%` matched nothing, proving the escaping
survived.

❌ `"total"` equal to the number of accounts means wildcards are reaching the pattern
unescaped.

### 3.6 First-request latency on a cold Aurora

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven, qualitatively:** the cold start is real
> and was seen from two directions — a dropped `migrate` invoke, and three "Loading…"
> spinners still on screen six seconds after sign-in. The ⚠️ at the end of this item
> ("warm the API before any demo") is now a **measured instruction**, not a precaution.
>
> **Proven, warm:** at least one warm endpoint is fast — `/reports/summary` answers in
> **0.20 s** against the full demo dataset. So the "a slow *second* call is a real
> problem" branch does not apply; `memory_size` is the 512 MB M1 set.
>
> **Not measured:** the two specific `time curl` calls against `/facilities/tree`, so
> there is no number for the cold path or for that endpoint in particular.

**Why it needs the cloud.** `GET /facilities/tree` issues three statements and
`GET /engineers` runs a correlated subquery. Neither is slow, but both may be the first
thing a demo touches after an idle period, and Aurora Serverless v2 with
`min_capacity = 0` takes roughly 15 seconds to wake.

```sh
time curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" "$BASE/facilities/tree"
time curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" "$BASE/facilities/tree"
```

✅ **Correct result:** the first call may take 15–20 seconds after an idle period; the
second should be well under a second. A slow *second* call is a real problem — check the
Lambda's `memory_size` is the 512 MB M1 set, not the default 128.

⚠️ Warm the API before any demo. This is Aurora waking, not a bug, but it looks like one.

---

## M4 — Incidents and workflow

### 4.1 Revisions 0002 and 0003 apply to Aurora

> ✅ **VERIFIED, 2026-09-23.** The `{"action":"migrate"}` invoke reported the schema
> **upgraded to head**, which is `0001` → `0005`. So `0002` (seven columns rewritten from
> `timestamp` to `timestamptz`) and `0003` (two column defaults) both applied to Aurora
> without a lock timeout.
>
> ⚠️ **They applied to an empty table.** The migration ran *before* `seed_demo`, so the
> `ALTER COLUMN ... TYPE` rewrite this item warns about never had rows to rewrite. The
> SQL is proven valid against Aurora; "applies cleanly to a **populated** table" is not,
> and cannot be re-tested now without a fresh database. The concern is small — a table
> rewrite at these row counts is instant — but it is not what was observed.
>
> ⚠️ The deployed database now holds **300 incidents and 1,813 events**. Any future
> revision that rewrites `incidents` should be run in a quiet window, as this item says.

**Why it needs the cloud.** Both are `ALTER TABLE`s against tables revision 0001 already
created, and both are the kind of statement that behaves differently on a table with rows
in it. 0002 rewrites seven columns from `timestamp` to `timestamptz`; 0003 changes two
column defaults. Locally they run against a database the test suite drops and recreates,
so "it worked" proves the SQL is valid, not that it applies cleanly to a populated Aurora
table.

```sh
aws lambda invoke --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --payload '{"action":"migrate"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

✅ **Correct result:** `"schema": "upgraded to head"`, and re-running it is a no-op —
both revisions are idempotent in the sense that Alembic will not replay them.

❌ A lock timeout means something is holding the `incidents` table. Aurora Serverless v2
with `min_capacity = 0` can also time the invoke out while it wakes; re-run rather than
assuming failure, and check `alembic_version` before doing anything else:

```sh
# There is no psql path to Aurora from the VDI, so read it through the API instead:
curl -s "https://${CLOUDFRONT_DOMAIN}/api/v1/health"
```

⚠️ `ALTER COLUMN ... TYPE` rewrites the table and takes an `ACCESS EXCLUSIVE` lock. On our
row counts this is instant. If `seed_demo` has already run in M7, run it in a quiet window.

### 4.2 Timestamps serialise as UTC from the Lambda

> ⬜ **STILL UNVERIFIED.** No `created_at` value was read back from the deployed API, so
> the session time-zone pin in `build_connect_args()` is unproven on Aurora.
>
> **This one is now worth doing early**, because two later items depend on it and both
> became answerable when `seed_demo` ran against Aurora: [7.2](#72-the-daily-series-buckets-in-utc-not-in-the-servers-zone)
> (daily bucketing) and [7.7](#77-the-generated-timestamps-survive-the-round-trip-through-aurora)
> (1,813 backdated event rows). A zone that failed to apply shifts all three quietly and
> nothing errors.

**Why it needs the cloud.** `build_connect_args()` pins the session time zone to UTC so
that development and production agree. The Lambda's own environment is already UTC, so
locally we can prove the *pin* works but not that the deployed value is what we think.

```sh
TOKEN=...   # any access token
BASE="https://${CLOUDFRONT_DOMAIN}/api/v1"

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/incidents?page_size=1" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["items"][0]["created_at"])'
```

✅ **Correct result:** a value ending in `Z` or `+00:00`.

❌ Any other offset means the connection option did not take. Everything still works, but
the frontend will render times wrong by that offset, and M7's duration arithmetic will be
off by it too.

### 4.3 Full-text search works on Aurora's `english` configuration

> ⬜ **STILL UNVERIFIED.** No search was run against the deployed API.
>
> **Half the risk is retired:** the generated column and the GIN index were **created**
> on Aurora ([2.3](#23-schema-objects-aurora-may-treat-differently)), and `seed_demo`
> then inserted **300 incidents** through it — which means `to_tsvector('english', ...)`
> evaluated successfully 300 times on Aurora, or the inserts would have failed. So the
> dictionary exists and the expression works.
>
> **What is left** is querying: whether stemming matches, whether the ticket-number path
> works, and whether `websearch_to_tsquery` swallows punctuation rather than raising.
> Simpler than when written — there are now 300 real tickets to search, so **no ticket
> needs to be created first**. Pick a word out of the seeded data instead.

**Why it needs the cloud.** `search_vector` is a *generated stored* column whose
expression names `to_tsvector('english', ...)`. Aurora ships the same dictionaries as
stock PostgreSQL 17, but the column was generated at `CREATE TABLE` time in revision 0001
and has never been exercised against Aurora rows.

```sh
TOKEN=...
BASE="https://${CLOUDFRONT_DOMAIN}/api/v1"

# Report something with a distinctive, stemmable word first.
curl -s -X POST "$BASE/incidents" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "title": "Ceiling light flickering badly",
    "description": "The light above my desk has flickered since Monday morning.",
    "category_id": "<a subcategory id>", "building_id": "<a building id>",
    "floor_id": "<a floor id>"
  }' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["reference"])'

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/incidents?q=flicker"   | head -c 200; echo
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/incidents?q=INC-000001" | head -c 200; echo
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/incidents?q=%26%26%21"  | head -c 200; echo
```

✅ **Correct result:** the first finds the ticket by stem (`flicker` matches
`flickering`), the second finds exactly one by number, and the third returns
`"total": 0` — `websearch_to_tsquery` swallowed the punctuation instead of raising.

❌ A 500 on the third means something is calling `to_tsquery` rather than
`websearch_to_tsquery`. A 500 on the first means the GIN index or the generated column
did not survive the migration.

### 4.4 Repeatable query parameters survive CloudFront

> ⬜ **STILL UNVERIFIED**, and blocked behind [3.2](#32-include_inactive-and-the-admin-listings-work-through-cloudfront),
> which is also unverified. Do 3.2 first: if query strings do not reach the Lambda at
> all, this item's answer is meaningless.
>
> Now easy to read: the deployed database holds 300 incidents with a real status spread,
> so the "two statuses ≥ one status" comparison has actual numbers on both sides rather
> than zero and zero.

**Why it needs the cloud.** `?status=OPEN&status=BLOCKED` sends the same key twice, and
`?assignee_id=unassigned` is a sentinel rather than a UUID. 3.2 proved query strings reach
the Lambda at all; this proves a *repeated* key is not collapsed to one value by the cache
policy, which would silently narrow every multi-select filter in the UI.

```sh
TOKEN=...
BASE="https://${CLOUDFRONT_DOMAIN}/api/v1"

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/incidents?status=OPEN" \
  | python3 -c 'import json,sys; print("one status:", json.load(sys.stdin)["total"])'
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/incidents?status=OPEN&status=CLOSED" \
  | python3 -c 'import json,sys; print("two statuses:", json.load(sys.stdin)["total"])'
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/incidents?assignee_id=unassigned" \
  | python3 -c 'import json,sys; print("unassigned:", json.load(sys.stdin)["total"])'
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/incidents?assignee_id=nobody" | head -c 200; echo
```

✅ **Correct result:** the two-status total is greater than or equal to the one-status
total, and the last call returns 422 with `INVALID_ASSIGNEE_FILTER` — proving the raw
string reached the parser rather than being rewritten.

❌ Identical totals for one and two statuses means CloudFront is forwarding only the first
occurrence. Fix it in the cache policy's query-string configuration, not in the API.

### 4.5 A refused transition keeps its 409 and its body

> ⬜ **STILL UNVERIFIED.** No transition was refused against the deployed API, so the
> `allowed_transitions` key on a 409 body is unproven in the cloud.
>
> Its ❌ branch — "a 200 with `/index.html`" — is **ruled out** by
> [1.4](#14-the-spa-cloudfront-function-does-not-touch-the-api). What remains is whether
> the distribution leaves the **body** alone, which is narrower and still worth one call.

**Why it needs the cloud.** 3.3 proved 404 and 409 survive CloudFront. This one is
narrower: the 409 from a refused transition carries an extra top-level key,
`allowed_transitions`, which the frontend reads to recover. A distribution that rewrites
error bodies would leave the status intact and the recovery path broken.

```sh
TOKEN=...   # the reporter of $INC, an employee
BASE="https://${CLOUDFRONT_DOMAIN}/api/v1"
INC=...     # an OPEN incident id they reported

curl -s -o /dev/stdout -w '\n%{http_code}\n' -X POST "$BASE/incidents/$INC/transitions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"to_status":"RESOLVED","resolution_summary":"I fixed it myself."}'
```

✅ **Correct result:** `409`, with a body carrying `"code": "TRANSITION_NOT_ALLOWED"` and
an `allowed_transitions` array containing `{"to_status": "CLOSED", "action_label":
"Cancel ticket", ...}`.

❌ A 200 with `/index.html` means the SPA error mapping from M1 has come back — see 1.4.

### 4.6 Event ordering under real, separate transactions

> ⬜ **STILL UNVERIFIED.** No `clear-escalation` was performed against the deployed API.
>
> **`seed_demo`'s 1,813 events do not count as evidence here.** The seeder writes its
> timeline in one bulk transaction with backdated timestamps, which is the *opposite* of
> the case this item is about: one request, its own transaction, two rows that must order
> correctly under revision `0003`'s column default. The deployed database does now
> contain escalated incidents to try it on.

**Why it needs the cloud.** Revision 0003 exists because `now()` is the transaction start
time. The test suite runs every request inside one transaction, which is the pathological
case; the Lambda runs each request in its own, which is the normal one. Both should now
produce the same order, and only the cloud exercises the second.

```sh
TOKEN=...   # an admin
BASE="https://${CLOUDFRONT_DOMAIN}/api/v1"
INC=...     # an escalated incident

curl -s -X POST "$BASE/incidents/$INC/clear-escalation" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"note":"Agreed, raising this.","priority":"HIGH"}' > /dev/null

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/incidents/$INC/activity" \
  | python3 -c 'import json,sys; [print(e["kind"], e.get("event_type")) for e in json.load(sys.stdin)]'
```

✅ **Correct result:** `ESCALATION_CLEARED` appears immediately before `PRIORITY_CHANGED`.
Those two rows are written by one request, so this is the case revision 0003 fixes.

❌ The reverse order means the column default did not apply — check 4.1 actually ran
revision 0003.

### 4.7 Aurora's plan for the incident list

> ⬜ **STILL UNVERIFIED — but no longer blocked, and that is the change.** No `GET
> /incidents` timing was taken against the deployed stack.
>
> **The precondition is now met.** This item's closing ⚠️ said "re-run this after M7's
> `seed_demo`. Until then there are not enough rows for the numbers to mean much."
> `seed_demo` **has** now run against Aurora — **300 incidents, 1,813 events** — so the
> realistic row count this item was waiting for exists in the deployed database. The
> three `time curl` calls below will finally mean something.
>
> The one adjacent number on record is `/reports/summary` at **0.20 s warm**, which is a
> different and heavier query; it makes a slow warm `GET /incidents` unlikely, but it is
> not a measurement of this endpoint.

**Why it needs the cloud.** `GET /incidents` is the busiest endpoint in the application:
a filtered count, a filtered page, and six `selectinload` follow-ups. Locally it runs
against tens of rows. Aurora with M7's ~300 incidents is the first realistic test, and
Serverless v2 waking from `min_capacity = 0` will dominate the first call either way.

```sh
TOKEN=...
BASE="https://${CLOUDFRONT_DOMAIN}/api/v1"

time curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" "$BASE/incidents?page_size=25"
time curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" "$BASE/incidents?page_size=25"
time curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" "$BASE/incidents?q=light&sort=-priority"
```

✅ **Correct result:** the first call may take 15–20 seconds after an idle period; the
rest should be well under a second.

❌ A consistently slow *second* call, especially on the search, is worth a look at
`ix_incidents_search_vector` — a GIN index that failed to build would still return
correct answers, just by sequential scan.

⚠️ Re-run this after M7's `seed_demo`. Until then there are not enough rows for the
numbers to mean much.

---

## M5 — Frontend shell and auth

Everything below assumes `CF` is the distribution domain and that the frontend has been
deployed:

```sh
./bin/deploy-frontend.sh
CF=$(cd infra && terraform output -raw cloudfront_distribution_url)
```

### 5.1 A deep link into a guarded route restores the session

> ⬜ **STILL UNVERIFIED — for the round trip.** The **CloudFront half** is proven:
> `/tickets` returns **200** from the deployed distribution, so an extension-less path
> reaches `index.html`. What was not walked is what follows — `AuthProvider` spending the
> refresh cookie, `RequireAuth` releasing the route, and the address bar still reading
> the requested path.
>
> ⚠️ **Read this item against [D38](DECISION-LOG.md#d38--correcting-d36-the-login-loop-was-a-redirect-not-a-cache).**
> `destinationAfterSignIn` now **refuses** `paths.changePassword` as a post-login
> destination and falls back to home. For every other route the `state.from` behaviour
> this item describes is unchanged, so `/tickets/mine` should still land on
> `/tickets/mine` — but `/change-password` deliberately will not, and that is correct
> rather than the ❌ branch below.

**Why it needs the cloud.** 1.4 proves an extension-less path returns `index.html`. What
it cannot prove is the round trip that follows: the SPA boots at that URL, `AuthProvider`
spends the refresh cookie, `RequireAuth` releases the route, and the user lands on the
page they asked for rather than on the home page. Locally that path is served by the Vite
dev server, not by the CloudFront Function.

Sign in through the deployed UI, then paste a guarded URL into the address bar:

```
https://$CF/tickets/mine
```

✅ **Correct result:** a brief "Restoring your session…" and then the page, with "My
tickets" selected in the navigation. The address bar still reads `/tickets/mine`.

Now the signed-out case. Open a private window and paste the same URL.

✅ **Correct result:** the login screen. After signing in you arrive at `/tickets/mine`,
not at `/` — that is `RequireAuth` stashing `state.from` and `LoginPage` reading it.
❌ Landing on `/` means the navigation state was lost; ❌ a CloudFront 404 page means the
SPA function is not matching the two-segment path.

### 5.2 The first page load survives a cold Aurora and a cold Lambda

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven:** the app survives a waking Aurora rather
> than being killed by it. Six seconds after sign-in the engineer home still showed three
> "Loading…" spinners, and it then rendered. **No CloudFront 504 was seen**, which is the
> failure mode this item is actually hunting — the origin read timeout is not below
> Aurora's wake time. Nobody was dumped at the login screen either.
>
> **Not done as specified:** the ~15-minute idle followed by a reload with devtools open,
> so the `POST /api/v1/auth/refresh` status was not read directly and the "holds for up
> to ~25 s" bound has no measurement behind it. What was observed was a cold *database*
> during an already-signed-in session, not a cold start on the very first request of a
> cold page load.

**Why it needs the cloud.** `POST /auth/refresh` is the very first request the app makes,
before anything is rendered. In the cloud it can hit a sleeping Aurora (~15 s to wake,
per 1.6) *and* a cold Lambda at the same time, behind CloudFront's own origin read
timeout. None of those exist locally, where the call answers in milliseconds.

There is no timeout on the axios client, deliberately — a slow answer is better than a
false one — so the failure mode to look for is CloudFront giving up first.

Leave the deployed app idle for ~15 minutes, then reload it with devtools open.

✅ **Correct result:** the "Restoring your session…" state holds for up to ~25 s, then the
app renders signed in. `POST /api/v1/auth/refresh` shows 200.
❌ A **504** from CloudFront means the origin read timeout is below Aurora's wake time.
❌ Being dumped at the login screen means the refresh returned 401 rather than timing out
— check 2.6 rather than this item.

### 5.3 Refresh-and-retry works through the distribution

> ⬜ **STILL UNVERIFIED.** Needs a tab left idle for more than fifteen minutes; nobody
> did that.
>
> One of its two ❌ branches is now **less likely**: `Cache-Control: no-store` is live on
> every API response including errors ([D36](DECISION-LOG.md#d36--the-deployed-app-could-not-be-signed-into-and-only-the-deployed-app)),
> so a cached 401 would have to come from CloudFront rather than the browser — and the
> `/api/v1*` behaviour uses CachingDisabled. The **single-flight** half of this item, and
> the three-entry sequence in the Network tab, are untouched.

**Why it needs the cloud.** 2.6 proves one refresh works via `curl`. This proves the
*interceptor* works: an expired access token, a transparent refresh, and a replay of the
original request — through CloudFront, whose API cache behaviour must not be caching the
401 that starts it.

Sign in, then leave the tab open and idle for **more than 15 minutes** (the access token
TTL). Come back and click a navigation item, with the Network tab recording.

✅ **Correct result:** three entries in order — the original request `401`, `POST
/api/v1/auth/refresh` `200` with a fresh `Set-Cookie`, then the original request again
`200`. The user sees no error and is not signed out.
❌ A 401 that is **not** followed by a refresh means CloudFront served a cached 401; check
that the `/api/v1*` behaviour uses the CachingDisabled policy.
❌ Two refresh calls means the single-flight promise in `api/client.ts` is not doing its
job — and the second one will revoke every session (see 5.4).

### 5.4 Reuse detection really ends every session on Aurora

> ⬜ **STILL UNVERIFIED.** The four-`curl` replay sequence was not run against the
> deployed stack, and the Lambda log group was not searched for "Refresh token reuse
> detected".
>
> This is the item with the strongest argument for running it: its whole premise is that
> the local suite **cannot** see the bug, because the fixture rolls back the mid-request
> commit that the fix depends on — which is, in this item's own words, "exactly how the
> bug hid for three phases". Deployed is the only place the answer exists.

**Why it needs the cloud.** The M5 carry-over fix makes `rotate_session` commit
mid-request, on a path that then raises. That commit's interaction with the connection
pool and with Aurora's transaction handling is not something the local suite can prove —
its fixture rolls everything back, which is exactly how the bug hid for three phases.

```sh
# A: log in and keep the cookie.
curl -s -c A.txt -X POST "https://$CF/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@acme.inc","password":"<password>"}' > /dev/null

# B: rotate it once, legitimately.
curl -s -b A.txt -c B.txt -X POST "https://$CF/api/v1/auth/refresh" > /dev/null

# Replay the spent cookie A — the theft signal.
curl -s -o /dev/null -w '%{http_code}\n' -b A.txt -X POST "https://$CF/api/v1/auth/refresh"

# Now the *legitimate* cookie B must also be dead.
curl -s -o /dev/null -w '%{http_code}\n' -b B.txt -X POST "https://$CF/api/v1/auth/refresh"
```

✅ **Correct result:** `401` and `401`. The third call detects the replay, the fourth
proves the mass revocation was committed.
❌ `401` then `200` is the original bug: the revocation was rolled back when the failing
request closed its session. Check that `session.commit()` is still in the
`stored.revoked_at is not None` branch of `auth_service.rotate_session`.

Also check the Lambda log group for the warning the path emits:

```sh
aws logs filter-log-pattern --log-group-name "/aws/lambda/coding-workshop-v1-${PARTICIPANT_ID}" \
  --filter-pattern "Refresh token reuse detected"
```

### 5.5 The seeded admin's forced password change works end to end

> ✅ **VERIFIED — and it failed first. 2026-09-23.**
>
> **This is the item that earned the whole checklist.** Walking it on the deployed URL
> found a defect that could not have been found anywhere else, and the flow now works.
>
> **What happened.** Sign in with the temporary password → change it when asked → sign in
> again with the new one → **land back on the change-password screen. Every time.** The
> password was right and the API was answering correctly. That is a failure mode this
> item did not list: not the wall of 403s, not being able to navigate away, but an
> endless loop between two screens that both behaved correctly in isolation.
>
> **Two decisions came out of it:**
>
> - [**D38**](DECISION-LOG.md#d38--correcting-d36-the-login-loop-was-a-redirect-not-a-cache)
>   — the real cause. Changing a password revokes every session, so the app went
>   anonymous while still rendering `/change-password`; `RequireAuth` stashed that
>   location and sign-in dutifully returned to it. `destinationAfterSignIn` now refuses
>   `paths.changePassword` as a destination.
> - [**D36**](DECISION-LOG.md#d36--the-deployed-app-could-not-be-signed-into-and-only-the-deployed-app)
>   — the wrong cause, found on the way, and worth keeping: `/auth/me` carried no
>   `Cache-Control` at all, so a browser was free to invent a freshness lifetime for it.
>   `NoStoreMiddleware` fixes that independently.
>
> **Now:** sign-in lands on the dashboard. All the demo accounts get in.
>
> **Not re-walked from a `seed_admin` account.** The fix was proven against the deployed
> URL headlessly, and the demo accounts have `must_change_password` false, so the
> *forced* gate itself has not been re-driven by hand since. See
> [2.4](#24-seed_admin-creates-a-usable-first-account).

**Why it needs the cloud.** `seed_admin` runs as a direct Lambda invoke against Aurora
(2.4), so the account with `must_change_password` only exists there. This is the first
time a human uses the deployed application, and the one flow that has to work before any
other screen can be reached.

In a browser, sign in at `https://$CF/login` with the temporary password from 2.4.

✅ **Correct result:** you land on the change-password screen, not on the dashboard. It
says "Choose your own password to continue", labels the first field "Temporary password",
and offers **no** Cancel button and no navigation. Changing the password returns you to
the login screen with "Password changed. Please sign in again." Signing in with the new
password lands on the admin dashboard.
❌ Landing on the dashboard with a wall of 403s means `RequireAuth` is not reading
`must_change_password` — but check `/api/v1/auth/me` first, since the flag comes from
there.
❌ Being able to navigate away from the change-password screen means the guard's
`skipPasswordGate` route is catching more than the one path.

### 5.6 Measure whether the bundle is served compressed

> ✅ **VERIFIED — and the answer flipped. 2026-09-23.**
>
> **Compression is live.** The workshop organisers approved the change, `compress = true`
> is set, and the measurement against the deployed distribution is:
>
> | | |
> | --- | --- |
> | JS bundle, raw | **994 kB** |
> | JS bundle, gzipped over the wire | **309 kB** |
> | Saving on every cold visit | **~685 kB, a 3.2× reduction** |
>
> The "**This one expects to fail**" premise below is **no longer true** and the
> ✅ **Expected today** line under the commands is wrong — there **is** a
> `content-encoding` header now. See
> [D37](DECISION-LOG.md#d37--cloudfront-compression-enabled) and
> [`INFRA-CHANGES.md`](INFRA-CHANGES.md) item 4, which is now applied rather than
> proposed.
>
> ⚠️ **Three different bundle sizes appear in this repository**, because the bundle grew
> between each measurement: 790 kB (when this item was written, at M5), 976 kB (D37), and
> **994 kB — the current, measured, deployed figure**. Where they disagree, 994/309 is
> the one taken against the live distribution.
>
> The reasoning about woff2 below still holds: fonts are already compressed and are not
> part of this saving.

**Why it needs the cloud.** Compression is a CloudFront behaviour setting applied at the
edge. The dev server does its own thing and proves nothing.

**This one expected to fail, and now does not.** *(Kept for the record — see the status
line above.)* `infra/cloudfront.tf` did not set `compress` on either behaviour, and the
CloudFront default is **off**. The production bundle was ~790 kB raw against ~251 kB
gzipped when this was written — a 3× difference on the first load of every session, and it
grew in M6 (`@mui/x-data-grid`) and M7 (`@mui/x-charts`) to the 994 kB measured above.

The woff2 alongside it is *not* part of this argument: woff2 is already compressed, and
CloudFront will not shrink it further. Only the JavaScript, CSS and HTML are at stake.
(192 kB of font is emitted, two families at four weights each, but a normal load fetches
only the 96 kB of Roboto — fallback families are fetched lazily.)

```sh
BUNDLE=$(curl -s "https://$CF/" | grep -o '/assets/index-[^"]*\.js')
curl -s -I -H 'Accept-Encoding: gzip, br' "https://$CF$BUNDLE" \
  | grep -iE 'content-encoding|content-length|x-cache'
```

✅ **Expect now:** `content-encoding: gzip` and a `content-length` near **309 kB** against
a raw bundle of **994 kB**. ❌ *No* `content-encoding` would mean the `compress = true`
change has been reverted or a deploy did not pick it up.

~~✅ **Expected today:** no `content-encoding` header and a `content-length` near 788
kB.~~ — superseded on 2026-09-23.

The fix was one line — `compress = true` on the `default_cache_behavior` in
`infra/cloudfront.tf`. It was **the repo owner's call**, it was put to the workshop
organisers, and they approved it. It is now applied on the default behaviour *and* the API
behaviours, making it the fourth change to the provided Terraform.

### 5.7 The self-hosted font arrives

> ⬜ **STILL UNVERIFIED.** The eight `.woff2` files were not fetched from the deployed
> distribution and `document.fonts.check('600 14px Roboto')` was not run in the deployed
> browser.
>
> **This item is designed to fail silently**, which is why it survives a successful-looking
> deploy: if OAC refuses the fonts or the MIME type is wrong, `font-display: swap` means
> the page renders perfectly and the only symptom is the ~4 px vertical lean the
> self-hosting exists to remove. **Nothing observed so far would have shown it.** The
> deployed sign-in screen was looked at, at 1440 px and 375 px, and looked right — but
> "looked right" is exactly what this failure looks like.

**Why it needs the cloud.** The font is four hashed `.woff2` files under `/assets/`,
served by S3 through CloudFront's default behaviour with an Origin Access Control. If the
sync misses them, the MIME type is wrong, or OAC refuses them, the page still renders —
`font-display: swap` means the fallback simply stays. Nothing errors. The only symptom is
the 4 px vertical lean in buttons, navigation rows and inputs that self-hosting exists to
remove, which is invisible unless you are looking for it.

```sh
# Every font the built CSS references must be fetchable. Roboto is what
# renders; Inter is the fallback tier and is only fetched if Roboto cannot be,
# so check both are there rather than trusting the one you can see load.
CSS=$(curl -s "https://$CF/" | grep -o '/assets/index-[^"]*\.css')
curl -s "https://$CF$CSS" | grep -oE '/assets/(inter|roboto)-[^)]*\.woff2' | sort -u |
  while read -r font; do
    printf '%-52s %s\n' "$font" \
      "$(curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}' "https://$CF$font")"
  done
```

✅ **Correct result:** eight lines, each `200 font/woff2` with roughly 24000 bytes.
❌ A **403** means the S3 object is missing or OAC is not granting it — re-run
`./bin/deploy-frontend.sh` and check the sync included `dist/assets/`.
❌ A `content_type` of `application/octet-stream` or `binary/octet-stream` means the S3
upload guessed the type; browsers still accept woff2 by sniffing, so this is a warning
rather than a failure, but it is worth fixing in the sync.

Then confirm it is the font that actually renders. In the browser, on the deployed site,
devtools → Network → Font: the four files appear on a cold load. Or in the console:

```js
document.fonts.check('600 14px Roboto')   // expect true
```

✅ **Correct result:** `true`, and a button's label sits centred — 13.08px above the
capitals against 13.46px below the baseline, which is even to well within a pixel.
❌ `false` means the CSS loaded but the font did not, and every fixed-height container is
back to leaning ~4 px high.

### 5.8 A redeployed frontend is actually served

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven, circumstantially but firmly:** the
> deployed site serves the **current** frontend, including the demo account picker added
> in the tip commit `cbcf93a`. The D36/D38 login-loop work was driven against the same
> URL *before* that commit existed. So the frontend has been deployed more than once and
> the invalidation propagated each time — an `index.html` pinned to a stale hash would
> have left the picker invisible or the page broken.
>
> **Not done:** the explicit before/after comparison of the `/assets/index-*.js` name
> either side of a `./bin/deploy-frontend.sh` run, which is what this item actually
> prescribes and the only way to see a *slow* invalidation rather than a failed one.

**Why it needs the cloud.** `deploy-frontend.sh` syncs to S3 and issues a CloudFront
invalidation. Whether the invalidation completes before the next request, and whether
`index.html` was cached with a long TTL, is edge behaviour with no local equivalent.

The bundle filename is content-hashed, so the risk is not a stale bundle — it is a stale
`index.html` still pointing at the **previous** hash, which S3 may no longer have.

```sh
# Note the current bundle name, redeploy, then compare.
curl -s "https://$CF/" | grep -o '/assets/index-[^"]*\.js'
./bin/deploy-frontend.sh
curl -s "https://$CF/" | grep -o '/assets/index-[^"]*\.js'
```

✅ **Correct result:** the second name differs whenever `src/` changed, and requesting it
returns 200. ❌ The old name persisting means the invalidation had not finished — wait and
repeat before changing anything. ❌ The new `index.html` referencing a bundle that 404s
means the S3 sync deleted the old asset before the invalidation landed; re-run the deploy.

---

## M6 — Persona screens

As with M5, `CF` is the distribution domain and the frontend has been deployed:

```sh
./bin/deploy-frontend.sh
CF=$(cd infra && terraform output -raw cloudfront_distribution_url)
```

### 6.1 The questionnaire's two reference trees load behind CloudFront

> ⬜ **STILL UNVERIFIED.** `/report` was not opened against the deployed app and
> `/facilities/tree` was not timed.
>
> The estate is no longer hypothetical: the deployed database holds **3 buildings** with
> their floors and seats from `seed_demo`, so the size question this item asks — "a few
> kilobytes, or hundreds?" — now has a real answer waiting to be measured.

**Why it needs the cloud.** The report form cannot render until both
`GET /api/v1/categories` and `GET /api/v1/facilities/tree` answer. Both are
unpaginated whole-collection responses — 37 categories, and every building, floor and
seat — which locally are a few kilobytes and instant. In the cloud they are the first
two requests a signed-in employee makes, against a possibly-cold Lambda and a possibly
sleeping Aurora, and the facility tree grows with the estate rather than with a page
size.

Sign in as an employee and open `https://$CF/report`.

✅ **Correct result:** the five group cards appear with their icons and hints. Choosing
one reveals its subcategories; choosing a subcategory reveals the location fields that
group requires.
❌ A spinner that never resolves, or "Could not load the categories and locations this
form needs", means one of the two calls failed — check which in devtools before
assuming it is the form.

Then measure them, because they are the responses most likely to outgrow their shape:

```sh
curl -s -o /dev/null -w '%{size_download} bytes  %{time_total}s\n' \
  -H "Authorization: Bearer $TOKEN" "https://$CF/api/v1/facilities/tree"
```

✅ Expect a few kilobytes and well under a second once warm. ❌ Hundreds of kilobytes
means the estate has grown past what an unpaginated tree should carry, and the location
picker needs to load lazily per building — worth knowing before it becomes a symptom.

### 6.2 Repeatable filter parameters survive the distribution *from the browser*

> ⬜ **STILL UNVERIFIED**, and behind both [3.2](#32-include_inactive-and-the-admin-listings-work-through-cloudfront)
> and [4.4](#44-repeatable-query-parameters-survive-cloudfront), which are also open.
> Walk those two first — they isolate the client from the distribution, and this item
> cannot tell them apart on its own.

**Why it needs the cloud.** [4.4](#44-repeatable-query-parameters-survive-cloudfront)
proved CloudFront forwards `?status=OPEN&status=BLOCKED` when curl sends it. What it did
not cover is that the **browser** now generates that shape: axios would serialise
`status[]=OPEN` by default, which FastAPI ignores silently, and `paramsSerializer:
{ indexes: null }` in `api/client.ts` is what prevents it. A misconfigured CloudFront
cache policy that drops or reorders query strings would produce the same symptom.

Open `https://$CF/tickets?status=OPEN&status=BLOCKED` and watch the request in devtools.

✅ **Correct result:** the request URL contains `status=OPEN&status=BLOCKED`, and the
list shows only open and blocked tickets. The status filter reads "Open, Blocked".
❌ Every ticket regardless of status means the parameters were dropped or renamed. Check
the outgoing request first: if it says `status[]=`, the client is at fault; if it says
`status=` and the list is still unfiltered, CloudFront is not forwarding the query
string to the Lambda origin.

### 6.3 A deep link to one ticket opens it

> ⬜ **STILL UNVERIFIED.** Only a **one-segment** path was checked against the deployed
> distribution — `/tickets` returns 200. The shape this item is about,
> `/tickets/<uuid>`, whose last segment mixes hyphens and digits and is the sort of thing
> a "does it look like a file?" rewrite gets wrong, has not been requested.
>
> No ticket needs reporting first any more: the deployed database has **300** of them.

**Why it needs the cloud.** [1.4](#14-the-spa-cloudfront-function-does-not-touch-the-api)
and [5.1](#51-a-deep-link-into-a-guarded-route-restores-the-session) cover
extension-less paths and two-segment routes. A ticket's URL is a third shape:
`/tickets/0d93156a-fb89-4eda-9fe7-6e2f982c3c35`, whose last segment contains hyphens and
digits and is the sort of thing a naive "does it look like a file?" rewrite gets wrong.

Report a ticket, copy its URL, and paste it into a fresh private window.

✅ **Correct result:** the login screen, and after signing in, that ticket — not the home
page.
❌ A CloudFront 404 or an XML error document means the SPA function did not rewrite the
path. ❌ Landing on `/` means the navigation state was lost; that is 5.1's problem, not
this one.

### 6.4 `allowed-transitions` drives the buttons against the real API

> ⬜ **STILL UNVERIFIED**, and it is the **highest-value open item in this file**. This is
> the rubric's central requirement, and its failure mode — a cached
> `allowed-transitions` serving one user's buttons to another — is a **correctness**
> failure that looks like nothing at all.
>
> **Partly de-risked:** `Cache-Control: no-store` is live on every API response
> ([D36](DECISION-LOG.md#d36--the-deployed-app-could-not-be-signed-into-and-only-the-deployed-app)),
> so the *browser* will not hold a stale copy. The `X-Cache` check below, against
> CloudFront itself, has not been run and is what this item actually asks for.
>
> Two personas on one RESOLVED ticket is now easy: the demo account picker on the
> deployed sign-in screen fills the form in one click, so two browser profiles cost
> seconds rather than minutes.

**Why it needs the cloud.** This is the rubric's central requirement and the one place
the frontend is forbidden its own copy of a rule. Locally it is exercised by the
Playwright suite; in the cloud the question is whether the same three responses arrive
through the distribution, uncached and per-user. **A cached
`/api/v1/incidents/*/allowed-transitions` would be a correctness failure, not a
performance one:** one user's buttons served to another.

With the same ticket open in two browsers — the reporter in one, the assigned engineer
in the other, both on a RESOLVED ticket:

✅ **Correct result:** the reporter sees **Confirm fixed** and **Still broken**; the
engineer sees **Close ticket**. Both are on the same URL.
❌ Both seeing the same buttons means the response is being cached. Confirm with the
response headers:

```sh
curl -sI -H "Authorization: Bearer $TOKEN" \
  "https://$CF/api/v1/incidents/$INCIDENT_ID/allowed-transitions" | grep -i 'x-cache\|cache-control'
```

✅ Expect `X-Cache: Miss from cloudfront` on every request. ❌ `Hit from cloudfront` on
the `/api/v1*` behaviour means the cache policy needs to be disabled for it.

### 6.5 Creating an engineer shows the temporary password once

> ⬜ **STILL UNVERIFIED.** No engineer was created through the deployed admin screen. Its
> ❌ "502 because bcrypt exceeded the Lambda timeout" branch is unlikely given
> [2.8](#28-bcrypts-native-wheel-runs-on-the-lambda-runtime), but the dialog, the copy
> button and the sign-in that follows are untested in the cloud.

**Why it needs the cloud.** [3.4](#34-post-engineers-hashes-a-password-inside-the-lambda)
proves the Lambda can hash a password at bcrypt cost 12 within its timeout. What this
adds is the round trip a person makes: the admin screen must show the generated password
before the response is discarded, and that account must then be able to sign in.

As an admin at `https://$CF/engineers`, add an engineer.

✅ **Correct result:** a dialog with the password in a monospaced face and a copy button,
and the warning that it is shown once. Sign out, sign in as that engineer with it, and
land on the forced change-password screen. Complete it and the engineer's own screens
open.
❌ A long pause and then a 502 means bcrypt exceeded the Lambda timeout — see 3.4.
❌ A dialog with no password means the response shape changed.

### 6.6 Bulk seat creation survives the request path

> ⬜ **STILL UNVERIFIED.** The largest request the application can make — up to 500 seat
> codes in one body — has never travelled through CloudFront to the Lambda Function URL.
> Nothing about the deployment bears on it either way, so this item stands exactly as
> written.

**Why it needs the cloud.** Every other write in this application is a small JSON body.
`POST /floors/{id}/seats/bulk` accepts up to 500 codes, which is the largest request the
application can make, and it travels through CloudFront to a Lambda Function URL rather
than to a local uvicorn.

At `https://$CF/facilities`, pick a floor, choose **Add many**, and paste 200 codes.

✅ **Correct result:** the dialog reports how many were added and how many already
existed, and stays open so the report can be read. The seats appear in the table behind
it.
❌ A 413 means a body-size limit somewhere on the path. ❌ A timeout means the single
INSERT is slower against Aurora than expected — re-run with 500 to find the ceiling, and
record it.

### 6.7 The first list query after an idle period

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven:** the wake-up seen from the interface is
> real. Six seconds after signing in, the **engineer home** still showed three "Loading…"
> spinners while Aurora woke, and it then resolved — the loading state held rather than
> erroring, which is this item's ✅ shape.
>
> **Not done as specified:** the ~15-minute idle followed by opening `/tickets` with the
> Network panel recording. So the two things this item is really asking — whether
> `/tickets` in particular behaves, and whether TanStack Query's `retry: 1` turns one
> slow request into **two** — are still unanswered. The retry question is the interesting
> one and a spinner cannot show it; only the Network panel can.

**Why it needs the cloud.** [1.6](#16-aurora-cold-start) and
[3.6](#36-first-request-latency-on-a-cold-aurora) measure a cold Aurora through curl.
This is the same wake-up seen from the interface, where it is a spinner rather than a
number, and where TanStack Query's `retry: 1` may quietly turn one slow request into two.

Leave the deployed app idle for ~15 minutes, then open `https://$CF/tickets`.

✅ **Correct result:** the loading state holds for up to ~25 s and then the table
renders. Exactly one `GET /api/v1/incidents` in the network panel.
❌ Two requests means the first timed out and the retry succeeded, which is survivable
but worth knowing. ❌ "Could not load these tickets" means the retry failed too.

### 6.8 Run the end-to-end suite against the deployed stack

> ⬜ **STILL UNVERIFIED.** The Playwright suite has not been pointed at CloudFront.
>
> ⚠️ **Think before running this one now.** When it was written, the deployed database was
> empty and the suite's residue did not matter. It is no longer empty: `seed_demo` has
> run against Aurora, and this suite **creates accounts and tickets in whatever database
> it is pointed at** and leaves the tickets behind. Running it would put `e2e.*` accounts
> and extra tickets into the same database a demonstration reads from — which is exactly
> what happened locally to `acme_demo` (see `docs/DEMO-SCRIPT.md`, "318 incidents, not
> 300"). Decide whether you want that before typing the command, because there is no way
> back short of dropping and re-seeding.
>
> Its ❌ note about cold-Aurora timeouts is now **confirmed advice** rather than a guess:
> warm the stack with one request first. See [1.6](#16-aurora-cold-start).

**Why it needs the cloud.** The Playwright suite is written against a base URL, so it can
be pointed at CloudFront — which turns the whole of M6 into one command, executed by a
real browser against the real distribution, the real Lambda and Aurora.

**Read this before running it.** The suite **creates accounts and tickets** in whatever
database it is pointed at, through the API. It never drops or truncates anything, and it
deactivates the accounts it made on the way out, but the tickets stay. Run it against a
demo environment, not one being graded live.

```sh
cd frontend
E2E_BASE_URL="https://$CF" \
E2E_ADMIN_EMAIL="admin@acme.inc" \
E2E_ADMIN_PASSWORD="<the seed_admin password, already changed>" \
  npx playwright test
```

✅ **Correct result:** **82 passed, 10 skipped**, the same as locally. (This item was
written at M6, when the suite was 12 passed / 2 skipped; M7, S6 and S1 have since taken it
to 82/10. The ten skips are all deliberate viewport guards:

- **5** desktop-only tests skipped in the **`mobile`** project — all in
  `dashboards.spec.ts`.
- **4** mobile-only tests skipped in the **`desktop`** project — the two phone drawers, a
  keyboard path into one, and the sticky action bar.
- **1** describe-level skip in `assignment.spec.ts`, which guards on
  `viewport.width < 900` and is therefore **also skipped in `mobile`**, making it the
  sixth desktop-only case.

5 + 4 + 1 = 10, so **the skip count is expected and is not a sign of anything wrong**. A
skip count other than 10 is worth investigating; a skip count of 0 means the project
filter is not being applied.)
❌ Timeouts on the first test are most likely a cold Aurora — the config allows 90 s per
test, which is generous locally and may not be after a 15-minute idle. Warm it with a
`curl https://$CF/api/v1/health` first and re-run before investigating anything else.
❌ A failure in `responsive.spec.ts` but not in `lifecycle.spec.ts` points at the
delivered CSS rather than the API — check 5.6 and 5.7.

---

## M7 — Dashboards and demo data (pass 1: report endpoints)

### 7.1 The reports run on Aurora at all

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven for `summary`:** `/reports/summary`
> answers in **0.20 s warm** against the deployed database, so it returns 200 rather than
> 500. That is the most useful single data point this item could have, because `summary`
> is the report that uses **`generate_series(...)` in the `FROM` clause** — one of the
> four constructs the item is worried about — and it is the one whose ❌ branch is called
> out by name.
>
> **Not measured:** the other seven. In particular **`response-times`**, which is the only
> user of `percentile_cont(...) WITHIN GROUP (...)`, the ordered-set aggregate and the
> other named ❌ branch. `summary` passing says nothing about it.
>
> The eight-report loop below is one paste and closes this item completely.

**Why it needs the cloud.** The report SQL uses four things the rest of the application
never touches: `COUNT(*) FILTER (WHERE ...)`, the ordered-set aggregate
`percentile_cont(...) WITHIN GROUP (...)`, a window function (`sum(count(*)) OVER
(PARTITION BY ...)`), and `generate_series(...)` in the `FROM` clause. All four are
standard PostgreSQL 9.4-and-later and Aurora is 17.7, so they are expected to work — but
"expected to work" is not the same as "has worked", and this is the first phase whose SQL
could not have been written against an older server.

```sh
TOKEN=...   # a FACILITY_ADMIN access token
BASE="https://${CLOUDFRONT_DOMAIN}/api/v1"

for report in summary categories locations response-times \
              engineer-workload blocked-escalated communication me; do
  printf '%-20s ' "$report"
  curl -s -o /dev/null -w '%{http_code}\n' \
    -H "Authorization: Bearer $TOKEN" "$BASE/reports/$report"
done
```

✅ **Correct result:** eight `200`s.

❌ A `500` on `response-times` only points at `percentile_cont`; on `summary` only, at
`generate_series` in the `FROM` clause. Read the Lambda log group for the SQLSTATE rather
than guessing — both render as a generic 500 to the client.

### 7.2 The daily series buckets in UTC, not in the server's zone

> ⬜ **STILL UNVERIFIED — and now genuinely checkable, which it was not before.** The
> `?from=&to=` call was not run.
>
> Previously this had no data to bucket. The deployed database now holds **300 incidents
> spread over 90 days**, so `per_day` will come back populated and a one-day offset would
> actually be visible. Do [4.2](#42-timestamps-serialise-as-utc-from-the-lambda) at the
> same time — they are the same question asked from two ends, and neither has been asked.

**Why it needs the cloud.** `summary.per_day` casts `created_at` to `date`, and a
`timestamptz` renders in the **session** time zone. `app/db.py` pins that to UTC through
`build_connect_args`, and the test fixtures build their engine the same way — so locally
the pin is proven to work, not proven to be what Aurora would otherwise have done. If the
pin were ever dropped, tickets near midnight would land on different days in the two
environments and nothing would error.

```sh
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/reports/summary?from=$(date -u -d '2 days ago' +%Y-%m-%dT00:00:00Z)&to=$(date -u +%Y-%m-%dT23:59:59Z)" \
  | python3 -m json.tool | head -40
```

✅ **Correct result:** `window.from` and `window.to` come back with a `+00:00` offset, and
`per_day` holds one entry per calendar day with `day` values that match the UTC dates in
the request.

❌ Days offset by one, or a `per_day` length one longer or shorter than expected, means
the session zone is not UTC. Check `SHOW timezone` through a `migrate`-style invoke before
touching the report code.

### 7.3 Report latency against a realistic row count

> 🟡 **PARTLY VERIFIED — and this is the item whose situation changed most. 2026-09-23.**
>
> **The blocker is gone.** This item required `seed_demo` to have run first, and the old
> [7.5](#75-seed_demo-on-the-deployed-lambda) said it never could. `seed_demo` **has** now
> run against Aurora: **300 incidents, 1,813 events, 37 users, 3 buildings** — the
> realistic row count this item was written for, in the deployed database.
>
> **The one measurement taken, warm:**
>
> | Report | Time | Bar |
> | --- | --- | --- |
> | `/reports/summary` | **0.20 s** | under 1 s ✅ |
>
> **That is the right one to have.** `summary` is this item's own stated worst case — it
> issues three statements, one of them a 31-row `generate_series` with **two correlated
> subqueries per row** — and the ⚠️ below says that if anything is the outlier it will be
> this. It is not. At 0.20 s against 300 incidents there is no case for rewriting
> `per_day` as two grouped queries plus a Python zero-fill.
>
> **Six of seven reports remain unmeasured**, including `/reports/blocked-escalated`, the
> other named suspect (`_blocked_since()`, one correlated `MAX` over `incident_events`
> per blocked row — now against **1,813** event rows). **Do not read "reports are fast"
> into one report being fast.**
>
> **Still not answered at all:** whether `ix_incident_events_incident_id_created_at`
> covers that correlated `MAX`. That needs `EXPLAIN`, and there is still no psql path to
> Aurora.

**Why it needs the cloud.** Locally every report runs against a fixture of ten incidents.
The demo dataset is ~300, and Aurora Serverless v2 starts from `min_capacity = 0.0`.
The reports issue between one and three statements each; `/reports/summary` issues three,
one of which is a 31-row `generate_series` with two correlated subqueries per row.

Run **after** `seed_demo` (pass 2), and warm the database first so the number is not a
cold-start measurement:

```sh
curl -s "https://${CLOUDFRONT_DOMAIN}/api/v1/health" > /dev/null
for report in summary categories locations response-times \
              engineer-workload blocked-escalated communication; do
  printf '%-20s ' "$report"
  curl -s -o /dev/null -w '%{time_total}s\n' \
    -H "Authorization: Bearer $TOKEN" "$BASE/reports/$report"
done
```

✅ **Correct result:** every report under 1 s warm. A dashboard fires several at once, so
the slowest one sets the page's time-to-content.

⚠️ If `/reports/summary` is the outlier, the 31 correlated subqueries in `per_day` are the
first thing to look at — two grouped queries plus a Python zero-fill would be the fallback,
and the reason it was not done that way is in the guide.

⚠️ If `/reports/blocked-escalated` is the outlier, it is `_blocked_since()`: one correlated
`MAX` over `incident_events` per blocked row. `ix_incident_events_incident_id_created_at`
should cover it; confirm with `EXPLAIN` rather than assuming.

### 7.4 The admin-only split survives CloudFront

> ⬜ **STILL UNVERIFIED.** No employee token was pointed at `/reports/summary` to confirm
> a **403** with `{"code": "ROLE_NOT_PERMITTED"}` rather than HTML.
>
> The general form of the worry is retired — [1.4](#14-the-spa-cloudfront-function-does-not-touch-the-api)
> shows API errors are not rewritten, via a 401. But **401 and 403 are different paths**:
> one is rejected before any router runs, the other after the role check inside the
> application, and this item is about the second. Two `curl`s.

**Why it needs the cloud.** M3's 3.3 established that error status codes survive the
distribution, but the 403s there came from routes CloudFront had already been asked to
forward. These are new paths, and a 403 that CloudFront rewrote into a 200 `/index.html`
would be the exact rubric violation `infra/cloudfront.tf` was changed to prevent.

```sh
EMPLOYEE_TOKEN=...   # any EMPLOYEE account
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" "$BASE/reports/summary"
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" "$BASE/reports/me"
```

✅ **Correct result:** `403` then `200`, and the 403 body is
`{"detail": ..., "code": "ROLE_NOT_PERMITTED"}` rather than HTML.

## M7 — Dashboards and demo data (pass 2: `seed_demo`)

### 7.5 `seed_demo` on the deployed Lambda

> ♻️ **SUPERSEDED, 2026-09-23. This item's title used to be "`seed_demo` refuses to run
> on the deployed Lambda", and that is no longer what the code does.**
>
> **What changed.** Commit `cbcf93a` added an explicit opt-in to
> `_op_seed_demo` in `backend/v1/app/services/ops.py`. The guard now reads:
>
> ```python
> if not settings.is_local and not bool(
>     event.get("i_understand_this_publishes_demo_credentials")
> ):
> ```
>
> A bare `{"action":"seed_demo"}` is still refused in a deployed environment. A payload
> that carries `"i_understand_this_publishes_demo_credentials": true` proceeds. The flag
> is deliberately verbose — as the code comment says, `force: true` "would be too easy to
> copy from a runbook without reading it".
>
> **Why.** Refusing outright meant the deployed application had nothing to show. A
> workshop demonstration on a sandbox account is a legitimate reason to want exactly this
> data.
>
> **What was observed.** The opt-in path was taken. **`seed_demo` ran against Aurora** and
> created **300 incidents, 1,813 events, 37 users and 3 buildings**. See
> [7.6](#76-seeding-the-review-database-if-you-decide-you-want-demo-data-there).
>
> **What is proven, and what is not:**
>
> - ✅ **`IS_LOCAL` reaches the Lambda as `"false"`.** That was this item's underlying
>   worry, and it is settled from the other side: the same flag drives `sslmode=require`,
>   which is confirmed applied, and the weak-`JWT_SECRET` refusal, which is confirmed
>   running ([3.1](#31-the-lambda-refuses-to-start-without-a-real-jwt_secret)). The guard
>   is not silently open.
> - ⬜ **The bare refusal has not been tested deployed.** Nobody invoked
>   `{"action":"seed_demo"}` *without* the flag to watch it refuse. The branch is covered
>   by `tests/unit/test_ops.py` locally, which is what this item always said was not
>   enough.
>
> ⚠️ **The stated risk is now a live fact, not a hypothetical.** The deployed database
> contains **37 accounts sharing one password that is published in this repository**
> (`DEMO_PASSWORD` in `backend/v1/app/seed/demo.py`, and repeated in
> `frontend/src/features/auth/demoAccounts.ts`). That is acceptable **only** because this
> is a throwaway sandbox deployment of a workshop submission holding nothing real. It
> would not be acceptable anywhere else, and there is still **no `unseed_demo`** — the way
> back is to drop and recreate the database.
>
> ✅ **The expected-result text below is stale.** The current refusal message ends
> `Pass "i_understand_this_publishes_demo_credentials": true to proceed on a sandbox
> account you control.`, not the wording quoted.

**Why it needs the cloud.** The guard reads `settings.is_local`, which is False only
because `infra/locals.tf` injects `IS_LOCAL = "false"`. Locally the refusal is tested by
setting the variable by hand (`tests/unit/test_ops.py`), which proves the branch, not the
wiring. If `IS_LOCAL` failed to apply, the flag would fall back to its development default
of True and the guard would silently open.

**Risk if wrong.** A direct invoke would insert thirty-seven accounts — all sharing one
password published in this repository — and three months of fictional tickets into the
deployed database, and there is no `unseed_demo`. *(This is now the deliberate state of
the deployed database, by the opt-in above.)*

```sh
aws lambda invoke --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --payload '{"action":"seed_demo"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

✅ **Correct result:** `{"ok": true, "action": "seed_demo", "result": {"created": false,
"error": "seed_demo is refused outside local development ... environment is 'aws'."}}` and
**no rows written**. Confirm the second half rather than trusting the first:

```sh
aws lambda invoke --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --payload '{"action":"health"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

❌ If it reports `"created": true`, `IS_LOCAL` did not reach the Lambda — check
`local.env_vars` and re-apply. Then the database needs recreating, because the demo
accounts cannot be told apart from real ones by anything except their names.

### 7.6 Seeding the review database, if you decide you want demo data there

> ♻️ **SUPERSEDED — it was decided, and it was done. 2026-09-23.**
>
> **The deployed database is seeded.** `seed_demo` ran against Aurora through the Lambda,
> via the explicit opt-in described in [7.5](#75-seed_demo-on-the-deployed-lambda):
>
> | | Created on Aurora |
> | --- | --- |
> | Incidents | **300** |
> | Events | **1,813** |
> | Users | **37** (1 admin, 6 engineers, 30 employees) |
> | Buildings | **3** |
>
> ✅ **All the demo accounts tried signed in to the deployed app**, and the demo account
> picker on the sign-in screen fills the form in one click.
>
> **The advice below is inverted.** This item said "deliberately not runnable against
> Aurora" and "prefer demoing against a local database". Both are now out of date: the
> deployed app has the same world as the local one, and the deployed URL is a first-class
> way to demonstrate it. `docs/DEMO-SCRIPT.md` carries both routes.
>
> ⚠️ **The reset half was not done and is not planned.** This item's original option was
> "run it, and reset the database afterwards". The data is staying. That is a deliberate
> choice for a sandbox demonstration, not an oversight — but it means the deployed
> database permanently contains accounts with a published password. See 7.5's warning.
>
> ⚠️ **Not confirmed:** the floor, desk and meeting-room counts (`~14`, `~420`, `~34`
> below) and the `by_status` spread, which were not read back from the Aurora response.
> The four figures in the table are what was reported.
>
> The local commands below still work and are still the right way to refresh a local
> demo database.

**Why it needs the cloud.** Decision D4 resets `acme_incidents_dev` before seeding, and
7.3's report timings need a realistic row count to be worth measuring. *(The deployed
database now has one.)*

Against **Aurora**, this needs the explicit opt-in flag — see
[7.5](#75-seed_demo-on-the-deployed-lambda):

```sh
aws lambda invoke --function-name "coding-workshop-v1-${PARTICIPANT_ID}" \
  --payload '{"action":"seed_demo","i_understand_this_publishes_demo_credentials":true}' \
  --cli-binary-format raw-in-base64-out /dev/stdout
```

⚠️ Read 7.5 before running that. It publishes 37 accounts with a shared password and
cannot be undone without dropping the database.

Locally, and only locally:

```sh
POSTGRES_NAME=acme_incidents_dev python -c "import function, json; \
  print(json.dumps(function.handler({'action':'migrate'}, None)))"
POSTGRES_NAME=acme_incidents_dev python -c "import function, json; \
  print(json.dumps(function.handler({'action':'seed_demo'}, None), default=str))"
```

✅ **Correct result:** roughly one second, `"created": true`, and a payload reporting
3 buildings, ~14 floors, ~420 desks, ~34 meeting rooms, 37 users and 300 incidents with a
`by_status` spread of roughly 60% CLOSED and 40% live.

⚠️ Not idempotent in the topping-up sense: a second run finds the demo buildings and
returns `"created": false` without writing. To regenerate, drop and recreate the database
first.

### 7.7 The generated timestamps survive the round trip through Aurora

> ⬜ **STILL UNVERIFIED — but unblocked, which is the change.** The
> `/reports/blocked-escalated` call was not made against the deployed API, so
> `max_age_hours` has not been compared with the local figure.
>
> **Its precondition is now met.** This item said "only checkable if 7.6's data ever
> reaches a deployed database". It has: **1,813 backdated event rows** were bulk-inserted
> into Aurora in one transaction — precisely the case this item exists for, and the one
> [4.2](#42-timestamps-serialise-as-utc-from-the-lambda) does not cover.
>
> The bulk insert **succeeded**, so psycopg wrote aware UTC datetimes into `timestamptz`
> without error. What is unproven is whether they read back at the same instant, which is
> the part that fails silently and by exactly a whole number of hours.

**Why it needs the cloud.** Every backdated timestamp is written as an aware UTC
`datetime` through psycopg into `timestamptz`. `app/db.py` pins the session time zone to
UTC via `build_connect_args`, and M4's 4.2 established that timestamps serialise as UTC
from the Lambda — but that was for rows the API wrote one at a time, not for a bulk insert
of ~2,000 event rows in one transaction. A session time zone that failed to apply would
shift the daily series and every age by the offset, quietly.

Only checkable if 7.6's data ever reaches a deployed database. If it does:

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/reports/blocked-escalated" | jq '.blocked'
```

✅ **Correct result:** `max_age_hours` in the hundreds or low thousands, matching what the
same query returns locally to within the hours between the two runs. ❌ An age that is out
by exactly a whole number of hours is a time-zone problem, not a data problem.

### 7.8 A 300-incident seed inside the Lambda's limits

> ✅ **VERIFIED, 2026-09-23. It fits.**
>
> This item was recorded as **unverifiable** — "unverifiable while 7.5 stands, and
> recorded so that nobody discovers it by trying". 7.5 no longer stands, the guard was
> deliberately opened for one invoke, and the answer is that the whole generation runs
> inside the Lambda against Aurora:
>
> **300 incidents, 1,813 events, 37 users, 3 buildings** — written in one invoke, inside
> `timeout = 300` and `memory_size = 512`, across the VPC, to an Aurora instance that had
> been at `min_capacity = 0.0`. Roughly 2,300 ORM objects held in memory before flushing,
> and it neither timed out nor ran out of memory.
>
> **Not captured:** the reported `Duration` and `Max Memory Used` from the invoke's log
> tail — so there is **no margin figure**. It fits; how comfortably is unknown. That
> matters if the spec is ever raised above 300 incidents, so grab those two numbers if
> you run it again.
>
> **This item is now an actionable check that has passed**, which is why this file's
> actionable count went from 66 to 67.

**Why it needs the cloud.** Locally the whole generation takes under a second against
PostgreSQL on the same host. In the Lambda it is one round trip per flush across a
VPC to an Aurora instance waking from `min_capacity = 0.0`. `infra/lambda.tf` sets
`timeout = 300` and `memory_size = 512`; the generator holds every incident, event and
note in memory before flushing, which is roughly 2,300 ORM objects.

~~Unverifiable while 7.5 stands~~ — it has now run. Watch the reported `Duration` and
`Max Memory Used` in the invoke's log tail if you run it again; neither was captured the
first time.

## M7 — Dashboards and demo data (pass 3: the three persona screens)

### 7.9 The lazy-loaded dashboard chunk is served, and cached, by CloudFront

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven, indirectly:** signing in through the demo
> account picker **lands on the dashboard** in the deployed app. The dashboard is behind
> a `React.lazy` boundary, so if the SPA rewrite had caught
> `AdminDashboardPage-<hash>.js` and returned `index.html` with a `text/html` MIME type,
> the screen would sit on its Suspense fallback for ever with a console error. It does
> not. So a `.js` asset **does** pass straight through the CloudFront Function, which is
> the rule this item says had never been exercised by a request the *browser* makes on
> its own.
>
> **Not measured:** the `curl` giving `200 text/javascript` and ~340 kB, and the negative
> half — confirming the chunk is **not** fetched when signing in as an employee. Note
> that the size figure in this item predates compression; with `compress = true` now live
> ([5.6](#56-measure-whether-the-bundle-is-served-compressed)) the transferred size will
> be far smaller than 340 kB, and that is correct rather than a failure.

**Why it needs the cloud.** M7 pass 3 splits the admin dashboard and `@mui/x-charts` into
a second JavaScript chunk, fetched only when an admin lands on `/`. Locally Vite serves it
from the dev server, so nothing is exercised about how it is *deployed*: the chunk is a
hashed asset next to `index.html` in S3, requested at runtime by the already-loaded
`index-*.js`, and it must come back 200 from the default CloudFront behaviour rather than
be swallowed by the SPA rewrite.

`infra/cloudfront.tf`'s CloudFront Function rewrites **extension-less** paths to
`/index.html` (see `docs/INFRA-CHANGES.md`). A `.js` file has an extension, so it should
pass straight through — but that rule has never been exercised by a request the *browser*
makes on its own rather than one typed into the address bar.

```sh
# After ./bin/deploy-frontend.sh, find the chunk's real name:
ls frontend/dist/assets/AdminDashboardPage-*.js

curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
  "$BASE_URL/assets/AdminDashboardPage-<hash>.js"
```

✅ **Correct result:** `200 text/javascript` and roughly 340 kB. ❌ `200 text/html` with
about 1 kB means the SPA rewrite caught it, and an admin would see the dashboard's
Suspense fallback for ever with a MIME-type error in the console. Then sign in as an admin
in a real browser, open the network panel, and confirm the second chunk is requested on
arrival at `/` and **not** requested when signing in as an employee.

### 7.10 Eight report requests on one page load against a sleeping Aurora

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven:** the thing this item says the risk really
> is — "what an admin sees: eight spinners for fifteen seconds with nothing saying why" —
> **was observed, and it is exactly that.** Six seconds after signing in, a persona home
> still showed three "Loading…" spinners while Aurora woke. Nothing timed out.
>
> **Proven warm, for one of the seven:** `/reports/summary` at **0.20 s**.
>
> **Not run:** the seven-report loop below, so six reports have no warm number and the
> concurrent first-paint case — seven reports plus `GET /incidents` queueing behind one
> cold connection — has not been watched in a Network panel.
>
> **On its ❌ branch:** "if the cold path is bad enough to matter, the fix is a
> `min_capacity` above zero on the review environment". That was considered and
> **declined** — 0.5 ACU bills continuously on a shared sandbox account. The accepted fix
> is procedural: warm the page about a minute before a demonstration. See
> [1.6](#16-aurora-cold-start).

**Why it needs the cloud.** The dashboard issues six period reports, one current-state
report and one `GET /incidents` **concurrently** on first paint. Locally that is eight
queries against PostgreSQL on the same host and the page is complete in well under a
second. Deployed, the first of them may arrive at an Aurora Serverless v2 instance at
`min_capacity = 0.0` — a ~15 second wake — and the other seven queue behind it on a Lambda
whose `timeout` is 300 s but whose Function URL fronting has its own limits.

The risk is not correctness but what an admin sees: eight spinners for fifteen seconds
with nothing saying why.

```sh
# Warm, after one request has woken the cluster.
# All seven reports the dashboard actually requests — six period, one current-state.
# The eighth concurrent request on first paint is GET /incidents, not a report.
for r in summary categories locations response-times engineer-workload communication \
         blocked-escalated; do
  curl -s -o /dev/null -w "$r %{time_total}\n" \
    -H "Authorization: Bearer $TOKEN" "$BASE/reports/$r"
done
```

✅ **Correct result:** every warm request under a second, and the cold first one completing
rather than timing out. ❌ If the cold path is bad enough to matter, the fix is a
`min_capacity` above zero on the review environment, not a change to the screen.

> **Corrected after S1.** This loop listed six reports and omitted `communication`, so it
> exercised six of the eight requests the item is named for. `communication` was the
> report with no screen until S1 gave it one (`CommunicationPanel`), which is exactly why
> it was easy to leave out of a list of what the dashboard fetches. It is a period report
> and it is now in the loop.

### 7.11 The dashboard's number-to-list agreement, against real data

> ⬜ **STILL UNVERIFIED — and now exactly as checkable as it was designed to be.** No
> tile was clicked through to its list on the deployed app.
>
> This item wanted "a deployed database with a different row count" to compare against,
> and there now is one: **300 incidents** seeded directly into Aurora, with the
> `created_at` bounds evaluated on the database rather than on the API host. Sign in as
> `demo.admin@acme.inc`, note "Still open", click it, compare with the list footer, then
> do "Blocked" under **Right now** and confirm the URL carries **no** `created_from`.
>
> Depends on [3.2](#32-include_inactive-and-the-admin-listings-work-through-cloudfront):
> if query strings are not reaching the Lambda, every drill-down list is unfiltered and
> this item will report a mismatch for the wrong reason.

**Why it needs the cloud.** `e2e/dashboards.spec.ts` asserts that a KPI tile's number
equals the total of the list it links to. That is the property that proves the period and
current-state scoping line up end to end, and it is checked locally against a few hundred
incidents. Against a deployed database with a different row count, different clock skew
between the Lambda and Aurora, and `created_at` bounds evaluated on the database rather
than the API host, it is worth confirming once by hand.

Sign in as an admin, note "Still open", click it, and compare with the list's footer.
Repeat for "Blocked" under **Right now** — that link must carry no `created_from` in the
address bar at all.

✅ **Correct result:** both totals match their tiles, and the live one's URL is
`/tickets?status=BLOCKED` with no date parameters. ❌ A live tile whose list is shorter
than the tile means a date filter has crept onto a current-state link, which is decision
D9's failure reintroduced at the UI layer.

### 7.12 Charts render in the deployed build, not only in the dev server

> ⬜ **STILL UNVERIFIED.** Nobody has looked at the four bar charts and the daily-flow
> line chart in the deployed build to confirm they draw **marks** rather than empty plot
> frames.
>
> [7.9](#79-the-lazy-loaded-dashboard-chunk-is-served-and-cached-by-cloudfront) shows the
> chunk carrying `@mui/x-charts` is **fetched and executed** — the dashboard renders. That
> is not the same claim: this item is about Vite's production build resolving and
> tree-shaking the vendored d3 differently from the dev server, which produces an `<svg>`
> with axes and nothing inside it. **A rendered dashboard with empty charts would look
> exactly like what was observed.** Worth two minutes of actually looking.

**Why it needs the cloud.** `@mui/x-charts` is new in this pass and renders SVG through
a vendored d3 bundle. Vite's dev server and its production build resolve and tree-shake
that dependency differently, and `npm run build` succeeding proves only that it compiles.

Sign in as an admin against the deployed URL and confirm the four bar charts and the
daily-flow line chart draw marks — not empty plot frames — and that each bar carries its
value label outside the bar.

✅ **Correct result:** bars with numbers beside them, two coloured lines with a legend.
❌ An empty `<svg>` with axes but no `.MuiBarChart-element` inside it is a bundling
problem, visible only here.

## S6 — Hardening (accessibility, boundaries, 404, lockout, JSON logs)

### 8.1 Run the new migration before anything else

> ✅ **VERIFIED, 2026-09-23.** The migration reached **head**, which includes revision
> `0004` and therefore the `login_attempts` table.
>
> Proven twice over: **the demo accounts sign in to the deployed app.** The lockout check
> is the first thing `authenticate` does, so without that table *every* sign-in returns
> 500. Sign-in works, so the table exists.
>
> What remains unproven is that the lockout **behaves** — see
> [8.4](#84-the-lockout-works-through-cloudfront-and-the-429-survives-it) and
> [8.5](#85-the-lockout-counter-is-shared-across-lambda-containers), both still open.

**Why it needs the cloud.** `login_attempts` is created by revision `0004`. Until it
exists, **every sign-in returns 500** — the lockout check is the first thing
`authenticate` does. This is the one S6 step that must happen before the application is
usable at all, and it is a one-line invoke.

```sh
aws lambda invoke --function-name "$FUNCTION_NAME" \
  --payload '{"action":"migrate"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

Expect `{"ok": true, "action": "migrate", "result": {"schema": "upgraded to head", …}}`.
`migrate` is idempotent, so running it when it has already run is a no-op.

### 8.2 The log lines are JSON in CloudWatch, and queryable

> ⬜ **STILL UNVERIFIED.** No log group was tailed and no Logs Insights query was run.
>
> The log group now has real traffic in it to look at — a deploy, a migration, a bulk
> seed and several sign-ins — so both halves of this item are ready to check: that each
> line appears **once** (not also as a prose copy from the runtime's own handler), and
> that CloudWatch parses the object into queryable fields rather than dropping it whole
> into `@message`.

**Why it needs the cloud.** Locally the JSON goes to a terminal, which proves the format
and nothing about CloudWatch. Two things can only be seen there: that the Lambda
runtime's own handler is **not** also printing a prose copy of every line (the reason
`configure_logging` replaces the root handler rather than appending to it), and that
CloudWatch parses the object into queryable fields rather than storing it as a string.

```sh
aws logs tail "/aws/lambda/$FUNCTION_NAME" --since 10m --format short | head -20
```

Each line should be one JSON object and each should appear **once**. Then, in the
CloudWatch Logs Insights console, over the same log group:

```
fields @timestamp, request_id, method, route, status, duration_ms, user_id
| filter event = "request"
| sort @timestamp desc
| limit 20
```

If `status` and `duration_ms` come back as columns, the parse worked. If the whole line
lands in `@message` and the other fields are empty, it did not — check that nothing is
prefixing the line before the `{`.

Then the query the whole exercise is for:

```
fields @timestamp, route, status, duration_ms
| filter event = "request" and status >= 500
| sort duration_ms desc
```

### 8.3 The Lambda request id is what the line is filed under

> ⬜ **STILL UNVERIFIED.** The `x-request-id` header was not read off a deployed response,
> so neither half is answered: whether Mangum puts the Lambda context into the ASGI scope
> (the branch that only exists in the cloud), and whether CloudFront forwards and returns
> the header at all.

**Why it needs the cloud.** `_resolve_request_id` prefers a caller-supplied
`x-request-id`, then `scope["aws.context"].aws_request_id`, then a fresh UUID. Only the
middle branch needs Lambda — Mangum puts the Lambda context into the ASGI scope, and the
point of using it is that the application's line and CloudWatch's own `START RequestId:`
line join on the same value. Locally that branch never runs.

```sh
curl -si "$CLOUDFRONT_URL/api/v1/health" | grep -i x-request-id
```

Take the value and find it in the log group; the `START RequestId:` line for the same
invocation should carry the same id. If instead it is a bare 32-character hex string,
the Lambda context was not visible in the scope and the branch fell through to the UUID —
which still works, but loses the join.

Also confirm CloudFront **forwards and returns** the header. If `x-request-id` is absent
from the response, the distribution is stripping it and a support conversation cannot
start from something the browser can see.

### 8.4 The lockout works through CloudFront, and the 429 survives it

> ⬜ **STILL UNVERIFIED.** The eleven-attempt loop was not run against the deployed
> distribution.
>
> Its premise is partly settled: CloudFront is **not** rewriting API error responses
> ([1.4](#14-the-spa-cloudfront-function-does-not-touch-the-api), via a 401), so a 429
> turning into an HTML page is unlikely. What is untested is the `Retry-After` **header**
> surviving the CDN, which is a different mechanism from the status code and the body.
>
> Safe to run: it uses an address that does not exist, so no real account is locked, and
> the row cleans itself up within fifteen minutes. Use `deploy.check.nobody@acme.inc` as
> written — **not** one of the demo accounts, which are now real accounts in the deployed
> database.

**Why it needs the cloud.** A 429 with a `Retry-After` header has two things in front of
it that do not exist locally: CloudFront, which has its own opinions about error
responses, and the `custom_error_response` mapping that `docs/INFRA-CHANGES.md` item 1
replaced. A distribution that rewrote a 429 the way the scaffold rewrote 404s would turn
the lockout into an HTML page.

Use an address that does not exist, so no real account is locked:

```sh
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code} " -X POST "$CLOUDFRONT_URL/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"deploy.check.nobody@acme.inc","password":"wrong-'"$i"'"}'
done; echo
```

Expect ten `401`s then a `429`. Then check the shape survived the CDN:

```sh
curl -si -X POST "$CLOUDFRONT_URL/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"deploy.check.nobody@acme.inc","password":"x"}' | head -20
```

`Retry-After` must be present as a header, `retry_after_seconds` in the JSON body, and
the body must be JSON rather than HTML. Locally verified: ten 401s then a 429 carrying
`Retry-After: 898`.

The row cleans itself up within fifteen minutes; nothing needs deleting afterwards.

### 8.5 The lockout counter is shared across Lambda containers

> ⬜ **STILL UNVERIFIED.** The parallel `xargs` burst was not run.
>
> This is the item that proves **why** [D19](DECISION-LOG.md#d19--where-a-failed-login-counter-can-live-when-there-is-no-shared-memory)
> put the counter in a table rather than in process memory, and there is still exactly one
> place that question can be answered. Now that the stack is live, it is one command.

**Why it needs the cloud.** This is the *reason* the counter is a table rather than a
process variable ([D19](DECISION-LOG.md#d19--where-a-failed-login-counter-can-live-when-there-is-no-shared-memory)),
and locally there is one process, so the claim is untested. Concurrency spreads the
attempts across containers; if the count still trips at ten, the shared state works.

```sh
seq 1 12 | xargs -P 6 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$CLOUDFRONT_URL/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"deploy.check.parallel@acme.inc","password":"wrong-{}"}' | sort | uniq -c
```

Expect roughly ten 401s and the rest 429s. An exact split is not the assertion — the
requests genuinely race — but *no* 429 would mean each container was counting alone,
which is the failure this design exists to prevent.

### 8.6 The SPA rewrite sends an unknown deep link to the 404 page

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven — the second line, which is the one this
> item calls "the one thing that would silently regress":** an API path is **not**
> swallowed by the SPA rewrite. An unauthenticated API call returns 401 from the
> application, not 200 with `index.html`. That is the rubric line
> [`INFRA-CHANGES.md`](INFRA-CHANGES.md) item 1 exists to protect, and it holds.
>
> **Proven, adjacent:** an extension-less path reaches the SPA — `/tickets` returns 200.
>
> **Not done:** an **unknown** extension-less path. `/tickets` is a real route, so what
> was confirmed is that the rewrite happens, not that an unrecognised path lands on
> `NotFoundPage` rather than S3's XML error document. Nor was the page opened in a
> browser to confirm it renders inside the shell with the navigation intact.

**Why it needs the cloud.** Locally Vite serves `index.html` for anything; in the cloud
it is the CloudFront Function on the default behaviour. An unknown extension-less path
must reach the SPA — where `NotFoundPage` explains it — rather than S3's own XML error,
and it must do so **without** `/api/*` being affected.

```sh
curl -s -o /dev/null -w "%{http_code}\n" "$CLOUDFRONT_URL/definitely-not-a-route"   # 200, index.html
curl -s -o /dev/null -w "%{http_code}\n" "$CLOUDFRONT_URL/api/v1/definitely-not"     # 404, from the API
```

The first is 200 **by design** and the page then says "Page not found" — see
[D21](DECISION-LOG.md#d21--an-unknown-url-gets-a-page-not-a-redirect). The second must
stay a real 404: that is the rubric line `docs/INFRA-CHANGES.md` item 1 exists to protect,
and it is worth re-checking here because it is the one thing that would silently regress.

Then open `$CLOUDFRONT_URL/definitely-not-a-route` in a browser, signed in, and confirm
the page renders inside the shell with the navigation intact.

### 8.7 The error boundary's stale-bundle path, which only a deploy can produce

> ⬜ **STILL UNVERIFIED — but for the first time it is actually *possible*.** The
> four-step procedure was not followed.
>
> This item needs two deploys with a tab open across them, and there have now been
> several ([5.8](#58-a-redeployed-frontend-is-actually-served)) — the mechanism that
> produces a stale chunk reference exists in this environment and has been exercised by
> accident, just never with a tab left open to watch it. `isChunkLoadError` and its
> "This page needs reloading" branch remain the only part of the error boundary that no
> environment has ever driven.

**Why it needs the cloud.** `isChunkLoadError` exists for a tab left open across a
deploy: `index-*.js` is already loaded and asks for an `AdminDashboardPage-*.js` that the
new deploy has renamed. That cannot be reproduced locally, where Vite serves modules by
source path and never renames them.

1. Sign in as an admin and load the dashboard, so the chunk is fetched once.
2. Navigate away to `/tickets` and leave the tab open.
3. Run `./bin/deploy-frontend.sh` from another terminal — rebuilding changes the hashes
   and the invalidation removes the old asset.
4. Back in the open tab, navigate to `/` again.

Expect "This page needs reloading" and a **Reload the page** button, not "Something went
wrong" with a Try again that cannot work. Press it and the dashboard loads.

If instead the tab shows a blank page, the boundary did not catch it — check that the
error reached a render rather than an unhandled rejection.

### 8.8 Contrast and focus on the real deployed CSS

> 🟡 **PARTLY VERIFIED, 2026-09-23.** **Proven:** the production build's extracted,
> concatenated CSS renders correctly at **both** viewports on the deployed app — the demo
> account picker was checked at **1440 px and 375 px** and the layout holds.
>
> **Not done, and it is the half that matters:** nobody pressed **Tab** on the deployed
> site and looked for a focus ring. That is the specific thing this item exists for. The
> ring depends on `body :focus-visible` **beating Material UI's `ButtonBase` on
> specificity**, and it was order-dependent before the fix — the production build is the
> only place the concatenated order differs from development. Looking at a page proves
> nothing here; [D23](DECISION-LOG.md#d23--what-tabbing-found-that-axe-did-not) is the
> story of a focused card being pixel-identical to the four beside it.
>
> **Two minutes: open the deployed URL, press Tab twice, look. Then Tab to a category
> card on `/report` and look again.**

**Why it needs the cloud.** The axe run and the focus-ring screenshots were taken against
the Vite dev server, which serves Emotion's styles from separate injected `<style>` tags
in development order. The production build extracts and concatenates them, and the focus
ring depends on **specificity beating injection order** — `body :focus-visible` against
Material UI's `ButtonBase`. It should be order-independent now, which is the point of the
fix, but it was order-dependent before it and nothing else in this project has been
checked against the built CSS.

```sh
cd frontend && npm run build && npx playwright test accessibility.spec.ts \
  --project=desktop -- --E2E_BASE_URL="$CLOUDFRONT_URL"
```

or, more simply, sign in at the CloudFront URL, press Tab twice and **look**: there must
be a ring. Then tab to a category card on `/report` and look again. That is the check
that caught the ring being absent in the first place
([D23](DECISION-LOG.md#d23--what-tabbing-found-that-axe-did-not)).

## S1 — In-app notifications

### 9.1 Revision 0005 applies to Aurora, and creates the enum type

> ✅ **VERIFIED, 2026-09-23.** The migration reached **head**, and `0005` is head. So both
> halves this item worried about held on a database that had already run `0001`–`0004`:
> the `notification_type` enum was created outside `0001`, and the `notifications` table
> with it. [D28](DECISION-LOG.md#d28--revision-0001-was-not-frozen-and-0005-is-what-proved-it)'s
> concern — that `0001` had stopped iterating `ENUM_TYPES` — did not bite on Aurora.
>
> A half-applied revision would have left `type "notification_type" does not exist`, and
> "upgraded to head" is not reported unless every step completed.
>
> **Not done:** the explicit `GET /api/v1/notifications/unread-count` call returning
> `{"unread": 0}` rather than a 500. The bell polls that endpoint on every screen, so a
> 500 would show as a permanently absent badge — quietly. One `curl` closes it.

`0005` is the first revision to create a PostgreSQL enum type outside `0001`, and the
first to be written after `0001` stopped iterating `ENUM_TYPES`
([D28](DECISION-LOG.md#d28--revision-0001-was-not-frozen-and-0005-is-what-proved-it)).
Both halves are worth proving against a database that has already run `0001`–`0004`.

```sh
aws lambda invoke --function-name <fn> \
  --payload '{"action":"migrate"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

Expect `{"ok": true, ... "schema": "upgraded to head"}`. Then, through the API rather
than psql (Aurora is not reachable from a laptop): sign in, `GET
/api/v1/notifications/unread-count` must return `{"unread": 0}` rather than a 500. A 500
here with `type "notification_type" does not exist` means the revision half-applied;
`relation "notifications" does not exist` means it did not run at all.

**Locally this was applied to both `acme_incidents_dev` and `acme_demo`.** A migration
applied to one and not the other is the failure mode S6 nearly shipped — the demo
database was missed and would have 500'd on login.

### 9.2 The unread count is an index-only scan on Aurora, not just on PostgreSQL 18

> ⬜ **STILL UNVERIFIED, and still genuinely blocked.** The engine version is confirmed
> **17.7**, and the **data precondition is now met** — `seed_demo` ran against Aurora and
> writes notifications with a read rate, so there are unread rows for a real demo user to
> count.
>
> **What is still missing is the access path, not the data.** This needs `EXPLAIN
> (ANALYZE, BUFFERS)`, and Aurora remains `publicly_accessible = false` with no psql
> route from the VDI. The two ways out named below are unchanged: add a read-only
> `explain` ops action, or measure locally and treat it as a lower bound.
>
> Deploying did not move this one. It is the clearest remaining case for the `explain`
> action.

The measurement behind [D30](DECISION-LOG.md#d30--thirty-seconds-one-integer-and-a-database-that-sleeps)
was taken on the development machine's PostgreSQL 18.6. Aurora is 17.7, and an
index-only scan depends on the visibility map, which depends on autovacuum having run.
With demo data seeded:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM notifications WHERE user_id = '<a demo user>' AND read_at IS NULL;
```

Expect `Index Only Scan using ix_notifications_user_id_read_at` and `Heap Fetches: 0`.
**`Heap Fetches` above zero is the thing to watch**: it means the visibility map is
stale, the scan is touching the table, and the cheapest route in the application is not
as cheap as it looks. `VACUUM ANALYZE notifications` and re-measure. If it recurs on a
busy instance, that is the argument for a partial index
(`ON notifications (user_id) WHERE read_at IS NULL`) rather than the composite one.

There is no way to run this without a psql session, so it needs the ops path: add a
read-only `explain` action, or take the measurement from a local database seeded to the
same size and treat it as a lower bound.

### 9.3 The poll does not keep Aurora awake — or, if it does, that is a decision

> ⬜ **STILL UNVERIFIED — and now much more interesting than when it was written.** The
> ACU graph has not been looked at after leaving a tab open.
>
> Two things make this worth doing now. First, **the cold start is confirmed real and
> costly** ([1.6](#16-aurora-cold-start)) — which means a poll that *does* hold Aurora
> awake is not purely a cost question, it is also accidentally the mitigation for the
> demo problem. Second, the "accept it, the cost of 0.5 ACU is small" option now has to be
> weighed against this being a **shared sandbox account**, where continuous capacity is
> the same objection that ruled out raising `min_capacity`.
>
> **Nothing here is a bug.** Recorded so the graph does not come as a surprise, and the
> graph now exists to be looked at.

Aurora Serverless v2 runs at `min_capacity = 0` and sleeps when idle. Every open browser
tab asks for the unread count every thirty seconds, and TanStack Query stops the interval
while the window is unfocused — but a tab that *is* focused, left open on somebody's
second monitor, will hold the database awake indefinitely.

Check it after a demo: leave one tab open and idle, then look at the ACU graph in
RDS → Databases → the cluster → Monitoring. If capacity never returns to 0, this is why.

Three ways out, in increasing order of effort: accept it (the cost of 0.5 ACU is small);
raise `UNREAD_POLL_INTERVAL_MS`; or stop polling after a period of no interaction, which
is a real feature and not a config change. **Nothing here is a bug** — it is a known
consequence of a polled badge on a database that bills for being awake, recorded so that
the graph does not come as a surprise.

### 9.4 The notifications a demo generates are real, and the read rate starts at zero

> 🟡 **PARTLY VERIFIED — and the branch that applies has changed. 2026-09-23.**
>
> This item offered two paths: a database seeded fresh with `seed_demo`, which "gets demo
> notifications with it", or an unseeded one that needs the demo script walked once to put
> a number on the tile. **The deployed database took the first path.** `seed_demo` ran
> against Aurora, and it writes notifications — `_write_notifications` in
> `backend/v1/app/seed/demo.py` replays the timeline through `app/notifications.py`'s own
> rules, with a designed read rate, so the inbox agrees with the ticket history rather
> than being invented separately.
>
> **So the three bullets below do not apply to the deployed app.** The bells should not
> read zero, and `/reports/communication`'s three fields should not be `0, 0, null`.
> **Nobody needs to walk the demo script first** to make the dashboard tile meaningful.
>
> **Not confirmed:** the notification **count** on Aurora. The seed reported incidents,
> events, users and buildings; notifications were not among the figures captured. So the
> mechanism is established and the number is not — open the bell on the deployed app and
> look.

The `notifications` table starts empty on any database that already existed
([D31](DECISION-LOG.md#d31--what-s1-deliberately-does-not-do-and-what-looking-at-it-found)
explains why there is no backfill). So on first deploy:

- every bell reads zero, which is correct and looks broken;
- `/reports/communication`'s three new fields read `0`, `0` and `null` — **not** 0%, which
  is the distinction the schema is careful about;
- both fill in as soon as anybody uses the application.

If the deployed database is seeded fresh with `seed_demo`, it gets demo notifications
with it. If it is not, walk the demo script once before showing the dashboard: report a
ticket, assign it, add a public note, resolve it. That produces one of each of the four
kinds and puts a number on the tile.

### 9.5 Known limitation to state rather than check: the badge does not announce itself

> ⬜ **Unchanged by the deployment — and it is not a check.** This is a statement of a
> deliberate design decision, with no command and no expected result. It is the one item
> in this file that is not actionable, which is why the actionable count is **67 of 68**.

There is no `aria-live` region on the bell, deliberately — a polite announcement every
thirty seconds on every screen would interrupt whatever a screen-reader user was reading.
The count is in the control's accessible name, so it is available on demand.

The consequence is real and belongs with the other accessibility notes: a screen-reader
user learns that something arrived when they next reach the bell, not when it arrives.
If that is judged unacceptable, the fix is an `aria-live="polite"` region that announces
**only on an increase** and only once per change — not a live region on the count itself,
which would re-announce on every poll.

## Not yet verifiable, by design

These are out of scope until the phase that introduces them.

> **Two of these eight were unblocked by the deployment, 2026-09-23.** Both were blocked
> on the same thing — no realistic row count in a deployed database — and `seed_demo`
> running against Aurora removed it. They are struck through below and now live as
> ordinary open items.

- ~~Report endpoint performance against a realistic row count.~~ **No longer blocked.**
  It was blocked because 7.5 said `seed_demo` could not run against the deployed
  database. It can, and it did: **300 incidents, 1,813 events** are in Aurora, and the
  first measurement is in — `/reports/summary` at **0.20 s warm**. The remaining six
  reports are an open item under [7.3](#73-report-latency-against-a-realistic-row-count),
  not a declared gap. The local-lower-bound workaround is no longer needed: there is a
  real number with the VPC hop in it.
- **A `resolved_from` / `resolved_to` filter on `GET /incidents`.** Not a cloud check — work
  that was not done. The dashboard's "Resolved in the period" tile counts by `resolved_at`
  (from `/reports/engineer-workload`) while the incident list can only filter on
  `created_at`, so no list matches that tile exactly. The tile is therefore deliberately
  unlinked, and the per-engineer resolved count in the workload table links to an
  approximation with the dates it used shown as a chip. Adding the two filters to
  `IncidentFilters` would close both gaps. See D14 §3.
- **"Unassigned for over 24 hours" is computed from one page of fifty.** Also not a cloud
  check. `GET /incidents` has no "older than" filter, so the dashboard asks for open
  unowned tickets oldest-first and cuts the page at the age. Exact while fewer than fifty
  tickets are that stale; past that it under-reports, and on a busy deployed instance it
  could be. A `created_before` filter, or an `unassigned_over_hours` count on
  `/reports/blocked-escalated`, would make it exact.
- **A ticket resolved by an admin on an unassigned ticket is missing from "Resolved in the
  period".** That figure sums `resolved_in_period` per engineer, so work with no assignee
  belongs to nobody. Reachable only by unassigning an IN_PROGRESS ticket and then resolving
  it as an admin. Rare, and recorded rather than handled.
- **Screen-reader output itself.** Everything in S6 was verified with axe, with a
  keyboard, and by reading the accessibility tree — none of which is the same as
  listening to NVDA, JAWS or VoiceOver read the page. The semantics are asserted;
  how they *sound* is not, and it is the one part of an accessibility pass no
  automated check substitutes for. Worth half an hour with a real screen reader
  before anybody calls this done.
- **Whether a stale visibility map ever costs the unread count its index-only scan.**
  9.2 says how to look; it cannot be looked at without a psql session against Aurora,
  which the IAM boundary and `publicly_accessible = false` together prevent. Measured
  locally, on a 200,000-row table, it was 3–4 shared buffers and `Heap Fetches: 0`.
  **Still blocked after the deployment** — the rows now exist on Aurora, but the way to
  run `EXPLAIN` against them does not. A read-only `explain` ops action is the only route
  that does not require relaxing `publicly_accessible`.
- **The 15-minute lockout window expiring in the cloud.** Locally the expiry is tested
  with an injected `now`, which is the right way to test it. Watching a real address
  unlock after fifteen real minutes is a stopwatch exercise; run it once if you want the
  reassurance, but the injected-clock test is the one that will keep working.
- ~~Anything depending on a realistic row count in the *deployed* database.~~ **No longer
  blocked.** `seed_demo` no longer refuses to run there — [7.5](#75-seed_demo-on-the-deployed-lambda)
  gained an explicit opt-in and it was used. The deployed database holds **300 incidents,
  1,813 events, 37 users and 3 buildings**, so [4.7](#47-auroras-plan-for-the-incident-list)'s
  query plan, [6.7](#67-the-first-list-query-after-an-idle-period)'s timings,
  [7.2](#72-the-daily-series-buckets-in-utc-not-in-the-servers-zone)'s day buckets,
  [7.7](#77-the-generated-timestamps-survive-the-round-trip-through-aurora)'s bulk-insert
  timestamps and [7.11](#711-the-dashboards-number-to-list-agreement-against-real-data)'s
  tile-to-list agreement can all now be measured **where it counts**, with the VPC hop
  included. None of them have been; they are open items, not declared gaps.

---

## What to walk next

If you have twenty minutes, in this order — cheapest first, and each one unblocks or
de-risks something below it:

1. **[3.2](#32-include_inactive-and-the-admin-listings-work-through-cloudfront)** — two
   `curl`s. Until this passes, no filtered screen or drill-down list in the deployed app
   can be trusted, and its failure looks like success. It gates 4.4, 6.2 and 7.11.
2. **[2.2](#22-the-migration-is-idempotent-against-aurora)** — one invoke. The only
   completed `migrate` run against Aurora so far is the first one.
3. **[7.1](#71-the-reports-run-on-aurora-at-all)** — one loop, eight reports. Closes
   most of [7.3](#73-report-latency-against-a-realistic-row-count) with it, and
   `response-times` is the one construct nothing has exercised.
4. **[8.8](#88-contrast-and-focus-on-the-real-deployed-css)** — press Tab twice and look.
   The production CSS is the only place the focus ring's specificity fight can be
   resolved.
5. **[6.4](#64-allowed-transitions-drives-the-buttons-against-the-real-api)** — the
   rubric's central requirement, and a caching failure here is a correctness failure that
   is invisible from one browser.
6. **[5.4](#54-reuse-detection-really-ends-every-session-on-aurora)** — four `curl`s, and
   the local suite structurally cannot answer it.

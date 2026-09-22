# Deployment Checklist

Everything that **cannot be verified without live AWS credentials**, with the exact
command to run and what a correct result looks like.

Built up phase by phase while the reasoning was fresh. Nothing here is a known defect —
each item is something that was designed and tested locally but whose cloud behaviour
depends on Aurora, Lambda, CloudFront or the participant IAM role, none of which are
reachable from the VDI.

**How to use this:** work top to bottom the first time credentials exist. Later phases
append to the bottom; re-run the whole list after a deploy that changes infrastructure.

## Before anything else

```sh
./bin/setup-participant.sh          # refresh STS credentials (they expire in hours)
source ENVIRONMENT.config
aws sts get-caller-identity         # expect an account id, not ExpiredToken
```

If `setup-participant.sh` fails, the account is not provisioned yet and nothing below
can run.

---

## M1 — Scaffold and walking skeleton

### 1.1 Lambda packaging excludes the virtualenv

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

```sh
./bin/deploy-frontend.sh
```

✅ **Correct result:** opening the CloudFront URL shows "API healthy", "Database ok" and
"Environment: aws". ❌ "The API could not be reached" means 1.3 failed.

### 1.6 Aurora cold start

**Why it needs the cloud.** `min_capacity = 0.0` has no local analogue.

Leave the app idle for ~15 minutes, then request `/api/v1/health` and time it.

✅ **Correct result:** the first request takes roughly 15–25 s and then succeeds;
subsequent requests are fast. ❌ A timeout means `postgres_connect_timeout` (30 s in
`app/config.py`) is too low for this cluster.

---

## M2 — Data model, auth and RBAC

### 2.1 The migration's `CREATE EXTENSION` succeeds on Aurora

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

Run the exact same command a second time.

✅ **Correct result:** `"already_present": 37` and `groups_created: 0`,
`subcategories_created: 0`. Nothing is duplicated. ❌ Any non-zero created count on the
second run means the `(parent_id, name)` lookup is not matching — check that the
`NULLS NOT DISTINCT` unique index exists (2.3).

### 2.3 Schema objects Aurora may treat differently

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

**Why it needs the cloud.** The cookie `Path` is deliberately narrow, and CloudFront does
not rewrite paths on the API behaviour — but that is exactly what 1.3 verifies, so this
depends on it.

✅ **Correct result:** after logging in through the deployed UI, the browser sends
`acme_refresh_token` on `POST /api/v1/auth/refresh` but **not** on
`GET /api/v1/health`. Check in the browser devtools Network tab. ❌ If the cookie is sent
on every request, `REFRESH_COOKIE_PATH` in `app/security/dependencies.py` is wrong.

### 2.8 bcrypt's native wheel runs on the Lambda runtime

**Why it needs the cloud.** `bcrypt` ships a compiled extension. Terraform builds the
package with the VDI's local pip (`build_in_docker = false`), so the wheel is whatever
matches this machine — Linux x86_64, CPython 3.13, which *should* match the Lambda
runtime exactly.

Covered implicitly by 2.4 (seeding hashes a password) and 2.6 (login verifies one). If
either fails with an `ImportError` or a `_bcrypt` symbol error, the wheel is wrong:
rebuild with `build_in_docker = true` in `infra/lambda.tf`.

---

## Not yet verifiable, by design

These are out of scope until the phase that introduces them:

- `seed_demo` and its production guard — M7.
- Report endpoint performance against a realistic row count — M7.
- End-to-end lifecycle through the deployed UI with three accounts — M6.

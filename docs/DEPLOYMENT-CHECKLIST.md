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

## M3 — Facilities, categories, engineers and users

### 3.1 The Lambda refuses to start without a real `JWT_SECRET`

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

**Why it needs the cloud.** Compression is a CloudFront behaviour setting applied at the
edge. The dev server does its own thing and proves nothing.

**This one expects to fail.** `infra/cloudfront.tf` does not set `compress` on either
behaviour, and the CloudFront default is **off**. The production bundle is ~790 kB raw
against ~251 kB gzipped — a 3× difference on the first load of every session, and it grows
in M6 (`@mui/x-data-grid`) and M7 (`@mui/x-charts`). Measure it before deciding.

The woff2 alongside it is *not* part of this argument: woff2 is already compressed, and
CloudFront will not shrink it further. Only the JavaScript, CSS and HTML are at stake.
(192 kB of font is emitted, two families at four weights each, but a normal load fetches
only the 96 kB of Roboto — fallback families are fetched lazily.)

```sh
BUNDLE=$(curl -s "https://$CF/" | grep -o '/assets/index-[^"]*\.js')
curl -s -I -H 'Accept-Encoding: gzip, br' "https://$CF$BUNDLE" \
  | grep -iE 'content-encoding|content-length|x-cache'
```

✅ **Expected today:** no `content-encoding` header and a `content-length` near 788 kB.

The fix is one line — `compress = true` on the `default_cache_behavior` in
`infra/cloudfront.tf` — but CLAUDE.md scopes `infra/` edits to three specific changes, and
this is not one of them. **It is the repo owner's call**, not something M5 took on its
own: the file is already on the permitted-edit list, the change is additive and reversible,
and the cost of not doing it is a 537 kB penalty on every cold visit.

### 5.7 The self-hosted font arrives

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

✅ **Correct result:** 12 passed, 2 skipped, the same as locally.
❌ Timeouts on the first test are most likely a cold Aurora — the config allows 90 s per
test, which is generous locally and may not be after a 15-minute idle. Warm it with a
`curl https://$CF/api/v1/health` first and re-run before investigating anything else.
❌ A failure in `responsive.spec.ts` but not in `lifecycle.spec.ts` points at the
delivered CSS rather than the API — check 5.6 and 5.7.

---

## M7 — Dashboards and demo data (pass 1: report endpoints)

### 7.1 The reports run on Aurora at all

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

### 7.5 `seed_demo` refuses to run on the deployed Lambda

**Why it needs the cloud.** The guard reads `settings.is_local`, which is False only
because `infra/locals.tf` injects `IS_LOCAL = "false"`. Locally the refusal is tested by
setting the variable by hand (`tests/unit/test_ops.py`), which proves the branch, not the
wiring. If `IS_LOCAL` failed to apply, the flag would fall back to its development default
of True and the guard would silently open.

**Risk if wrong.** A direct invoke would insert thirty-seven accounts — all sharing one
password published in this repository — and three months of fictional tickets into the
deployed database, and there is no `unseed_demo`.

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

**Why it needs the cloud.** Decision D4 resets `acme_incidents_dev` before seeding, and
7.3's report timings need a realistic row count to be worth measuring. The deployed
database has neither.

This is **deliberately not runnable against Aurora** — see 7.5. If the deployed dashboards
need data, the options are, in order of preference: demo against a local database; or
relax the guard for one invoke, run it, and reset the database afterwards, accepting that
every account shares a published password. Prefer the first.

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

**Why it needs the cloud.** Locally the whole generation takes under a second against
PostgreSQL on the same host. In the Lambda it would be one round trip per flush across a
VPC to an Aurora instance waking from `min_capacity = 0.0`. `infra/lambda.tf` sets
`timeout = 300` and `memory_size = 512`; the generator holds every incident, event and
note in memory before flushing, which is roughly 2,300 ORM objects.

Unverifiable while 7.5 stands, and recorded so that nobody discovers it by trying. If the
guard is ever deliberately relaxed for one invoke, watch the reported `Duration` and
`Max Memory Used` in the invoke's log tail before assuming it will repeat.

## Not yet verifiable, by design

These are out of scope until the phase that introduces them:

- Report endpoint performance against a realistic row count. The checks are written up as
  7.3 above and need `seed_demo` to have run first — which, per 7.5, it cannot do against
  the deployed database. Measure them locally against a seeded database instead, and treat
  the result as a lower bound: it has no VPC hop in it.
- The three persona home pages and the admin dashboard — M7 pass 3. M6 ships every other
  screen; `/` is still a placeholder naming the phase. The report endpoints those pages
  read now exist (M7 pass 1); the pages themselves do not.
- Anything depending on a realistic row count in the *deployed* database. `seed_demo`
  now exists but refuses to run there (7.5), so 6.7's timings and 4.7's query plan are
  still measured against whatever has been reported by hand — tens of rows rather than
  hundreds. Both are worth re-running locally against a seeded database, where the row
  count is right even though the network is not.

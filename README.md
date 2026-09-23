# Coding Workshop

The goal of this coding workshop is to enable and assess the hands-on skills
of participants through development of a practical technical solution that
solves a theoretical business problem.

## Getting Started

Navigate to [Coding Workshop - Main Guide](./docs/README.md) to get started.

## Local development

> This section covers the ACME Facility Incident Management application built in this
> repository. [CLAUDE.md](./CLAUDE.md) holds the scaffold constraints,
> [docs/BUILD-PLAN.md](./docs/BUILD-PLAN.md) the specification, and
> [docs/PROJECT-GUIDE.md](./docs/PROJECT-GUIDE.md) a deep explanation of how it works.

### Prerequisites

PostgreSQL 17 and Python 3.13 installed on the host, and Node 22 for the frontend. There
is no `docker-compose.yml` and no LocalStack — the database runs natively.

### 1. Set up the database

The application never creates its own database; the first step is making one and pointing
the API at it.

```sh
# A role and a database for local work. `postgres123` matches the defaults in
# app/config.py, which are the values infra/locals.tf injects for the local case.
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres123';"
sudo -u postgres createdb acme_incidents_dev
```

The database must exist and be **empty**; the schema comes from Alembic in step 3.

### 2. Configure the backend

```sh
cd backend/v1
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
```

**Do not skip the `.env` copy.** `app/config.py` defaults `POSTGRES_NAME` to `postgres` —
the cluster's empty maintenance database — because that is the name the deployed
environment would use if Terraform injected nothing. With the default in place the API
starts, `/api/v1/health` reports healthy (it only proves the connection works), and then
every real query fails on a missing table.
[`.env.example`](./backend/v1/.env.example) documents every overridable setting; the only
one you normally need is `POSTGRES_NAME=acme_incidents_dev`.

`.env` is gitignored. It never reaches the Lambda either: `infra/locals.tf` excludes
dot-prefixed files from the deployment package, and injects the same variable names
directly instead.

### 3. Create the schema and the first admin

Both run through the ops actions in `app/services/ops.py` — the same code path the
deployed Lambda uses, invoked locally here:

```sh
cd backend/v1
.venv/bin/python -c "from function import handler; print(handler({'action': 'migrate'}, None))"
.venv/bin/python -c "from function import handler; print(handler({'action': 'seed_admin', 'email': 'admin@acme.inc', 'full_name': 'Facility Admin'}, None))"
```

`migrate` upgrades the schema to head and seeds the category reference data; both halves
are idempotent, so re-running is safe. `seed_admin` prints a temporary password **once** —
the account is flagged `must_change_password`, so the first sign-in has to change it.
Self-registration always produces an EMPLOYEE, so this is the only way to get an admin.

### 4. Run it

```sh
# terminal 1 — API on :8000
cd backend/v1 && .venv/bin/uvicorn app.main:app --reload --port 8000

# terminal 2 — UI on :3000, proxying /api to :8000 with the path unchanged
cd frontend && npm install && npm run dev
```

Browse to <http://localhost:3000>. Interactive API docs are at
<http://localhost:8000/api/v1/docs> — note the `/api/v1` prefix, which the application
owns in both environments because CloudFront forwards the full path to the Lambda.

The app opens at the sign-in screen. Two ways in:

- **Create an employee account** — "Create one with your ACME address". Self-registration
  is open to `@acme.inc` addresses only and always produces an EMPLOYEE.
- **Use the admin from step 3** — its temporary password is flagged
  `must_change_password`, so the first sign-in goes straight to a change-password screen
  and offers no way past it. That is the gate working, not a fault.

`npm install` again after pulling this phase: M5 adds `react-hook-form`, `zod`,
`@hookform/resolvers` and `@fontsource/inter` (the typeface is self-hosted and bundled,
not fetched from a CDN).

### 5. Run the checks

```sh
cd backend/v1
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/python -m pytest

cd ../frontend
npm run lint && npm test
```

As of M5: **606 backend tests** and **112 frontend tests**, all passing. The backend
suite takes about five minutes, most of it bcrypt hashing at cost 12.

The backend suite needs the same PostgreSQL server. It creates its own database
(`acme_incidents_test`, from `POSTGRES_TEST_NAME`) and **drops and recreates it on every
run**, so never point that at a database you care about; `tests/conftest.py` refuses to
drop `postgres`. Your `acme_incidents_dev` data is untouched.

Because that drop uses `WITH (FORCE)`, **only one suite can use a given database at a
time** — a second run terminates the first one's connections mid-test. If you need two at
once, give the second its own:

```sh
POSTGRES_TEST_NAME=acme_incidents_mine .venv/bin/python -m pytest
```

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `relation "users" does not exist` | `POSTGRES_NAME` still points at `postgres`. Copy `.env.example` to `.env` (step 2). |
| `AdminShutdown: terminating connection due to administrator command`, from a test fixture | Another `pytest` is using the same test database and dropped it. Check with `ps -eo pid,etime,cmd \| grep '[p]ytest'`, then re-run with your own `POSTGRES_TEST_NAME`. |
| `/api/v1/health` healthy but every other call 500s | Same cause: the connection works, the schema is elsewhere. |
| `password authentication failed for user "postgres"` | Step 1's `ALTER USER` was skipped, or `POSTGRES_PASS` does not match. |
| `database "acme_incidents_dev" does not exist` | Step 1's `createdb` was skipped. |
| Signing in lands on a change-password screen with no way out | Working as designed for a seeded or admin-created account: `must_change_password` is set, and the API answers 403 `PASSWORD_CHANGE_REQUIRED` everywhere outside `/auth` until it is cleared. Complete the form. |
| The app sits on "Restoring your session…" | The first request of a page load is `POST /api/v1/auth/refresh`. Locally that is instant, so a hang means uvicorn is not running or the Vite proxy is not reaching it — check `curl localhost:3000/api/v1/health`. |
| `Failed to resolve import "zod"` or `"react-hook-form"` | M5 added three frontend dependencies. Run `npm install` in `frontend/`. |

## Coding Workshop Example

Coding workshop organizer(s) will provide instructions to follow by email. Here
below is a real example of requirements and expectations for participant(s):

### Requirements: Business Problem

Our company ACME Inc. is going through a massive organizational transformation
to become a more data-driven organization. Information about teams structure
and performance is currently scattered across multiple systems, making it
difficult to get a comprehensive view of team dynamics and achievements.

We are struggling to answer simple questions like:

* Who are the members of each team?
* Where are the teams located?
* What are the key achievements of each team on a monthly basis?
* How many teams have team leader not co-located with team members?
* How many teams have team leader as a non-direct staff?
* How many teams have non-direct staff to employees ratio above 20%?
* How many teams are reporting to an organization leader?

### Requirements: Technical Solution

As part of this transformation, we are looking to build a centralized team
management tool that will allow us to track team members, team locations,
monthly team achievements, as well as individual-level and team-level metadata.
Initial focus is to provide a self-service capability without any integrations
with other tools such as Employee Directory, Project Tracking, or Performance
Management.

The technical solution involves developing a stand-alone web application using
modern technologies. The application will have the following features:

* User authentication and authorization
* Role-based access control
* CRUD operations for individuals, teams, achievements and metadata
* Search and filter functionality
* Responsive design for mobile and desktop usage

### Requirements: Technology Stack

The following technologies are required to build the application:

* Frontend: HTML, CSS, React.js with React Responsive and Material UI Components
* Backend: Python
* Database: PostgreSQL

The following technologies are good to know, as they are used to manage and
deploy code:

* Version Control: Git, GitHub
* Infrastructure: Terraform
* Deployment Mode: Shell Scripts
* Deployment Target: AWS Serverless (e.g. S3, CloudFront, Lambda, RDS)

### Expectations: Value-Based Outcomes

By the end of the workshop, participants will have developed a functional
web application that meets the requirements outlined above. The application
will be deployed to a cloud environment and accessible via a web browser.
Participants will also gain hands-on experience with modern web development
technologies and best practices.

## Contributing

See the [CONTRIBUTING](./CONTRIBUTING.md) resource for more details.

## License

This library is licensed under the MIT-0 License.
See the [LICENSE](./LICENSE) resource for more details.

## Roadmap

See the
[open issues](https://github.com/citi/coding-workshop-participant/issues)
for a list of proposed roadmap features (and known issues).

## Security

See the
[Security Issue Notifications](./CONTRIBUTING.md#security-issue-notifications)
resource for more details.

## Authors

The following people have contributed to this workshop:

* Colin Heilman - [@heilmancs](https://github.com/heilmancs)
* Eugene Istrati - [@eistrati](https://github.com/eistrati)
* Isaiah Cornelius Smith - [@corneliusmith](https://github.com/corneliusmith)
* Juan Arevalo - [@jparevalo27](https://github.com/jparevalo27)
* Michael Annucci - [@michael-annucci](https://github.com/michael-annucci)

## Feedback

We'd love to hear your feedback! Please:

* ⭐ Star the repository if you find it helpful
* 🐛 Report issues on GitHub
* 💡 Suggest improvements
* 📝 Share your experience

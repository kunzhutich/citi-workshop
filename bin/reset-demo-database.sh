#!/usr/bin/env bash
#
# Rebuild the local demo database from scratch.
#
# WHY THIS EXISTS
# ---------------
# Two things accumulate in `acme_demo` and neither is a fault:
#
#   1. The Playwright suite registers accounts and reports tickets through the
#      real API, and deliberately leaves them behind (`e2e/fixtures/test.ts`).
#      A full run adds roughly a dozen tickets, all stamped today. Run the
#      suite ten times while working on a phase and "today" becomes a wall on
#      the admin dashboard's daily chart, and every rate computed over the last
#      thirty days is measuring the test suite rather than the demo world.
#
#   2. The seed itself changes. R6 added three category groups, grew the
#      roster from six engineers to ten and the history from 300 tickets to
#      420. An existing database picks up new *categories* from `migrate`,
#      which is idempotent — but nothing backfills tickets that use them, or
#      invents the four new engineers. The data is only as new as the last
#      time it was built.
#
# `seed_demo` refuses to top up: it returns "Demo data is already present"
# and changes nothing, on purpose, so that a second invoke cannot silently
# double a dataset. Rebuilding is therefore drop, migrate, seed — which is
# what this script does, in that order.
#
# WHAT IT COSTS
# -------------
# **Everything local is destroyed**, including tickets you reported by hand
# while demonstrating. The demo world is regenerated from a fixed random seed
# (`DemoSpec.random_seed`), so the *shape* comes back identically — same
# buildings, same engineers, same category mix — but the dates rebase to the
# day you run it, which is what keeps a demo looking recent.
#
# It touches nothing deployed. Aurora is unreachable from here by design.
#
# USAGE
# -----
#   ./bin/reset-demo-database.sh            # asks first
#   ./bin/reset-demo-database.sh --yes      # for a script
#
set -euo pipefail

DB_NAME="${POSTGRES_NAME:-acme_demo}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
export PGPASSWORD="${POSTGRES_PASS:-postgres123}"

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../backend/v1" && pwd)"
PYTHON="${SERVICE_DIR}/.venv/bin/python"

if [[ ! -x "${PYTHON}" ]]; then
  echo "No virtualenv at ${PYTHON}. See the README's step 2." >&2
  exit 1
fi

echo "This DROPS and rebuilds the local database '${DB_NAME}' on ${DB_HOST}:${DB_PORT}."
echo "Everything in it goes, including anything you reported by hand."
echo

if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Type the database name to confirm: " reply
  if [[ "${reply}" != "${DB_NAME}" ]]; then
    echo "Not confirmed. Nothing was changed."
    exit 1
  fi
fi

# The API holds a connection pool open, and Postgres refuses to drop a
# database with sessions attached. Terminating them is friendlier than telling
# the reader to go and stop their own dev server.
echo "==> Disconnecting anything attached to ${DB_NAME}"
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 -q -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" > /dev/null

echo "==> Dropping and recreating ${DB_NAME}"
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};" \
  -c "CREATE DATABASE ${DB_NAME};"

# `migrate` runs Alembic to head *and* seeds the category tree — a migrated
# but unseeded database cannot render the report questionnaire.
echo "==> Migrating and seeding the category tree"
cd "${SERVICE_DIR}"
POSTGRES_NAME="${DB_NAME}" "${PYTHON}" -c \
  "from function import handler; print(handler({'action': 'migrate'}, None))"

echo "==> Generating the demo world"
POSTGRES_NAME="${DB_NAME}" "${PYTHON}" -c \
  "from function import handler; print(handler({'action': 'seed_demo'}, None))"

echo
echo "Done. Restart the API so it reconnects:"
echo "  cd backend/v1 && .venv/bin/uvicorn app.main:app --port 8000 --reload"

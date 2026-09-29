#!/usr/bin/env bash
# =============================================================================
# setup-schema.sh  ???  create the 16 tables in db_sales_novacore
# =============================================================================
# Run this on the VPS, before migrate-data.sh.
#
# It fetches the generated SQL straight from GitHub and applies it with psql
# inside the target container. There is no need to clone the project, and no
# need for the database password or any network configuration.
#
# Usage:
#   export DB_CONTAINER=kqgwtzqknu9axud1urkau5si
#   ./setup-schema.sh
# =============================================================================

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:?set DB_CONTAINER - the crm-sales-db container name or id}"
DB_NAME="${DB_NAME:-db_sales_novacore}"
REPO="${REPO:-novacore25/crm-sales-novacore}"
BRANCH="${BRANCH:-main}"
SQL_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/drizzle/0000_init.sql"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "=============================================================="
echo " Creating the schema in ${DB_CONTAINER}/${DB_NAME}"
echo "=============================================================="

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running."; exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "ERROR: no running container named '$DB_CONTAINER'."
  echo "       Find it with:  docker ps --format '{{.Names}}' | grep -i postgres"
  exit 1
fi

# Refuse to run twice: CREATE TYPE would fail on a second attempt.
existing=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo 0)

if [ "$existing" != "0" ]; then
  echo "ERROR: ${DB_NAME} already has $existing table(s) in the public schema."
  echo "       This script is only for an empty database. To start over:"
  echo "         docker exec -it $DB_CONTAINER psql -U postgres -d $DB_NAME -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'"
  echo "       That destroys everything in it - only do that if you are certain."
  exit 1
fi

echo "  target is empty, good"

echo "  downloading the schema from GitHub..."
if ! curl -fsSL "$SQL_URL" -o "$WORK/schema.sql"; then
  echo "ERROR: could not download $SQL_URL"
  echo "       Check the repo name, the branch, and that the repo is public or"
  echo "       that this host has credentials for it."
  exit 1
fi

bytes=$(wc -c < "$WORK/schema.sql")
echo "  downloaded ${bytes} bytes"

# A sanity check before applying: the file must declare the enums, or the
# tables that reference them will fail to be created.
if ! grep -q 'CREATE TYPE "public"."lead_status"' "$WORK/schema.sql"; then
  echo "ERROR: the downloaded SQL does not contain the CREATE TYPE statements."
  echo "       Applying it would create tables referencing a type that does not exist."
  exit 1
fi
echo "  enums present, applying..."

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -q -f - < "$WORK/schema.sql"

echo
echo "Created:"
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -tAc \
  "SELECT '  ' || table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"

echo
echo "=============================================================="
echo " Schema is ready. Next: migrate-data.sh"
echo "=============================================================="

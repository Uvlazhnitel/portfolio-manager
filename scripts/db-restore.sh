#!/usr/bin/env bash

set -Eeuo pipefail

readonly EXPECTED_SERVICE="postgres"
readonly EXPECTED_DATABASE="portfolio_manager"
readonly BACKUP_DIR="backups"

usage() {
  cat <<'EOF'
Usage: pnpm db:restore -- <backup-file> --confirm portfolio_manager

Restores the complete application database through Docker Compose. This is a
destructive operation: app services are stopped and the target database is
recreated before the archive is restored.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if (( $# != 3 )) || [[ "${2:-}" != "--confirm" ]]; then
  usage >&2
  exit 64
fi

backup_file="$1"
confirmed_database="$3"

if [[ "$confirmed_database" != "$EXPECTED_DATABASE" ]]; then
  echo "Restore confirmation must exactly match '$EXPECTED_DATABASE'." >&2
  exit 64
fi

if [[ ! -f "$backup_file" || ! -s "$backup_file" ]]; then
  echo "Backup file does not exist or is empty: $backup_file" >&2
  exit 66
fi

backup_file="$(cd "$(dirname "$backup_file")" && pwd)/$(basename "$backup_file")"
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if ! docker compose ps --status running --services | grep -Fxq "$EXPECTED_SERVICE"; then
  echo "Docker Compose service '$EXPECTED_SERVICE' is not running." >&2
  exit 69
fi

database_name="$(docker compose exec -T "$EXPECTED_SERVICE" sh -c 'printf %s "$POSTGRES_DB"')"
database_user="$(docker compose exec -T "$EXPECTED_SERVICE" sh -c 'printf %s "$POSTGRES_USER"')"

if [[ "$database_name" != "$EXPECTED_DATABASE" ]]; then
  echo "Refusing restore: Compose targets '$database_name', expected '$EXPECTED_DATABASE'." >&2
  exit 78
fi

if [[ -z "$database_user" ]]; then
  echo "POSTGRES_USER must be configured in the postgres service." >&2
  exit 78
fi

if ! docker compose exec -T "$EXPECTED_SERVICE" pg_restore --list <"$backup_file" >/dev/null; then
  echo "Backup is not a readable PostgreSQL custom-format archive: $backup_file" >&2
  exit 65
fi

mkdir -p "$BACKUP_DIR"
safety_backup="${BACKUP_DIR}/portfolio_manager_before_restore_$(date -u +%Y%m%d_%H%M%S).dump"
"$project_dir/scripts/db-backup.sh" "$safety_backup"

echo "Validated archive: $backup_file"
echo "Target database: $database_name"
echo "Safety backup: $safety_backup"

docker compose stop app history-worker

# Invoked indirectly by the ERR trap.
# shellcheck disable=SC2329
restore_failed() {
  echo "Restore failed. Application services remain stopped to protect the database." >&2
  echo "Safety backup available at: $safety_backup" >&2
}
trap restore_failed ERR

docker compose exec -T "$EXPECTED_SERVICE" psql \
  --username "$database_user" \
  --dbname postgres \
  --set ON_ERROR_STOP=1 \
  --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$EXPECTED_DATABASE' AND pid <> pg_backend_pid();" >/dev/null

docker compose exec -T "$EXPECTED_SERVICE" dropdb \
  --username "$database_user" \
  --if-exists \
  --force \
  "$database_name"

docker compose exec -T "$EXPECTED_SERVICE" createdb \
  --username "$database_user" \
  "$database_name"

docker compose exec -T "$EXPECTED_SERVICE" pg_restore \
  --username "$database_user" \
  --dbname "$database_name" \
  --exit-on-error \
  --no-owner \
  --no-privileges <"$backup_file"

docker compose up -d app history-worker

for _ in $(seq 1 60); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' portfolio-manager-app 2>/dev/null || true)"
  if [[ "$health" == "healthy" ]]; then
    trap - ERR
    echo "Database '$database_name' restored from $backup_file"
    echo "Application container is healthy."
    exit 0
  fi
  sleep 2
done

echo "Restore completed, but the application did not become healthy within 120 seconds." >&2
exit 70

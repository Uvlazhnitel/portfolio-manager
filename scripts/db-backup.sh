#!/usr/bin/env bash

set -Eeuo pipefail

readonly EXPECTED_SERVICE="postgres"
readonly DEFAULT_BACKUP_DIR="backups"

usage() {
  cat <<'EOF'
Usage: pnpm db:backup -- [output-file]

Creates a complete custom-format PostgreSQL backup through the Docker Compose
postgres service. When output-file is omitted, a UTC timestamped file is
created under backups/.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if (( $# > 1 )); then
  usage >&2
  exit 64
fi

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

output_file="${1:-${DEFAULT_BACKUP_DIR}/portfolio_manager_$(date -u +%Y%m%d_%H%M%S).dump}"

if [[ -e "$output_file" ]]; then
  echo "Refusing to overwrite existing backup: $output_file" >&2
  exit 73
fi

mkdir -p "$(dirname "$output_file")"
partial_file="${output_file}.partial"
rm -f "$partial_file"

cleanup_partial() {
  rm -f "$partial_file"
}
trap cleanup_partial EXIT

if ! docker compose ps --status running --services | grep -Fxq "$EXPECTED_SERVICE"; then
  echo "Docker Compose service '$EXPECTED_SERVICE' is not running." >&2
  exit 69
fi

database_name="$(docker compose exec -T "$EXPECTED_SERVICE" sh -c 'printf %s "$POSTGRES_DB"')"
database_user="$(docker compose exec -T "$EXPECTED_SERVICE" sh -c 'printf %s "$POSTGRES_USER"')"

if [[ -z "$database_name" || -z "$database_user" ]]; then
  echo "POSTGRES_DB and POSTGRES_USER must be configured in the postgres service." >&2
  exit 78
fi

docker compose exec -T "$EXPECTED_SERVICE" pg_dump \
  --username "$database_user" \
  --dbname "$database_name" \
  --format custom \
  --no-owner \
  --no-privileges >"$partial_file"

if [[ ! -s "$partial_file" ]]; then
  echo "Backup command produced an empty file." >&2
  exit 74
fi

mv "$partial_file" "$output_file"
trap - EXIT

echo "Database '$database_name' backed up to $output_file"

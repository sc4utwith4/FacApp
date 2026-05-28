#!/usr/bin/env bash
set -euo pipefail

# Executa a suite da Fase A usando credencial temporaria do projeto Supabase linkado.
# Baseline reprodutivel:
#   sslmode=require&uselibpqcompat=true&options=-c role=postgres
#
# Uso:
#   ./scripts/run-lancamentos-phase-a-linked.sh
#   ./scripts/run-lancamentos-phase-a-linked.sh --assert-no-double

ASSERT_NO_DOUBLE=0
if [[ "${1:-}" == "--assert-no-double" ]]; then
  ASSERT_NO_DOUBLE=1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERRO: supabase CLI nao encontrado no PATH." >&2
  exit 1
fi

TMP_FILE="$(mktemp)"
cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

build_db_url() {
  supabase db dump --linked --schema public --dry-run >"$TMP_FILE"

  DB_HOST="$(sed -n 's/^export PGHOST="\([^"]*\)"/\1/p' "$TMP_FILE" | head -n1)"
  DB_PORT="$(sed -n 's/^export PGPORT="\([^"]*\)"/\1/p' "$TMP_FILE" | head -n1)"
  DB_USER="$(sed -n 's/^export PGUSER="\([^"]*\)"/\1/p' "$TMP_FILE" | head -n1)"
  DB_PASS="$(sed -n 's/^export PGPASSWORD="\([^"]*\)"/\1/p' "$TMP_FILE" | head -n1)"
  DB_NAME="$(sed -n 's/^export PGDATABASE="\([^"]*\)"/\1/p' "$TMP_FILE" | head -n1)"

  if [[ -z "$DB_HOST" || -z "$DB_PORT" || -z "$DB_USER" || -z "$DB_PASS" || -z "$DB_NAME" ]]; then
    echo "ERRO: nao foi possivel extrair credenciais temporarias do Supabase CLI." >&2
    exit 1
  fi

  ENC_PASS="$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$DB_PASS")"
  DB_URL="postgresql://${DB_USER}:${ENC_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require&uselibpqcompat=true&options=-c%20role=postgres"
}

run_suite() {
  if [[ "$ASSERT_NO_DOUBLE" == "1" ]]; then
    LANCAMENTOS_PHASE_A_DB_URL="$DB_URL" \
      LANCAMENTOS_PHASE_A_ASSERT_NO_DOUBLE=1 \
      npm run test:run:lancamentos-phase-a
  else
    LANCAMENTOS_PHASE_A_DB_URL="$DB_URL" \
      npm run test:run:lancamentos-phase-a
  fi
}

build_db_url
echo "Executando Fase A no projeto linkado..."
echo "  user=${DB_USER} host=${DB_HOST} port=${DB_PORT} db=${DB_NAME}"
echo "  tls=sslmode=require&uselibpqcompat=true role=postgres"

if ! run_suite; then
  echo "Primeira execucao falhou; renovando credencial temporaria e tentando novamente..."
  build_db_url
  echo "  retry user=${DB_USER} host=${DB_HOST} port=${DB_PORT} db=${DB_NAME}"
  run_suite
fi

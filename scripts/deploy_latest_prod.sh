#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v git >/dev/null 2>&1; then
  echo "Erro: git nao encontrado no PATH."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "Erro: npx nao encontrado no PATH."
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Erro: branch atual '$CURRENT_BRANCH'. Troque para 'main' para deploy em producao."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Erro: existem alteracoes locais nao commitadas."
  echo "Resolva antes do deploy para evitar publicar codigo inconsistente."
  git status --short
  exit 1
fi

echo "[1/4] Atualizando referencias remotas..."
git fetch origin main --prune

echo "[2/4] Sincronizando main local com origin/main..."
git pull --ff-only origin main

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  echo "Erro: HEAD local ($LOCAL_HEAD) difere de origin/main ($REMOTE_HEAD)."
  exit 1
fi

echo "[3/5] Confirmacao: codigo local esta na versao mais recente."
echo "[4/5] Validando consistencia das rotas DISECURIT..."
node scripts/check-disecurit-route-consistency.cjs

echo "[5/5] Executando deploy em producao (Vercel)..."
npx vercel deploy --prod --yes

echo "Deploy finalizado com sucesso."

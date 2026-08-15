#!/usr/bin/env bash
# ==============================================================================
# Responsabilidade : Controlar quais camadas do laboratorio estao quebradas.
#                    Permite trabalhar uma camada por vez em vez de encarar as
#                    ~70 falhas simultaneamente.
# Consumido por    : voce, no terminal
# Regra            : `fix` copia o arquivo correto de .solutions/ por cima do quebrado.
#                    `break` restaura o arquivo quebrado a partir de .chaos-backup/.
#                    Nenhum comando toca em src/ - o codigo da aplicacao e imutavel.
#
# Uso:
#   ./scripts/chaos.sh status            # o que esta quebrado agora
#   ./scripts/chaos.sh fix docker        # conserta uma camada
#   ./scripts/chaos.sh break docker      # volta a quebrar
#   ./scripts/chaos.sh fix all
#   ./scripts/chaos.sh diff observability
# ==============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOLUCOES="$RAIZ/.solutions"
BACKUP="$RAIZ/.chaos-backup"

# camada -> lista de arquivos (relativos a raiz do repo)
declare -A CAMADAS=(
  [env]=".env"
  [docker]="Dockerfile .dockerignore docker-compose.yml"
  [observability]="infra/observability/prometheus/prometheus.yml infra/observability/prometheus/rules/api-alerts.yml infra/observability/grafana/provisioning/datasources/datasources.yml infra/observability/grafana/provisioning/dashboards/dashboards.yml infra/observability/loki/loki-config.yml infra/observability/tempo/tempo-config.yml infra/observability/alloy/config.alloy"
  [k8s]="infra/k8s/kind-cluster.yaml infra/k8s/base/namespace.yaml infra/k8s/base/secret.yaml infra/k8s/base/configmap.yaml infra/k8s/base/deployment.yaml infra/k8s/base/service.yaml infra/k8s/base/ingress.yaml infra/k8s/base/networkpolicy.yaml infra/k8s/base/statefulset-mongo.yaml infra/k8s/base/hpa.yaml infra/k8s/base/serviceaccount.yaml infra/k8s/base/pdb.yaml infra/k8s/base/kustomization.yaml infra/k8s/overlays/local/kustomization.yaml"
  [ci]=".github/workflows/ci.yml .github/workflows/codeql.yml .github/workflows/cd.yml .github/dependabot.yml"
  [prod]="render.yaml"
)

ORDEM=(env docker observability k8s ci prod)

garantir_backup() {
  mkdir -p "$BACKUP"
  for camada in "${ORDEM[@]}"; do
    for arquivo in ${CAMADAS[$camada]}; do
      local destino="$BACKUP/$arquivo"
      if [[ ! -f "$destino" && -f "$RAIZ/$arquivo" ]]; then
        mkdir -p "$(dirname "$destino")"
        cp "$RAIZ/$arquivo" "$destino"
      fi
    done
  done
}

estado_arquivo() {
  local arquivo="$1"
  if [[ ! -f "$SOLUCOES/$arquivo" ]]; then echo "sem-gabarito"; return; fi
  if [[ ! -f "$RAIZ/$arquivo" ]]; then echo "ausente"; return; fi
  if cmp -s "$RAIZ/$arquivo" "$SOLUCOES/$arquivo"; then echo "corrigido"; else echo "QUEBRADO"; fi
}

comando_status() {
  printf '\n%-14s %-8s %s\n' "CAMADA" "ESTADO" "ARQUIVOS QUEBRADOS"
  printf '%s\n' "--------------------------------------------------------------------------"
  for camada in "${ORDEM[@]}"; do
    local quebrados=0 total=0 lista=""
    for arquivo in ${CAMADAS[$camada]}; do
      total=$((total + 1))
      if [[ "$(estado_arquivo "$arquivo")" != "corrigido" ]]; then
        quebrados=$((quebrados + 1))
        lista+="$(basename "$arquivo") "
      fi
    done
    local estado="OK"
    [[ $quebrados -gt 0 ]] && estado="$quebrados/$total"
    printf '%-14s %-8s %s\n' "$camada" "$estado" "$lista"
  done
  printf '\n'
}

comando_fix() {
  local camada="$1"
  garantir_backup
  for arquivo in ${CAMADAS[$camada]}; do
    if [[ -f "$SOLUCOES/$arquivo" ]]; then
      mkdir -p "$(dirname "$RAIZ/$arquivo")"
      cp "$SOLUCOES/$arquivo" "$RAIZ/$arquivo"
      echo "corrigido: $arquivo"
    else
      echo "sem gabarito (corrija manualmente): $arquivo"
    fi
  done
}

comando_break() {
  local camada="$1"
  for arquivo in ${CAMADAS[$camada]}; do
    if [[ -f "$BACKUP/$arquivo" ]]; then
      cp "$BACKUP/$arquivo" "$RAIZ/$arquivo"
      echo "quebrado novamente: $arquivo"
    else
      echo "sem backup para: $arquivo"
    fi
  done
}

comando_diff() {
  local camada="$1"
  for arquivo in ${CAMADAS[$camada]}; do
    [[ -f "$SOLUCOES/$arquivo" ]] || continue
    echo "=== $arquivo ==="
    diff -u "$RAIZ/$arquivo" "$SOLUCOES/$arquivo" || true
  done
}

acao="${1:-status}"
alvo="${2:-}"

case "$acao" in
  status) garantir_backup; comando_status ;;
  fix|break|diff)
    [[ -n "$alvo" ]] || { echo "informe a camada: ${ORDEM[*]} | all"; exit 1; }
    if [[ "$alvo" == "all" ]]; then
      for camada in "${ORDEM[@]}"; do "comando_$acao" "$camada"; done
    else
      [[ -n "${CAMADAS[$alvo]:-}" ]] || { echo "camada invalida: $alvo"; exit 1; }
      "comando_$acao" "$alvo"
    fi
    ;;
  *) sed -n '2,25p' "${BASH_SOURCE[0]}" ;;
esac

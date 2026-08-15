#!/usr/bin/env bash
# ==============================================================================
# Responsabilidade : Bateria de verificacao do ambiente. Cada check e um criterio
#                    objetivo de "camada consertada" para registrar no runbook.
# Consumido por    : voce, apos cada correcao
# Regra            : Nunca corrige nada. Apenas observa e reporta.
# ==============================================================================
set -uo pipefail

VERDE=$'\033[0;32m'; VERMELHO=$'\033[0;31m'; AMARELO=$'\033[0;33m'; RESET=$'\033[0m'
OK=0; FALHOU=0

checar() {
  local descricao="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  %sPASSOU%s  %s\n' "$VERDE" "$RESET" "$descricao"; OK=$((OK+1))
  else
    printf '  %sFALHOU%s  %s\n' "$VERMELHO" "$RESET" "$descricao"; FALHOU=$((FALHOU+1))
  fi
}

secao() { printf '\n%s== %s ==%s\n' "$AMARELO" "$1" "$RESET"; }

secao "Codigo da aplicacao (deve passar SEMPRE)"
checar "pnpm typecheck" pnpm typecheck
checar "pnpm test" pnpm test
checar "pnpm build" pnpm build

secao "Camada Docker"
checar "docker build" docker build -t chaos-lab-api:verify .
checar "docker compose config valido" docker compose config
checar "container api saudavel" bash -c 'docker inspect --format="{{.State.Health.Status}}" chaos-api 2>/dev/null | grep -q healthy'

secao "Camada aplicacao em execucao"
checar "liveness 200" curl -fsS http://localhost:3000/health/live
checar "readiness 200" curl -fsS http://localhost:3000/health/ready
checar "metrics expostas" bash -c 'curl -fsS http://localhost:3000/metrics | grep -q http_requests_total'
checar "openapi publicado" curl -fsS http://localhost:3000/docs/json

secao "Camada observabilidade"
checar "prometheus config valida" bash -c 'docker compose exec -T prometheus promtool check config /etc/prometheus/prometheus.yml'
checar "target da api em UP" bash -c 'curl -fsS http://localhost:9090/api/v1/targets | grep -q "\"health\":\"up\""'
checar "grafana saudavel" curl -fsS http://localhost:3001/api/health
checar "loki pronto" curl -fsS http://localhost:3100/ready
checar "tempo pronto" curl -fsS http://localhost:3200/ready

secao "Camada Kubernetes"
checar "cluster acessivel" kubectl cluster-info
checar "todos os pods Running" bash -c '! kubectl get pods -n chaos-lab --no-headers 2>/dev/null | grep -vq "Running\|Completed"'
checar "service com endpoints" bash -c 'kubectl get endpoints chaos-lab-api -n chaos-lab -o jsonpath="{.subsets[*].addresses[*].ip}" | grep -q .'
checar "kustomize build" kubectl kustomize infra/k8s/overlays/local

secao "Camada CI/CD (sintaxe)"
checar "workflows YAML validos" bash -c 'for f in .github/workflows/*.yml; do python3 -c "import sys,yaml;yaml.safe_load(open(sys.argv[1]))" "$f" || exit 1; done'
checar "dependabot YAML valido" python3 -c "import yaml;yaml.safe_load(open('.github/dependabot.yml'))"
checar "lockfile versionado" bash -c 'git ls-files --error-unmatch pnpm-lock.yaml'

printf '\n%s%d passaram%s | %s%d falharam%s\n\n' "$VERDE" "$OK" "$RESET" "$VERMELHO" "$FALHOU" "$RESET"
[[ $FALHOU -eq 0 ]]

# Laboratório do caos — API saudável, ambiente hostil

Laboratório de engenharia do caos **invertido**: em vez de injetar falhas em runtime
numa infra saudável, o repositório entrega uma aplicação Node.js correta cercada por
uma infraestrutura com **~70 defeitos catalogados**. O exercício é diagnosticar,
corrigir e documentar cada um.

```
 src/  ──────────────────────────►  imutável, testado, 100% funcional
 tudo o mais  ───────────────────►  quebrado de propósito
```

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22 · TypeScript · pnpm |
| HTTP | Fastify 5 · Zod · OpenAPI/Swagger |
| Segurança | `node:crypto` (scrypt, HMAC, timingSafeEqual) · JWT · Helmet · rate limit |
| Dados | PostgreSQL (driver `pg` nativo, sem ORM) · MongoDB (driver nativo) |
| Observabilidade | Prometheus · OpenTelemetry · Grafana · Loki · Tempo · Alloy |
| Testes | Vitest (unit + integração via `app.inject`) |
| Empacotamento | Docker multi-stage · Docker Compose |
| Orquestração | Kubernetes local (kind) + Kustomize |
| Entrega | GitHub Actions · CodeQL · Dependabot · Render / Supabase / Mongo Atlas |

**Convenção de nomenclatura:** arquivos em inglês (`user.repository.ts`), funções e
domínio em português (`buscarPorEmail`, `calcularSituacaoManutencao`). Todo arquivo
carrega um cabeçalho `Responsabilidade / Consumido por / Regra`.

---

## Domínio

API de manutenção preventiva de ativos industriais.

- **PostgreSQL** — `users`, `assets`, `maintenance_log` (dados relacionais)
- **MongoDB** — `readings` (telemetria, série temporal com TTL de 90 dias)
- Ingestão de leitura aceita **JWT** (operador) ou **assinatura HMAC** (dispositivo de campo)

| Rota | Descrição |
|---|---|
| `GET /health/live` · `/health/ready` · `/health/startup` | Sondas operacionais |
| `GET /metrics` | Exposição Prometheus |
| `GET /docs` · `/docs/json` | Swagger UI e contrato OpenAPI 3.1 |
| `POST /auth/register` · `/auth/login` | Registro e emissão de JWT |
| `GET /users/me` · `GET /users` | Usuário autenticado / listagem (admin) |
| `POST /assets` · `GET /assets` · `GET /assets/:id` · `POST /assets/:id/maintenance` | CRUD de ativos |
| `POST /readings` · `GET /readings/:assetId` · `/summary` | Telemetria |

---

## Começando

```bash
pnpm install

# prova de que o código está íntegro — deve passar 100% mesmo com tudo quebrado
pnpm typecheck && pnpm test && pnpm build

# o que está quebrado agora
./scripts/chaos.sh status
```

Saída esperada no estado inicial:

```
CAMADA         ESTADO   ARQUIVOS QUEBRADOS
env            1/1      .env
docker         3/3      Dockerfile .dockerignore docker-compose.yml
observability  7/7      prometheus.yml api-alerts.yml datasources.yml ...
k8s            14/14    kind-cluster.yaml namespace.yaml secret.yaml ...
ci             4/4      ci.yml codeql.yml cd.yml dependabot.yml
prod           1/1      render.yaml
```

---

### Comandos do `chaos.sh`

```bash
./scripts/chaos.sh status                 # panorama
./scripts/chaos.sh diff observability     # o que difere do gabarito
./scripts/chaos.sh fix docker             # aplica o gabarito de uma camada
./scripts/chaos.sh break docker           # volta a quebrar (backup automático)
./scripts/chaos.sh fix all                # rende tudo (use só para comparar no fim)
```

`fix` é uma **rede de segurança**, não o caminho. Use `diff` depois de tentar por conta
própria — comparar sua solução com o gabarito costuma ser mais instrutivo que copiá-lo.

---

## Estrutura

```
.
├── src/                       # aplicação — ÍNTEGRA, não editar para "resolver"
│   ├── config/env.ts          # validação Zod de ambiente (fail-fast)
│   ├── infra/                 # pool pg + client mongo
│   ├── observability/         # registry Prometheus + SDK OpenTelemetry
│   ├── plugins/               # jwt, swagger
│   ├── shared/                # crypto, errors (RFC 7807), logger
│   └── modules/               # health, auth, users, assets, readings
├── tests/                     # 26 testes — devem passar sempre
├── db/                        # migrations SQL + seed mongo
├── infra/
│   ├── observability/         # QUEBRADO: prometheus, grafana, loki, tempo, alloy
│   └── k8s/                   # QUEBRADO: base + overlay local (kind)
├── .github/                   # QUEBRADO: ci, cd, codeql, dependabot
├── .solutions/                # gabarito — consulte por último
├── docs/
│   ├── CHAOS-CATALOG.md       # ← catálogo completo das ~70 falhas
│   ├── RUNBOOK-TEMPLATE.md    # template de documentação por falha
│   └── runbooks/              # seus registros
├── Dockerfile                 # QUEBRADO
├── docker-compose.yml         # QUEBRADO
├── .env                       # QUEBRADO
└── render.yaml                # QUEBRADO
```

---

## Ferramentas de diagnóstico recomendadas

Instale antes de começar — metade das falhas é detectável estaticamente:

```bash
hadolint Dockerfile                                    # lint de Dockerfile
docker compose config                                  # validação do compose
promtool check config infra/observability/prometheus/prometheus.yml
promtool check rules  infra/observability/prometheus/rules/*.yml
kubeconform -strict -summary infra/k8s/base/*.yaml     # validação de manifestos
kubectl kustomize infra/k8s/overlays/local             # build do overlay
actionlint                                             # lint de GitHub Actions
trivy fs --scanners misconfig .                        # misconfigs em geral
```

Aprender a pegar essas falhas com linter — e depois colocar o linter no CI — é o
objetivo real do laboratório. A seção "Prevenção" do runbook existe para isso.

---

## Critério de conclusão

O laboratório está completo quando:

- [ ] `./scripts/verify.sh` passa em todos os checks
- [ ] `docker compose up` sobe todos os serviços saudáveis sem intervenção manual
- [ ] Prometheus mostra o target da API em `UP` e o dashboard do Grafana renderiza
- [ ] Traces da API aparecem no Tempo, correlacionados com logs no Loki
- [ ] `kubectl get pods -n chaos-lab` mostra tudo `Running` com endpoints populados
- [ ] Os 4 workflows do GitHub Actions passam em verde
- [ ] Existe um runbook em `docs/runbooks/` para cada ID do catálogo que você tocou
- [ ] Você adicionou pelo menos 3 validações preventivas no CI que teriam pego falhas antes

---

## Credenciais do ambiente local (após o seed)

```
admin@chaoslab.dev / ChaosLab@2026
Grafana:    admin / admin
API:        http://localhost:3000/docs
Prometheus: http://localhost:9090
Grafana:    http://localhost:3001
```

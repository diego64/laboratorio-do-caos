# Laboratório do caos — API saudável, ambiente hostil

Laboratório de engenharia do caos **invertido**: em vez de injetar falhas em runtime
numa infra saudável, o repositório entrega uma aplicação Node.js correta cercada por
uma infraestrutura com **92 defeitos catalogados**. O exercício é diagnosticar,
corrigir e documentar cada um.

```
 src/  ──────────────────────────►  imutável, testado, 100% funcional
 tudo o mais  ───────────────────►  quebrado de propósito
```

---

## Progresso

Cinco das seis camadas já foram percorridas. Cada uma tem um documento de
correção que registra o defeito, **por que** ele quebra, e o que a correção
mudou — o produto real do laboratório não é o código consertado, é esse registro.

| Camada | IDs | Situação | Registro |
|---|---|---|---|
| ENV · DOCKER · COMPOSE · BANCOS · OBSERVABILIDADE | 49 | 48 corrigidos ([PR #1](https://github.com/diego64/laboratorio-do-caos/pull/1)) | [`CORRECOES-DOCKER.md`](docs/CORRECOES-DOCKER.md) |
| KUBERNETES | 20 | Corrigida e validada em cluster `kind` ([PR #2](https://github.com/diego64/laboratorio-do-caos/pull/2)) | [`CORRECOES-K8S.md`](docs/CORRECOES-K8S.md) |
| CI/CD | 17 | Corrigida, verificada estaticamente | [`CORRECOES-CI-CD.md`](docs/CORRECOES-CI-CD.md) |
| **PRODUÇÃO** | **6** | **Intacta — `render.yaml`, `PRD-01..06`** | — |

**85 dos 92 IDs resolvidos.** Restam os 6 da camada PRODUÇÃO e o `PG-03`, que
não reproduz (ver seção 13 do `CORRECOES-DOCKER.md`).

Se você clonou o repositório para fazer o exercício, os três documentos acima são
gabarito. A camada PRODUÇÃO é a que ainda está em branco.

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
| Entrega | GitHub Actions · CodeQL · Trivy · Dependabot · Render / Supabase / Mongo Atlas |

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

# bateria de verificação do ambiente (não corrige nada, só observa)
bash scripts/verify.sh
```

Os checks de código passam sempre. Os de Docker, observabilidade e Kubernetes
exigem a stack de pé; os de CI/CD são estáticos e passam sem nada rodando:

```bash
cd docker && docker compose --env-file ../.env up -d    # sobe a stack local
```

---

### Comandos do `chaos.sh`

```bash
bash scripts/chaos.sh status                 # panorama
bash scripts/chaos.sh diff observability     # o que difere do gabarito
bash scripts/chaos.sh fix docker             # aplica o gabarito de uma camada
bash scripts/chaos.sh break docker           # volta a quebrar (backup automático)
```

> **`chaos.sh` depende de `.solutions/`, que não está neste repositório.** Sem o
> diretório de gabarito, `estado_arquivo` devolve `sem-gabarito` para tudo e o
> `status` reporta **todas as camadas quebradas**, independentemente do estado
> real — inclusive as cinco já corrigidas. `fix` e `diff` não têm de onde copiar.
> Use `scripts/verify.sh` para saber o estado real; os documentos em `docs/` são
> o gabarito de fato.

`fix` é uma **rede de segurança**, não o caminho. Use `diff` depois de tentar por conta
própria — comparar sua solução com o gabarito costuma ser mais instrutivo que copiá-lo.

---

## Estrutura

```
.
├── src/                        # aplicação — ÍNTEGRA, não editar para "resolver"
│   ├── config/env.ts           # validação Zod de ambiente (fail-fast)
│   ├── infra/                  # pool pg + client mongo
│   ├── observability/          # registry Prometheus + SDK OpenTelemetry
│   ├── plugins/                # jwt, swagger
│   ├── shared/                 # crypto, errors (RFC 7807), logger
│   └── modules/                # health, auth, users, assets, readings
├── tests/                      # 26 testes — devem passar sempre
├── db/
│   ├── migrations/             # 000_pg_init.sh, 001_init.sql, 002_audit.sql
│   └── seeds/                  # 00-init-mongo.js
├── infra/
│   ├── observability/          # corrigido: prometheus, grafana, loki, tempo, alloy
│   └── k8s/                    # corrigido: base + overlay local (kind)
├── docker/
│   └── docker-compose.yml      # corrigido (movido da raiz)
├── .github/                    # corrigido: ci, cd, codeql, trivy, dependabot
├── scripts/
│   ├── chaos.sh                # controle de camadas — exige .solutions/, ver acima
│   ├── verify.sh               # bateria de verificação do ambiente
│   ├── check-k8s-refs.py       # referências cruzadas dos manifestos k8s
│   ├── check-workflows.py      # forma dos workflows do Actions
│   └── migrate.ts · seed.ts · dump-openapi.ts
├── docs/
│   ├── CATALOGO-DE-FALHAS.md   # ← catálogo completo dos 92 IDs
│   ├── CORRECOES-DOCKER.md     # camadas env, docker, compose, bancos, observabilidade
│   ├── CORRECOES-K8S.md        # camada kubernetes
│   ├── CORRECOES-CI-CD.md      # camada ci/cd
│   └── RUNBOOK-TEMPLATE.md     # template de documentação por falha
├── Dockerfile                  # corrigido — multi-stage, alvos release e migrator
├── .env                        # corrigido
└── render.yaml                 # QUEBRADO — PRD-01..06, a camada que resta
```

---

## Ferramentas de diagnóstico recomendadas

Instale antes de começar — metade das falhas é detectável estaticamente:

```bash
hadolint Dockerfile                                    # lint de Dockerfile
cd docker && docker compose --env-file ../.env config   # validação do compose
# o compose vive em docker/ e o .env na raiz: o --env-file é obrigatório
promtool check config infra/observability/prometheus/prometheus.yml
promtool check rules  infra/observability/prometheus/rules/*.yml
kubeconform -strict -summary infra/k8s/base/*.yaml     # validação de manifestos
kubectl kustomize infra/k8s/overlays/local             # build do overlay
actionlint                                             # lint de GitHub Actions
trivy fs --scanners misconfig .                        # misconfigs em geral
```

Dois verificadores nasceram deste laboratório e ficaram no repositório, porque
nenhuma ferramenta genérica pegava a classe de defeito que eles pegam:

```bash
python3 scripts/check-k8s-refs.py infra/k8s/base    # referência que aponta para recurso inexistente
python3 scripts/check-workflows.py                  # workflow que parseia mas não tem jobs
```

O segundo é a lição mais transferível da camada CI/CD: em formato onde a
indentação carrega semântica, `yaml.safe_load` retornar sem exceção não diz
nada sobre o arquivo estar correto — só assertar a **forma esperada** diz.

Aprender a pegar essas falhas com linter — e depois colocar o linter no CI — é o
objetivo real do laboratório. A seção "Prevenção" do runbook existe para isso.

---

## Critério de conclusão

O laboratório está completo quando:

- [x] `docker compose up` sobe todos os serviços saudáveis sem intervenção manual
- [x] Prometheus mostra o target da API em `UP` e o dashboard do Grafana renderiza
- [x] Traces da API aparecem no Tempo, correlacionados com logs no Loki
- [x] `kubectl get pods -n chaos-lab` mostra tudo `Running` com endpoints populados
- [x] Existe registro documentado para cada ID do catálogo que foi tocado — os
      três `CORRECOES-*.md` em `docs/` substituíram o formato de runbook por falha
- [x] Pelo menos 3 validações preventivas foram adicionadas — `check-k8s-refs.py`,
      `check-workflows.py` e o scan de IaC em `.github/workflows/trivy.yaml`
- [ ] Os 4 workflows do GitHub Actions passam em verde — corrigidos, mas só o
      `push` prova (ver seção 16 de `CORRECOES-CI-CD.md`)
- [ ] `bash scripts/verify.sh` passa em todos os checks
- [ ] Camada PRODUÇÃO (`PRD-01..06`) diagnosticada e corrigida em `render.yaml`

---

## Credenciais do ambiente local (após o seed)

```
admin@chaoslab.dev / ChaosLab@2026
Grafana:    admin / admin
API:        http://localhost:3000/docs
Prometheus: http://localhost:9090
Grafana:    http://localhost:3001
```

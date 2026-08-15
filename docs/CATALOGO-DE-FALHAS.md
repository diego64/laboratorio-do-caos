# Catálogo de Falhas — Chaos Lab

Cada falha tem um ID estável. Use o ID no título do commit e no runbook:
`fix(chaos): CMP-05 database inexistente no boot do postgres`.

**Regra do laboratório:** nada em `src/` está quebrado. Se você se pegar editando
código de aplicação para "resolver", parou de fazer engenharia de infraestrutura e
começou a mascarar o defeito. A única exceção legítima é `.env`, que é configuração.

Legenda de dificuldade: 🟢 direta · 🟡 exige diagnóstico · 🔴 falha silenciosa ou em cascata

---

## Camada ENV — `.env`

| ID | Falha semeada | Sintoma observável | Dif. |
|---|---|---|---|
| ENV-01 | `JWT_SECRET` com 10 caracteres | Processo morre no boot: `Variaveis de ambiente invalidas: - JWT_SECRET: ...` | 🟢 |
| ENV-02 | `POSTGRES_URL` aponta para `localhost` | `ECONNREFUSED 127.0.0.1:5432` dentro do container | 🟡 |
| ENV-03 | `MONGO_URL` sem `?authSource=admin` | `MongoServerError: Authentication failed` | 🟡 |
| ENV-04 | `OTEL_EXPORTER_OTLP_ENDPOINT` na porta 4317 (gRPC) com exporter HTTP | Nenhum trace no Tempo; nenhum erro fatal | 🔴 |
| ENV-05 | `METRICS_PATH=/prometheus` | `/metrics` responde 404; scrape do Prometheus fica DOWN | 🟡 |
| ENV-06 | `WEBHOOK_HMAC_SECRET` ausente | Boot falha na validação Zod | 🟢 |
| ENV-07 | `POSTGRES_POOL_MAX=40` contra `max_connections=10` | `FATAL: sorry, too many clients already` sob carga | 🔴 |

**Reproduzir:** `pnpm dev` — a validação Zod falha antes de qualquer conexão.

---

## Camada DOCKER — `Dockerfile`, `.dockerignore`

| ID | Falha semeada | Sintoma observável | Dif. |
|---|---|---|---|
| DKR-01 | `FROM node:18-alpine` vs `engines: node >=22` | `EBADENGINE` / APIs indisponíveis | 🟢 |
| DKR-02 | `COPY . .` antes do install | Cache invalidado a cada build; build lento | 🟡 |
| DKR-03 | `corepack enable` ausente | `pnpm: not found` (se corrigir DKR-04 primeiro) | 🟢 |
| DKR-04 | `npm install` em projeto pnpm | Árvore de deps divergente; sem lockfile determinístico | 🟡 |
| DKR-05 | Sem estágio de build | `Cannot find module '/app/dist/server.js'` | 🟢 |
| DKR-06 | `HEALTHCHECK` com `curl` (ausente no alpine) e porta 8080 | Container fica `unhealthy` permanentemente | 🟡 |
| DKR-07 | `EXPOSE 8080` divergente de `PORT=3000` | Porta publicada não responde | 🟡 |
| DKR-08 | Roda como root, `npm start` como PID 1 | SIGTERM não propaga; `docker stop` leva 10s e mata à força | 🔴 |
| DKR-09 | `.dockerignore` quase vazio | `node_modules` do host e `.env` entram na imagem; contexto de MBs | 🔴 |

**Reproduzir:** `docker build -t chaos-lab-api:local .`

---

## Camada COMPOSE — `docker-compose.yml`

| ID | Falha semeada | Sintoma observável | Dif. |
|---|---|---|---|
| CMP-01 | Chave `version:` obsoleta | Warning que mascara erros reais na saída | 🟢 |
| CMP-02 | `depends_on` sem `condition: service_healthy` | API sobe antes do banco; primeiro request falha | 🟡 |
| CMP-03 | Postgres sem `healthcheck` | Impossível usar `service_healthy` (dependência de CMP-02) | 🟡 |
| CMP-04 | `POSTGRES_PASSWORD=chaos` vs `chaos123` na URL | `28P01 password authentication failed` | 🟢 |
| CMP-05 | `POSTGRES_DB=chaos` vs URL apontando `/chaoslab` | `3D000 database "chaoslab" does not exist` | 🟡 |
| CMP-06 | Mount em `/docker-entrypoint-init.d` (typo) | Migrations nunca executam; `relation "users" does not exist` | 🔴 |
| CMP-07 | Bind mount `./:/app` sem volume anônimo em `node_modules` | Binários do host sobrescrevem os da imagem; `Exec format error` | 🔴 |
| CMP-08 | API e Grafana disputando a porta 3000 | `port is already allocated` | 🟢 |
| CMP-09 | Mongo com `--replSet rs0` sem `rs.initiate()` | `MongoServerSelectionError: Server selection timed out` | 🔴 |
| CMP-10 | `api` na rede `frontend`, bancos na `backend` | `getaddrinfo ENOTFOUND postgres` | 🟡 |
| CMP-11 | Prometheus sem volume de config | Sobe com config default; nenhum target da aplicação | 🟡 |
| CMP-12 | Sem `restart`, sem limite de memória, sem `stop_grace_period` | Container morto não volta; OOM do host | 🔴 |
| CMP-13 | `GF_SECURITY_ADMIN_PASSWORD__FILE` apontando para secret inexistente | Grafana não inicia | 🟢 |

**Reproduzir:** `docker compose config` e depois `docker compose up`

---

## Camada BANCOS — `db/`

| ID | Falha semeada | Sintoma observável | Dif. |
|---|---|---|---|
| PG-01 | `000_pg_init.sh` cria extensão no database errado | `function gen_random_uuid() does not exist` | 🟡 |
| PG-02 | `max_connections=10` no comando do postgres | Esgotamento de pool sob concorrência | 🔴 |
| PG-03 | Ordem lexicográfica dos arquivos de init | `002_audit.sql` referencia FK antes de `001_init.sql` conforme o mount | 🟡 |
| MGO-01 | Root user `root/root` no compose vs `chaos/chaos` na URL | `Authentication failed` | 🟢 |
| MGO-02 | Replica set declarado e nunca iniciado | Timeout de seleção de servidor | 🔴 |
| MGO-03 | Seed montado em path errado | Usuário de aplicação nunca criado | 🟡 |
| MGO-04 | Usuário criado em `chaoslab`, autenticação buscando em `admin` | `Authentication failed` mesmo com usuário existindo | 🔴 |

---

## Camada OBSERVABILIDADE — `infra/observability/`

| ID | Falha semeada | Sintoma observável | Dif. |
|---|---|---|---|
| OBS-01 | Target `localhost:3000` no Prometheus | Target DOWN — `connection refused` | 🟡 |
| OBS-02 | `metrics_path` divergente do `METRICS_PATH` da app | Target DOWN com 404 | 🟡 |
| OBS-03 | `rate(...)` sem seletor de intervalo | Prometheus recusa carregar o arquivo de regras inteiro | 🟢 |
| OBS-04 | `rule_files` referenciado mas diretório não montado | Nenhum alerta existe; nenhum erro visível | 🔴 |
| OBS-05 | Datasource `uid: prometheus` vs painéis usando `PROM-DS` | Painéis com "Datasource not found" | 🟡 |
| OBS-06 | Provisioning montado em `/etc/grafana/provisioning/datasource` | Nenhum datasource aparece no Grafana | 🔴 |
| OBS-07 | Painel com `"datasource": "Prometheus"` (formato legado string) | Painel não renderiza no Grafana 11 | 🟡 |
| OBS-08 | Loki com `boltdb-shipper` + schema `v11` | Container encerra no boot com erro de config | 🟢 |
| OBS-09 | Tempo sem receiver OTLP/HTTP e sem porta 4318 | Nenhum trace chega; app não reclama | 🔴 |
| OBS-10 | Alloy referencia `loki.write.default` mas declara `loki.write "loki"` | Alloy falha ao carregar a config | 🟢 |
| OBS-11 | Alerta e painel usando `http_request_duration_ms_bucket` | Consulta vazia; alerta nunca dispara | 🔴 |
| OBS-12 | URL do Loki com `/loki` no final | Datasource com "Unable to connect" | 🟡 |
| OBS-13 | Provider de dashboards apontando para `/etc/grafana/dashboards` | Pasta "Chaos Lab" vazia | 🟡 |

**Reproduzir:**
`docker compose exec prometheus promtool check config /etc/prometheus/prometheus.yml`
`curl -s localhost:9090/api/v1/targets | jq '.data.activeTargets[].health'`

---

## Camada KUBERNETES — `infra/k8s/`

| ID | Falha semeada | Sintoma observável | Dif. |
|---|---|---|---|
| K8S-01 | `kind-cluster.yaml` sem `extraPortMappings` | Ingress inacessível a partir do host | 🟡 |
| K8S-02 | Imagem local com `imagePullPolicy: Always` | `ImagePullBackOff` | 🟢 |
| K8S-03 | Deployment busca `postgres-url`, Secret define `db-url` | `CreateContainerConfigError` | 🟢 |
| K8S-04 | Service `selector: app: chaos-api` vs label do Pod | Endpoints vazio; 503 no Ingress | 🟡 |
| K8S-05 | Liveness em `/healthz` com `failureThreshold: 1` | `CrashLoopBackOff` por reinício em loop | 🟡 |
| K8S-06 | `requests.memory: 8Gi` | Pod `Pending` — `Insufficient memory` | 🟢 |
| K8S-07 | `readOnlyRootFilesystem: true` sem `emptyDir` em `/tmp` | Erro de escrita em runtime | 🔴 |
| K8S-08 | `runAsUser: 0` com PSA `restricted` no namespace | Pod rejeitado na admissão | 🟡 |
| K8S-09 | `storageClassName: fast-ssd` (inexistente no kind) | PVC `Pending` para sempre | 🟡 |
| K8S-10 | NetworkPolicy default-deny sem egress para kube-dns | `EAI_AGAIN` em toda resolução de nome | 🔴 |
| K8S-11 | HPA de resource metrics sem metrics-server | `unable to get metrics`; HPA inoperante | 🟡 |
| K8S-12 | Ingress sem `ingressClassName` | 404 do default backend | 🟡 |
| K8S-13 | ConfigMap com `METRIC_PATH` e `OTEL_ENDPOINT` | App usa defaults silenciosamente | 🔴 |
| K8S-14 | initContainer com `node:22-slim` chamando `pnpm db:migrate` | `executable file not found` | 🟢 |
| K8S-15 | StatefulSet sem o headless service declarado | DNS de pod estável não resolve | 🟡 |
| K8S-16 | `kustomization.yaml` listando arquivos inexistentes | `kubectl apply -k` falha | 🟢 |
| K8S-17 | `nodeSelector: workload=backend` sem node com a label | Pod `Pending` — `didn't match node selector` | 🟡 |
| K8S-18 | `jwt-secret` com 10 caracteres no Secret | `CrashLoopBackOff` com erro de validação Zod | 🟡 |
| K8S-19 | `targetPort: 8080` vs `containerPort: 3000` | Connection refused via Service | 🟡 |
| K8S-20 | Overlay com patch em `chaos-api` (nome inexistente) | `no matches for Id ...` no kustomize | 🟢 |

**Reproduzir:**
```bash
kind create cluster --config infra/k8s/kind-cluster.yaml
kubectl apply -k infra/k8s/overlays/local
kubectl get pods -n chaos-lab -w
kubectl describe pod -n chaos-lab -l app.kubernetes.io/name=chaos-lab-api
```

---

## Camada CI/CD — `.github/`

| ID | Falha semeada | Sintoma observável | Dif. |
|---|---|---|---|
| CI-01 | `actions/checkout@v2` | Warning de deprecação; falha futura | 🟢 |
| CI-02 | `node-version: 18` contra `engines >=22` | `EBADENGINE` no install | 🟢 |
| CI-03 | Sem `pnpm/action-setup` | `pnpm: command not found` | 🟢 |
| CI-04 | `cache: pnpm` antes do pnpm existir | `Some specified paths were not resolved` | 🟡 |
| CI-05 | `pnpm-lock.yaml` no `.gitignore` | `--frozen-lockfile` falha: lockfile ausente | 🔴 |
| CI-06 | `working-directory: ./app` | `No such file or directory` | 🟢 |
| CI-07 | CodeQL sem `permissions: security-events: write` | Upload do SARIF negado (403) | 🟡 |
| CI-08 | `languages: typescript` | Linguagem não suportada; correto é `javascript-typescript` | 🟢 |
| CI-09 | Dependabot com `package-ecosystem: "pnpm"` | Arquivo inválido; Dependabot não roda | 🟢 |
| CI-10 | Dependabot com `directory: "/app"` | Nenhum manifesto encontrado | 🟢 |
| CI-11 | CD usando `secrets.RENDER_API_KEY` inexistente | Header vazio; deploy silenciosamente ignorado | 🔴 |
| CI-12 | `needs: [lint]` sem job `lint` | Workflow inválido | 🟢 |
| CI-14 | Trivy com `exit-code: 1` e severidade `UNKNOWN,LOW,...` | CI vermelho permanente | 🟡 |
| CI-15 | `runs-on: ubuntu-latest-16core` | Job fica em fila para sempre | 🟡 |
| CI-16 | CodeQL com `paths-ignore: src/**` | Análise passa sem analisar nada | 🔴 |
| CI-17 | `environment: production-approved` inexistente | Job bloqueado | 🟡 |
| CI-18 | Dependabot com `schedule` sem `interval` | Schema inválido | 🟢 |

**Reproduzir localmente:** `actionlint` ou
`python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"`

---

## Camada PRODUÇÃO — `render.yaml`

| ID | Falha semeada | Sintoma observável | Dif. |
|---|---|---|---|
| PRD-01 | `healthCheckPath: /health` | Render marca o serviço como unhealthy e recicla | 🟡 |
| PRD-02 | `buildCommand: npm install` sem `pnpm build` | `Cannot find module dist/server.js` | 🟢 |
| PRD-03 | Supabase na porta 5432 (conexão direta) | Esgotamento de conexões; `remaining connection slots` | 🔴 |
| PRD-04 | Atlas SRV com `authSource=chaoslab` | `Authentication failed` mesmo com credencial correta | 🔴 |
| PRD-05 | `HOST=127.0.0.1` | Render não roteia tráfego; deploy "sobe" e não responde | 🔴 |
| PRD-06 | Smoke test usando `$API_TOKEN` inexistente | `curl` autentica com header vazio → falso negativo | 🟡 |

---

## Ordem de ataque recomendada

Corrigir tudo de uma vez produz uma cascata de erros sem sinal claro. A ordem abaixo
respeita as dependências entre as camadas:

1. **ENV** — sem isso o processo nem inicia. `./scripts/chaos.sh fix env`
2. **DOCKER** — build da imagem antes de orquestrar.
3. **COMPOSE + BANCOS** — dependências reais e migrations aplicadas.
4. **OBSERVABILIDADE** — só faz sentido com a aplicação de pé emitindo sinal.
5. **KUBERNETES** — a imagem precisa existir e ser carregada no kind.
6. **CI/CD** — o pipeline reproduz o que já funciona localmente.
7. **PRODUÇÃO** — por último, com o contrato de health já validado.

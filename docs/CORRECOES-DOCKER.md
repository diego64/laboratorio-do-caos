# Correções da Camada Docker e Observabilidade

Registro completo do trabalho de recuperação do ambiente containerizado do
**Laboratório do Caos**, da primeira versão (commit `f5eb66f`, com todas as falhas
semeadas ativas) até a versão funcional atual, com a stack inteira de pé e a
observabilidade emitindo sinal real.

Branch: `fix/docker`
Base: `f5eb66f — chore: initial commit do Laboratorio do Caos`

> **Estado: correções aplicadas e validadas com a stack em execução.**
> Este foi o primeiro dos três documentos de correção. As camadas que ele
> declarava fora de escopo já foram tratadas desde então:
> [`CORRECOES-K8S.md`](./CORRECOES-K8S.md) cobre `K8S-01..20` e
> [`CORRECOES-CI-CD.md`](./CORRECOES-CI-CD.md) cobre a camada CI/CD. Só a camada
> PRODUÇÃO (`PRD-01..06`, em `render.yaml`) segue intacta.

---

## 1. Escopo e como ler este documento

O laboratório tem falhas semeadas de propósito, cada uma com um ID estável
documentado em [`CATALOGO-DE-FALHAS.md`](./CATALOGO-DE-FALHAS.md). Este documento
percorre as camadas **DOCKER**, **COMPOSE**, **BANCOS**, **ENV** e
**OBSERVABILIDADE** — as que compõem o ambiente local de containers.

Cada correção abaixo referencia o ID do catálogo. Quando a mudança não corresponde
a nenhuma falha semeada (melhoria adicional), está marcada como **[extra]**.

**Fora de escopo deste documento:** camadas KUBERNETES (`K8S-01..20`), CI/CD
(`CI-01..CI-18`, 17 IDs — não há `CI-13`) e PRODUÇÃO (`PRD-01..06`). Estavam
todas intactas quando este documento foi escrito; as duas primeiras foram
corrigidas depois, em [`CORRECOES-K8S.md`](./CORRECOES-K8S.md) e
[`CORRECOES-CI-CD.md`](./CORRECOES-CI-CD.md).

**Regra respeitada:** nada em `src/` foi alterado. A única mudança em código de
aplicação foi em `package.json` (scripts), que é configuração de tooling, não
lógica de negócio.

---

## 2. Resumo executivo

| Camada | Arquivos tocados | IDs resolvidos | Situação |
|---|---|---|---|
| DOCKER | `Dockerfile`, `.dockerignore` | DKR-01 … DKR-09 (9) | Completa |
| COMPOSE | `docker/docker-compose.yml` | CMP-01 … CMP-13 (13) | Completa |
| BANCOS | `db/migrations/000_pg_init.sh`, `db/seeds/00-init-mongo.js` | PG-01, PG-02, MGO-01 … MGO-04 (6) | Completa |
| ENV | `.env.example`, `.env`, `package.json` | ENV-01 … ENV-07 (7) | Completa |
| OBSERVABILIDADE | `prometheus.yml`, `api-alerts.yml`, `loki-config.yml`, `tempo-config.yml`, `config.alloy`, `datasources.yml`, dashboards | OBS-01 … OBS-13 (13) | Completa |

**Total: 48 falhas semeadas corrigidas.** Os 49 IDs destas cinco camadas estão
todos contabilizados: `PG-03` é o único não corrigido, porque não reproduz — ver
seção 13.

Além disso, foram adicionados dois exporters de banco, a separação do dashboard
único em quatro dashboards temáticos e a correlação métrica ↔ trace ↔ log entre
os datasources (seção 9).

---

## 3. Estado inicial

O `docker compose up` original não chegava a subir. Os bloqueios em cascata eram:

1. A imagem não construía de forma útil — `npm install` em projeto pnpm, sem
   estágio de build, sem `dist/`.
2. O compose declarava `version:` obsoleto, duas redes isolando a API dos bancos,
   bind mount da árvore inteira do host sobre `/app`, e Grafana apontando para um
   secret inexistente.
3. Postgres e Mongo montavam os scripts de inicialização em
   `/docker-entrypoint-init.d` (faltando o `db`) — nunca executavam.
4. Mongo subia com `--replSet rs0` e ninguém chamava `rs.initiate()`.
5. Prometheus subia sem volume de configuração, raspando apenas a si mesmo.
6. Loki 3.x com `boltdb-shipper` e schema `v11` (removidos na versão 3) encerrava
   no boot; Tempo tinha bloco `ingester` de topo, também removido.
7. Alloy referenciava `loki.write.default` mas declarava `loki.write "loki"`.
8. O dashboard consultava métricas que a aplicação nunca exportou.

---

## 4. Fase 1 — Imagem da aplicação (`Dockerfile`, `.dockerignore`)

### 4.1 Antes

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm install
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1
EXPOSE 8080
CMD ["npm", "start"]
```

Oito linhas com nove defeitos.

### 4.2 Depois

```dockerfile
FROM node:22-alpine3.20 AS base
RUN apk add --no-cache dumb-init wget && corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS release
ENV NODE_ENV=production PORT=3000
WORKDIR /app

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live >/dev/null 2>&1 || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
```

### 4.3 Correção por ID

| ID | Defeito | Correção | Consequência prática |
|---|---|---|---|
| DKR-01 | `node:18-alpine` contra `engines: node >=22` | `node:22-alpine3.20` | `--env-file` nativo e APIs do Node 22 passam a existir |
| DKR-02 | `COPY . .` antes do install | Estágio `deps` copia só `package.json` + `pnpm-lock.yaml` | Camada de dependências só invalida quando o lockfile muda |
| DKR-03 | `corepack enable` ausente | Adicionado no estágio `base` | `pnpm` passa a existir na imagem |
| DKR-04 | `npm install` em projeto pnpm | `pnpm install --frozen-lockfile` | Árvore determinística, idêntica ao lockfile versionado |
| DKR-05 | Sem estágio de build | Estágio `build` roda `pnpm build`; `release` copia `dist/` | Resolve `Cannot find module '/app/dist/server.js'` |
| DKR-06 | `HEALTHCHECK` com `curl` (inexistente no alpine) na porta 8080 | `wget` (instalado no `base`) contra `/health/live` na 3000 | Container sai de `unhealthy` permanente |
| DKR-07 | `EXPOSE 8080` divergente de `PORT=3000` | `EXPOSE 3000` + `ENV PORT=3000` | Porta publicada passa a responder |
| DKR-08 | Root, `npm start` como PID 1 | `USER node`, `ENTRYPOINT ["dumb-init","--"]`, `CMD ["node", …]` | SIGTERM propaga; `docker stop` encerra limpo, sem os 10s de timeout |
| DKR-09 | `.dockerignore` praticamente vazio | 17 entradas | `.env`, `node_modules`, `dist`, chaves e SBOM fora do contexto de build |

`.dockerignore` final:

```
.git
.gitignore
.gitattributes
.github

.env
.env.*
!.env.example
*.pem
*.key
security/sbom

node_modules
dist
coverage
.stryker-tmp
reports
```

A negação `!.env.example` é intencional: o arquivo de exemplo não tem segredo e
serve de referência dentro do contexto.

### 4.4 Validação da imagem

O build do alvo `release` foi validado isoladamente antes de qualquer `compose up`,
por smoke test:

- Imagem final: **69 MB**.
- Primeira execução falhou por `WEBHOOK_HMAC_SECRET` inválido — validação Zod em
  `src/config/env.ts` derrubando o processo no boot, comportamento correto.
- Segunda falha: `pino-pretty` ausente na imagem de produção. O logger só carrega
  o transport quando `NODE_ENV=development`; como o `.env` trazia `development` e a
  imagem `release` instala só `dependencies`, o transport não existia e o boot morria.
  Tratado no compose (seção 5.3, linha `NODE_ENV: production`), não no Dockerfile —
  a imagem estava certa.
- Com `NODE_ENV=production`, container sobe e fica `healthy`.

---

## 5. Fase 2 — Orquestração (`docker/docker-compose.yml`)

### 5.1 Reorganização de diretório **[extra]**

O `docker-compose.yml` saiu da raiz para `docker/docker-compose.yml`. A raiz do
projeto tinha arquivos de sete ferramentas diferentes; isolar o Docker em uma pasta
deixa a raiz legível.

Consequências que precisaram de ajuste:

- `build.context` passou a ser `..` (a raiz continua sendo o contexto de build).
- Todos os volumes passaram a ser relativos a `docker/` (`../infra/...`, `../db/...`).
- O `.env` continua na raiz, então **todo comando exige `--env-file ../.env`**:

```bash
cd docker && docker compose --env-file ../.env up -d
```

O `README.md` foi atualizado com essa nota, porque é um erro fácil de cometer e o
sintoma (variáveis vazias) não aponta para a causa.

### 5.2 Correção por ID

| ID | Defeito | Correção |
|---|---|---|
| CMP-01 | `version: "3"` obsoleto | Removido; substituído por `name: laboratorio-do-caos` |
| CMP-02 | `depends_on` sem condição | `depends_on: {postgres: {condition: service_healthy}, mongo: {condition: service_healthy}}` |
| CMP-03 | Postgres sem healthcheck | `pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB`, com `start_period` |
| CMP-04 | Senha divergente entre serviço e URL | URL montada a partir das mesmas variáveis do serviço (5.3) |
| CMP-05 | `POSTGRES_DB` divergente do database na URL | Idem — impossível divergir por construção |
| CMP-06 | Mount em `/docker-entrypoint-init.d` | `/docker-entrypoint-initdb.d` nos dois bancos |
| CMP-07 | Bind mount `./:/app` | Removido. A imagem carrega o próprio `dist/` e `node_modules` |
| CMP-08 | API e Grafana disputando a 3000 | API publica `3001:3000`; Grafana fica em `127.0.0.1:3000:3000` |
| CMP-09 | `--replSet rs0` sem `rs.initiate()` | Removido o replica set: `mongod --bind_ip_all` |
| CMP-10 | API na rede `frontend`, bancos na `backend` | Rede única `chaos` |
| CMP-11 | Prometheus sem volume de config | `prometheus.yml` e `rules/` montados; flags explícitas no `command` |
| CMP-12 | Sem `restart`, sem limite de memória, sem `stop_grace_period` | `restart: unless-stopped` em todos; `stop_grace_period: 20s` e limite de 512M na API |
| CMP-13 | `GF_SECURITY_ADMIN_PASSWORD__FILE` para secret inexistente | `GF_SECURITY_ADMIN_PASSWORD: ${GF_SECURITY_ADMIN_PASSWORD:?...}` — falha explícita e imediata se a variável não existir |

### 5.3 URLs montadas a partir de partes

CMP-04 e CMP-05 são o mesmo defeito de fundo: credencial escrita duas vezes,
divergindo na segunda. A correção elimina a duplicação em vez de sincronizar valores.

```yaml
api:
  environment:
    NODE_ENV: production
    POSTGRES_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    MONGO_URL: mongodb://${MONGO_APP_USERNAME}:${MONGO_APP_PASSWORD}@mongo:27017/${MONGO_INITDB_DATABASE}?authSource=${MONGO_INITDB_DATABASE}
```

Três decisões embutidas:

1. **`NODE_ENV: production` no compose** sobrepõe o `.env`. A imagem `release` não
   tem `pino-pretty`; sem isso o boot morre (seção 4.4).
2. **Hostnames de serviço** (`postgres`, `mongo`) só resolvem dentro da rede do
   compose. O `.env` guarda as URLs com `localhost` para o tooling do host
   (`pnpm db:seed`, `pnpm db:migrate`); o compose sobrescreve com o hostname interno.
   Os dois contextos coexistem sem conflito.
3. **`authSource` explícito** — ver MGO-04 na seção 6.2.

### 5.4 Endurecimento dos serviços de observabilidade **[extra]**

Grafana, Loki, Tempo e Alloy receberam:

```yaml
security_opt: ["no-new-privileges:true"]
cap_drop: [ALL]
```

E as portas passaram a publicar em loopback (`127.0.0.1:3100:3100`) em vez de
`0.0.0.0`. São serviços de laboratório sem autenticação — não devem ficar expostos
na rede local.

### 5.5 Atualização das imagens

| Serviço | Antes | Depois |
|---|---|---|
| postgres | `postgres:16-alpine` | `postgres:18.4-alpine3.24` |
| mongo | `mongo:7` | `mongo:8` |
| prometheus | `prom/prometheus:v2.53.0` | `prom/prometheus:v3.13.2` |
| grafana | `grafana/grafana-oss:11.1.0` | `grafana/grafana:13.1.3` |
| loki | `grafana/loki:3.1.0` | `grafana/loki:3.7.6` |
| tempo | `grafana/tempo:2.5.0` | `grafana/tempo:3.0.3` |
| alloy | `grafana/alloy:v1.3.0` | `grafana/alloy:v1.18.1` |

A atualização do Postgres trouxe uma armadilha própria: **o Postgres 18 guarda os
dados em subpasta de `/var/lib/postgresql`**, e montar o volume em
`/var/lib/postgresql/data` passa a ser recusado. O volume foi remontado em
`/var/lib/postgresql`.

---

## 6. Fase 3 — Inicialização dos bancos

### 6.1 PostgreSQL — `db/migrations/000_pg_init.sh`

Antes:

```bash
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-SQL
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

A extensão nascia no database `postgres`, não no da aplicação. Sintoma:
`function gen_random_uuid() does not exist` na primeira migration que usasse UUID.

Depois:

```bash
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

**Nota de rastreabilidade:** o comentário dentro do arquivo rotulava esta falha
como `PG-03`, mas pela descrição do catálogo ela é `PG-01` (extensão no database
errado); `PG-03` é a falha de ordem lexicográfica dos arquivos de init. A
divergência é do rótulo, não da correção.

`PG-02` (`max_connections=10`) foi corrigido no compose: `max_connections=100`,
compatível com `POSTGRES_POOL_MAX=10` da aplicação com folga para o exporter e
sessões administrativas.

### 6.2 MongoDB — `db/seeds/00-init-mongo.js`

Antes:

```javascript
db = db.getSiblingDB('chaoslab');
db.createUser({
  user: 'chaos',
  pwd: 'chaos',
  roles: [{ role: 'readWrite', db: 'chaoslab' }],
});
```

Três problemas: credencial fixa no código versionado (`MGO-01`), duplicação da
credencial que já existia no compose, e o usuário vivendo em `chaoslab` enquanto a
aplicação autenticava contra `admin` (`MGO-04`).

Depois:

```javascript
const banco = process.env.MONGO_INITDB_DATABASE;
const usuario = process.env.MONGO_APP_USERNAME;
const senha = process.env.MONGO_APP_PASSWORD;

if (!banco || !usuario || !senha) {
  throw new Error('MONGO_INITDB_DATABASE, MONGO_APP_USERNAME e MONGO_APP_PASSWORD sao obrigatorias');
}

db = db.getSiblingDB(banco);

db.createUser({
  user: usuario,
  pwd: senha,
  roles: [{ role: 'readWrite', db: banco }],
});

db.createCollection('readings');
```

O compose injeta `MONGO_APP_USERNAME` e `MONGO_APP_PASSWORD` no serviço `mongo`
para que o `mongosh` do entrypoint as enxergue.

`MGO-04` tem duas soluções possíveis: mover o usuário para `admin`, ou manter em
`chaoslab` e autenticar com `authSource=chaoslab`. **Foi escolhida a segunda**, por
menor privilégio: o usuário da aplicação só tem `readWrite` no próprio banco, sem
qualquer alcance sobre `admin`.

`MGO-02` (replica set nunca iniciado) foi resolvido removendo o `--replSet`: a
aplicação não usa transação multi-documento nem change stream, e manter o replica
set exigiria `security.keyFile` junto com a autenticação. Está documentado no
compose que os dois voltam juntos, se um dia for preciso.

### 6.3 Scripts de init só rodam com volume vazio

Tanto o entrypoint do Postgres quanto o do Mongo executam
`/docker-entrypoint-initdb.d` **apenas na primeira inicialização com o diretório de
dados vazio**. Como os volumes já existiam das tentativas anteriores, corrigir os
scripts não bastou — foi necessário recriar os containers com volumes novos para
que as correções tomassem efeito. Esse passo é obrigatório sempre que um script de
init muda.

---

## 7. Fase 4 — Variáveis de ambiente

### 7.1 `.env.example` reescrito

O arquivo tinha chaves duplicadas e não declarava metade das variáveis que o
compose consome. Foi deduplicado e completado:

```
NODE_ENV=development
SERVICE_NAME=laboratorio-do-caos-api
SERVICE_VERSION=1.0.0
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info

POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
POSTGRES_URL=
POSTGRES_POOL_MAX=10
POSTGRES_CONNECT_TIMEOUT_MS=5000

MONGO_INITDB_ROOT_USERNAME=
MONGO_INITDB_ROOT_PASSWORD=
MONGO_INITDB_DATABASE=

MONGO_APP_USERNAME=
MONGO_APP_PASSWORD=

MONGO_URL=
MONGO_DB=
MONGO_CONNECT_TIMEOUT_MS=5000

GF_SECURITY_ADMIN_USER=
GF_SECURITY_ADMIN_PASSWORD=

JWT_SECRET=
JWT_ISSUER=
JWT_EXPIRES_IN_SECONDS=900
# minimo de 16 caracteres (validado em src/config/env.ts)
WEBHOOK_HMAC_SECRET=
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1 minute

OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318
METRICS_PATH=/metrics
```

Chaves novas em relação ao original: `NODE_ENV`, `POSTGRES_USER/PASSWORD/DB`,
`MONGO_INITDB_ROOT_USERNAME/PASSWORD`, `MONGO_INITDB_DATABASE`,
`MONGO_APP_USERNAME/PASSWORD`, `GF_SECURITY_ADMIN_USER/PASSWORD`.

O `.env` local recebeu o mesmo tratamento de deduplicação, preservando sempre o
valor não-vazio de cada chave repetida. Nenhuma chave foi perdida e nenhuma ficou
vazia após a operação.

### 7.2 Correção por ID

| ID | Defeito | Correção |
|---|---|---|
| ENV-01 | `JWT_SECRET` com 10 caracteres | Segredo com comprimento válido no `.env` |
| ENV-02 | `POSTGRES_URL` em `localhost` dentro do container | `.env` usa `localhost` (tooling do host); compose sobrescreve com `postgres:5432` |
| ENV-03 | `MONGO_URL` sem `authSource` | `?authSource=${MONGO_INITDB_DATABASE}` |
| ENV-04 | `OTEL_EXPORTER_OTLP_ENDPOINT` na 4317 (gRPC) com exporter HTTP | `http://tempo:4318` |
| ENV-05 | `METRICS_PATH=/prometheus` | `METRICS_PATH=/metrics`, alinhado ao `metrics_path` do Prometheus |
| ENV-06 | `WEBHOOK_HMAC_SECRET` ausente | Presente, acima do mínimo de 16 caracteres |
| ENV-07 | `POSTGRES_POOL_MAX=40` contra `max_connections=10` | Pool em 10, `max_connections` em 100 |

### 7.3 A aplicação nunca carregava o `.env` no host

Diagnóstico separado, com sintoma enganoso: `pnpm db:seed` falhava com
`POSTGRES_URL / MONGO_URL / JWT_SECRET / WEBHOOK_HMAC_SECRET: Required`, mesmo com
o `.env` preenchido.

Causa: o projeto **não tem `dotenv` instalado** e nenhum módulo chama `config()`.
Dentro do container isso nunca apareceu, porque o compose injeta as variáveis via
`env_file`. No host, os scripts `tsx` rodavam com `process.env` vazio.

Correção em `package.json`, usando o carregador nativo do Node 22 — sem adicionar
dependência:

```json
"dev": "tsx watch --env-file=.env src/server.ts",
"db:migrate": "tsx --env-file=.env scripts/migrate.ts",
"db:seed": "tsx --env-file=.env scripts/seed.ts",
"openapi:dump": "tsx --env-file=.env scripts/dump-openapi.ts"
```

Seed executado com sucesso após a correção: 192 leituras inseridas e usuário
administrador criado.

---

## 8. Fase 5 — Observabilidade

### 8.1 Prometheus — `prometheus.yml`

| ID | Defeito | Correção |
|---|---|---|
| OBS-01 | Target `localhost:3000` | `api:3000` — dentro da rede do compose o alvo é o nome do serviço |
| OBS-02 | `metrics_path` divergente | `/metrics`, igual ao `METRICS_PATH` da aplicação |
| OBS-04 | `rule_files` declarado, diretório não montado | `rules/` montado em `/etc/prometheus/rules` |

Ajustes adicionais: `scrape_interval` de 60s para 15s (60s tornava
`$__rate_interval` inútil em janelas curtas), `evaluation_interval` alinhado em 15s,
e o bloco `alerting` comentado — **não existe serviço `alertmanager` no compose**, e
apontar para um alvo inexistente só gera erro de resolução recorrente. O comentário
registra que os dois voltam juntos.

### 8.2 Regras de alerta — `rules/api-alerts.yml`

```yaml
# antes
expr: rate(http_requests_total{status_code=~"5.."}) > 0.05
```

`rate()` sem seletor de intervalo (`OBS-03`) faz o Prometheus recusar o arquivo de
regras **inteiro** — os outros alertas também deixam de existir, sem sinal óbvio.

```yaml
# depois
expr: >-
  sum(rate(http_requests_total{status_code=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m])) > 0.05
```

Além do intervalo, a expressão passou a ser uma **proporção**. `rate(...) > 0.05`
comparava requisições por segundo com 0.05, não taxa de erro: dispararia com
qualquer tráfego de erro acima de 0,05 req/s, independente do volume total.

`OBS-11`: a regra de latência usava `http_request_duration_ms_bucket`. A aplicação
exporta `http_request_duration_seconds_bucket` (`src/observability/metrics.ts`
define o histograma em segundos, com buckets de 0.005 a 10). Consulta vazia e alerta
que nunca dispara. Corrigido o nome da métrica **e a unidade do limiar**: `> 500`
virou `> 0.5`.

### 8.3 Loki — `loki-config.yml`

`OBS-08`. O Loki 3.x removeu `boltdb-shipper` e `shared_store`; o container encerrava
no boot.

```yaml
schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

storage_config:
  tsdb_shipper:
    active_index_directory: /loki/tsdb-index
    cache_location: /loki/tsdb-cache

compactor:
  working_directory: /loki/compactor
  delete_request_store: filesystem
  retention_enabled: true

limits_config:
  retention_period: 168h
```

Compactor e retenção de 7 dias foram adicionados **[extra]** — sem retenção, um
laboratório de caos enche o disco.

### 8.4 Tempo — `tempo-config.yml`

`OBS-09`. Faltava o receiver OTLP/HTTP:

```yaml
distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318
```

A aplicação exporta por HTTP (`OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318`).
Sem o receiver, nenhum trace chegava e nada reclamava.

O bloco `ingester` de topo foi removido — o `app.Config` do Tempo 3.x não tem mais
esse campo, e a presença dele impedia o boot.

### 8.5 Alloy — `config.alloy`

`OBS-10`: `loki.source.docker` encaminhava para `loki.write.default.receiver`, mas o
componente declarado era `loki.write "loki"`. O Alloy falhava ao carregar a config.
A URL também estava em `/api/prom/push` (formato legado) em vez de
`/loki/api/v1/push`.

Corrigido isso, apareceu um problema **não catalogado**: a coleta funcionava, mas
todo log chegava ao Loki com um único label, `service_name="unknown_service"`.

Causa: `discovery.docker` entrega apenas meta-labels (`__meta_docker_*`), e o Loki
descarta tudo que começa com `__`. Sem um `discovery.relabel` no meio, não existe
label nenhum para filtrar. Era por isso que o painel de logs consultava
`{container="chaos-api"}` e não retornava nada — o label `container` não existia, e
o container nem se chama assim.

```alloy
discovery.relabel "containers" {
  targets = discovery.docker.containers.targets

  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }

  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "service"
  }

  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_project"]
    target_label  = "stack"
  }
}
```

Foi adicionado também um `loki.process` que traduz o nível numérico do pino
(`10`…`60`) para texto (`trace`…`fatal`) e o promove a label, só para os logs do
serviço `api`. Sem isso não há filtro por severidade nem coloração no Grafana.

Verificação após a mudança — labels reais no Loki:

```
container, service, stack, level, service_name
service = alloy, api, grafana, loki, mongo, mongodb-exporter,
          postgres, postgres-exporter, prometheus, tempo
```

### 8.6 Grafana — provisioning

| ID | Defeito | Correção |
|---|---|---|
| OBS-06 | Provisioning montado em `/etc/grafana/provisioning/datasource` | `/etc/grafana/provisioning` |
| OBS-12 | URL do Loki com `/loki` no final | `http://loki:3100` |
| OBS-13 | Provider aponta para `/etc/grafana/dashboards`, mount em `/var/lib/grafana/dashboards` | Mount alinhado em `/etc/grafana/dashboards` |
| — | `datasourceUid: tempo-traces` nos derived fields | `tempo` — o uid real |

---

## 9. Fase 6 — Dashboards separados **[extra]**

### 9.1 Situação encontrada

O dashboard versionado (`api-overview.json`) tinha quatro painéis e três defeitos
catalogados: `OBS-05` (datasource `PROM-DS` inexistente), `OBS-07` (datasource em
formato string legado) e `OBS-11` (métrica `_ms`).

Em algum momento anterior o arquivo foi substituído por um export da UI do Grafana
no schema v2 (`dashboard.grafana.app/v2`, 514 linhas), carregando metadados de
instância — `resourceVersion`, `creationTimestamp`, `sourceChecksum` — que não fazem
sentido em arquivo versionado. Os defeitos continuavam presentes.

### 9.2 Bloqueio: métricas de banco não existiam

Antes de montar qualquer visualização de banco, um fato: o Prometheus raspava
**apenas dois alvos** — a própria API e ele mesmo. Não havia nenhuma métrica de
Postgres ou de Mongo na base. A única informação disponível sobre os bancos era o
gauge `dependency_up`, que a própria aplicação publica no `/health/ready` — ou seja,
um booleano por banco, medido de fora.

Foram adicionados dois exporters ao compose:

```yaml
postgres-exporter:
  image: quay.io/prometheuscommunity/postgres-exporter:v0.18.1
  environment:
    DATA_SOURCE_NAME: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?sslmode=disable

mongodb-exporter:
  image: percona/mongodb_exporter:0.47.1
  command:
    - --mongodb.uri=mongodb://${MONGO_INITDB_ROOT_USERNAME}:${MONGO_INITDB_ROOT_PASSWORD}@mongo:27017/?authSource=admin
    - --collect-all
    - --compatible-mode
```

`--collect-all` habilita `dbstats`, `collstats` e `indexstats`; `--compatible-mode`
expõe também os nomes legados (`mongodb_up`, `mongodb_connections`,
`mongodb_op_counters_total`), que são mais estáveis entre versões do exporter.

O `prometheus.yml` passou de 2 para **8 alvos**. Além dos dois exporters, Loki,
Tempo, Grafana e Alloy expõem `/metrics` nativamente — foram incluídos sem custo de
container adicional:

```yaml
scrape_configs:
  - job_name: chaos-lab-api   # api:3000
  - job_name: postgres        # postgres-exporter:9187
  - job_name: mongodb         # mongodb-exporter:9216
  - job_name: prometheus      # localhost:9090
  - job_name: loki            # loki:3100
  - job_name: tempo           # tempo:3200
  - job_name: grafana         # grafana:3000
  - job_name: alloy           # alloy:12345
```

### 9.3 Os quatro dashboards

Todos escritos no schema clássico (array `panels`), com `uid` fixo, `tags` e
provisionados pelo provider `chaos-lab` na pasta "Chaos Lab".

| Arquivo | uid | Título | Conteúdo |
|---|---|---|---|
| `aplicacao.json` | `chaos-app` | 1. Aplicação — respostas da API | RED completo: throughput por rota e por classe de status, p50/p90/p99 e média, heatmap de distribuição de latência, taxa de erro por rota, tabela rota × método × status no período, métricas de domínio, volume de log por nível e stream de logs |
| `postgres.json` | `chaos-postgres` | 2. PostgreSQL | `pg_up` ao lado de `dependency_up`, uso de conexões contra `max_connections`, cache hit ratio, TPS commit/rollback, operações em tuplas, locks por modo, deadlocks e conflitos, transação aberta mais longa, crescimento do banco, logs do container |
| `mongodb.json` | `chaos-mongodb` | 3. MongoDB | `mongodb_up` ao lado de `dependency_up`, uptime, conexões (abertas/ativas/novas por segundo), operações por segundo por tipo, latência média read/write/command, fila do global lock, cache do WiredTiger contra o máximo configurado, tabela de databases, logs do container |
| `environment.json` | `chaos-environment` | 4. Ambiente — stack completa | Linha do tempo (`state-timeline`) de up/down de todos os alvos, tabela de targets, contagem de alertas disparando, CPU e memória residente por serviço, heap e event loop lag do Node, file descriptors, volume de log por serviço, linhas de erro por serviço e stream de todos os containers |

Decisões de construção:

- **`$__rate_interval` em vez de `[5m]` fixo**, para o `rate()` acompanhar o zoom.
- **Variáveis de template**: `$route` (aplicação), `$db` (Postgres), `$database`
  (MongoDB), todas com `includeAll` e `multi`.
- **`clamp_min` no denominador** de toda divisão, evitando divisão por zero quando
  não há tráfego.
- **`or vector(0)`** no numerador da taxa de erro 5xx — sem isso o painel mostra
  *No data* em vez de 0% quando não houve nenhum erro, o que é justamente o estado
  saudável.
- **`dependency_up` ao lado da métrica do exporter** nos dois dashboards de banco.
  Divergência entre os dois separa "o banco caiu" de "a aplicação não consegue
  falar com o banco" — problema de credencial ou de rede, não do banco.
- **Anotação de alertas** (`ALERTS{alertstate="firing"}`) nos quatro dashboards,
  marcando na linha do tempo o instante em que cada alerta disparou.

### 9.4 Correlação entre sinais — `datasources.yml` **[extra]**

```yaml
- name: Prometheus
  jsonData:
    httpMethod: POST
    exemplarTraceIdDestinations:
      - name: trace_id
        datasourceUid: tempo

- name: Tempo
  jsonData:
    tracesToLogsV2:
      datasourceUid: loki
      spanStartTimeShift: -5m
      spanEndTimeShift: 5m
      filterByTraceID: true
      tags: [{ key: service.name, value: service }]
    tracesToMetrics:
      datasourceUid: prometheus
      tags: [{ key: service.name, value: service }]
    serviceMap:
      datasourceUid: prometheus
```

Fecha o triângulo: do ponto no gráfico de latência para o trace, do trace para os
logs do mesmo serviço, e do trace de volta para as métricas.

---

## 10. Armadilhas de ambiente encontradas

Nenhuma destas está no catálogo. São comportamentos reais de ferramenta que
custaram tempo de diagnóstico e vão reaparecer.

### 10.1 Variável exportada no shell vence o `--env-file`

Sintoma: `POSTGRES_DB` continuava valendo `chaos` mesmo com o `.env` correto e o
`--env-file` apontado para ele.

Causa: o Docker Compose dá precedência a variáveis já presentes no ambiente do shell
sobre as do `--env-file`. A sessão tinha exports antigos de `POSTGRES_DB`,
`POSTGRES_USER`, `MONGO_*` e `GF_*`.

O mesmo vale para o Node: **`--env-file` não sobrescreve variável já presente em
`process.env`**. Um `WEBHOOK_HMAC_SECRET` exportado vazio no shell silenciosamente
anulava o valor de 48 caracteres do `.env`.

Contorno em sessão contaminada:

```bash
env -u POSTGRES_DB -u POSTGRES_USER -u POSTGRES_PASSWORD \
    -u MONGO_INITDB_ROOT_USERNAME -u MONGO_INITDB_ROOT_PASSWORD \
    docker compose --env-file ../.env up -d
```

Solução real: usar um terminal limpo. Se um comando se comporta de forma
inexplicável, `env | grep POSTGRES` antes de qualquer outra hipótese.

### 10.2 Bind mount de arquivo quebra no Docker Desktop / WSL

Sintoma, ao reescrever `config.alloy` e reiniciar o container:

```
error mounting ".../docker-desktop-bind-mounts/..." to rootfs
at "/etc/alloy/config.alloy": no such file or directory
```

Causa: reescrever o arquivo cria um **inode novo**; o bind mount do Docker Desktop
no WSL aponta para o inode antigo, que deixou de existir.

`docker compose restart` **não** resolve — ele reusa o container e o mount quebrado.

```bash
docker compose --env-file ../.env up -d --force-recreate <servico>
```

Vale para todo arquivo de configuração montado individualmente: `prometheus.yml`,
`config.alloy`, `loki-config.yml`, `tempo-config.yml`. Diretórios montados
(`dashboards/`, `provisioning/`) não têm esse problema.

### 10.3 Dashboard provisionado não pode ser removido pela API

Ao trocar o `uid` do dashboard mantendo o mesmo arquivo:

```
Operation cannot be fulfilled on dashboards.dashboard.grafana.app "chaos-app":
deprecatedInternalID=3527568904368128 is already in use
```

O registro antigo continua no volume `grafanadata` e a API recusa deletar
(`provisioned dashboard cannot be deleted`).

Solução: **renomear o arquivo**. O provisioner remove o dashboard cujo arquivo de
origem desapareceu (`disableDeletion: false`) e cria o novo. Foi por isso que
`api-overview.json` virou `aplicacao.json`.

### 10.4 `pino-pretty` e `NODE_ENV`

A imagem `release` instala apenas `dependencies`. O logger carrega o transport
`pino-pretty` — uma `devDependency` — quando `NODE_ENV=development`. Um `.env` com
`NODE_ENV=development` derruba o container de produção no boot. Daí o
`NODE_ENV: production` explícito no serviço `api` do compose.

### 10.5 Contadores sem série

`readings_ingested_total` e `auth_login_failures_total` não aparecem no
`/metrics` até serem incrementados pela primeira vez — comportamento do `prom-client`
para contadores com label. Painel vazio nesse caso é estado correto, não defeito.

---

## 11. Verificação

### 11.1 Estática

```bash
cd docker && docker compose --env-file ../.env config -q     # compose válido
promtool check config infra/observability/prometheus/prometheus.yml
promtool check rules  infra/observability/prometheus/rules/*.yml
python3 -c "import json,glob; [json.load(open(f)) for f in glob.glob('infra/observability/grafana/dashboards/*.json')]"
```

### 11.2 Em execução

```bash
# alvos do Prometheus — esperado: 8 alvos, todos up
curl -s 'http://127.0.0.1:9090/api/v1/targets?state=active' \
  | python3 -c "import sys,json;[print(t['labels']['job'], t['health']) for t in json.load(sys.stdin)['data']['activeTargets']]"

# labels do Loki — esperado incluir container, service, stack, level
curl -s http://127.0.0.1:3100/loki/api/v1/labels

# saúde dos datasources do Grafana
curl -s -u "$GF_SECURITY_ADMIN_USER:$GF_SECURITY_ADMIN_PASSWORD" \
  http://127.0.0.1:3000/api/datasources/uid/prometheus/health

# prontidão da aplicação — os dois bancos devem reportar up
curl -s http://127.0.0.1:3001/health/ready
```

### 11.3 Verificação das queries dos painéis

Toda expressão dos quatro dashboards foi executada contra o Prometheus e o Loki
reais, com as variáveis de template substituídas. Das aproximadamente 70 queries,
**apenas 3 retornaram vazio** — as dos contadores descritos em 10.5.

Detalhe do método, para quem for repetir: consulta de **stream** de log
(`{service="api"}`, sem função de agregação) não funciona no endpoint
`/loki/api/v1/query`; exige `query_range`. Uma primeira rodada acusou falsos
positivos nos quatro painéis de log por causa disso.

---

## 12. Estado final

Dez serviços, todos de pé:

| Serviço | Container | Porta publicada | Healthcheck |
|---|---|---|---|
| api | `laboratorio-do-caos` | `3001 → 3000` | healthy |
| postgres | `chaos-postgres` | `5432` | healthy |
| mongo | `chaos-mongo` | `27017` | healthy |
| postgres-exporter | `chaos-postgres-exporter` | interna (9187) | — |
| mongodb-exporter | `chaos-mongodb-exporter` | interna (9216) | — |
| prometheus | `chaos-prometheus` | `9090` | — |
| grafana | `chaos-grafana` | `127.0.0.1:3000` | healthy |
| loki | `chaos-loki` | `127.0.0.1:3100` | — |
| tempo | `chaos-tempo` | `127.0.0.1:3200`, `4317`, `4318` | — |
| alloy | `chaos-alloy` | `127.0.0.1:12345` | — |

- `/health/ready` responde saudável com `dependency_up` em 1 para os dois bancos.
- 8 alvos no Prometheus, todos `up`.
- Loki recebendo log dos 10 containers, com labels `container`, `service`, `stack`
  e `level`.
- Datasources Prometheus, Loki e Tempo com health OK.
- 4 dashboards provisionados na pasta "Chaos Lab".

### Subir do zero

```bash
cp .env.example .env      # preencher os valores em branco
cd docker
docker compose --env-file ../.env up -d --build
```

Em terminal limpo, sem exports de `POSTGRES_*`, `MONGO_*` ou `GF_*` (ver 10.1).

Para o tooling do host (`pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`), o `.env`
mantém as URLs em `localhost` — os scripts carregam via `--env-file` nativo.

---

## 13. O que ficou de fora

| Item | Motivo |
|---|---|
| cAdvisor | Daria CPU e memória por **container**; hoje o dashboard de ambiente mostra por **processo**. Um container a mais para uma métrica que ainda não foi necessária. |
| Alertmanager | Não existe no compose. O bloco `alerting` do Prometheus está comentado, com nota para reativar junto com o serviço. |
| Replica set do Mongo | Removido. Reativar exige `security.keyFile` junto com a autenticação, e a aplicação não usa transação nem change stream. |
| Camadas K8S e CI/CD | Estavam fora do escopo do ambiente Docker local. Corrigidas depois, em [`CORRECOES-K8S.md`](./CORRECOES-K8S.md) (20 IDs) e [`CORRECOES-CI-CD.md`](./CORRECOES-CI-CD.md) (17 IDs). |
| Camada PRODUÇÃO | `PRD-01..06` em `render.yaml`, ainda ativas. É a única camada do laboratório que segue intacta. |
| `PG-03` | Não reproduz. O catálogo descreve `002_audit.sql` rodando antes de `001_init.sql`, mas os três arquivos de `db/migrations/` já estão nomeados `000_`, `001_`, `002_`, e o entrypoint do Postgres os executa em ordem alfabética — as FKs de `002` encontram `users` e `assets` criadas por `001`. O que impedia a execução era o mount em `/docker-entrypoint-init.d` (sem o `db`), corrigido em 5.2. Ver também a nota de rastreabilidade em 6.1: o comentário dentro do `000_pg_init.sh` rotulava a própria falha como `PG-03` quando ela é `PG-01`. |

---

## 14. Índice de arquivos alterados

```
.dockerignore                                              modificado
Dockerfile                                                 reescrito
README.md                                                  modificado
package.json                                               modificado (scripts)
.env.example                                               reescrito
db/migrations/000_pg_init.sh                               modificado
db/seeds/00-init-mongo.js                                  reescrito
docker-compose.yml                                         removido (movido)
docker/docker-compose.yml                                  novo
infra/observability/prometheus/prometheus.yml              modificado
infra/observability/prometheus/rules/api-alerts.yml        modificado
infra/observability/loki/loki-config.yml                   modificado
infra/observability/tempo/tempo-config.yml                 modificado
infra/observability/alloy/config.alloy                     reescrito
infra/observability/grafana/provisioning/datasources/
  datasources.yml                                          modificado
infra/observability/grafana/dashboards/api-overview.json   removido
infra/observability/grafana/dashboards/aplicacao.json      novo
infra/observability/grafana/dashboards/postgres.json       novo
infra/observability/grafana/dashboards/mongodb.json        novo
infra/observability/grafana/dashboards/environment.json    novo
```

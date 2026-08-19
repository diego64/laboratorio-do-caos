# Correções da Camada CI/CD

Registro da recuperação dos workflows do GitHub Actions em `.github/`: o que
estava quebrado, **por que** cada coisa quebra, e o que cada defeito pede como
correção.

> **Estado: correções aplicadas e verificadas estaticamente.**
> Ao contrário das camadas Docker e Kubernetes, esta não pôde ser validada em
> execução real: um workflow só executa quando o GitHub o executa. O que dá para
> provar localmente está na [seção 14](#14-verificação); o que só o `push` prova
> está na [seção 16](#16-o-que-ficou-de-fora). Os companheiros deste documento são
> [`CORRECOES-DOCKER.md`](./CORRECOES-DOCKER.md) e
> [`CORRECOES-K8S.md`](./CORRECOES-K8S.md).

Branch: `fix/ci-cd`
Base: `d58bb29` — a camada `.github/` estava intacta desde `f5eb66f`, o commit
inicial.

Cada achado referencia o ID de [`CATALOGO-DE-FALHAS.md`](./CATALOGO-DE-FALHAS.md)
quando corresponde a uma falha semeada. Achados sem ID são defeitos reais
encontrados fora do catálogo, marcados **[extra]**.

---

## 1. Escopo e método

Arquivos cobertos:

```
.github/
├── dependabot.yml
└── workflows/
    ├── ci.yml
    ├── cd.yml
    ├── codeql.yml
    └── trivy.yaml
```

Mais `.gitignore`, que é onde mora `CI-05` — a falha desta camada que não está
em nenhum workflow.

**Fora de escopo:** `render.yaml` (camada PRODUÇÃO, `PRD-01..06`). Ele continua
propositalmente quebrado e é citado aqui apenas quando o `cd.yml` depende dele.

A verificação seguiu três camadas, da mais barata para a mais cara:

| Camada | Ferramenta | Pega o quê |
|---|---|---|
| Sintaxe | `yaml.safe_load` | YAML que não parseia |
| Forma | `scripts/check-workflows.py` | Estrutura válida com semântica errada — `jobs` ausente, `needs` órfão, runner inexistente, passo sem `run` nem `uses` |
| Execução | `pnpm typecheck`, `pnpm test:cov`, `pnpm build`, `docker build` | Comandos que o workflow invoca e que podem falhar por motivo próprio |

A segunda camada foi a que rendeu. E vale explicar por quê, porque é o achado
central desta auditoria.

### 1.1 Por que parse não é validação

O `ci.yml` encontrado no working tree parseava sem nenhum erro:

```
$ python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
$ echo $?
0
```

Nenhuma exceção, nenhum aviso. E o arquivo estava inutilizável: tinha **zero
jobs**.

Em YAML a indentação carrega semântica. Um bloco deslocado dois espaços não
produz erro de sintaxe — produz **outra árvore**, igualmente válida. `jobs:`
indentado dentro de `on:` deixa de ser uma chave de topo e vira uma chave do
gatilho, onde ninguém a lê. O parser não tem como reclamar: a estrutura pedida
foi entregue corretamente. Ela é que estava errada.

O corolário prático:

> Em formato onde a indentação carrega semântica, a única detecção possível é
> **assertar a forma esperada**, não a ausência de exceção. "Parseou" e "está
> correto" são afirmações independentes.

É a mesma classe de problema da seção 1.1 do `CORRECOES-K8S.md` — campo em
posição errada descartado em silêncio — só que aqui não há sequer um schema
validador no caminho. O `.github/workflows/` não passa por `--dry-run` nenhum
antes do `push`.

Daí o `scripts/check-workflows.py`. Ele carrega cada workflow e resolve:

- presença de `jobs` e de `on` no **nível raiz** (o achado da seção 4)
- arquivo vazio, que parseia como `None` e não é workflow nenhum
- `runs-on` contra a lista de runners hospedados
- cada `needs` contra os jobs declarados no mesmo arquivo
- cada passo com **exatamente um** entre `uses` e `run`
- `uses` sem referência fixada, ou fixado em branch móvel

`actionlint` faz tudo isso e mais, e é a ferramenta certa quando está
disponível. O script existe porque não estava — e porque a verificação precisa
ser reproduzível por quem clonar o repositório sem instalar nada além de
`pyyaml`.

---

## 2. Inventário

Antes, 4 workflows e 4 jobs no total:

```
.github/
├── dependabot.yml          2 ecossistemas declarados, 1 inválido
└── workflows/
    ├── ci.yml              jobs: build-test, docker
    ├── cd.yml              jobs: deploy-render
    ├── codeql.yml          jobs: analyze
    └── trivy.yaml          0 bytes
```

Depois, 4 workflows e 5 jobs:

```
.github/
├── dependabot.yml          npm + docker + github-actions
└── workflows/
    ├── ci.yml              jobs: quality, docker
    ├── cd.yml              jobs: deploy-render
    ├── codeql.yml          jobs: analyze
    └── trivy.yaml          jobs: config          <- preenchido
```

Nenhum arquivo novo, nenhum removido. Entrou `scripts/check-workflows.py`, e
`pnpm-lock.yaml` passou a ser versionado (seção 6).

---

## 3. Estado inicial

Nenhum dos quatro workflows chegaria ao fim. Os bloqueios, em ordem de quem
falha primeiro:

1. `trivy.yaml` tem 0 bytes. O Actions recusa o arquivo antes de qualquer coisa.
2. O job `build-test` do `ci.yml` pede `ubuntu-latest-16core`, um runner que não
   existe. Ele nunca sai da fila.
3. O job `docker` do mesmo arquivo declara `needs: [lint]`, e não há job `lint`.
   Isso invalida o workflow inteiro no momento do parse do Actions.
4. Se os dois anteriores fossem resolvidos: `pnpm` não é instalado, então
   `cache: pnpm` no `setup-node` não resolve o store, e `pnpm install` não é
   encontrado.
5. Se `pnpm` existisse: `pnpm-lock.yaml` está no `.gitignore`, então
   `--frozen-lockfile` falha por lockfile ausente.
6. Se as dependências instalassem: os testes rodam com `working-directory:
   ./app`, diretório que não existe neste repositório.
7. O CodeQL analisa com `paths-ignore` cobrindo `src/**` — todo o código.
8. O Dependabot declara `package-ecosystem: "pnpm"`, que não existe, e um
   `schedule` sem `interval`. O arquivo é rejeitado por schema.
9. O CD dispara em `push` para `main` sem esperar o CI, autentica no Render com
   um header vazio e chama `curl` sem `--fail`, de modo que o passo fica verde
   independentemente do que a API responda.

---

## 4. O defeito que o YAML aceita: `jobs` dentro de `on`

Este não vem do catálogo. Ele foi introduzido durante a própria correção da
camada, e é o mais instrutivo de todos.

O arquivo estava assim:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches:
      - 'feat/**'
  permissions:              # <- dois espaços a mais
    contents: read

    concurrency:
      group: ci-${{ github.ref }}

    jobs:                   # <- e aqui já se perdeu tudo
      quality:
        runs-on: ubuntu-latest
```

`permissions:` ganhou dois espaços de indentação e virou filho de `on:`. Como
tudo o que vinha depois estava indentado em relação a ele, `concurrency` e
`jobs` foram junto. O documento resultante tem exatamente duas chaves de topo:

```
$ python3 -c "import yaml;print(list(yaml.safe_load(open('ci.yml'))))"
['name', True]
```

Duas observações sobre essa saída.

**`True` é o `on`.** YAML 1.1 — a versão que o PyYAML implementa — trata `on`,
`off`, `yes` e `no` como booleanos. A chave `on:` sem aspas vira o booleano
`True`. É inofensivo para o GitHub, que usa outro parser, mas qualquer script
de verificação precisa aceitar as duas formas. O `check-workflows.py` faz isso
explicitamente.

**Não há `jobs`.** O GitHub recusa o workflow com um erro de "no jobs defined"
no momento em que tenta agendá-lo. Não há execução, não há log de job, não há
nada para clicar — o workflow aparece na aba Actions já vermelho, com uma
mensagem que não aponta para a linha errada, porque do ponto de vista do parser
não existe linha errada.

### 4.1 Os defeitos que vieram no mesmo arquivo

Uma vez que a árvore está errada, tudo abaixo dela deixa de ser lido, e erros
adicionais ficam invisíveis. Havia mais três, todos do mesmo tipo — estrutura
válida, semântica errada:

**`steps` dentro de `services`.** No mesmo nível de indentação de `postgres:` e
`mongo:`, o que faria dele um terceiro *serviço* chamado `steps`, e não a lista
de passos do job:

```yaml
services:
  postgres: { ... }
  mongo: { ... }
  steps:              # <- terceiro serviço, não os passos do job
    - name: Checkout repository
```

**`ports` como flow mapping.** `- {5432:5432}` não é a string `"5432:5432"` —
é um mapeamento de uma chave só. O valor esperado por `ports` é uma sequência de
strings; a forma correta é `- 5432:5432`, sem chaves.

**`- name:` e `- uses:` como itens de lista distintos.** Cada hífen abre um novo
item:

```yaml
steps:
  - name: Checkout repository     # item 1: só tem name, não faz nada
  - uses: actions/checkout@v4     # item 2: sem name
```

Sete passos viraram catorze itens de lista, e os que ficaram só com o `name:`
não têm `run` nem `uses` — não fazem nada. O mesmo padrão colocou o bloco `env:`
dos testes como item próprio, órfão do `run: pnpm test:cov` que deveria
consumi-lo: as variáveis nunca chegariam ao processo.

**Correção:** o arquivo foi reescrito com a árvore correta. É a regra que a
verificação de forma passa a garantir: `jobs` no nível raiz, cada passo com
exatamente um entre `uses` e `run`.

---

## 5. Falhas semeadas no `ci.yml`

### 5.1 A ordem entre `pnpm` e `setup-node` — `CI-03`, `CI-04`

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 18
    cache: pnpm          # CI-04
# CI-03: pnpm/action-setup nunca aparece
```

Dois defeitos que parecem um só, e a ordem entre eles importa.

`cache: pnpm` não é uma opção declarativa que o `setup-node` interpreta sozinho.
Para descobrir **o que** cachear, ele executa `pnpm store path` no runner. Se o
binário `pnpm` não estiver no PATH naquele instante, a resolução falha — em
versões diferentes da action isso aparece como `Unable to locate executable file:
pnpm` ou como o `Some specified paths were not resolved` que o catálogo cita.

Ou seja: **`pnpm/action-setup` precisa vir antes do `setup-node`**, não depois.
É contraintuitivo, porque `pnpm` é instalado por cima do Node — mas quem precisa
do `pnpm` primeiro é a etapa de cache, não a de runtime. A `action-setup` usa o
Node que já vem pré-instalado na imagem do runner para se instalar.

**Correção:**

```yaml
# pnpm precisa existir ANTES do setup-node, senao `cache: pnpm` nao resolve o store.
- name: Set up pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 10

- name: Set up Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: pnpm
```

O comentário ficou no arquivo. Essa ordem é exatamente o tipo de coisa que a
próxima pessoa inverte ao "organizar" os passos.

### 5.2 `node-version: 18` contra `engines: >=22` — `CI-02`

O `package.json` declara:

```json
"engines": { "node": ">=22.0.0", "pnpm": ">=10.0.0" }
```

O CI pedia Node 18. O `pnpm` respeita `engines` e aborta o install. Corrigido
para `node-version: 22`, alinhado com o `Dockerfile`, que usa
`node:22-alpine3.20`.

O ponto geral: **a versão do runtime no CI é uma duplicata do que já está
declarado no `package.json` e no `Dockerfile`.** Três lugares, nenhum
mecanismo garantindo que concordem. Manter o número igual nos três é
disciplina, não configuração — vale conferir sempre que um deles subir.

### 5.3 `working-directory: ./app` — `CI-06`

```yaml
- name: Testes
  working-directory: ./app
  run: pnpm test:cov
```

Não existe `./app` neste repositório; o código está na raiz. O passo falha com
`No such file or directory`. Removido.

### 5.4 `needs: [lint]` — `CI-12`

```yaml
docker:
  needs: [lint]
```

Não há job `lint` — e nem poderia haver, porque o `package.json` não tem script
de lint. `needs` apontando para job inexistente **invalida o workflow inteiro**,
não apenas o job que o declara: o Actions monta o grafo de dependências antes de
executar qualquer coisa, e um nó órfão impede a montagem.

Isso é o mesmo padrão do Kustomize documentado na seção 3 do `CORRECOES-K8S.md`:
ferramenta que acumula antes de aplicar aborta tudo no primeiro erro, e o
primeiro erro esconde os demais.

**Correção:** `needs: [quality]`, o job que de fato existe. A verificação de
`needs` contra os jobs declarados entrou no `check-workflows.py`.

Não foi adicionado job de lint. O projeto não tem linter configurado, e inventar
um aqui seria trocar um workflow quebrado por um workflow que reprova código que
ninguém combinou como escrever. O `typecheck`, que o `ci.yml` original tinha e a
correção em andamento havia perdido, foi reintroduzido — esse já existe como
script e é gratuito.

### 5.5 `ubuntu-latest-16core` — `CI-15`

```yaml
runs-on: ubuntu-latest-16core
```

Runners de maior porte existem, mas são **provisionados por organização, com
label definida por quem os cria**. `ubuntu-latest-16core` não é um label padrão
do GitHub. O job não falha: fica `Queued` esperando um runner com aquele label
aparecer, indefinidamente, até o timeout de 6 horas do workflow.

É a falha mais desagradável de diagnosticar da camada, porque não há mensagem de
erro nenhuma — só um job amarelo que não anda. Corrigido para `ubuntu-latest`.

Junto entrou `timeout-minutes` em todos os jobs (15 no `quality`, 20 no
`docker`, 10 no `config` do Trivy). O padrão do Actions é 360 minutos; um job
travado consome seis horas de runner antes de alguém perceber.

### 5.6 Trivy como gate de merge — `CI-14`

```yaml
- uses: aquasecurity/trivy-action@master
  with:
    exit-code: "1"
    severity: "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL"
```

`exit-code: 1` transforma o scanner em bloqueio de merge. Combinado com uma lista
de severidade que inclui `UNKNOWN` e `LOW`, o bloqueio é permanente: qualquer
imagem base tem CVEs de severidade baixa em aberto, muitos sem correção
disponível. O PR fica vermelho por um problema que ninguém pode resolver
naquele PR.

O efeito real não é segurança — é o oposto. Um sinal que está sempre vermelho é
um sinal que as pessoas aprendem a ignorar, e quando aparecer o `CRITICAL` que
importa, ele estará no meio de quarenta `LOW` que já estavam lá.

**Correção:** o achado vira relatório, não gate.

```yaml
severity: HIGH,CRITICAL
format: sarif
output: trivy-image.sarif
# exit-code 0: o gate e o Security tab, nao um CI vermelho por CVE de base image.
exit-code: "0"
```

Com `format: sarif` e o upload via `github/codeql-action/upload-sarif`, o achado
aparece na aba Security do repositório, com histórico, atribuição e possibilidade
de dispensa individual. É onde vulnerabilidade de dependência deve viver.

Isso exigiu `permissions: security-events: write` no job `docker` — a mesma
permissão que o `CI-07` pedia no CodeQL, pelo mesmo motivo.

### 5.7 Actions em versão retirada ou branch móvel — `CI-01` e **[extra]**

Três problemas de fixação de versão no mesmo arquivo:

| Como estava | Problema |
|---|---|
| `actions/checkout@v2` | `CI-01` — versão descontinuada |
| `actions/upload-artifact@v3` | **[extra]** — v3 foi retirada; o passo falha |
| `aquasecurity/trivy-action@master` | **[extra]** — branch móvel |

O terceiro é o interessante. `@master` não é uma versão: é um ponteiro que se
move. O workflow passa a ter um comportamento que muda sem que o repositório
mude, e a bissecção de "funcionava semana passada" não encontra nada, porque não
há commit local correspondente à mudança.

É o mesmo raciocínio de fixar tag de imagem em vez de `:latest`, aplicado a
YAML. E é a razão de o `dependabot.yml` ter ganhado o ecossistema
`github-actions` (seção 9): fixar versão só é sustentável se algo se encarrega
de propor as atualizações.

**Correção:** `checkout@v4`, `upload-artifact@v4`, `trivy-action@0.24.0`. A
verificação de `@master`/`@main` entrou no `check-workflows.py`.

---

## 6. O lockfile ignorado — `CI-05`

A falha mais silenciosa da camada, e a única que não está em nenhum workflow.

```
$ grep -n lock .gitignore
9:pnpm-lock.yaml
$ git ls-files --error-unmatch pnpm-lock.yaml
error: pathspec 'pnpm-lock.yaml' did not match any file known to git
```

O arquivo existe no disco de quem desenvolve e **não existe no repositório**.
Localmente tudo funciona. No runner, que clona limpo:

```
ERR_PNPM_NO_LOCKFILE  Cannot install with "frozen-lockfile" because
pnpm-lock.yaml is absent
```

`--frozen-lockfile` é a flag correta para CI — ela recusa resolver dependências
de novo e garante que o runner instale exatamente o que a máquina de quem
commitou instalou. Só que ela pressupõe o lockfile versionado. Sem ele, a flag
que existe para dar reprodutibilidade vira a que quebra o build.

**Correção:** remover a linha do `.gitignore` e versionar o lockfile.

```bash
sed -i '/^pnpm-lock\.yaml$/d' .gitignore
git add pnpm-lock.yaml
```

Vale registrar o critério, porque ele é fonte de confusão recorrente:
**aplicação versiona lockfile; biblioteca publicada não.** A biblioteca precisa
ser testada contra o leque de versões que seus consumidores vão resolver. A
aplicação precisa do oposto — que produção instale exatamente o que foi testado.
Este projeto é aplicação.

---

## 7. Serviços de banco que nenhum teste usa — **[extra]**

O `ci.yml` em correção declarava `services:` com Postgres e Mongo, healthchecks,
portas e URLs de conexão completas. Nada disso é usado.

O cabeçalho do único teste de integração diz, textualmente:

```
tests/integration/http-contract.spec.ts
 * Responsabilidade : Validar o contrato HTTP da aplicacao inteira via app.inject(), sem
 *                    abrir porta e sem depender de PostgreSQL/MongoDB.
 * Consumido por    : pnpm test / pipeline de CI (job que roda sem services)
```

E o `tests/setup-env.ts` já define todo o ambiente com `??=`, ou seja, sem
exigir nada de fora:

```ts
process.env['POSTGRES_URL'] ??= 'postgresql://chaos:chaos@localhost:5432/laboratorio-do-caos-test';
process.env['MONGO_URL']    ??= 'mongodb://localhost:27017/laboratorio-do-caos-test';
```

Dois containers subindo a cada execução, com healthcheck, para uma suíte que
nunca abre socket. E o custo não é só tempo de runner: dependência declarada e
não usada **carrega configuração própria que ninguém valida**. As duas dela
estavam erradas:

- `OTEL_TRACE: "false"` — a variável do schema em `src/config/env.ts` chama-se
  `OTEL_ENABLED`. Um nome que não existe é ignorado em silêncio, exatamente
  como o `OTL_ENABLED` da seção 7.1 do `CORRECOES-K8S.md`.
- `mongodb://ci-chaoslab:ci-chaoslab@localhost:27017/ci-chaoslab-database` — sem
  `authSource=admin`. Usuário criado por `MONGO_INITDB_ROOT_USERNAME` vive no
  banco `admin`, não no banco da aplicação; a autenticação falharia. É o mesmo
  defeito do `PRD-04`.

Nenhum dos dois teria sido notado, porque nada os exercita.

**Correção:** o bloco `services:` inteiro saiu, e com ele os dois defeitos que
só existiam por causa dele. O comentário que ficou no lugar registra a decisão e
a condição para revertê-la:

```yaml
# ponytail: sem `services:` — tests/setup-env.ts define o ambiente e a suite
# roda via app.inject(), sem tocar Postgres/Mongo. Subir bancos aqui seria
# custo puro. Se surgir teste de integracao real, adicione um job separado.
```

> Infraestrutura de CI deve ser derivada do que a suíte **executa**, não do que a
> stack do projeto sugere. Configuração que nada exercita apodrece em silêncio.

---

## 8. `codeql.yml` — `CI-07`, `CI-08`, `CI-16`

### 8.1 Sem `permissions` — `CI-07`

O job não declarava `permissions`. O `codeql-action/analyze` termina fazendo
upload do SARIF para a API de code scanning, que exige `security-events: write`.
Sem isso, a análise roda inteira — gastando os minutos de runner — e falha com
403 no último passo.

**Correção:**

```yaml
permissions:
  actions: read
  contents: read
  security-events: write
```

`actions: read` é necessário para o CodeQL correlacionar a análise com o run que
a produziu.

### 8.2 `languages: typescript` — `CI-08`

O CodeQL não tem um extrator de TypeScript separado: TS e JS são analisados pelo
mesmo, cujo identificador é `javascript-typescript`. `typescript` sozinho não é
um valor aceito.

**Correção:** `javascript-typescript`. Entrou também `fail-fast: false` na
matriz — com mais de uma linguagem, a falha de uma não deve cancelar as outras
antes de terem seus resultados enviados.

### 8.3 `paths-ignore: src/**` — `CI-16`

```yaml
- uses: github/codeql-action/init@v3
  with:
    languages: ${{ matrix.language }}
    paths-ignore: |
      src/**
      tests/**
```

Excluir `src/**` e `tests/**` é excluir o repositório inteiro. A análise
completa, reporta zero alertas, e o badge fica verde — a pior forma de falha,
porque produz confiança em vez de dúvida.

Há um detalhe a mais, e ele reforça o tema desta camada: **`paths-ignore` não é
um input de `codeql-action/init`.** O filtro de caminhos do CodeQL vive no
arquivo de configuração apontado por `config-file:`, ou no input `config:`.
Passado direto no `with:`, ele é um input desconhecido — o Actions emite um
aviso e o descarta.

Ou seja, o defeito tem duas camadas: como está escrito, não faz nada e gera um
aviso que ninguém lê; escrito no lugar certo, faria exatamente o estrago que o
catálogo descreve. As duas versões estão erradas, e a de cima é pior de
diagnosticar.

> Input desconhecido em `uses:` não é erro — é aviso. Configuração que você
> acha que aplicou e não aplicou é indistinguível de configuração ausente,
> exceto por uma linha no meio do log.

**Correção:** o bloco saiu. Entrou `queries: security-and-quality`, que amplia o
conjunto padrão, e `category` no `analyze`, que separa os resultados deste
workflow dos do Trivy na aba Security — sem isso, um upload sobrescreve o outro.

---

## 9. `dependabot.yml` — `CI-09`, `CI-10`, `CI-18`

Três defeitos de schema no mesmo bloco:

```yaml
- package-ecosystem: "pnpm"      # CI-09
  directory: "/app"              # CI-10
  schedule:
    day: "monday"                # CI-18: sem `interval`
```

**`CI-09`.** Não existe ecossistema `pnpm`. O Dependabot cobre projetos pnpm
sob o ecossistema `npm`, que entende `package.json` e os três formatos de
lockfile.

**`CI-10`.** `/app` não existe. `directory` é relativo à raiz do repositório e
precisa apontar para onde está o manifesto — aqui, `/`. Mesmo defeito do
`working-directory` do `CI-06`, o que sugere que ambos foram semeados a partir
da suposição de um layout que este repositório não tem.

**`CI-18`.** `interval` é obrigatório dentro de `schedule`; `day` sozinho é
inválido. E o efeito é o pior possível: **um `dependabot.yml` inválido não
degrada — ele desliga.** O Dependabot não roda com a configuração parcial que
conseguiu ler; ele reporta o erro na aba Insights → Dependency graph, onde
ninguém olha, e para. Zero PRs de atualização, sem nenhum sinal vermelho em
lugar nenhum.

**Correção:** os três corrigidos, mais duas adições:

```yaml
- package-ecosystem: "npm"
  directory: "/"
  schedule:
    interval: "weekly"
    day: "monday"
  groups:                        # [extra]
    producao:
      dependency-type: "production"
      update-types: ["minor", "patch"]
    desenvolvimento:
      dependency-type: "development"
  labels: ["dependencies"]

- package-ecosystem: "github-actions"   # [extra]
  directory: "/"
```

`groups` junta atualizações correlatas num PR só — sem isso, um repositório com
este número de dependências gera dezenas de PRs por semana e o
`open-pull-requests-limit: 10` vira uma fila que nunca esvazia.

`github-actions` é o que fecha o ciclo da seção 5.7: fixar `trivy-action@0.24.0`
em vez de `@master` só é sustentável se alguém propuser o `0.25.0` quando ele
sair.

---

## 10. `cd.yml` — `CI-11`, `CI-17` e extras

O CD é o arquivo com mais defeitos por linha, e três deles são silenciosos.

### 10.1 Segredo ausente vira header vazio — `CI-11`

```yaml
- name: Disparar deploy no Render
  run: |
    curl -X POST \
      -H "Authorization: Bearer ${{ secrets.RENDER_API_KEY }}" \
      "https://api.render.com/v1/services/${{ secrets.RENDER_SERVICE_ID }}/deploys"
```

Dois comportamentos se somam aqui, e o resultado é um deploy que nunca acontece
sem que nada fique vermelho.

**Segredo inexistente interpola string vazia.** `${{ secrets.X }}` não falha
quando `X` não está configurado — resolve para `""`. O header vira
`Authorization: Bearer `, e a URL vira
`https://api.render.com/v1/services//deploys`.

**`curl` sem `--fail` retorna 0 em erro HTTP.** Para o `curl`, um 401 é uma
resposta bem-sucedida: a requisição foi feita, a resposta chegou. O código de
saída só reflete erro de transporte. Sem `--fail`, o passo termina verde.

Somados: o deploy é recusado pelo Render, o passo é marcado como sucesso, o
workflow fica verde, e produção continua rodando a versão anterior. O sintoma
que chega ao usuário é "fiz merge e a mudança não apareceu", horas depois, sem
nenhum log vermelho para consultar.

**Correção em três partes.** Validar antes:

```yaml
- name: Validar segredos e variaveis obrigatorios
  env:
    RENDER_API_KEY: ${{ secrets.RENDER_API_KEY }}
    RENDER_SERVICE_ID: ${{ secrets.RENDER_SERVICE_ID }}
    BASE_URL: ${{ vars.PRODUCTION_URL }}
  run: |
    : "${RENDER_API_KEY:?secret RENDER_API_KEY ausente}"
    : "${RENDER_SERVICE_ID:?secret RENDER_SERVICE_ID ausente}"
    : "${BASE_URL:?variable PRODUCTION_URL ausente}"
```

`${VAR:?mensagem}` aborta o shell com mensagem própria se a variável estiver
vazia. Um passo barato que transforma "deploy silenciosamente ignorado" em
"falhou na primeira linha, dizendo o nome do que falta".

Depois, `curl -fsS` e `set -euo pipefail` em todos os passos, para que erro HTTP
seja erro.

E os segredos passaram de interpolação direta no `run:` para `env:`. Isso não é
cosmético: `${{ }}` dentro de `run:` é substituído textualmente **antes** de o
shell existir, o que coloca o valor na linha de comando e abre superfície de
injeção quando o valor vem de fonte controlável. Via `env:`, o valor chega pelo
ambiente do processo e nunca passa pelo parser do shell.

### 10.2 `environment: production-approved` — `CI-17`

O nome não corresponde a nenhum environment configurado no repositório. O
environment é onde vivem duas coisas:

- as **regras de proteção** — revisor obrigatório, janela de espera, restrição
  de branch
- os **segredos e variáveis com escopo** de environment

Apontar para um nome errado significa que nenhuma das duas se aplica. Se
`RENDER_API_KEY` estiver configurado no environment `production`, ele **não
estará disponível** num job que declara `production-approved` — o que alimenta
diretamente o `CI-11` da seção anterior. Os dois defeitos são o mesmo defeito
visto de dois ângulos.

**Correção:** `environment: production`, o nome real. As regras de aprovação
configuram-se na interface do repositório, não no YAML — o workflow só declara
a qual environment o job pertence.

### 10.3 O gatilho: `push` em `main` não é "CI passou" — **[extra]**

```yaml
on:
  push:
    branches: [main]
```

Isto dispara o deploy **em paralelo** com o CI, não depois dele. São dois
workflows independentes reagindo ao mesmo evento. Código que não compila chega
em produção enquanto o job de testes ainda está instalando dependências.

**Correção:**

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:

jobs:
  deploy-render:
    if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}
```

O `if` é obrigatório, e é a pegadinha do `workflow_run`: o gatilho dispara em
`completed`, o que inclui **`failure` e `cancelled`**. Sem o teste explícito de
`conclusion == 'success'`, trocar `push` por `workflow_run` não corrige nada —
apenas atrasa o deploy do código quebrado até o CI terminar de reprová-lo.

### 10.4 O health check que valida a versão antiga — **[extra]**

```yaml
- name: Aguardar propagacao
  run: sleep 20

- name: Health check de producao
  run: curl --fail --silent --show-error "https://chaos-lab-api.onrender.com/health"
```

Este é o defeito mais interessante do arquivo, porque ele **passa**.

Disparar um deploy no Render é uma chamada assíncrona: a API aceita a
requisição, devolve um objeto de deploy e começa a construir. O build leva
minutos. Durante todo esse tempo, a instância **anterior** continua no ar,
saudável, respondendo tudo corretamente — é exatamente para isso que o
deploy sem downtime existe.

Então o health check 20 segundos depois consulta a versão antiga e confirma que
ela está bem. Ela está. O workflow fica verde. Se o build falhar cinco minutos
depois, o CD já terminou com sucesso.

> Verificação pós-deploy que não espera o rollout não valida o deploy — valida
> o que o deploy deveria ter substituído. Quanto mais confiável for o mecanismo
> de zero-downtime, mais convincente é o falso positivo.

O ingrediente da correção já estava no arquivo e não era usado: o passo de
deploy capturava o `deploy_id` em `$GITHUB_OUTPUT` e ninguém o lia.

**Correção:** consultar o deploy por id até ele ficar `live`, falhando rápido
nos estados terminais de erro:

```yaml
- name: Aguardar o deploy ficar live
  env:
    DEPLOY_ID: ${{ steps.deploy.outputs.deploy_id }}
  run: |
    set -euo pipefail
    for tentativa in $(seq 1 60); do
      status=$(curl -fsS -H "Authorization: Bearer $RENDER_API_KEY" \
        "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys/$DEPLOY_ID" \
        | jq -r '.status')
      case "$status" in
        live) echo "deploy $DEPLOY_ID live na tentativa $tentativa"; exit 0 ;;
        build_failed|update_failed|canceled|pre_deploy_failed)
          echo "deploy $DEPLOY_ID terminou como $status"; exit 1 ;;
      esac
      echo "status=$status ... ($tentativa/60)"; sleep 10
    done
    echo "deploy nao ficou live em 10 minutos"; exit 1
```

Só depois disso o health check tem sentido, porque só depois disso ele está
falando com a versão nova.

Note que o `case` distingue três situações: sucesso, falha terminal e "ainda
andando". Um laço que só testasse `!= live` gastaria os 10 minutos inteiros
esperando um deploy que já falhou no primeiro minuto.

### 10.5 `/health` não existe — **[extra]**

A aplicação expõe três sondas, e nenhuma delas se chama `/health`:

```
src/modules/health/health.routes.ts
  /health/live       liveness
  /health/ready      readiness — verifica PostgreSQL e MongoDB
  /health/startup    startup
```

`GET /health` responde 404. É o mesmo defeito do `PRD-01` no `render.yaml`,
replicado no CD.

**Correção:** `/health/ready`, que é a sonda certa para esta pergunta — ela
verifica as duas dependências e só responde 200 se ambas estiverem de pé.
Verificando também o corpo, não só o status:

```yaml
if curl -fsS "$BASE_URL/health/ready" | jq -e '.status == "ready"' >/dev/null; then
```

E o host deixou de ser literal: passou a vir de `vars.PRODUCTION_URL`, validado
no primeiro passo. URL de produção embutida direto em dois passos diferentes são
dois lugares para esquecer de mudar.

O smoke test seguinte tinha o mesmo tipo de problema: usava `$API_TOKEN`, uma
variável que nunca é definida em lugar nenhum do workflow. Ele testava a
autenticação do próprio script, não o contrato da API. Foi trocado por duas
asserções que não precisam de credencial:

```yaml
curl -fsS "$BASE_URL/docs/json" | jq -e '.openapi' >/dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/assets")" = "401"
```

A primeira confirma que o contrato OpenAPI está sendo servido. A segunda
confirma que a rota protegida **está protegida** — um 200 aqui seria uma falha
de autenticação em produção, e é justamente o que um smoke test deve pegar.

---

## 11. `trivy.yaml` vazio — **[extra]**

O arquivo tinha 0 bytes desde o commit inicial.

Arquivo de workflow vazio não é no-op: o Actions tenta carregá-lo, não encontra
`jobs`, e reporta o workflow como inválido na aba Actions. Um arquivo vazio
custa um erro permanente no repositório — a forma mais barata de não ter um
workflow é não ter o arquivo.

A decisão sobre o que colocar nele exigiu perguntar o que **ainda não estava
coberto**:

| Alvo | Já coberto por |
|---|---|
| Vulnerabilidade na imagem | `ci.yml`, job `docker` |
| Vulnerabilidade em dependência npm | Dependabot |
| Erro de código | CodeQL |
| **Misconfiguration de IaC** | **nada** |

Só a última linha justificava um workflow novo. `Dockerfile`, `docker-compose.yml`
e os manifestos de `infra/k8s/` não são analisados por nenhuma das três
ferramentas existentes.

**Correção:** um job só, com `scan-type: config`:

```yaml
on:
  pull_request:
    branches: [main]
    paths:
      - 'Dockerfile'
      - 'docker/**'
      - 'infra/**'
      - '.github/workflows/trivy.yaml'
  push:
    branches: [main]
  schedule:
    - cron: "0 4 * * 1"
  workflow_dispatch:
```

O filtro `paths` no `pull_request` evita rodar o scan em PR que não toca
infraestrutura. O `schedule` semanal existe porque a base de regras do Trivy
muda mesmo quando o repositório não muda — um manifesto correto hoje pode violar
uma regra nova em três meses, e sem execução periódica ninguém descobre até o
próximo PR de infra.

Assim como no `ci.yml`, `exit-code: "0"` e resultado via SARIF. O `category:
trivy-config` separa estes achados dos do `trivy-image` na aba Security.

---

## 12. Rastreabilidade com o catálogo

| ID | Descrição no catálogo | Situação |
|---|---|---|
| CI-01 | `actions/checkout@v2` | Corrigido (`@v4`) |
| CI-02 | `node-version: 18` contra `engines >=22` | Corrigido (`22`) |
| CI-03 | Sem `pnpm/action-setup` | Corrigido — e posicionado antes do `setup-node` |
| CI-04 | `cache: pnpm` antes do pnpm existir | Corrigido pela ordem dos passos |
| CI-05 | `pnpm-lock.yaml` no `.gitignore` | Corrigido — lockfile versionado |
| CI-06 | `working-directory: ./app` | Corrigido — removido |
| CI-07 | CodeQL sem `security-events: write` | Corrigido |
| CI-08 | `languages: typescript` | Corrigido (`javascript-typescript`) |
| CI-09 | Dependabot com `package-ecosystem: "pnpm"` | Corrigido (`npm`) |
| CI-10 | Dependabot com `directory: "/app"` | Corrigido (`/`) |
| CI-11 | CD com `secrets.RENDER_API_KEY` inexistente | Corrigido — validação prévia e `curl -f` |
| CI-12 | `needs: [lint]` sem job `lint` | Corrigido (`needs: [quality]`) |
| CI-13 | — | **Não existe no catálogo** |
| CI-14 | Trivy com `exit-code: 1` e severidade `UNKNOWN,LOW,...` | Corrigido — `HIGH,CRITICAL` via SARIF |
| CI-15 | `runs-on: ubuntu-latest-16core` | Corrigido (`ubuntu-latest`) |
| CI-16 | CodeQL com `paths-ignore: src/**` | Corrigido — removido |
| CI-17 | `environment: production-approved` inexistente | Corrigido (`production`) |
| CI-18 | Dependabot com `schedule` sem `interval` | Corrigido |

**17 IDs do catálogo, todos corrigidos.** A numeração salta o `CI-13`: ele não
está no `CATALOGO-DE-FALHAS.md`, e a contagem de 18 que o cabeçalho da tabela
sugere está errada por um.

Achados fora do catálogo, todos corrigidos:

| # | Achado | Seção |
|---|---|---|
| 1 | `jobs` aninhado dentro de `on` — workflow sem nenhum job | 4 |
| 2 | `steps` declarado dentro de `services` | 4.1 |
| 3 | `ports: - {5432:5432}` como flow mapping | 4.1 |
| 4 | `- name:` e `- uses:` como itens de lista distintos | 4.1 |
| 5 | Bloco `env:` órfão do `run:` que deveria consumi-lo | 4.1 |
| 6 | `actions/upload-artifact@v3` — versão retirada | 5.7 |
| 7 | `aquasecurity/trivy-action@master` — branch móvel | 5.7 |
| 8 | Sem `timeout-minutes` em nenhum job | 5.5 |
| 9 | `services:` com dois bancos que nenhum teste usa | 7 |
| 10 | `OTEL_TRACE` em vez de `OTEL_ENABLED` | 7 |
| 11 | URL do Mongo sem `authSource=admin` | 7 |
| 12 | CodeQL sem `category` — uploads de SARIF se sobrescrevem | 8.3 |
| 13 | Dependabot sem `groups` e sem `github-actions` | 9 |
| 14 | CD em `push: main`, paralelo ao CI | 10.3 |
| 15 | Health check antes de o rollout terminar | 10.4 |
| 16 | `/health` inexistente no CD | 10.5 |
| 17 | `$API_TOKEN` indefinido no smoke test | 10.5 |
| 18 | Segredos interpolados direto no `run:` | 10.1 |
| 19 | URL de produção literal em dois passos | 10.5 |
| 20 | `trivy.yaml` com 0 bytes | 11 |

**Total: 37 defeitos.**

---

## 13. Ordem de ataque

A ordem seguida, e por que cada passo precisou vir onde veio:

| # | Passo | Por quê |
|---|---|---|
| 1 | Reconstruir a árvore do `ci.yml` | Enquanto `jobs` estivesse dentro de `on`, nada abaixo era lido — o mesmo padrão de "o primeiro erro esconde os demais" da seção 3 do `CORRECOES-K8S.md` |
| 2 | Corrigir runner, `needs`, versões de action | Defeitos que impedem o workflow de ser agendado, antes dos que impedem passos de rodar |
| 3 | Ordenar `pnpm` antes de `setup-node` | Bloqueia toda a instalação de dependências |
| 4 | Versionar o `pnpm-lock.yaml` | `--frozen-lockfile` falha antes de qualquer teste |
| 5 | Remover `services:` e `working-directory` | Só depois de o install funcionar dá para ver o que a suíte realmente precisa |
| 6 | Validar com `pnpm typecheck && pnpm test:cov && pnpm build` | Confirmar que os comandos que o workflow invoca passam localmente, antes de confiar no runner |
| 7 | Preencher o `trivy.yaml` | Decidir o escopo exigia saber o que os outros três já cobriam |
| 8 | Endurecer o `cd.yml` | O gatilho `workflow_run` referencia o `ci.yml` pelo nome; corrigir o CD antes seria apontar para um workflow inválido |
| 9 | Escrever o `check-workflows.py` | O verificador nasceu dos defeitos encontrados; escrevê-lo antes teria produzido asserções adivinhadas |

O passo 9 merece nota. O verificador foi escrito **depois** e validado contra as
versões defeituosas — é a única forma de saber que ele pega o que precisa pegar.
Um linter escrito antes dos defeitos testa a imaginação de quem o escreveu.

---

## 14. Verificação

### 14.1 Forma dos workflows

```bash
python3 scripts/check-workflows.py
# esperado: "workflows: 4  jobs: 5" e "nenhum defeito estrutural"
```

Contra as versões do commit inicial, para confirmar que o verificador não é
decorativo:

```bash
mkdir -p /tmp/wf-head
for f in ci cd codeql; do git show f5eb66f:.github/workflows/$f.yml > /tmp/wf-head/$f.yml; done
git show f5eb66f:.github/workflows/trivy.yaml > /tmp/wf-head/trivy.yaml
python3 scripts/check-workflows.py /tmp/wf-head
```

Saída obtida:

```
workflows: 4  jobs: 4

[runner] ci.yml:build-test: runs-on 'ubuntu-latest-16core' nao e um runner hospedado — o job fica na fila indefinidamente
[ needs] ci.yml:docker: needs 'lint', que nao existe neste arquivo
[versao] ci.yml:docker: step 2 (Scan de vulnerabilidades): uses 'aquasecurity/trivy-action@master' fixado em branch movel — o passo muda sem que o repositorio mude
[ vazio] trivy.yaml: arquivo vazio — o Actions recusa o workflow

total: 4
```

E contra a versão com a árvore colapsada da seção 4:

```
workflows: 1  jobs: 0

[estrutura] ci.yml: sem 'jobs' no nivel raiz — chaves de topo: ['name', 'on']

total: 1
```

O mesmo arquivo passa por `yaml.safe_load` sem exceção. É a demonstração da
seção 1.1.

### 14.2 Os comandos que o CI invoca

```bash
pnpm install --frozen-lockfile   # valida CI-05: exige o lockfile versionado
pnpm typecheck
pnpm test:cov
pnpm build
```

Resultado:

```
tsc --noEmit                      sem erros
Test Files  5 passed (5)
     Tests  26 passed (26)
  Duration  3.21s
tsc -p tsconfig.build.json        dist/server.js gerado
```

`pnpm install --frozen-lockfile` é o teste direto do `CI-05`: antes da correção
ele falharia num clone limpo por lockfile ausente.

### 14.3 Rotas que o CD consulta

```bash
grep -rn "'/health\|'/docs\|'/assets" src/ --include=*.ts
# confirma /health/live, /health/ready, /health/startup, routePrefix /docs, /assets
```

O `.status == "ready"` que o health check espera vem de
`src/modules/health/health.routes.ts`, que responde `'ready'` com 200 e
`'degraded'` com 503.

### 14.4 O que exige `push`

Nada acima executa um workflow. A verificação de execução real é o próprio
`push` da branch: o `ci.yml` dispara em `fix/**`, então o primeiro push exercita
`quality` e `docker` sem depender de PR. O `cd.yml` só se exercita em `main`,
e nem lá sem `RENDER_API_KEY`, `RENDER_SERVICE_ID` e `PRODUCTION_URL`
configurados.

---

## 15. Conceitos para reler

Resumo do que este documento ensina, destacado do contexto específico.

| Conceito | Onde apareceu |
|---|---|
| Parse bem-sucedido não é validação: indentação errada produz outra árvore, igualmente válida | Seções 1.1, 4 |
| A única detecção possível é assertar a forma esperada, não a ausência de exceção | Seção 1.1 |
| `on` sem aspas vira o booleano `True` em YAML 1.1 — todo verificador precisa aceitar as duas formas | Seção 4 |
| `needs` órfão invalida o workflow inteiro, não só o job que o declara | Seção 5.4 |
| Runner com label inexistente não falha: fica na fila até o timeout | Seção 5.5 |
| `pnpm/action-setup` vem **antes** do `setup-node`, porque quem precisa do binário é a etapa de cache | Seção 5.1 |
| `--frozen-lockfile` pressupõe lockfile versionado — a flag da reprodutibilidade é a que quebra sem ele | Seção 6 |
| Aplicação versiona lockfile; biblioteca publicada não | Seção 6 |
| Scanner com `exit-code: 1` e severidade baixa é sinal permanentemente vermelho, que se aprende a ignorar | Seção 5.6 |
| Achado de segurança pertence ao Security tab com histórico, não a um gate binário de merge | Seções 5.6, 11 |
| Uploads de SARIF sem `category` se sobrescrevem | Seção 8.3 |
| Input desconhecido em `uses:` gera aviso e é descartado — configuração não aplicada é indistinguível de ausente | Seção 8.3 |
| `${{ secrets.X }}` inexistente interpola string vazia, não erro | Seção 10.1 |
| Segredo de environment só existe se o nome do environment casar | Seção 10.2 |
| `curl` sem `--fail` retorna 0 em 4xx e 5xx: para ele, 401 é resposta bem-sucedida | Seção 10.1 |
| `${VAR:?msg}` converte segredo ausente em falha imediata e legível | Seção 10.1 |
| `${{ }}` em `run:` é substituição textual pré-shell; `env:` não passa pelo parser | Seção 10.1 |
| `workflow_run` dispara em `completed`, o que inclui `failure` — o `if` de `conclusion` é obrigatório | Seção 10.3 |
| Health check que não espera o rollout valida a versão antiga; zero-downtime torna o falso positivo convincente | Seção 10.4 |
| Laço de espera precisa distinguir sucesso, falha terminal e "ainda andando" | Seção 10.4 |
| Configuração de bot inválida não degrada — desliga, e reporta onde ninguém olha | Seção 9 |
| Arquivo de workflow vazio é erro permanente, não no-op | Seção 11 |
| Action em `@master` muda sem o repositório mudar — fixar versão exige bot que proponha as atualizações | Seções 5.7, 9 |
| `services:` que nenhum teste usa carrega configuração própria que ninguém valida | Seção 7 |
| Linter escrito antes dos defeitos testa a imaginação de quem o escreveu | Seção 13 |

---

## 16. O que ficou de fora

| Item | Motivo |
|---|---|
| **Execução real dos workflows** | Um workflow só executa quando o GitHub o executa. Tudo aqui foi verificado estaticamente e pelos comandos locais da seção 14. A prova de que o `quality` passa no runner é o primeiro push desta branch. |
| **`actionlint`** | Não disponível no ambiente. `scripts/check-workflows.py` cobre a classe de defeito encontrada, não o conjunto que o `actionlint` cobre — em especial, ele não valida expressões `${{ }}`, contextos disponíveis por gatilho, nem shellcheck nos blocos `run:`. Quando estiver disponível, é a ferramenta preferida. |
| **Job de lint** | O projeto não tem linter configurado nem script de lint. Adicionar um aqui seria escolher regras de estilo que ninguém combinou. O `typecheck` cobre o que é verificável sem essa decisão. |
| **Gate de cobertura** | `pnpm test:cov` gera o relatório e o publica como artifact; nada falha por cobertura baixa. Definir o limiar exige decidir o número, e o número tem dono. |
| **`render.yaml`** | Camada PRODUÇÃO, `PRD-01..06`, intacta. O `cd.yml` corrigido consulta `/health/ready`, mas o `healthCheckPath` do próprio Render continua em `/health` (`PRD-01`) — os dois precisam ser corrigidos juntos para o deploy funcionar de ponta a ponta. |
| **`GITHUB_SHA` sob `workflow_run`** | O `checkout` do CD pega o head do branch padrão, não o SHA que disparou o CI. Para deploy a partir de `main` isso é equivalente na prática, mas deixa de ser se o CD passar a rodar para outros branches. |
| **Environments e segredos** | `production` precisa existir no repositório, com `RENDER_API_KEY` e `RENDER_SERVICE_ID` como secrets e `PRODUCTION_URL` como variable. É configuração de interface, fora do repositório. O primeiro passo do CD falha com mensagem nomeando o que faltar. |
| **Assinatura e proveniência de imagem** | `cosign`, atestação SLSA e `provenance` no `build-push-action` não entraram. O `ci.yml` constrói com `push: false` — não há registry para onde publicar, e sem publicação a assinatura não tem consumidor. |

---

## 17. Índice de arquivos alterados

```
.github/workflows/ci.yml       reescrito
.github/workflows/cd.yml       modificado
.github/workflows/codeql.yml   modificado
.github/workflows/trivy.yaml   preenchido (estava com 0 bytes)
.github/dependabot.yml         modificado
.gitignore                     modificado (removida a linha pnpm-lock.yaml)
pnpm-lock.yaml                 versionado
scripts/check-workflows.py     novo
docs/CORRECOES-CI-CD.md        novo
```

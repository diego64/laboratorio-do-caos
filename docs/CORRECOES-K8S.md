# Auditoria da Camada Kubernetes

Documentação técnica da verificação dos manifestos em `infra/k8s/`: o que foi
examinado, o que está quebrado, **por que** cada coisa quebra, e qual correção
cada defeito pede.

> **Estado: correções aplicadas e validadas em cluster real.**
> A auditoria da seção 4 em diante descreve os defeitos como foram encontrados;
> a [seção 15](#15-aplicação-e-validação-em-cluster) registra a correção de cada
> um e a prova de funcionamento num cluster `kind` descartável. O companheiro
> deste documento é [`CORRECOES-DOCKER.md`](./CORRECOES-DOCKER.md).

Cada achado referencia o ID de [`CATALOGO-DE-FALHAS.md`](./CATALOGO-DE-FALHAS.md)
quando corresponde a uma falha semeada. Achados sem ID são defeitos reais
encontrados fora do catálogo.

---

## 1. Método

Manifestos não se validam por leitura. A auditoria seguiu três camadas, da mais
barata para a mais cara:

| Camada | Ferramenta | Pega o quê |
|---|---|---|
| Sintaxe e montagem | `kubectl kustomize` | YAML inválido, arquivo ausente, overlay que não resolve |
| Schema | `kubectl apply --dry-run` | Campo desconhecido, tipo errado, campo obrigatório ausente |
| Referência cruzada | script próprio | Nome que aponta para recurso inexistente — o que schema nenhum pega |

A terceira camada é a que mais rendeu. Um `secretKeyRef` apontando para uma chave
que não existe é **YAML perfeitamente válido e schema perfeitamente correto** — só
quebra quando o kubelet tenta criar o container. Nenhum linter genérico pega isso,
porque exige resolver referências entre documentos diferentes.

O verificador ficou em `scripts/check-k8s-refs.py`. Ele renderiza o kustomize, carrega
todos os documentos e resolve:

- `secretKeyRef` e `configMapRef` contra os Secrets e ConfigMaps existentes
- `backend.service.name` do Ingress contra os Services existentes
- `selector` de Service contra os labels dos pod templates
- `scaleTargetRef` do HPA contra os Deployments
- `serviceAccountName` contra as ServiceAccounts
- presença de `spec` no PDB e posição de `automountServiceAccountToken`
- conformidade com Pod Security Admission `restricted`
- credencial com valor literal fora de Secret

### 1.1 Nota sobre validação de campo desconhecido

Detalhe que muda como dois dos achados se manifestam. O `kubectl` 1.33 usa
`--validate=strict` por padrão:

```
--validate='strict':
  "true" or "strict" will use a schema to validate the input and fail the request
  "false" or "ignore" will not perform any schema validation, silently dropping
  any unknown or duplicate fields
```

Ou seja, um campo colocado no lugar errado tem **dois destinos possíveis**:

- com validação estrita (padrão): a request **falha** com erro de decodificação
- com `--validate=false`, ou em pipelines antigos: o campo é **descartado em
  silêncio** e o recurso é criado sem ele

O segundo caso é o perigoso, porque produz um recurso que parece certo no arquivo
e está errado no cluster. Os achados 9 e 10 deste documento são exatamente disso.

---

## 2. Inventário

```
infra/k8s/
├── kind-cluster.yaml               configuração do cluster local
├── base/
│   ├── namespace.yaml              chaos-lab, com PSA restricted
│   ├── serviceaccount.yaml         SA da API
│   ├── secret.yaml                 URLs de banco e segredos
│   ├── configmap.yaml              configuração não sensível
│   ├── deployment.yaml             API + initContainer de migration
│   ├── service.yaml                ClusterIP da API
│   ├── ingress.yaml                entrada via nginx
│   ├── networkpolicy.yaml          egress restrito
│   ├── statefulset-mongo.yaml      Mongo + 2 Services
│   ├── pdb.yml                     PodDisruptionBudget
│   ├── hpa.yaml                    autoscaler de CPU
│   └── kustomization.yaml          montagem da base
└── overlays/local/
    └── kustomization.yaml          ajustes para o kind
```

13 recursos renderizados a partir de 12 arquivos.

Depois das correções (seção 15) o inventário passou a ter três arquivos novos —
`pdb.yaml` no lugar de `pdb.yml`, `statefulset-postgres.yaml` e
`initdb/00-init-mongo.js` — e o build passou a render 19 recursos.

---

## 3. O bloqueio que esconde todo o resto

```
$ kubectl kustomize infra/k8s/base
error: accumulating resources from 'pdb.yaml':
lstat .../base/pdb.yaml: no such file or directory
```

**`kustomization.yaml` lista `pdb.yaml`. O arquivo no disco é `pdb.yml`.**
`K8S-16`.

### Por que isso importa mais do que parece

O Kustomize é um **acumulador**, não um aplicador incremental. Ele lê a lista de
`resources`, carrega cada um, aplica as transformações e só então emite o
resultado. Se qualquer item da lista falhar ao carregar, ele aborta a acumulação
inteira — não emite nada, nem os 11 recursos que estavam perfeitos.

O efeito prático é que **um erro de uma letra torna todos os outros defeitos
invisíveis**. Você conserta o `pdb.yml`, roda de novo, e descobre o próximo. É a
razão de a auditoria ter precisado de uma cópia em scratchpad com o arquivo
renomeado: sem destravar o primeiro, não há como enxergar os outros sete.

Esse é o padrão de diagnóstico que vale memorizar: **quando uma ferramenta de
montagem falha, o erro que ela mostra raramente é o único — é apenas o primeiro
em ordem de leitura.** Destrave numa cópia descartável e continue, em vez de
consertar um, rodar, consertar outro, no repositório de verdade.

### Correção

Renomear `pdb.yml` para `pdb.yaml`. Alinhar a extensão com o resto do diretório
(todos os outros usam `.yaml`) é preferível a mudar a referência no
`kustomization.yaml`, porque a inconsistência de extensão é que gera o erro na
próxima vez também.

---

## 4. Referências quebradas

Estas são as que só aparecem quando algo tenta resolver o nome.

### 4.1 O container busca uma chave que o Secret não tem

```
Deployment/chaos-lab-api container=api: env MONGO_URL -> chave 'mongo-url'
ausente no Secret 'chaos-lab-secrets' (tem: hmac-secret, jwt-secret,
mongodb-url, postgres-url)
```

`K8S-03`.

O Secret define `mongodb-url`. O container principal pede `mongo-url`. E o detalhe
que torna isso didático: **o initContainer do mesmo Deployment pede
`mongodb-url`, o nome certo.** Os dois containers, no mesmo arquivo, discordam.

```yaml
# initContainer — correto
- name: MONGO_URL
  valueFrom:
    secretKeyRef: { name: chaos-lab-secrets, key: mongodb-url }

# container api — quebrado
- name: MONGO_URL
  valueFrom:
    secretKeyRef: { name: chaos-lab-secrets, key: mongo-url }
```

**Sintoma no cluster:** `CreateContainerConfigError`. Note que **não** é
`CrashLoopBackOff` — o container nem chega a iniciar. O kubelet falha ao montar o
ambiente antes de executar qualquer coisa, então `kubectl logs` não retorna nada
útil e o diagnóstico só aparece em `kubectl describe pod`.

Distinguir esses dois estados economiza muito tempo:

| Estado | Significa | Onde olhar |
|---|---|---|
| `CreateContainerConfigError` | O kubelet não conseguiu montar config/secret/volume | `kubectl describe pod` |
| `CrashLoopBackOff` | O container iniciou e o processo morreu | `kubectl logs --previous` |
| `ImagePullBackOff` | A imagem não foi encontrada ou não há credencial | `kubectl describe pod` |
| `Pending` | O scheduler não achou nó | `kubectl describe pod`, seção Events |

**Correção:** trocar `mongo-url` por `mongodb-url` no container `api`.

### 4.2 O Ingress aponta para um Service que não existe

```
Ingress/chaos-lab-api: backend 'chaos-lab-api' nao existe
(services: chaos-lab-service, mongo, mongo-headless)
```

`K8S-04` (variante: o catálogo descreve divergência de selector; aqui é o nome).

O Service chama-se `chaos-lab-service`; o Ingress procura `chaos-lab-api`.

**Conceito por trás — a cadeia de quatro elos.** Tráfego HTTP externo atravessa:

```mermaid
flowchart LR
  A[Ingress] -->|backend.service.name| B[Service]
  B -->|selector = labels| C[EndpointSlice]
  C -->|só pods Ready| D[Pod]
```

Cada seta é uma resolução por nome ou por label, e **cada uma falha em silêncio**,
retornando 503 sem dizer qual elo quebrou. O sintoma é idêntico se:

- o Ingress aponta para um Service inexistente (este caso)
- o Service tem selector que não casa com nenhum pod
- os pods existem mas nenhum está `Ready`

Por isso o diagnóstico de 503 sempre começa por `kubectl get endpointslices`: se
não há endpoint, o problema está do Service para baixo; se há endpoint e ainda dá
503, está do Ingress para o Service.

**Correção:** renomear o Service para `chaos-lab-api`, e não mudar o Ingress. O
sufixo `-service` no nome é redundante — o `kind` já diz o que o recurso é, e o
padrão do projeto (`chaos-lab-api` no Deployment, na SA e no PDB) é o nome nu.
Renomear o Service alinha os cinco recursos num nome só.

### 4.3 Não existe workload de Postgres

Achado fora do catálogo, e o mais grave.

O `Secret` define `postgres-url`. O `NetworkPolicy` libera egress na porta 5432. O
initContainer roda migration contra o Postgres. **E não há nenhum Deployment ou
StatefulSet de Postgres nos manifestos.** Só o Mongo tem workload.

**Por que isso derruba tudo, e não só o Postgres.** O `/health/ready` da aplicação
exige as duas dependências:

```javascript
const pronto = postgresOk && mongoOk;
const status = pronto ? 200 : (503 as const);
```

E o `readinessProbe` do Deployment aponta para `/health/ready`. A cascata:

1. Postgres não existe → `postgresOk = false`
2. `/health/ready` responde 503
3. readinessProbe falha → o pod nunca fica `Ready`
4. pod não-`Ready` é **removido do EndpointSlice** do Service
5. Service sem endpoints → Ingress devolve 503

Ou seja: **mesmo corrigindo os achados 4.1 e 4.2, a aplicação continua
inacessível.** O sintoma final (503 no Ingress) é idêntico ao de um Ingress
malconfigurado, o que torna esse defeito especialmente traiçoeiro — você conserta
o Ingress, o sintoma não muda, e conclui que a correção não funcionou.

Aqui está a diferença conceitual entre as duas probes, que é a raiz disso:

| Probe | Falha significa | Ação do kubelet |
|---|---|---|
| `livenessProbe` | O processo travou | **Reinicia** o container |
| `readinessProbe` | Não está apto a receber tráfego agora | **Remove** do Service, não reinicia |
| `startupProbe` | Ainda subindo | Suspende as outras duas até passar |

Um readiness que depende de serviço externo é uma decisão deliberada: significa
"me tire do balanceador enquanto minha dependência estiver fora". É correto para
esta aplicação. Mas implica que **toda dependência declarada precisa existir no
cluster**, senão nada fica pronto.

**Correção:** adicionar `statefulset-postgres.yaml` espelhando o do Mongo —
StatefulSet com `volumeClaimTemplates`, Service headless, credenciais vindas do
Secret, probes com `pg_isready`. E acrescentá-lo ao `kustomization.yaml`.

---

## 5. A falha silenciosa

### 5.1 O patch do overlay não casa com nada

O `overlays/local/kustomization.yaml` tem dois patches:

```yaml
- target: { kind: Deployment, name: chaos-lab-api }    # casa
  patch: replicas -> 1
- target: { kind: HorizontalPodAutoscaler, name: chaos-lab-api }   # NÃO casa
  patch: maxReplicas -> 1
```

O HPA se chama **`chaos-lab-hpa`**, não `chaos-lab-api`. `K8S-20`.

**E o kustomize não reclama.** Evidência direta:

```
$ kubectl kustomize overlays/local | grep -E "name:|maxReplicas|minReplicas"
  name: chaos-lab-hpa
  maxReplicas: 10        <- o patch queria 1
  minReplicas: 2
```

O build **passa**, o resultado sai, e o `maxReplicas` continua 10. O patch do
Deployment funcionou (`replicas: 1`); o do HPA evaporou.

**Conceito.** No campo `patches` do Kustomize, um `target` que não casa com nenhum
recurso é **ignorado sem erro**. A semântica é de seletor, não de referência: "para
todos os recursos que casarem com isto, aplique". Zero recursos casando é um
resultado válido, do mesmo jeito que um `grep` sem resultado não é erro.

Esse é o pior tipo de defeito de configuração: o arquivo declara uma intenção, a
ferramenta reporta sucesso, e a intenção não acontece. Não há sintoma até alguém
notar que o ambiente local está escalando para 10 réplicas.

**Como se defender disso:** o Kustomize tem `patches[].target.options` limitados,
mas a checagem confiável é comparar a saída renderizada com o esperado —
exatamente o que fizemos. Em CI, `kubectl kustomize overlays/local | grep
maxReplicas` valendo 1 é um teste de uma linha que teria pego isso.

**Correção:** trocar o `name` do target para `chaos-lab-hpa`.

Mas atenção a um segundo problema escondido atrás do primeiro: o base declara
`minReplicas: 2`. Se o patch passar a funcionar com `maxReplicas: 1`, o HPA fica
com `maxReplicas < minReplicas`, que o API server **rejeita**. A correção completa
precisa patchear os dois campos:

```yaml
- op: replace
  path: /spec/minReplicas
  value: 1
- op: replace
  path: /spec/maxReplicas
  value: 1
```

Consertar o alvo do patch sem isso troca um defeito silencioso por um erro de
aplicação. Vale como lembrete: **um defeito que mascara outro é comum, e a
correção do primeiro precisa antecipar o segundo.**

---

## 6. Defeitos de posicionamento de campo

Os dois achados que a nota da seção 1.1 antecipa.

### 6.1 O `spec` do PDB está dentro do `metadata`

```yaml
# pdb.yml — como está
metadata:
    name: chaos-lab-api
    namespace: chaos-lab
    spec:                       # <- indentado dentro de metadata
      maxUnavailable: 1
      selector:
        matchLabels:
          app.kubernetes.io/name: chaos-lab-api
```

O `spec` é irmão de `metadata`, não filho. O renderizado confirma que o kustomize
repassa como está — ele não valida schema:

```
kind: PodDisruptionBudget
metadata:
  name: chaos-lab-api
  namespace: chaos-lab
  spec:                          <- ainda dentro de metadata
    maxUnavailable: 1
```

**Os dois destinos possíveis:**

- validação estrita (padrão do kubectl 1.33): erro de decodificação, campo
  desconhecido `metadata.spec` — a aplicação falha
- validação desligada: o campo é descartado, e você fica com um **PDB sem spec e
  sem selector, que não protege pod nenhum** — enquanto o `kubectl get pdb`
  mostra o recurso lá, existindo, dando a impressão de proteção

**Conceito — o que um PDB faz.** Ele só atua em **despejo voluntário**
(`kubectl drain`, upgrade de nó, autoscaler removendo nó). Não protege contra
crash, OOM, delete direto ou falha de hardware. Um PDB com `maxUnavailable: 1`
diz ao drain: "espere até que derrubar mais este pod não deixe mais de 1
indisponível". Um PDB sem selector não fala de pod nenhum, e o drain passa reto.

Um defeito assim só se manifesta no dia do upgrade do cluster, que é o pior dia
possível para descobri-lo.

**Correção:** desindentar o `spec` para o nível raiz e renomear o arquivo para
`.yaml` (achado da seção 3, mesmo arquivo).

### 6.2 `automountServiceAccountToken` no lugar errado

```yaml
# serviceaccount.yaml — como está
apiVersion: v1
kind: ServiceAccount
metadata:
    name: chaos-lab-api
    namespace: chaos-lab-api                 # <- namespace errado
    automountServiceAccountToken: false      # <- campo de nível raiz
```

Dois defeitos num arquivo de cinco linhas.

**O campo.** `automountServiceAccountToken` é campo de nível raiz do
ServiceAccount (irmão de `metadata`), e também existe no `PodSpec`. Dentro de
`metadata` ele é desconhecido — mesmos dois destinos da seção 6.1. No caminho
silencioso, o resultado é que **o token É montado**, exatamente o oposto do que o
arquivo declara.

**Por que isso é uma falha de segurança e não só um detalhe.** Todo pod que monta
o token do ServiceAccount recebe em
`/var/run/secrets/kubernetes.io/serviceaccount/token` uma credencial válida para
falar com o API server. Se um atacante conseguir execução de código dentro do
container — via SSRF, deserialização, qualquer coisa — ele ganha aquele token e
pode consultar o que a SA puder consultar. Uma aplicação HTTP que nunca fala com
o API server não tem motivo para carregar essa credencial.

O princípio: **desmontar o que não se usa é mais barato do que restringir o que se
montou.** Não há RBAC a escrever, não há Role a auditar — a credencial
simplesmente não está lá.

**Defesa em profundidade:** o campo pode ser negado nos dois níveis. No
ServiceAccount ele vale para todo pod que a usar; no `PodSpec` ele vence o da SA.
Declarar nos dois é redundante de propósito — se alguém corrigir um e esquecer o
outro, ainda fica negado.

**O namespace.** `namespace: chaos-lab-api` aponta para um namespace que não
existe (o namespace é `chaos-lab`; `chaos-lab-api` é o nome da *aplicação*). Hoje
isso passa despercebido porque o `kustomization.yaml` declara `namespace:
chaos-lab` e o Kustomize **sobrescreve o campo em todos os recursos**. O arquivo
está errado e o resultado sai certo.

É outro padrão que vale reconhecer: **um erro mascarado por uma transformação da
ferramenta.** Aplique esse arquivo sozinho, com `kubectl apply -f`, e ele falha.
A correção é remover o `namespace` do arquivo — quando o kustomize já o injeta,
declará-lo é duplicação que pode divergir.

**Correção:**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: chaos-lab-api
automountServiceAccountToken: false
```

E no `PodSpec` do Deployment, a redundância deliberada:

```yaml
spec:
  serviceAccountName: chaos-lab-api
  automountServiceAccountToken: false
```

---

## 7. Configuração que erra em silêncio

### 7.1 `OTL_ENABLED` em vez de `OTEL_ENABLED`

```yaml
# configmap.yaml
OTL_ENABLED: "true"        # a aplicação lê OTEL_ENABLED
```

`K8S-13`.

O ConfigMap é injetado via `envFrom`, que **não valida nada** — ele despeja todas
as chaves como variáveis de ambiente. A aplicação procura `OTEL_ENABLED`, não
acha, e usa o default. `OTL_ENABLED` fica lá, ocupando espaço, sem ninguém ler.

**Conceito.** Variável de ambiente com nome errado é indetectável por definição:
não existe schema de ambiente. As duas defesas possíveis são do lado da
aplicação, não do manifesto:

- **validação estrita no boot** — é o que `src/config/env.ts` faz com Zod para as
  variáveis obrigatórias, e é por isso que `JWT_SECRET` ausente derruba o processo
  na hora em vez de causar comportamento estranho depois
- **rejeitar variável desconhecida** com o prefixo esperado, que quase ninguém faz

Nota que `OTEL_ENABLED` tem default `true` e é opcional, então a validação Zod não
pega. O defeito sobrevive justamente porque a variável é opcional. **Configuração
opcional é onde typo mora**, porque a obrigatória falha alto no primeiro boot.

**Correção:** `OTEL_ENABLED: "true"`.

### 7.2 As URLs do Secret apontam para `localhost`

```yaml
postgres-url: "postgresql://chaos:chaos@localhost:5432/laboratoriodocaos"
mongodb-url: "mongodb://chaos:chaos@localhost:27017/chaoslab?authSource=chaoslab"
```

Achado fora do catálogo, mas irmão gêmeo do `ENV-02` da camada Docker.

**Conceito — o que `localhost` significa dentro de um pod.** Todo container de um
pod compartilha o mesmo network namespace. `localhost` é o **próprio pod**, não o
nó e não o cluster. Um pod da API chamando `localhost:5432` está tentando falar
consigo mesmo, e recebe `ECONNREFUSED`.

O endereço correto é o DNS do Service. O CoreDNS resolve, dentro do namespace:

```
postgres                              -> mesmo namespace
postgres.chaos-lab                    -> namespace explícito
postgres.chaos-lab.svc.cluster.local  -> FQDN
```

Essa é a mesma classe de erro do `OBS-01` (Prometheus raspando `localhost:3000`
em vez de `api:3000`) e do `ENV-02`. Aparece três vezes no laboratório, em três
camadas, porque é o erro mais comum ao portar configuração de máquina local para
ambiente orquestrado: **`localhost` funciona no seu terminal e significa outra
coisa dentro do container.**

**Correção:** trocar por `postgres:5432` e `mongo:27017` — os nomes dos Services.

E uma observação sobre o Secret em si: ele está em texto plano no git. Para um
laboratório, tudo bem, e o próprio catálogo trata isso como parte do exercício.
Para qualquer coisa real, o caminho é Sealed Secrets, External Secrets Operator
ou SOPS — o manifesto guarda a referência ou o valor cifrado, nunca o segredo.

---

## 8. Segurança e resiliência do Mongo

O `StatefulSet` do Mongo acumula quatro problemas, todos fora do catálogo.

```
StatefulSet/mongo: sem serviceAccountName (usa a default)
StatefulSet/mongo container=mongo: sem livenessProbe
StatefulSet/mongo container=mongo: sem readinessProbe
StatefulSet/mongo container=mongo: MONGO_INITDB_ROOT_PASSWORD com valor literal
```

### 8.1 Sem probes

```yaml
containers:
  - name: mongo
    image: mongo:7
    # nenhuma probe
```

**Consequência sem readiness:** o pod é marcado `Ready` assim que o container
inicia, muito antes de o `mongod` aceitar conexão. O Service passa a rotear para
ele imediatamente, e a API recebe `connection refused` durante os primeiros
segundos de cada rollout.

**Consequência sem liveness:** se o `mongod` travar sem morrer — deadlock, disco
cheio, corrupção — o container continua "rodando" para o kubelet e nunca é
reiniciado. Precisa de intervenção manual.

**Correção proposta:**

```yaml
readinessProbe:
  exec:
    command: ["mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]
  initialDelaySeconds: 10
  periodSeconds: 5
livenessProbe:
  exec:
    command: ["mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]
  initialDelaySeconds: 30
  periodSeconds: 15
  failureThreshold: 3
```

Repare que é o **mesmo comando** do healthcheck do compose — consistência entre
ambientes vale mais do que sofisticação. E note os tempos diferentes: liveness com
`initialDelaySeconds` maior e `failureThreshold` folgado, porque **liveness
agressiva causa reinício em loop sob carga**, que é pior do que a doença.

### 8.2 Senha literal no manifesto

```yaml
env:
  - { name: MONGO_INITDB_ROOT_USERNAME, value: chaos }
  - { name: MONGO_INITDB_ROOT_PASSWORD, value: chaos }
```

Além de ser credencial versionada, é **inconsistente com o resto**: a API já lê
tudo de `chaos-lab-secrets`. O Mongo devia ler do mesmo lugar.

Há também uma divergência de conteúdo. A URL no Secret usa `chaos:chaos` com
`authSource=chaoslab`, sugerindo um usuário de aplicação; o StatefulSet cria
`chaos` como **root**. São papéis diferentes com o mesmo nome. A camada Docker
resolveu isso separando `MONGO_INITDB_ROOT_*` de `MONGO_APP_*` (ver
`CORRECOES-DOCKER.md`, seção 6.2), e o K8s deveria espelhar essa separação.

### 8.3 ServiceAccount default

Sem `serviceAccountName`, o pod usa a SA `default` do namespace — que monta token
por padrão. Vale o mesmo raciocínio da seção 6.2, agravado: um banco de dados é
justamente o pod onde execução de código não autorizada custa mais caro.

**Correção:** SA dedicada `mongo`, com `automountServiceAccountToken: false`.

### 8.4 `mongo:7` contra `mongo:8` no compose

Não é defeito, é deriva. A camada Docker foi atualizada para `mongo:8`; o K8s
ficou em `mongo:7`. Ambientes que divergem em versão de banco produzem o clássico
"funciona no meu docker-compose".

---

## 9. Achados que dependem do cluster

### 9.1 HPA sem metrics-server

```yaml
metrics:
  - type: Resource
    resource: { name: cpu, target: { type: Utilization, averageUtilization: 50 } }
```

`K8S-11`. O `kind` **não instala metrics-server**.

**Conceito.** HPA do tipo `Resource` consulta a **Metrics API**
(`metrics.k8s.io`), que não é nativa do control plane — é servida por um
APIService agregado, o metrics-server. Sem ele, o HPA não consegue ler utilização
e reporta:

```
unable to get metrics for resource cpu: no metrics returned from resource metrics API
```

O HPA existe, aparece em `kubectl get hpa`, e mostra `<unknown>/50%` na coluna de
targets. **Ele não escala nada, e não emite erro em lugar nenhum além dos eventos
do próprio HPA.**

Não confundir com o **Prometheus Adapter**, que serve `custom.metrics.k8s.io` para
HPA baseado em métrica de aplicação. São dois componentes distintos para dois
tipos de métrica.

**Correção:** instalar metrics-server no kind, com `--kubelet-insecure-tls` (o
kind usa certificado auto-assinado no kubelet):

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

Alternativa mais barata para laboratório: remover o HPA do overlay local. Com
`replicas: 1` fixo, o HPA não tem função ali.

### 9.2 `enforce-version: latest`

```yaml
pod-security.kubernetes.io/enforce: restricted
pod-security.kubernetes.io/enforce-version: latest
```

**Conceito.** O Pod Security Admission versiona seus próprios perfis. `restricted`
na 1.29 e `restricted` na 1.33 não exigem exatamente as mesmas coisas — requisitos
novos entram a cada versão. Com `latest`, seus pods passam a ser avaliados por um
padrão mais rígido **no dia em que o cluster for atualizado**, sem que nenhum
arquivo seu mude.

Um workload que aplicava ontem passa a ser rejeitado hoje, e o `git log` do
repositório não tem nenhuma pista.

**Correção:** fixar a versão, `enforce-version: v1.33`, e subir deliberadamente
junto com o upgrade do cluster.

---

## 10. O que está correto

Vale registrar, tanto porque é a maior parte quanto porque são os padrões a manter.

**Segurança do pod da API** — passa em PSA `restricted` sem exceção:

```yaml
securityContext:              # nível do pod
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000
  seccompProfile: { type: RuntimeDefault }
# nível do container
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: ["ALL"] }
```

O `restricted` exige os cinco: `runAsNonRoot`, `allowPrivilegeEscalation: false`,
`capabilities.drop: [ALL]`, `seccompProfile` `RuntimeDefault` ou `Localhost`, e
ausência de volume de host. Todos presentes.

E o detalhe que costuma faltar: `readOnlyRootFilesystem: true` **com um `emptyDir`
montado em `/tmp`**. Raiz somente-leitura sem lugar para escrever quebra qualquer
runtime que precise de arquivo temporário — é o `K8S-07` do catálogo, aqui já
corrigido. O par "raiz read-only + emptyDir no que precisa de escrita" é o padrão
a copiar.

**Probes da API** — as três, nos paths que a aplicação realmente expõe, com
`startupProbe` de `failureThreshold: 30` e `periodSeconds: 2`, dando 60 segundos
de folga para o boot sem afrouxar a liveness depois. É exatamente para isso que a
startupProbe existe: separar "está demorando para subir" de "travou".

**NetworkPolicy** — DNS declarado primeiro, com comentário explicando por quê:

```yaml
# DNS - Precisa ser o primeiro pois sem isto, nada resolve
```

O comentário está certo e o `K8S-10` está corrigido. Uma NetworkPolicy de
default-deny egress que esquece a porta 53 para o `kube-dns` quebra **toda
resolução de nome** do pod, e o sintoma (`EAI_AGAIN`, `getaddrinfo failed`) não
aponta para a policy.

Um detalhe a observar: o recurso se chama `default-deny-egress` e declara
`policyTypes: [Egress]` apenas. **Não há política de ingress**, então todo tráfego
de entrada é permitido. Isso é coerente com o nome, mas quem lê "default-deny"
rápido pode presumir proteção nos dois sentidos.

**Outros acertos:** `ingressClassName: nginx` (`K8S-12`), `extraPortMappings` no
kind (`K8S-01`), Service headless declarado e batendo com `serviceName` do
StatefulSet (`K8S-15`), `storageClassName: standard` que é o default real do kind
(`K8S-09`), `targetPort: http` **por nome** em vez de número — o que torna o
`K8S-19` impossível de reintroduzir, porque mudar a porta do container passa a
atualizar o Service automaticamente.

---

## 11. Rastreabilidade com o catálogo

| ID | Descrição no catálogo | Situação |
|---|---|---|
| K8S-01 | kind sem `extraPortMappings` | Corrigido |
| K8S-02 | Imagem local com `imagePullPolicy: Always` | Corrigido (`IfNotPresent`) |
| K8S-03 | Deployment busca chave que o Secret não define | **Ativo** — `mongo-url` vs `mongodb-url` |
| K8S-04 | Service/selector não resolve até o pod | **Ativo** — Ingress aponta para Service inexistente |
| K8S-05 | Liveness em `/healthz` com `failureThreshold: 1` | Corrigido |
| K8S-06 | `requests.memory: 8Gi` | Corrigido (`128Mi`) |
| K8S-07 | `readOnlyRootFilesystem` sem `emptyDir` em `/tmp` | Corrigido |
| K8S-08 | `runAsUser: 0` com PSA `restricted` | Corrigido |
| K8S-09 | `storageClassName: fast-ssd` | Corrigido (`standard`) |
| K8S-10 | NetworkPolicy sem egress para kube-dns | Corrigido |
| K8S-11 | HPA de resource metrics sem metrics-server | **Ativo** |
| K8S-12 | Ingress sem `ingressClassName` | Corrigido |
| K8S-13 | ConfigMap com chave de nome errado | **Ativo** — `OTL_ENABLED` |
| K8S-14 | initContainer sem o binário que invoca | **Ativo** — `tsx` e `scripts/` ausentes na imagem |
| K8S-15 | StatefulSet sem headless service | Corrigido |
| K8S-16 | `kustomization.yaml` listando arquivo inexistente | **Ativo** — `pdb.yaml` vs `pdb.yml` |
| K8S-17 | `nodeSelector` sem nó com a label | Corrigido/inócuo — nenhum manifesto usa `nodeSelector` |
| K8S-18 | `jwt-secret` com 10 caracteres | Corrigido (64 hex) |
| K8S-19 | `targetPort` divergente de `containerPort` | Corrigido (por nome) |
| K8S-20 | Overlay com patch em nome inexistente | **Ativo** — alvo `chaos-lab-api` vs `chaos-lab-hpa` |

**7 do catálogo ativos, 13 corrigidos.**

Achados fora do catálogo: ausência de workload Postgres, `spec` do PDB dentro de
`metadata`, `automountServiceAccountToken` dentro de `metadata`, namespace errado
na SA, URLs com `localhost`, Mongo sem probes, Mongo sem SA dedicada, senha
literal no Mongo, `enforce-version: latest`, deriva `mongo:7` vs `mongo:8`.

**Total: 17 defeitos** — todos corrigidos e validados na seção 15. A coluna
"situação" acima descreve o estado **no momento da auditoria**, que é o que dá
sentido às seções 3 a 9; para o estado atual, ver a tabela 15.1.

### 11.1 O `K8S-14` em detalhe

```yaml
initContainers:
  - name: migrate
    image: chaos-lab-api:1.0.0
    command: ["node", "dist/../node_modules/.bin/tsx", "scripts/migrate.ts"]
```

Três problemas empilhados:

1. `dist/../node_modules/.bin/tsx` é um caminho ofuscado para
   `node_modules/.bin/tsx`. O `dist/..` não faz nada além de dificultar a leitura.
2. **`tsx` é `devDependency`.** O estágio `prod-deps` do Dockerfile roda
   `pnpm install --frozen-lockfile --prod` — `tsx` não está na imagem.
3. **`scripts/` não é copiado para a imagem.** O estágio `release` copia
   `node_modules`, `dist` e `package.json`, nada mais.

O initContainer falha, e como initContainer que falha impede o pod de iniciar, o
sintoma é um pod eternamente em `Init:Error` / `Init:CrashLoopBackOff`.

**Correção proposta:** compilar a migration junto com a aplicação e invocar o
JavaScript já buildado:

```yaml
command: ["node", "dist/scripts/migrate.js"]
```

Isso exige que `tsconfig.build.json` inclua `scripts/`. A alternativa — instalar
`tsx` na imagem de produção — troca uma imagem de 69 MB por uma bem maior e
carrega um compilador para dentro do runtime, o que é justamente o que o
multi-stage build foi feito para evitar.

---

## 12. Ordem de ataque recomendada

A ordem importa porque os defeitos se mascaram. Corrigir fora de ordem faz você
consertar algo e não ver mudança nenhuma no sintoma.

1. **`pdb.yml` → `pdb.yaml`** e desindentar o `spec`. Sem isso nada renderiza e
   nenhum outro conserto é verificável.
2. **Adicionar o StatefulSet do Postgres.** É a lacuna estrutural: enquanto não
   existir, a readiness nunca passa e o Ingress devolve 503 independentemente de
   qualquer outra correção.
3. **`mongo-url` → `mongodb-url`** no container `api`. Sem isso o pod nem inicia.
4. **Renomear o Service** para `chaos-lab-api`, alinhando com o Ingress.
5. **`OTL_ENABLED` → `OTEL_ENABLED`** e as URLs do Secret para os nomes dos
   Services.
6. **ServiceAccount**: campo no nível raiz, remover o namespace, e negar o
   automount também no PodSpec.
7. **initContainer**: buildar `scripts/` e invocar o `.js`.
8. **Mongo**: probes, SA dedicada, credenciais do Secret, imagem para `:8`.
9. **Overlay**: alvo do patch para `chaos-lab-hpa`, patcheando `minReplicas` e
   `maxReplicas` juntos.
10. **metrics-server** no kind, ou remover o HPA do overlay local.
11. **`enforce-version`** fixado.

Os passos 1 a 4 são o caminho crítico até "a aplicação responde". Do 5 em diante é
correção de qualidade e segurança.

---

## 13. Verificação

### 13.1 Sem cluster

```bash
# renderiza? (pega arquivo ausente, YAML inválido, overlay que não resolve)
kubectl kustomize infra/k8s/base
kubectl kustomize infra/k8s/overlays/local

# o patch do overlay realmente aplicou? (pega o no-op silencioso)
kubectl kustomize infra/k8s/overlays/local | grep -E "maxReplicas|minReplicas"

# referências cruzadas
python3 scripts/check-k8s-refs.py infra/k8s/base

# schema, se houver cluster de teste disponível
kubectl apply --dry-run=server -k infra/k8s/overlays/local
```

`--dry-run=server` vale muito mais do que `--dry-run=client`: ele envia ao API
server, que aplica validação de schema completa, admission controllers e PSA. O
client-side só decodifica localmente.

### 13.2 Com cluster

```bash
kind create cluster --config infra/k8s/kind-cluster.yaml
kubectl apply -k infra/k8s/overlays/local

# o que realmente aconteceu
kubectl get pods -n chaos-lab -w
kubectl describe pod -n chaos-lab -l app.kubernetes.io/name=chaos-lab-api

# a cadeia Ingress -> Service -> EndpointSlice -> Pod
kubectl get endpointslices -n chaos-lab
kubectl get ingress -n chaos-lab

# o token foi montado, apesar do que a SA declara?
kubectl exec -n chaos-lab deploy/chaos-lab-api -- \
  ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1 || echo "sem token - correto"

# o PDB protege alguma coisa?
kubectl get pdb -n chaos-lab -o wide     # ALLOWED DISRUPTIONS deve refletir pods reais

# o HPA está lendo métrica?
kubectl get hpa -n chaos-lab             # <unknown>/50% = metrics-server ausente

# o que a SA pode fazer
kubectl auth can-i --list \
  --as=system:serviceaccount:chaos-lab:chaos-lab-api
```

O teste do token na lista acima é o único jeito confiável de confirmar o achado
6.2: o arquivo diz `false`, e só o cluster responde se o campo teve efeito.

---

## 14. Conceitos para reler

Resumo do que este documento ensina, destacado do contexto específico.

| Conceito | Onde apareceu |
|---|---|
| Kustomize aborta a acumulação inteira se um `resource` falhar — o primeiro erro esconde todos | Seção 3 |
| `patches` com `target` sem correspondência é ignorado **sem erro** | Seção 5.1 |
| Kustomize sobrescreve `namespace` em todos os recursos, mascarando erro no arquivo | Seção 6.2 |
| `CreateContainerConfigError` ≠ `CrashLoopBackOff` — um é o kubelet, outro é o processo | Seção 4.1 |
| Ingress → Service → EndpointSlice → Pod: quatro elos, todos falham com o mesmo 503 | Seção 4.2 |
| Readiness remove do balanceador; liveness reinicia; startup suspende as duas | Seção 4.3 |
| Readiness dependente de serviço externo exige que a dependência exista no cluster | Seção 4.3 |
| Campo em posição errada: falha na validação estrita, some em silêncio sem ela | Seções 1.1, 6.1, 6.2 |
| PDB só atua em despejo **voluntário** — não protege contra crash nem delete | Seção 6.1 |
| Token da SA é credencial para o API server; não montar é mais barato que restringir | Seção 6.2 |
| `localhost` dentro de um pod é o próprio pod, não o nó nem o cluster | Seção 7.2 |
| Configuração **opcional** é onde typo sobrevive — a obrigatória falha no boot | Seção 7.1 |
| Liveness agressiva causa reinício em loop, pior que a falha original | Seção 8.1 |
| HPA `Resource` precisa de metrics-server; HPA de métrica custom precisa de adapter | Seção 9.1 |
| PSA versiona os perfis: `enforce-version: latest` muda o critério no upgrade | Seção 9.2 |
| `readOnlyRootFilesystem` exige `emptyDir` no que precisa escrever | Seção 10 |
| `targetPort` por **nome** torna divergência de porta impossível de reintroduzir | Seção 10 |
| Um defeito que mascara outro: a correção do primeiro precisa antecipar o segundo | Seção 5.1 |

---

## 15. Aplicação e validação em cluster

Os 17 defeitos foram corrigidos e o resultado validado num cluster `kind`
descartável, criado para o teste e destruído ao final. Esta seção registra o que
mudou e a evidência de cada verificação.

### 15.1 Correções aplicadas

| # | Defeito | Correção |
|---|---|---|
| 1 | `pdb.yml` vs `pdb.yaml` | Arquivo renomeado e `spec` desindentado para o nível raiz |
| 2 | `mongo-url` inexistente no Secret | Container `api` passa a pedir `mongodb-url` |
| 3 | Ingress apontando para Service inexistente | Service renomeado de `chaos-lab-service` para `chaos-lab-api` |
| 4 | Patch do overlay sem alvo | Alvo corrigido para `chaos-lab-hpa`, patcheando `minReplicas` **e** `maxReplicas` |
| 5 | `OTL_ENABLED` | `OTEL_ENABLED` |
| 6 | initContainer sem `tsx` nem `scripts/` | Novo alvo `migrator` no Dockerfile |
| 7 | HPA sem metrics-server | `minReplicas = maxReplicas = 1` no overlay local, onde o HPA não tem função |
| 8 | Sem workload de Postgres | `statefulset-postgres.yaml` novo |
| 9 | `spec` do PDB dentro de `metadata` | Desindentado |
| 10 | `automountServiceAccountToken` dentro de `metadata` | Movido para o nível raiz e repetido no `PodSpec` |
| 11 | Namespace errado na SA | Removido do arquivo — o `kustomization.yaml` já o injeta |
| 12 | URLs do Secret em `localhost` | `postgres:5432` e `mongo:27017` |
| 13 | Mongo sem probes | Readiness por `mongosh`, liveness por `tcpSocket` |
| 14 | Mongo sem SA dedicada | SAs `postgres` e `mongo`, ambas sem automount |
| 15 | Senha literal no Mongo | Todas as credenciais vindas do Secret |
| 16 | `enforce-version: latest` | Fixado em `v1.33` |
| 17 | `mongo:7` contra `mongo:8` no compose | Alinhado em `mongo:8` |

### 15.2 Decisões que mereceram escolha

**Imagem separada para migração.** A `release` não serve como initContainer:
`tsx` é `devDependency` e `scripts/` não é copiado para lá. As alternativas eram
instalar `tsx` na imagem de produção — que anularia o multi-stage, inflando de
69 MB para o tamanho de uma imagem com compilador — ou compilar `scripts/` junto,
o que exigiria `rootDir: "."` e mudaria o layout de `dist/`, quebrando o `CMD` que
já está em produção. O alvo `migrator` isola o problema sem tocar em nada que já
funciona.

**Sem ConfigMap de init para o Postgres.** `001_init.sql` já executa
`CREATE EXTENSION IF NOT EXISTS pgcrypto`, e quem aplica as migrações aqui é o
initContainer, não o entrypoint da imagem. O `000_pg_init.sh` do compose seria
redundante.

**`initdb/00-init-mongo.js` é uma cópia.** O Kustomize recusa ler arquivo fora da
própria raiz — restrição de segurança que só se contorna com `--load-restrictor`
em toda invocação, o que transformaria todo comando do projeto num footgun. A
cópia é o menor mal, e o `kustomization.yaml` registra a origem para quem for
alterar o original.

**Liveness do Mongo por TCP, readiness por `mongosh`.** Ver 15.4.

### 15.3 Evidência

Cluster `kind` com control-plane e worker, imagens carregadas via
`kind load docker-image`, `kubectl apply -k infra/k8s/overlays/local`.

```
NAME                             READY   STATUS    RESTARTS   AGE
chaos-lab-api-549fffcd94-5b2n8   1/1     Running   0          5m3s
mongo-0                          1/1     Running   0          3m30s
postgres-0                       1/1     Running   0          3m30s
```

Verificação item a item:

| O que se queria provar | Comando | Resultado |
|---|---|---|
| O manifesto aplica | `kubectl apply -k overlays/local` | 19 recursos criados, sem erro de schema — o que por si só prova as correções do PDB e da SA, que a validação estrita rejeitaria |
| Referências resolvem | `scripts/check-k8s-refs.py` | `nenhuma referencia quebrada` (eram 8) |
| Patch do overlay aplica | `kubectl get hpa` | `MIN 1  MAX 1` (era 10) |
| Migração roda | `kubectl logs -c migrate` | `nenhuma migracao pendente` |
| A cadeia Service→Pod fecha | `kubectl get endpointslices` | `chaos-lab-api → 10.244.1.9  ready=true` |
| A aplicação enxerga os bancos | `GET /health/ready` | `{"status":"ready","dependencies":{"postgres":"up","mongodb":"up"}}` |
| O token **não** é montado | `ls /var/run/secrets/.../serviceaccount/` | `No such file or directory` |
| O PDB protege pods reais | `kubectl get pdb` | `ALLOWED DISRUPTIONS: 1` |
| O Ingress entrega | `curl -H "Host: chaos-lab.local" http://127.0.0.1/health/live` | `HTTP 200` |
| A autenticação funciona | `curl .../assets` sem token | `HTTP 401` |
| As métricas saem | `curl .../metrics` | séries `http_requests_total` presentes |

### 15.4 O defeito que só apareceu rodando

A primeira versão da correção deu ao Mongo readiness **e** liveness por
`mongosh`, espelhando o healthcheck do compose. No cluster:

```
Liveness probe failed: command timed out:
  "mongosh --quiet --eval db.adminCommand('ping').ok" timed out after 1s
Container mongo failed liveness probe, will be restarted
```

`mongosh` é um CLI escrito em Node e leva segundos só para iniciar. O
`timeoutSeconds` **padrão de uma probe é 1 segundo** — valor que o comando nunca
alcança. As duas probes estouravam sempre, e a liveness passou a matar um
container perfeitamente saudável em loop.

É exatamente o risco descrito na seção 8.1 deste documento, e a correção caiu
nele. Vale como lembrete de que **liveness agressiva é uma falha que se
autoalimenta**: o reinício não conserta nada, e o pod parece doente quando o
doente é o critério.

A correção final separa os papéis:

- **readiness** por `mongosh` com `timeoutSeconds: 10` — a verificação é cara,
  mas é a que realmente diz se o banco aceita comando
- **liveness** por `tcpSocket` — barata, e suficiente para detectar processo
  morto sem gastar um processo Node a cada ciclo

Depois da correção, `mongo-0` ficou com **0 restarts**.

Detalhe correlato: a primeira tentativa do initContainer de migração falhou com
`Dependencia indisponivel: postgres`, porque rodou antes de o Postgres ficar
`Ready`. **Não é defeito** — initContainer que falha é reiniciado, e a segunda
tentativa passou sozinha. O que atrapalha o diagnóstico é `consultar()` em
`src/infra/postgres.ts` converter qualquer erro de conexão nessa mensagem
genérica, que não distingue "banco ainda subindo" de "credencial errada".

### 15.5 O que ficou de fora

**metrics-server não foi instalado.** No overlay local o HPA está fixado em
`minReplicas = maxReplicas = 1`, onde ele não tem o que decidir. Para exercitar
o autoscaling de verdade é preciso instalar o metrics-server com
`--kubelet-insecure-tls` (o kubelet do kind usa certificado auto-assinado), como
descrito na seção 9.1.

**NetworkPolicy não foi exercitada.** O `kindnet`, CNI padrão do kind, **não
implementa NetworkPolicy** — a política existe no cluster e não é aplicada.
Validar de verdade exige subir o kind com Calico ou Cilium. O manifesto está
correto por inspeção, mas isso não é o mesmo que testado.

**O ingress-nginx precisou de um ajuste externo ao repositório.** O manifesto
`main` do projeto ingress-nginx não traz mais o `nodeSelector: ingress-ready`, e
o controller caiu no worker, que não tem `extraPortMappings`. Foi corrigido com
um `patch` no deployment do controller durante o teste. **O `kind-cluster.yaml`
deste repositório está correto** — a label `ingress-ready=true` estava no
control-plane, como esperado.

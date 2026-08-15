<!-- Título do PR no padrão de commit do projeto: `<tipo>: <descrição>` -->

## Descrição

<!--
Descreva de forma objetiva o que foi alterado nesta PR.
Explique o problema, a motivação e a solução adotada.
-->

### Problema

<!-- Qual problema esta PR resolve? -->

### Solução

<!-- Como o problema foi resolvido? -->

### Objetivo

<!-- Qual é o resultado esperado após o merge? -->

## Tipo

- [ ] `feat` — nova funcionalidade
- [ ] `fix` — correção de bug
- [ ] `docs` — documentação
- [ ] `refactor` — refatoração sem mudança de comportamento
- [ ] `test` — testes
- [ ] `chore` — manutenção, dependências
- [ ] `security` — segurança

## Como testar

<!-- Comandos ou passos para o revisor reproduzir o resultado. -->

```bash
```

### Testes executados

- [ ] Unit Tests
- [ ] Integration Tests
- [ ] Contract Tests
- [ ] E2E Tests
- [ ] Performance Tests
- [ ] Mutation Tests
- [ ] Testes manuais

### Resultado

<!--
Descreva brevemente os testes executados e os resultados.
Exemplo:
- Unit Tests: 152 passed
- Integration Tests: 48 passed
- E2E: 12 passed
-->

## Impacto

| Item | Valor |
|---|---|
| Camada afetada | <!-- docker / infra / db / scripts / ci / docs / src --> |
| Quebra compatibilidade | <!-- sim / não --> |
| Requer migração ou nova variável de ambiente | <!-- sim / não --> |

<!-- Se marcou "sim" em qualquer linha, descreva o procedimento aqui. -->

### Ambiente

- [ ] Desenvolvimento
- [ ] Homologação
- [ ] Produção

## Checklist

- [ ] O código foi revisado localmente.
- [ ] Os testes foram executados.
- [ ] O lint foi executado.
- [ ] Não existem secrets ou credenciais no código.
- [ ] A documentação foi atualizada quando necessário.
- [ ] O commit segue o padrão do projeto.
- [ ] O Pull Request possui uma descrição adequada.
- [ ] Os checks do CI estão passando.

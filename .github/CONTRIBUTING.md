# Contribuindo

Obrigado por contribuir com este projeto! Este documento apresenta as principais orientações para desenvolvimento, abertura de Issues e Pull Requests.

## Antes de começar

Antes de realizar qualquer alteração:

1. Leia a documentação disponível no projeto.
2. Verifique as Issues e Pull Requests existentes.
3. Confirme se a alteração proposta ainda não foi implementada.
4. Para alterações significativas, abra uma Issue antes de iniciar o desenvolvimento.

## Estratégia de Branches

Utilize branches separadas para cada alteração.

Formato recomendado:

```text
feature/<descricao>
fix/<descricao>
hotfix/<descricao>
refactor/<descricao>
docs/<descricao>
chore/<descricao>
security/<descricao>
```

Exemplos:

```text
feature/add-user-authentication
fix/database-connection
security/update-dependencies
docs/update-readme
```

Evite trabalhar diretamente na branch `main`.

## Desenvolvimento

Antes de enviar uma alteração, certifique-se de que:

- O código segue os padrões utilizados no projeto.
- Não existem erros de lint.
- Os testes existentes continuam passando.
- Novos comportamentos possuem testes quando aplicável.
- Não foram adicionados secrets, tokens, senhas ou credenciais ao código.
- Dependências desnecessárias não foram adicionadas.
- Arquivos temporários ou gerados localmente não foram commitados.

## Testes

Execute os testes localmente antes de abrir um Pull Request.

Exemplo:

```bash
pnpm run test
```

Caso o projeto utilize outros comandos, consulte o `README.md` e a configuração do projeto.

Pull Requests que apresentarem falhas nos testes ou nos checks obrigatórios do CI poderão ser rejeitados até que os problemas sejam corrigidos.

## Segurança

Nunca faça commit de:

- Senhas
- API Keys
- Tokens
- Certificados privados
- Credenciais de banco de dados
- Secrets de serviços externos
- Arquivos `.env` contendo informações sensíveis

Utilize as ferramentas e mecanismos de secrets apropriados para cada ambiente.

Problemas de segurança **não devem ser reportados publicamente através de Issues**.

Consulte o arquivo [`SECURITY.md`](./SECURITY.md) para obter as orientações sobre como reportar vulnerabilidades.

## Commits

Utilize mensagens de commit claras e objetivas.

Formato recomendado:

```text
<tipo>: <descricao>
```

Exemplos:

```text
feat: adiciona autenticação de usuários
fix: corrige conexão com PostgreSQL
docs: atualiza documentação da API
refactor: reorganiza camada de serviços
test: adiciona testes de integração
chore: atualiza dependências
security: atualiza configuração do Trivy
```

Evite mensagens genéricas como:

```text
update
fix
changes
teste
alterações
```

## Pull Requests

Ao abrir um Pull Request:

1. Explique claramente o que foi alterado.
2. Descreva o motivo da alteração.
3. Informe possíveis impactos.
4. Adicione ou atualize testes quando necessário.
5. Verifique se todos os checks do GitHub Actions foram executados com sucesso.
6. Vincule a Issue relacionada, quando aplicável.

Exemplo:

```text
Closes #123
```

Não solicite aprovação de um Pull Request que ainda possua falhas conhecidas no CI.

## CI/CD

Os Pull Requests podem passar por verificações automatizadas, incluindo:

- Lint
- Testes unitários
- Testes de integração
- Análise de dependências
- Security Scan
- CodeQL
- Trivy
- Validação de Docker
- Validação de OpenAPI
- Testes de qualidade
- Geração de SBOM

As verificações obrigatórias devem ser aprovadas antes do merge.

## Docker

Quando houver alteração relacionada a Docker:

- Evite utilizar imagens com a tag `latest`.
- Prefira versões ou tags imutáveis.
- Mantenha o `Dockerfile` atualizado e seguro.
- Não inclua secrets dentro da imagem.
- Execute os scans de segurança antes do merge.

## Dependências

Antes de adicionar uma nova dependência:

1. Verifique se ela é realmente necessária.
2. Avalie sua manutenção e reputação.
3. Verifique possíveis vulnerabilidades conhecidas.
4. Evite dependências duplicadas ou desnecessárias.
5. Mantenha o lockfile atualizado.

Atualizações automatizadas de dependências podem ser realizadas pelo Dependabot.

## Documentação

Alterações que modificarem comportamento, configuração, API ou processo de desenvolvimento devem atualizar a documentação correspondente.

Mantenha o `README.md` e demais documentos consistentes com o estado atual do projeto.

## Issues

Ao abrir uma Issue, forneça o máximo de informações relevantes possível.

Inclua, quando aplicável:

- Descrição do problema
- Passos para reprodução
- Comportamento esperado
- Comportamento atual
- Logs relevantes
- Versão da aplicação
- Ambiente afetado

Não publique informações sensíveis ou credenciais nos comentários.

## Checklist antes do Pull Request

Antes de abrir um Pull Request, confirme:

- [ ] O código foi revisado localmente.
- [ ] Os testes foram executados.
- [ ] O lint foi executado.
- [ ] Não existem secrets ou credenciais no código.
- [ ] A documentação foi atualizada quando necessário.
- [ ] O commit segue o padrão do projeto.
- [ ] O Pull Request possui uma descrição adequada.
- [ ] Os checks do CI estão passando.

## Código de Conduta

Todos os colaboradores devem manter um ambiente respeitoso, profissional e colaborativo.

Comportamentos inadequados, assédio ou discriminação não são aceitos no projeto.

## Licença

Ao contribuir com este projeto, você concorda que suas contribuições sejam disponibilizadas sob a mesma licença utilizada pelo projeto.

Consulte o arquivo `LICENSE` para obter mais informações.

---

**Obrigado por contribuir!**

# Runbook — `<ID>` `<título curto da falha>`

> Copie este arquivo para `docs/runbooks/<ID>-<slug>.md` e preencha durante a correção,
> não depois. O valor do laboratório está no registro do raciocínio, não no patch final.

---

## 1. Sintoma

O que você observou **antes** de saber a causa. Cole a saída bruta.

```
<log / evento kubectl / mensagem de erro>
```

- Onde apareceu: `docker compose logs api` / `kubectl describe pod` / Actions run #
- Quando começou: no primeiro boot / após corrigir `<outro ID>`
- Blast radius: o que parou de funcionar por causa disso

## 2. Diagnóstico

Comandos executados, em ordem, com o que cada um descartou ou confirmou.

| # | Comando | Hipótese testada | Resultado |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |

**Causa raiz:**

> Uma frase. Se precisar de duas, provavelmente há duas falhas — abra outro runbook.

**Por que o sintoma não apontava direto para a causa:**

## 3. Correção

Arquivo(s) alterado(s) e o diff mínimo:

```diff
```

Justificativa da escolha (e a alternativa que você descartou):

## 4. Validação

Critério objetivo de "consertado" — não "parece que subiu".

```bash
```

```
<saída que comprova o sucesso>
```

## 5. Prevenção

Como esta falha seria pega **antes** de chegar em produção:

- [ ] Validação em CI (qual step?)
- [ ] Health check / probe que detectaria
- [ ] Alerta com runbook vinculado
- [ ] Lint de configuração (`promtool`, `kubeconform`, `actionlint`, `hadolint`)
- [ ] Teste automatizado

## 6. Notas

Tempo gasto · o que você aprendeu · o que faria diferente na próxima.

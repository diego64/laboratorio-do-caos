/**
 * Responsabilidade : Aplicar as migracoes SQL de db/migrations em ordem lexicografica,
 *                    registrando o que ja foi aplicado na tabela schema_migrations.
 * Consumido por    : `pnpm db:migrate`, initContainer do Kubernetes, job de CD
 * Regra            : Cada migracao roda dentro de uma transacao. Falha em uma migracao
 *                    aborta o processo com codigo != 0 - nunca aplica parcialmente.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executarTransacao, consultar, fecharPool } from '../src/infra/postgres';

const DIRETORIO = join(__dirname, '..', 'db', 'migrations');

/** Cria a tabela de controle, se ainda nao existir. */
async function garantirTabelaDeControle(): Promise<void> {
  await consultar(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      versao      TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/** Retorna o conjunto de migracoes ja aplicadas. */
async function listarAplicadas(): Promise<Set<string>> {
  const linhas = await consultar<{ versao: string }>('SELECT versao FROM schema_migrations');
  return new Set(linhas.map((linha) => linha.versao));
}

/** Aplica todas as migracoes pendentes. */
async function migrar(): Promise<void> {
  await garantirTabelaDeControle();
  const aplicadas = await listarAplicadas();

  const arquivos = readdirSync(DIRETORIO)
    .filter((nome) => nome.endsWith('.sql'))
    .sort();

  let executadas = 0;

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;

    const sql = readFileSync(join(DIRETORIO, arquivo), 'utf8');
    process.stdout.write(`aplicando ${arquivo}...\n`);

    await executarTransacao(async (cliente) => {
      await cliente.query(sql);
      await cliente.query('INSERT INTO schema_migrations (versao) VALUES ($1)', [arquivo]);
    });

    executadas += 1;
  }

  process.stdout.write(
    executadas === 0 ? 'nenhuma migracao pendente\n' : `${executadas} migracao(oes) aplicada(s)\n`,
  );
}

migrar()
  .then(() => fecharPool())
  .then(() => process.exit(0))
  .catch(async (erro: Error) => {
    process.stderr.write(`falha na migracao: ${erro.message}\n`);
    await fecharPool().catch(() => undefined);
    process.exit(1);
  });

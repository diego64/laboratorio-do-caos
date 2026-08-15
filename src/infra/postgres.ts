/**
 * Responsabilidade : Gerenciar o pool de conexoes PostgreSQL (driver nativo pg, sem ORM),
 *                    expor helpers de query tipada e de transacao, e reportar saude.
 * Consumido por    : src/modules/users/user.repository.ts, src/modules/assets/asset.repository.ts,
 *                    src/modules/health/health.routes.ts, scripts/migrate.ts
 * Regra            : Toda query usa parametros posicionais ($1, $2) - concatenacao de SQL e
 *                    proibida. Erros de conexao viram ErroDependenciaIndisponivel, nunca
 *                    vazam a connection string. Pool e singleton por processo.
 */
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { ambiente } from '../config/env';
import { ErroDependenciaIndisponivel } from '../shared/errors';

let pool: Pool | undefined;

/** Retorna (criando se necessario) o pool singleton do PostgreSQL. */
export function obterPool(): Pool {
  if (pool) return pool;
  const env = ambiente();

  pool = new Pool({
    connectionString: env.POSTGRES_URL,
    max: env.POSTGRES_POOL_MAX,
    connectionTimeoutMillis: env.POSTGRES_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 30000,
    application_name: env.SERVICE_NAME,
  });

  // Erro em conexao ociosa nao pode derrubar o processo.
  pool.on('error', (erro) => {
    process.emitWarning(`[postgres] erro em conexao ociosa: ${erro.message}`);
  });

  return pool;
}

/** Executa uma query parametrizada e devolve as linhas tipadas. */
export async function consultar<T extends QueryResultRow>(
  sql: string,
  parametros: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  try {
    const resultado = await obterPool().query<T>(sql, parametros as unknown[]);
    return resultado.rows;
  } catch (erro) {
    if (ehErroDeConexao(erro)) {
      throw new ErroDependenciaIndisponivel('postgres');
    }
    throw erro;
  }
}

/** Executa uma query esperando no maximo uma linha. */
export async function consultarUm<T extends QueryResultRow>(
  sql: string,
  parametros: ReadonlyArray<unknown> = [],
): Promise<T | undefined> {
  const linhas = await consultar<T>(sql, parametros);
  return linhas[0];
}

/** Executa um bloco dentro de uma transacao, com rollback automatico em erro. */
export async function executarTransacao<T>(
  operacao: (cliente: PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await operacao(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

/** Ping usado pelo readiness probe. Nunca lanca - retorna booleano. */
export async function verificarSaudePostgres(): Promise<boolean> {
  try {
    const linhas = await consultar<{ ok: number }>('SELECT 1 AS ok');
    return linhas[0]?.ok === 1;
  } catch {
    return false;
  }
}

/** Fecha o pool no graceful shutdown. Idempotente. */
export async function fecharPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}

/** Classifica erros de rede/autenticacao do driver pg como indisponibilidade. */
function ehErroDeConexao(erro: unknown): boolean {
  const codigo = (erro as { code?: string }).code;
  if (!codigo) return false;
  return ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', '57P03', '53300', '28P01', '3D000'].includes(codigo);
}

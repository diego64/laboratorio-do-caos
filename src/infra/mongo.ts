/**
 * Responsabilidade : Gerenciar o MongoClient singleton, expor a database e as colecoes
 *                    tipadas, garantir indices e reportar saude.
 * Consumido por    : src/modules/readings/reading.repository.ts,
 *                    src/modules/health/health.routes.ts, scripts/seed.ts
 * Regra            : Conexao e lazy e reaproveitada. Falha de conexao vira
 *                    ErroDependenciaIndisponivel. Criacao de indices e idempotente e roda
 *                    no bootstrap, nunca dentro do caminho de requisicao.
 */
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { ambiente } from '../config/env';
import { ErroDependenciaIndisponivel } from '../shared/errors';

let cliente: MongoClient | undefined;
let conexao: Promise<MongoClient> | undefined;

/** Conecta (uma unica vez) e retorna o MongoClient. */
export async function obterCliente(): Promise<MongoClient> {
  if (cliente) return cliente;
  if (conexao) return conexao;

  const env = ambiente();
  const novoCliente = new MongoClient(env.MONGO_URL, {
    connectTimeoutMS: env.MONGO_CONNECT_TIMEOUT_MS,
    serverSelectionTimeoutMS: env.MONGO_CONNECT_TIMEOUT_MS,
    appName: env.SERVICE_NAME,
    retryWrites: true,
  });

  conexao = novoCliente
    .connect()
    .then((conectado) => {
      cliente = conectado;
      return conectado;
    })
    .catch((erro) => {
      conexao = undefined;
      process.emitWarning(`[mongo] falha ao conectar: ${(erro as Error).message}`);
      throw new ErroDependenciaIndisponivel('mongodb');
    });

  return conexao;
}

/** Retorna a database configurada em MONGO_DB. */
export async function obterDatabase(): Promise<Db> {
  const conectado = await obterCliente();
  return conectado.db(ambiente().MONGO_DB);
}

/** Retorna uma colecao tipada. */
export async function obterColecao<T extends Document>(nome: string): Promise<Collection<T>> {
  const db = await obterDatabase();
  return db.collection<T>(nome);
}

/**
 * Cria os indices necessarios. Idempotente - chamado uma vez no bootstrap.
 * readings: consulta por ativo + janela temporal; expiracao automatica em 90 dias.
 */
export async function garantirIndices(): Promise<void> {
  const colecao = await obterColecao('readings');
  await colecao.createIndex({ assetId: 1, capturedAt: -1 }, { name: 'idx_asset_captured' });
  await colecao.createIndex(
    { capturedAt: 1 },
    { name: 'ttl_capturedAt_90d', expireAfterSeconds: 60 * 60 * 24 * 90 },
  );
}

/** Ping usado pelo readiness probe. Nunca lanca - retorna booleano. */
export async function verificarSaudeMongo(): Promise<boolean> {
  try {
    const db = await obterDatabase();
    const resultado = await db.command({ ping: 1 });
    return resultado.ok === 1;
  } catch {
    return false;
  }
}

/** Fecha a conexao no graceful shutdown. Idempotente. */
export async function fecharConexaoMongo(): Promise<void> {
  if (!cliente) return;
  await cliente.close();
  cliente = undefined;
  conexao = undefined;
}

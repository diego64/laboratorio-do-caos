/**
 * Responsabilidade : Popular o ambiente local com um admin, ativos de exemplo e leituras
 *                    sinteticas no MongoDB, permitindo exercitar dashboards e alertas.
 * Consumido por    : `pnpm db:seed`
 * Regra            : Idempotente - reexecutar nao duplica registros. NUNCA rodar com
 *                    NODE_ENV=production; o script aborta nesse caso.
 */
import { consultar, fecharPool } from '../src/infra/postgres';
import { fecharConexaoMongo, garantirIndices, obterColecao } from '../src/infra/mongo';
import { gerarHashSenha, gerarIdentificador } from '../src/shared/crypto';
import { ambiente } from '../src/config/env';

const ATIVOS = [
  { tag: 'BOMBA-001', nome: 'Bomba centrifuga linha A', local: 'Galpao 1', criticidade: 'critica', intervalo: 30 },
  { tag: 'COMP-014', nome: 'Compressor de ar 14', local: 'Galpao 2', criticidade: 'alta', intervalo: 60 },
  { tag: 'ESTEIRA-07', nome: 'Esteira transportadora 07', local: 'Expedicao', criticidade: 'media', intervalo: 90 },
  { tag: 'GERADOR-02', nome: 'Gerador diesel reserva', local: 'Casa de forca', criticidade: 'critica', intervalo: 45 },
];

/** Insere o usuario administrador padrao do laboratorio. */
async function semearAdmin(): Promise<void> {
  const hash = await gerarHashSenha('ChaosLab@2026');
  await consultar(
    `INSERT INTO users (id, email, nome, papel, hash_senha, ativo)
     VALUES ($1, $2, $3, 'admin', $4, TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [gerarIdentificador(), 'admin@chaoslab.dev', 'Administrador', hash],
  );
}

/** Insere os ativos de exemplo. */
async function semearAtivos(): Promise<string[]> {
  const ids: string[] = [];

  for (const ativo of ATIVOS) {
    const linhas = await consultar<{ id: string }>(
      `INSERT INTO assets (id, tag, nome, local, criticidade, intervalo_manutencao_dias)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tag) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id`,
      [gerarIdentificador(), ativo.tag, ativo.nome, ativo.local, ativo.criticidade, ativo.intervalo],
    );
    const id = linhas[0]?.id;
    if (id) ids.push(id);
  }

  return ids;
}

/** Gera 24 horas de leituras sinteticas por ativo (uma por hora, por tipo). */
async function semearLeituras(idsAtivos: string[]): Promise<void> {
  await garantirIndices();
  const colecao = await obterColecao('readings');
  const agora = Date.now();
  const documentos: Array<Record<string, unknown>> = [];

  for (const assetId of idsAtivos) {
    for (let hora = 0; hora < 24; hora += 1) {
      const capturedAt = new Date(agora - hora * 60 * 60 * 1000);
      documentos.push(
        {
          assetId,
          tipo: 'temperatura',
          valor: Number((55 + Math.sin(hora) * 8).toFixed(2)),
          unidade: 'C',
          capturedAt,
          ingestedAt: new Date(),
        },
        {
          assetId,
          tipo: 'vibracao',
          valor: Number((2.5 + Math.cos(hora) * 0.8).toFixed(3)),
          unidade: 'mm/s',
          capturedAt,
          ingestedAt: new Date(),
        },
      );
    }
  }

  await colecao.deleteMany({ assetId: { $in: idsAtivos } });
  await colecao.insertMany(documentos as never[]);
  process.stdout.write(`${documentos.length} leituras inseridas\n`);
}

/** Orquestra o seed completo. */
async function semear(): Promise<void> {
  if (ambiente().NODE_ENV === 'production') {
    throw new Error('seed bloqueado em producao');
  }

  await semearAdmin();
  const ids = await semearAtivos();
  await semearLeituras(ids);

  process.stdout.write('seed concluido - login: admin@chaoslab.dev / ChaosLab@2026\n');
}

semear()
  .then(async () => {
    await Promise.all([fecharPool(), fecharConexaoMongo()]);
    process.exit(0);
  })
  .catch(async (erro: Error) => {
    process.stderr.write(`falha no seed: ${erro.message}\n`);
    await Promise.all([
      fecharPool().catch(() => undefined),
      fecharConexaoMongo().catch(() => undefined),
    ]);
    process.exit(1);
  });

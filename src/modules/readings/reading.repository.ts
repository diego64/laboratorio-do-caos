/**
 * Responsabilidade : Persistencia e consulta das leituras na colecao `readings` (MongoDB).
 * Consumido por    : reading.service.ts
 * Regra            : Toda consulta obrigatoriamente filtra por assetId e usa o indice
 *                    idx_asset_captured. Consulta sem limite explicito e proibida -
 *                    o default vem do schema, nunca do driver.
 */
import { obterColecao } from '../../infra/mongo';
import type {
  DocumentoLeitura,
  EntradaIngestaoLeitura,
  FiltroConsultaLeituras,
} from './reading.schema';

const NOME_COLECAO = 'readings';

/** Insere uma leitura e devolve o documento persistido. */
export async function inserirLeitura(entrada: EntradaIngestaoLeitura): Promise<DocumentoLeitura> {
  const colecao = await obterColecao<DocumentoLeitura>(NOME_COLECAO);

  const documento: DocumentoLeitura = {
    assetId: entrada.assetId,
    tipo: entrada.tipo,
    valor: entrada.valor,
    unidade: entrada.unidade,
    capturedAt: new Date(entrada.capturedAt),
    ingestedAt: new Date(),
  };

  await colecao.insertOne(documento as never);
  return documento;
}

/** Lista as leituras de um ativo, mais recentes primeiro. */
export async function listarLeiturasPorAtivo(
  assetId: string,
  filtro: FiltroConsultaLeituras,
): Promise<DocumentoLeitura[]> {
  const colecao = await obterColecao<DocumentoLeitura>(NOME_COLECAO);

  const consulta: Record<string, unknown> = { assetId };
  if (filtro.tipo) consulta['tipo'] = filtro.tipo;
  if (filtro.desde) consulta['capturedAt'] = { $gte: new Date(filtro.desde) };

  return colecao
    .find(consulta as never, { projection: { _id: 0 } })
    .sort({ capturedAt: -1 })
    .limit(filtro.limite)
    .toArray();
}

/** Agrega estatisticas basicas da janela consultada (min, max, media, contagem). */
export async function agregarEstatisticas(
  assetId: string,
  desde: Date,
): Promise<Array<{ tipo: string; minimo: number; maximo: number; media: number; total: number }>> {
  const colecao = await obterColecao<DocumentoLeitura>(NOME_COLECAO);

  return colecao
    .aggregate<{ tipo: string; minimo: number; maximo: number; media: number; total: number }>([
      { $match: { assetId, capturedAt: { $gte: desde } } },
      {
        $group: {
          _id: '$tipo',
          minimo: { $min: '$valor' },
          maximo: { $max: '$valor' },
          media: { $avg: '$valor' },
          total: { $sum: 1 },
        },
      },
      { $project: { _id: 0, tipo: '$_id', minimo: 1, maximo: 1, media: 1, total: 1 } },
    ])
    .toArray();
}

/**
 * Responsabilidade : Regras de ingestao e consulta de leituras - validacao de existencia do
 *                    ativo, rejeicao de leitura futura e incremento das metricas de dominio.
 * Consumido por    : reading.routes.ts
 * Regra            : Leitura com capturedAt no futuro (tolerancia de 60s para clock skew)
 *                    e rejeitada com 422. Ativo inexistente => 404 antes de tocar o MongoDB.
 */
import { ErroValidacao } from '../../shared/errors';
import { totalLeiturasIngeridas } from '../../observability/metrics';
import { obterAtivo } from '../assets/asset.service';
import * as repositorio from './reading.repository';
import type {
  DocumentoLeitura,
  EntradaIngestaoLeitura,
  FiltroConsultaLeituras,
} from './reading.schema';

const TOLERANCIA_CLOCK_SKEW_MS = 60_000;

/** Ingere uma leitura apos validar o ativo e a janela temporal. */
export async function ingerirLeitura(
  entrada: EntradaIngestaoLeitura,
  agora: Date = new Date(),
): Promise<DocumentoLeitura> {
  await obterAtivo(entrada.assetId);

  const capturada = new Date(entrada.capturedAt);
  if (capturada.getTime() > agora.getTime() + TOLERANCIA_CLOCK_SKEW_MS) {
    throw new ErroValidacao([
      { campo: 'capturedAt', mensagem: 'Leitura no futuro nao e aceita' },
    ]);
  }

  const persistida = await repositorio.inserirLeitura(entrada);
  totalLeiturasIngeridas.inc({ tipo: entrada.tipo });
  return persistida;
}

/** Lista leituras de um ativo existente. */
export async function listarLeituras(
  assetId: string,
  filtro: FiltroConsultaLeituras,
): Promise<DocumentoLeitura[]> {
  await obterAtivo(assetId);
  return repositorio.listarLeiturasPorAtivo(assetId, filtro);
}

/** Resumo estatistico das ultimas 24 horas de um ativo. */
export async function resumirUltimas24h(assetId: string, agora: Date = new Date()) {
  await obterAtivo(assetId);
  const desde = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  return repositorio.agregarEstatisticas(assetId, desde);
}

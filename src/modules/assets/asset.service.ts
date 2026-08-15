/**
 * Responsabilidade : Regras de negocio de ativos - unicidade de tag, calculo de vencimento
 *                    de manutencao preventiva e classificacao de risco.
 * Consumido por    : asset.routes.ts, tests/unit/asset-service.spec.ts
 * Regra            : Tag duplicada => 409. Um ativo esta VENCIDO quando
 *                    (hoje - ultima_manutencao_em) > intervalo_manutencao_dias. Ativo sem
 *                    manutencao registrada conta o intervalo a partir da data de criacao.
 */
import { ErroConflito, ErroNaoEncontrado } from '../../shared/errors';
import * as repositorio from './asset.repository';
import type { Ativo, EntradaCriacaoAtivo, FiltroListagemAtivos } from './asset.schema';

export interface SituacaoManutencao {
  dias_desde_ultima: number;
  dias_restantes: number;
  vencido: boolean;
}

/** Cria um ativo garantindo unicidade da tag de negocio. */
export async function criarAtivo(entrada: EntradaCriacaoAtivo): Promise<Ativo> {
  const existente = await repositorio.buscarAtivoPorTag(entrada.tag);
  if (existente) {
    throw new ErroConflito(`Ativo com tag ${entrada.tag} ja existe`);
  }
  return repositorio.criarAtivo(entrada);
}

/** Recupera um ativo ou lanca 404. */
export async function obterAtivo(id: string): Promise<Ativo> {
  const ativo = await repositorio.buscarAtivoPorId(id);
  if (!ativo) throw new ErroNaoEncontrado('Ativo');
  return ativo;
}

/** Lista ativos aplicando o filtro recebido. */
export async function listarAtivos(filtro: FiltroListagemAtivos): Promise<Ativo[]> {
  return repositorio.listarAtivos(filtro);
}

/** Registra manutencao preventiva na data informada (default: hoje, UTC). */
export async function registrarManutencao(id: string, data?: string): Promise<Ativo> {
  const dataEfetiva = data ?? new Date().toISOString().slice(0, 10);
  const atualizado = await repositorio.registrarManutencao(id, dataEfetiva);
  if (!atualizado) throw new ErroNaoEncontrado('Ativo');
  return atualizado;
}

/**
 * Calcula a situacao da manutencao preventiva de um ativo.
 * Funcao pura - a base do calculo e a data de referencia recebida, o que a torna
 * deterministica e testavel sem congelar o relogio do sistema.
 */
export function calcularSituacaoManutencao(
  ativo: Pick<Ativo, 'ultima_manutencao_em' | 'criado_em' | 'intervalo_manutencao_dias'>,
  referencia: Date = new Date(),
): SituacaoManutencao {
  const base = ativo.ultima_manutencao_em ?? ativo.criado_em;
  const dataBase = new Date(base);
  const MS_POR_DIA = 24 * 60 * 60 * 1000;

  const diasDesdeUltima = Math.floor((referencia.getTime() - dataBase.getTime()) / MS_POR_DIA);
  const diasRestantes = ativo.intervalo_manutencao_dias - diasDesdeUltima;

  return {
    dias_desde_ultima: diasDesdeUltima,
    dias_restantes: diasRestantes,
    vencido: diasRestantes < 0,
  };
}

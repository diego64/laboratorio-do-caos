/**
 * Responsabilidade : Persistencia do agregado Ativo na tabela `assets` (PostgreSQL).
 * Consumido por    : asset.service.ts
 * Regra            : Filtro dinamico e montado com parametros posicionais acumulados -
 *                    nenhum valor de usuario entra na string de SQL. Paginacao sempre com
 *                    LIMIT/OFFSET explicitos para impedir varredura completa.
 */
import { consultar, consultarUm } from '../../infra/postgres';
import { gerarIdentificador } from '../../shared/crypto';
import type { Ativo, EntradaCriacaoAtivo, FiltroListagemAtivos } from './asset.schema';

const COLUNAS = `id, tag, nome, local, criticidade, intervalo_manutencao_dias,
  to_char(ultima_manutencao_em, 'YYYY-MM-DD') AS ultima_manutencao_em,
  to_char(criado_em, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS criado_em`;

/** Insere um ativo. */
export async function criarAtivo(entrada: EntradaCriacaoAtivo): Promise<Ativo> {
  const id = gerarIdentificador();
  const linhas = await consultar<Ativo>(
    `INSERT INTO assets (id, tag, nome, local, criticidade, intervalo_manutencao_dias)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUNAS}`,
    [id, entrada.tag, entrada.nome, entrada.local, entrada.criticidade, entrada.intervalo_manutencao_dias],
  );
  const criado = linhas[0];
  if (!criado) throw new Error('INSERT em assets nao retornou linha');
  return criado;
}

/** Busca ativo por id. */
export async function buscarAtivoPorId(id: string): Promise<Ativo | undefined> {
  return consultarUm<Ativo>(`SELECT ${COLUNAS} FROM assets WHERE id = $1`, [id]);
}

/** Busca ativo pela tag de negocio. */
export async function buscarAtivoPorTag(tag: string): Promise<Ativo | undefined> {
  return consultarUm<Ativo>(`SELECT ${COLUNAS} FROM assets WHERE tag = $1`, [tag]);
}

/** Lista ativos com filtro opcional por criticidade. */
export async function listarAtivos(filtro: FiltroListagemAtivos): Promise<Ativo[]> {
  const parametros: unknown[] = [];
  let clausula = '';

  if (filtro.criticidade) {
    parametros.push(filtro.criticidade);
    clausula = `WHERE criticidade = $${parametros.length}`;
  }

  parametros.push(filtro.limite);
  const posicaoLimite = parametros.length;
  parametros.push((filtro.pagina - 1) * filtro.limite);
  const posicaoOffset = parametros.length;

  return consultar<Ativo>(
    `SELECT ${COLUNAS} FROM assets ${clausula}
     ORDER BY criado_em DESC
     LIMIT $${posicaoLimite} OFFSET $${posicaoOffset}`,
    parametros,
  );
}

/** Marca a manutencao do ativo como realizada na data informada. */
export async function registrarManutencao(id: string, data: string): Promise<Ativo | undefined> {
  return consultarUm<Ativo>(
    `UPDATE assets SET ultima_manutencao_em = $2 WHERE id = $1 RETURNING ${COLUNAS}`,
    [id, data],
  );
}

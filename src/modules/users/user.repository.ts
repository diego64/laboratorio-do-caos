/**
 * Responsabilidade : Acesso a tabela `users` no PostgreSQL com SQL parametrizado.
 * Consumido por    : auth.service.ts (via porta RepositorioUsuarioAuth), user.routes.ts
 * Regra            : Nenhuma regra de negocio aqui - apenas traducao entre linha do banco e
 *                    tipo de dominio. SELECT nunca usa `*`: colunas explicitas garantem que
 *                    hash_senha so sai quando pedido explicitamente.
 */
import { consultar, consultarUm } from '../../infra/postgres';
import { gerarIdentificador } from '../../shared/crypto';
import type { UsuarioComSegredo, UsuarioPublico } from './user.schema';

const COLUNAS_PUBLICAS =
  'id, email, nome, papel, ativo, to_char(criado_em, \'YYYY-MM-DD"T"HH24:MI:SSOF\') AS criado_em';

/** Busca usuario por email, incluindo o hash da senha (uso exclusivo do login). */
export async function buscarPorEmail(email: string): Promise<UsuarioComSegredo | undefined> {
  return consultarUm<UsuarioComSegredo>(
    `SELECT ${COLUNAS_PUBLICAS}, hash_senha FROM users WHERE email = $1`,
    [email],
  );
}

/** Busca usuario por id. Retorna projecao publica. */
export async function buscarPorId(id: string): Promise<UsuarioPublico | undefined> {
  return consultarUm<UsuarioPublico>(
    `SELECT ${COLUNAS_PUBLICAS} FROM users WHERE id = $1`,
    [id],
  );
}

/** Insere um novo usuario. O id e gerado na aplicacao para permitir idempotencia futura. */
export async function criar(entrada: {
  email: string;
  nome: string;
  papel: 'admin' | 'operador';
  hashSenha: string;
}): Promise<UsuarioPublico> {
  const id = gerarIdentificador();
  const linhas = await consultar<UsuarioPublico>(
    `INSERT INTO users (id, email, nome, papel, hash_senha, ativo)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING ${COLUNAS_PUBLICAS}`,
    [id, entrada.email, entrada.nome, entrada.papel, entrada.hashSenha],
  );

  const criado = linhas[0];
  if (!criado) throw new Error('INSERT em users nao retornou linha');
  return criado;
}

/** Lista usuarios paginados, ordenados do mais recente para o mais antigo. */
export async function listar(limite: number, deslocamento: number): Promise<UsuarioPublico[]> {
  return consultar<UsuarioPublico>(
    `SELECT ${COLUNAS_PUBLICAS} FROM users ORDER BY criado_em DESC LIMIT $1 OFFSET $2`,
    [limite, deslocamento],
  );
}

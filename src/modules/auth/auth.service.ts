/**
 * Responsabilidade : Regras de negocio de registro e login. Orquestra repositorio de
 *                    usuarios, hashing de senha e emissao de JWT.
 * Consumido por    : src/modules/auth/auth.routes.ts
 * Regra            : Login com email inexistente e login com senha errada retornam a MESMA
 *                    resposta (401 generico) - nao existe enumeracao de usuarios. O hash e
 *                    sempre calculado mesmo quando o usuario nao existe, para evitar
 *                    diferenca de tempo observavel.
 */
import { gerarHashSenha, verificarSenha } from '../../shared/crypto';
import { ErroConflito, ErroNaoAutenticado } from '../../shared/errors';
import { totalLoginsFalhos } from '../../observability/metrics';
import type { UsuarioComSegredo, UsuarioPublico } from '../users/user.schema';
import type { EntradaLogin, EntradaRegistro } from './auth.schema';

/** Porta de persistencia exigida pelo servico - permite testar sem banco. */
export interface RepositorioUsuarioAuth {
  buscarPorEmail(email: string): Promise<UsuarioComSegredo | undefined>;
  criar(entrada: {
    email: string;
    nome: string;
    papel: 'admin' | 'operador';
    hashSenha: string;
  }): Promise<UsuarioPublico>;
}

/** Hash descartavel usado para igualar o tempo de resposta quando o email nao existe. */
const HASH_DUMMY =
  'scrypt$16384$8$1$00000000000000000000000000000000$' + '0'.repeat(128);

/** Registra um novo usuario. Falha com 409 se o email ja existir. */
export async function registrarUsuario(
  repositorio: RepositorioUsuarioAuth,
  entrada: EntradaRegistro,
): Promise<UsuarioPublico> {
  const existente = await repositorio.buscarPorEmail(entrada.email);
  if (existente) {
    throw new ErroConflito('Email ja cadastrado');
  }

  const hashSenha = await gerarHashSenha(entrada.senha);

  return repositorio.criar({
    email: entrada.email,
    nome: entrada.nome,
    papel: entrada.papel,
    hashSenha,
  });
}

/**
 * Autentica o usuario e devolve o payload que sera assinado como JWT.
 * Nao assina o token aqui - a assinatura pertence a camada HTTP (plugin jwt).
 */
export async function autenticarUsuario(
  repositorio: RepositorioUsuarioAuth,
  entrada: EntradaLogin,
): Promise<UsuarioPublico> {
  const usuario = await repositorio.buscarPorEmail(entrada.email);

  const hashParaComparar = usuario?.hash_senha ?? HASH_DUMMY;
  const senhaConfere = await verificarSenha(entrada.senha, hashParaComparar);

  if (!usuario || !senhaConfere) {
    totalLoginsFalhos.inc({ motivo: usuario ? 'senha_invalida' : 'usuario_inexistente' });
    throw new ErroNaoAutenticado();
  }

  if (!usuario.ativo) {
    totalLoginsFalhos.inc({ motivo: 'usuario_inativo' });
    throw new ErroNaoAutenticado('Usuario desativado');
  }

  return {
    id: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    papel: usuario.papel,
    ativo: usuario.ativo,
    criado_em: usuario.criado_em,
  };
}

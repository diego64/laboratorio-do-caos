/**
 * Responsabilidade : Validar as regras de registro e login sem tocar em banco, usando um
 *                    repositorio em memoria que implementa a porta RepositorioUsuarioAuth.
 * Consumido por    : pnpm test
 * Regra            : Provar que usuario inexistente e senha errada produzem o MESMO erro
 *                    (nao ha enumeracao de usuarios).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { gerarHashSenha, gerarIdentificador } from '../../src/shared/crypto';
import { ErroConflito, ErroNaoAutenticado } from '../../src/shared/errors';
import {
  autenticarUsuario,
  registrarUsuario,
  type RepositorioUsuarioAuth,
} from '../../src/modules/auth/auth.service';
import type { UsuarioComSegredo, UsuarioPublico } from '../../src/modules/users/user.schema';

class RepositorioEmMemoria implements RepositorioUsuarioAuth {
  private readonly registros = new Map<string, UsuarioComSegredo>();

  async buscarPorEmail(email: string): Promise<UsuarioComSegredo | undefined> {
    return this.registros.get(email);
  }

  async criar(entrada: {
    email: string;
    nome: string;
    papel: 'admin' | 'operador';
    hashSenha: string;
  }): Promise<UsuarioPublico> {
    const usuario: UsuarioComSegredo = {
      id: gerarIdentificador(),
      email: entrada.email,
      nome: entrada.nome,
      papel: entrada.papel,
      ativo: true,
      criado_em: new Date().toISOString(),
      hash_senha: entrada.hashSenha,
    };
    this.registros.set(entrada.email, usuario);
    const { hash_senha: _ignorado, ...publico } = usuario;
    return publico;
  }

  async semear(usuario: UsuarioComSegredo): Promise<void> {
    this.registros.set(usuario.email, usuario);
  }
}

describe('auth.service', () => {
  let repositorio: RepositorioEmMemoria;

  beforeEach(() => {
    repositorio = new RepositorioEmMemoria();
  });

  it('registra um usuario novo sem expor o hash', async () => {
    const usuario = await registrarUsuario(repositorio, {
      email: 'diego@chaoslab.dev',
      senha: 'senha-super-segura',
      nome: 'Diego',
      papel: 'admin',
    });

    expect(usuario.email).toBe('diego@chaoslab.dev');
    expect(usuario).not.toHaveProperty('hash_senha');
  });

  it('rejeita email duplicado com 409', async () => {
    const entrada = {
      email: 'dup@chaoslab.dev',
      senha: 'senha-super-segura',
      nome: 'Dup',
      papel: 'operador' as const,
    };
    await registrarUsuario(repositorio, entrada);

    await expect(registrarUsuario(repositorio, entrada)).rejects.toBeInstanceOf(ErroConflito);
  });

  it('autentica com credenciais validas', async () => {
    await registrarUsuario(repositorio, {
      email: 'ok@chaoslab.dev',
      senha: 'senha-super-segura',
      nome: 'Ok',
      papel: 'operador',
    });

    const usuario = await autenticarUsuario(repositorio, {
      email: 'ok@chaoslab.dev',
      senha: 'senha-super-segura',
    });

    expect(usuario.papel).toBe('operador');
  });

  it('nao permite enumerar usuarios: senha errada e email inexistente falham igual', async () => {
    await registrarUsuario(repositorio, {
      email: 'existe@chaoslab.dev',
      senha: 'senha-super-segura',
      nome: 'Existe',
      papel: 'operador',
    });

    const senhaErrada = await autenticarUsuario(repositorio, {
      email: 'existe@chaoslab.dev',
      senha: 'senha-incorreta',
    }).catch((erro: Error) => erro);

    const inexistente = await autenticarUsuario(repositorio, {
      email: 'naoexiste@chaoslab.dev',
      senha: 'senha-incorreta',
    }).catch((erro: Error) => erro);

    expect(senhaErrada).toBeInstanceOf(ErroNaoAutenticado);
    expect(inexistente).toBeInstanceOf(ErroNaoAutenticado);
    expect((senhaErrada as Error).message).toEqual((inexistente as Error).message);
  });

  it('bloqueia usuario desativado', async () => {
    await repositorio.semear({
      id: gerarIdentificador(),
      email: 'inativo@chaoslab.dev',
      nome: 'Inativo',
      papel: 'operador',
      ativo: false,
      criado_em: new Date().toISOString(),
      hash_senha: await gerarHashSenha('senha-super-segura'),
    });

    await expect(
      autenticarUsuario(repositorio, {
        email: 'inativo@chaoslab.dev',
        senha: 'senha-super-segura',
      }),
    ).rejects.toThrow(/desativado/);
  });
});

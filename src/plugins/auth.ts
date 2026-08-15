/**
 * Responsabilidade : Registrar @fastify/jwt e expor o decorator `autenticar`, usado como
 *                    preHandler das rotas protegidas.
 * Consumido por    : src/app.ts, src/modules/users/user.routes.ts,
 *                    src/modules/assets/asset.routes.ts, src/modules/readings/reading.routes.ts
 * Regra            : Token stateless com issuer validado e expiracao curta. Falha de
 *                    verificacao SEMPRE vira ErroNaoAutenticado (401) - nunca 500.
 *                    O payload carrega apenas sub, email e papel; nada sensivel.
 */
import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ambiente } from '../config/env';
import { ErroNaoAutenticado, ErroNaoAutorizado } from '../shared/errors';

export interface PayloadToken {
  sub: string;
  email: string;
  papel: 'admin' | 'operador';
}

declare module 'fastify' {
  interface FastifyInstance {
    autenticar: (requisicao: FastifyRequest, resposta: FastifyReply) => Promise<void>;
    exigirPapel: (
      papel: PayloadToken['papel'],
    ) => (requisicao: FastifyRequest, resposta: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: PayloadToken;
    user: PayloadToken;
  }
}

async function plugin(app: FastifyInstance): Promise<void> {
  const env = ambiente();

  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { iss: env.JWT_ISSUER, expiresIn: env.JWT_EXPIRES_IN_SECONDS * 1000 },
    verify: { allowedIss: env.JWT_ISSUER },
  });

  /** preHandler padrao: valida o Bearer token e popula requisicao.user. */
  app.decorate('autenticar', async (requisicao: FastifyRequest, _resposta: FastifyReply) => {
    try {
      await requisicao.jwtVerify();
    } catch {
      throw new ErroNaoAutenticado();
    }
  });

  /** preHandler de autorizacao por papel. Usar sempre APOS `autenticar`. */
  app.decorate('exigirPapel', (papel: PayloadToken['papel']) => {
    return async (requisicao: FastifyRequest, _resposta: FastifyReply) => {
      const usuario = requisicao.user;
      if (!usuario) throw new ErroNaoAutenticado();
      if (usuario.papel !== papel) throw new ErroNaoAutorizado();
    };
  });
}

export const pluginAutenticacao = fp(plugin, { name: 'auth-plugin' });

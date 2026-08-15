/**
 * Responsabilidade : Expor POST /auth/register e POST /auth/login, traduzindo HTTP <-> dominio.
 * Consumido por    : src/app.ts
 * Regra            : A rota nao contem regra de negocio - apenas parse (Zod), delegacao ao
 *                    service e assinatura do JWT. Rate limit mais agressivo no login para
 *                    conter forca bruta.
 */
import type { FastifyInstance } from 'fastify';
import { ambiente } from '../../config/env';
import { jsonSchemaProblema, paraJsonSchema } from '../../shared/openapi';
import * as repositorioUsuario from '../users/user.repository';
import { esquemaLogin, esquemaRegistro } from './auth.schema';
import { autenticarUsuario, registrarUsuario } from './auth.service';

/** Registra as rotas de autenticacao. */
export async function rotasAutenticacao(app: FastifyInstance): Promise<void> {
  const env = ambiente();

  app.post(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Cria um usuario',
        body: paraJsonSchema(esquemaRegistro),
        response: {
          201: { type: 'object', additionalProperties: true },
          409: jsonSchemaProblema,
          422: jsonSchemaProblema,
        },
      },
    },
    async (requisicao, resposta) => {
      const entrada = esquemaRegistro.parse(requisicao.body);
      const usuario = await registrarUsuario(repositorioUsuario, entrada);
      return resposta.code(201).send(usuario);
    },
  );

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Autentica e devolve um JWT',
        body: paraJsonSchema(esquemaLogin),
        response: {
          200: { type: 'object', additionalProperties: true },
          401: jsonSchemaProblema,
          422: jsonSchemaProblema,
        },
      },
    },
    async (requisicao, resposta) => {
      const entrada = esquemaLogin.parse(requisicao.body);
      const usuario = await autenticarUsuario(repositorioUsuario, entrada);

      const token = app.jwt.sign({
        sub: usuario.id,
        email: usuario.email,
        papel: usuario.papel,
      });

      return resposta.code(200).send({
        access_token: token,
        token_type: 'Bearer',
        expires_in: env.JWT_EXPIRES_IN_SECONDS,
        usuario,
      });
    },
  );
}

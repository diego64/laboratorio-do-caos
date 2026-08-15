/**
 * Responsabilidade : Expor GET /users/me e GET /users (listagem restrita a admin).
 * Consumido por    : src/app.ts
 * Regra            : Toda rota aqui exige JWT valido. A listagem exige papel admin -
 *                    autorizacao e verificada por preHandler, nunca dentro do handler.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErroNaoEncontrado } from '../../shared/errors';
import { jsonSchemaProblema, paraJsonSchema } from '../../shared/openapi';
import { buscarPorId, listar } from './user.repository';

const esquemaPaginacao = z.object({
  limite: z.coerce.number().int().min(1).max(100).default(20),
  pagina: z.coerce.number().int().min(1).default(1),
});

/** Registra as rotas de usuario. */
export async function rotasUsuarios(app: FastifyInstance): Promise<void> {
  app.get(
    '/users/me',
    {
      preHandler: [app.autenticar],
      schema: {
        tags: ['users'],
        summary: 'Dados do usuario autenticado',
        security: [{ bearerAuth: [] }],
        response: {
          200: { type: 'object', additionalProperties: true },
          401: jsonSchemaProblema,
          404: jsonSchemaProblema,
        },
      },
    },
    async (requisicao) => {
      const usuario = await buscarPorId(requisicao.user.sub);
      if (!usuario) throw new ErroNaoEncontrado('Usuario');
      return usuario;
    },
  );

  app.get(
    '/users',
    {
      preHandler: [app.autenticar, app.exigirPapel('admin')],
      schema: {
        tags: ['users'],
        summary: 'Lista usuarios (apenas admin)',
        security: [{ bearerAuth: [] }],
        querystring: paraJsonSchema(esquemaPaginacao),
        response: {
          200: { type: 'array', items: { type: 'object', additionalProperties: true } },
          401: jsonSchemaProblema,
          403: jsonSchemaProblema,
        },
      },
    },
    async (requisicao) => {
      const { limite, pagina } = esquemaPaginacao.parse(requisicao.query);
      return listar(limite, (pagina - 1) * limite);
    },
  );
}

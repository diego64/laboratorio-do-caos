/**
 * Responsabilidade : Expor o CRUD de ativos e o calculo de situacao da manutencao preventiva.
 * Consumido por    : src/app.ts
 * Regra            : Leitura exige apenas token valido; escrita exige papel admin.
 *                    Nenhuma regra de negocio no handler - tudo delegado ao service.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jsonSchemaProblema, paraJsonSchema } from '../../shared/openapi';
import {
  esquemaCriacaoAtivo,
  esquemaListagemAtivos,
} from './asset.schema';
import {
  calcularSituacaoManutencao,
  criarAtivo,
  listarAtivos,
  obterAtivo,
  registrarManutencao,
} from './asset.service';

const esquemaParametroId = z.object({ id: z.string().uuid() });
const esquemaManutencao = z.object({
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD')
    .optional(),
});

/** Registra as rotas de ativos. */
export async function rotasAtivos(app: FastifyInstance): Promise<void> {
  app.post(
    '/assets',
    {
      preHandler: [app.autenticar, app.exigirPapel('admin')],
      schema: {
        tags: ['assets'],
        summary: 'Cadastra um ativo',
        security: [{ bearerAuth: [] }],
        body: paraJsonSchema(esquemaCriacaoAtivo),
        response: {
          201: { type: 'object', additionalProperties: true },
          409: jsonSchemaProblema,
          422: jsonSchemaProblema,
        },
      },
    },
    async (requisicao, resposta) => {
      const entrada = esquemaCriacaoAtivo.parse(requisicao.body);
      const ativo = await criarAtivo(entrada);
      return resposta.code(201).send(ativo);
    },
  );

  app.get(
    '/assets',
    {
      preHandler: [app.autenticar],
      schema: {
        tags: ['assets'],
        summary: 'Lista ativos',
        security: [{ bearerAuth: [] }],
        querystring: paraJsonSchema(esquemaListagemAtivos),
        response: {
          200: { type: 'array', items: { type: 'object', additionalProperties: true } },
          401: jsonSchemaProblema,
        },
      },
    },
    async (requisicao) => listarAtivos(esquemaListagemAtivos.parse(requisicao.query)),
  );

  app.get(
    '/assets/:id',
    {
      preHandler: [app.autenticar],
      schema: {
        tags: ['assets'],
        summary: 'Detalha um ativo com a situacao da manutencao preventiva',
        security: [{ bearerAuth: [] }],
        params: paraJsonSchema(esquemaParametroId),
        response: {
          200: { type: 'object', additionalProperties: true },
          404: jsonSchemaProblema,
        },
      },
    },
    async (requisicao) => {
      const { id } = esquemaParametroId.parse(requisicao.params);
      const ativo = await obterAtivo(id);
      return { ...ativo, manutencao: calcularSituacaoManutencao(ativo) };
    },
  );

  app.post(
    '/assets/:id/maintenance',
    {
      preHandler: [app.autenticar, app.exigirPapel('admin')],
      schema: {
        tags: ['assets'],
        summary: 'Registra a execucao da manutencao preventiva',
        security: [{ bearerAuth: [] }],
        params: paraJsonSchema(esquemaParametroId),
        body: paraJsonSchema(esquemaManutencao),
        response: {
          200: { type: 'object', additionalProperties: true },
          404: jsonSchemaProblema,
        },
      },
    },
    async (requisicao) => {
      const { id } = esquemaParametroId.parse(requisicao.params);
      const { data } = esquemaManutencao.parse(requisicao.body ?? {});
      return registrarManutencao(id, data);
    },
  );
}

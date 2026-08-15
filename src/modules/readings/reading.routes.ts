/**
 * Responsabilidade : Expor a ingestao de leituras (com assinatura HMAC opcional para
 *                    coletores de campo) e as consultas de serie/estatisticas.
 * Consumido por    : src/app.ts
 * Regra            : A ingestao aceita DOIS modos de autenticacao - JWT (operador humano)
 *                    ou assinatura HMAC no header x-signature (dispositivo de campo).
 *                    Exatamente um deles precisa ser valido; ausencia dos dois => 401.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ambiente } from '../../config/env';
import { validarAssinatura } from '../../shared/crypto';
import { ErroNaoAutenticado } from '../../shared/errors';
import { jsonSchemaProblema, paraJsonSchema } from '../../shared/openapi';
import { esquemaConsultaLeituras, esquemaIngestaoLeitura } from './reading.schema';
import { ingerirLeitura, listarLeituras, resumirUltimas24h } from './reading.service';

const esquemaParametroAtivo = z.object({ assetId: z.string().uuid() });

/**
 * Autentica a ingestao por HMAC quando o header x-signature esta presente,
 * caindo para JWT caso contrario. Qualquer falha vira 401 - nunca 500.
 */
async function autenticarIngestao(requisicao: FastifyRequest): Promise<void> {
  const assinatura = requisicao.headers['x-signature'];

  if (typeof assinatura === 'string' && assinatura.length > 0) {
    const corpoBruto = JSON.stringify(requisicao.body ?? {});
    if (!validarAssinatura(corpoBruto, assinatura, ambiente().WEBHOOK_HMAC_SECRET)) {
      throw new ErroNaoAutenticado('Assinatura HMAC invalida');
    }
    return;
  }

  try {
    await requisicao.jwtVerify();
  } catch {
    throw new ErroNaoAutenticado();
  }
}

/** Registra as rotas de leituras. */
export async function rotasLeituras(app: FastifyInstance): Promise<void> {
  app.post(
    '/readings',
    {
      schema: {
        tags: ['readings'],
        summary: 'Ingere uma leitura de telemetria (JWT ou assinatura HMAC)',
        body: paraJsonSchema(esquemaIngestaoLeitura),
        response: {
          201: { type: 'object', additionalProperties: true },
          401: jsonSchemaProblema,
          404: jsonSchemaProblema,
          422: jsonSchemaProblema,
        },
      },
    },
    async (requisicao, resposta) => {
      await autenticarIngestao(requisicao);
      const entrada = esquemaIngestaoLeitura.parse(requisicao.body);
      const leitura = await ingerirLeitura(entrada);
      return resposta.code(201).send(leitura);
    },
  );

  app.get(
    '/readings/:assetId',
    {
      preHandler: [app.autenticar],
      schema: {
        tags: ['readings'],
        summary: 'Lista leituras de um ativo',
        security: [{ bearerAuth: [] }],
        params: paraJsonSchema(esquemaParametroAtivo),
        querystring: paraJsonSchema(esquemaConsultaLeituras),
        response: {
          200: { type: 'array', items: { type: 'object', additionalProperties: true } },
          404: jsonSchemaProblema,
        },
      },
    },
    async (requisicao) => {
      const { assetId } = esquemaParametroAtivo.parse(requisicao.params);
      const filtro = esquemaConsultaLeituras.parse(requisicao.query);
      return listarLeituras(assetId, filtro);
    },
  );

  app.get(
    '/readings/:assetId/summary',
    {
      preHandler: [app.autenticar],
      schema: {
        tags: ['readings'],
        summary: 'Resumo estatistico das ultimas 24 horas',
        security: [{ bearerAuth: [] }],
        params: paraJsonSchema(esquemaParametroAtivo),
        response: {
          200: { type: 'array', items: { type: 'object', additionalProperties: true } },
          404: jsonSchemaProblema,
        },
      },
    },
    async (requisicao) => {
      const { assetId } = esquemaParametroAtivo.parse(requisicao.params);
      return resumirUltimas24h(assetId);
    },
  );
}

/**
 * Responsabilidade : Montar a instancia Fastify - plugins de seguranca, observabilidade,
 *                    documentacao, handler global de erros e registro de todas as rotas.
 * Consumido por    : src/server.ts (producao) e tests/integration/* (via app.inject)
 * Regra            : Esta funcao NAO abre porta e NAO conecta em banco no import. Isso a
 *                    torna testavel com app.inject() sem infraestrutura. A ordem de registro
 *                    importa: seguranca -> observabilidade -> docs -> rotas.
 */
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ambiente } from './config/env';
import { criarLogger } from './shared/logger';
import { tratarErro, tratarNaoEncontrado } from './shared/error-handler';
import { pluginAutenticacao } from './plugins/auth';
import { registrarSwagger } from './plugins/swagger';
import {
  iniciarMetricasPadrao,
  normalizarRota,
  registrarRequisicao,
  requisicoesEmVoo,
} from './observability/metrics';
import { rotasSaude } from './modules/health/health.routes';
import { rotasAutenticacao } from './modules/auth/auth.routes';
import { rotasUsuarios } from './modules/users/user.routes';
import { rotasAtivos } from './modules/assets/asset.routes';
import { rotasLeituras } from './modules/readings/reading.routes';

declare module 'fastify' {
  interface FastifyRequest {
    inicioEmNs?: bigint;
  }
}

/** Constroi e retorna a aplicacao Fastify pronta para uso. */
export async function construirAplicacao(): Promise<FastifyInstance> {
  const env = ambiente();

  const app = Fastify({
    loggerInstance: criarLogger() as unknown as FastifyBaseLogger,
    trustProxy: true,
    requestIdHeader: 'x-correlation-id',
    bodyLimit: 1024 * 512,
    ajv: { customOptions: { strict: false, coerceTypes: true, removeAdditional: false } },
  });

  // --- Seguranca ---
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.NODE_ENV === 'production' ? false : true });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    allowList: (requisicao) => requisicao.url.startsWith('/health'),
  });
  await app.register(pluginAutenticacao);

  // --- Observabilidade: metricas RED por requisicao ---
  iniciarMetricasPadrao();

  app.addHook('onRequest', async (requisicao) => {
    requisicao.inicioEmNs = process.hrtime.bigint();
    requisicoesEmVoo.inc();
  });

  app.addHook('onResponse', async (requisicao, resposta) => {
    requisicoesEmVoo.dec();
    const inicio = requisicao.inicioEmNs;
    if (inicio === undefined) return;
    const duracaoSegundos = Number(process.hrtime.bigint() - inicio) / 1e9;
    registrarRequisicao(
      requisicao.method,
      normalizarRota(requisicao.routeOptions?.url, requisicao.url),
      resposta.statusCode,
      duracaoSegundos,
    );
  });

  // --- Documentacao ---
  await registrarSwagger(app);

  // --- Erros ---
  app.setErrorHandler(tratarErro);
  app.setNotFoundHandler(tratarNaoEncontrado);

  // --- Rotas ---
  await app.register(rotasSaude);
  await app.register(rotasAutenticacao);
  await app.register(rotasUsuarios);
  await app.register(rotasAtivos);
  await app.register(rotasLeituras);

  await app.ready();
  return app;
}

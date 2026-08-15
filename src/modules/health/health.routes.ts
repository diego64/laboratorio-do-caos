/**
 * Responsabilidade : Sondas operacionais - /health/live (liveness), /health/ready
 *                    (readiness com checagem de dependencias), /health/startup e /metrics.
 * Consumido por    : Docker HEALTHCHECK, probes do Kubernetes, scrape do Prometheus,
 *                    health check do Render.
 * Regra            : LIVENESS NUNCA toca dependencia externa - se o processo responde, esta
 *                    vivo. READINESS checa Postgres e Mongo e retorna 503 se algum falhar,
 *                    tirando o pod do balanceamento sem reinicia-lo.
 */
import type { FastifyInstance } from 'fastify';
import { ambiente } from '../../config/env';
import { verificarSaudePostgres } from '../../infra/postgres';
import { verificarSaudeMongo } from '../../infra/mongo';
import { registroMetricas, saudeDependencia } from '../../observability/metrics';

const inicioProcesso = Date.now();

/** Registra as rotas de saude e a exposicao de metricas. */
export async function rotasSaude(app: FastifyInstance): Promise<void> {
  const env = ambiente();

  app.get(
    '/health/live',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness probe - nao toca dependencias externas',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              uptime_seconds: { type: 'number' },
              version: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({
      status: 'alive',
      uptime_seconds: Math.floor((Date.now() - inicioProcesso) / 1000),
      version: env.SERVICE_VERSION,
    }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness probe - verifica PostgreSQL e MongoDB',
        response: {
          200: { type: 'object', additionalProperties: true },
          503: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (_requisicao, resposta) => {
      const [postgresOk, mongoOk] = await Promise.all([
        verificarSaudePostgres(),
        verificarSaudeMongo(),
      ]);

      saudeDependencia.set({ dependency: 'postgres' }, postgresOk ? 1 : 0);
      saudeDependencia.set({ dependency: 'mongodb' }, mongoOk ? 1 : 0);

      const pronto = postgresOk && mongoOk;
      const status = pronto ? 200 : (503 as const);
      return resposta.code(status).send({
        status: pronto ? 'ready' : 'degraded',
        dependencies: {
          postgres: postgresOk ? 'up' : 'down',
          mongodb: mongoOk ? 'up' : 'down',
        },
        checked_at: new Date().toISOString(),
      });
    },
  );

  app.get(
    '/health/startup',
    {
      schema: {
        tags: ['health'],
        summary: 'Startup probe - considera o boot concluido apos 5s de uptime',
        response: {
          200: { type: 'object', additionalProperties: true },
          503: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (_requisicao, resposta) => {
      const uptime = Date.now() - inicioProcesso;
      const iniciado = uptime > 5000;
      const status = iniciado ? 200 : (503 as const);
      return resposta.code(status).send({
        status: iniciado ? 'started' : 'starting',
        uptime_ms: uptime,
      });
    },
  );

  app.get(
    env.METRICS_PATH,
    {
      schema: {
        tags: ['health'],
        summary: 'Exposicao de metricas no formato Prometheus text/plain',
        response: { 200: { type: 'string' } },
      },
    },
    async (_requisicao, resposta) => {
      const corpo = await registroMetricas.metrics();
      return resposta.type(registroMetricas.contentType).send(corpo);
    },
  );
}

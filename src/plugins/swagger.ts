/**
 * Responsabilidade : Registrar @fastify/swagger e @fastify/swagger-ui, publicando o
 *                    contrato OpenAPI 3.1 em /docs/json e a UI em /docs.
 * Consumido por    : src/app.ts
 * Regra            : O contrato e gerado a partir dos JSON Schemas das rotas, que por sua
 *                    vez derivam dos schemas Zod (fonte unica da verdade). Documentacao
 *                    desatualizada e falha de build, nao detalhe cosmetico.
 */
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ambiente } from '../config/env';

/** Registra a documentacao OpenAPI na instancia Fastify. */
export async function registrarSwagger(app: FastifyInstance): Promise<void> {
  const env = ambiente();

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Chaos Lab API',
        description:
          'API de manutencao de ativos usada como alvo do laboratorio de engenharia do caos.',
        version: env.SERVICE_VERSION,
      },
      servers: [{ url: `http://localhost:${env.PORT}`, description: 'local' }],
      tags: [
        { name: 'health', description: 'Sondas de liveness e readiness' },
        { name: 'auth', description: 'Registro e autenticacao' },
        { name: 'users', description: 'Usuarios' },
        { name: 'assets', description: 'Ativos monitorados (PostgreSQL)' },
        { name: 'readings', description: 'Leituras de telemetria (MongoDB)' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}

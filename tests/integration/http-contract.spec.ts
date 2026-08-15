/**
 * Responsabilidade : Validar o contrato HTTP da aplicacao inteira via app.inject(), sem
 *                    abrir porta e sem depender de PostgreSQL/MongoDB.
 * Consumido por    : pnpm test / pipeline de CI (job que roda sem services)
 * Regra            : Somente rotas que nao tocam banco entram aqui. Rotas com dependencia
 *                    real ficam no job de integracao com services do docker-compose.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { construirAplicacao } from '../../src/app';

let app: FastifyInstance;

beforeAll(async () => {
  app = await construirAplicacao();
});

afterAll(async () => {
  await app.close();
});

describe('contrato HTTP', () => {
  it('liveness responde 200 sem tocar dependencias', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health/live' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ status: 'alive' });
  });

  it('expoe metricas no formato Prometheus', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/metrics' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain('http_requests_total');
    expect(resposta.body).toContain('nodejs_process_cpu_seconds_total');
  });

  it('publica o contrato OpenAPI', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/docs/json' });
    const contrato = resposta.json();

    expect(resposta.statusCode).toBe(200);
    expect(contrato.openapi).toMatch(/^3\./);
    expect(Object.keys(contrato.paths)).toContain('/auth/login');
    expect(Object.keys(contrato.paths)).toContain('/assets/{id}');
  });

  it('rota inexistente responde 404 em RFC 7807', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/nao-existe' });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.headers['content-type']).toContain('application/problem+json');
    expect(resposta.json()).toMatchObject({ status: 404, title: 'Rota nao encontrada' });
  });

  it('rota protegida sem token responde 401 em RFC 7807', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/users/me' });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json()).toMatchObject({
      status: 401,
      type: 'https://chaoslab.dev/errors/unauthenticated',
    });
  });

  it('rota protegida com token invalido responde 401, nunca 500', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: 'Bearer token.invalido.aqui' },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it('payload invalido responde 422 com lista de campos', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nao-e-email', senha: '' },
    });

    expect(resposta.statusCode).toBe(422);
    const problema = resposta.json();
    expect(problema.status).toBe(422);
    expect(Array.isArray(problema.errors)).toBe(true);
  });

  it('propaga o correlationId recebido no header', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/nao-existe',
      headers: { 'x-correlation-id': 'trace-123' },
    });

    expect(resposta.json().correlationId).toBe('trace-123');
  });
});

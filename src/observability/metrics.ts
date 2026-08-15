/**
 * Responsabilidade : Registro Prometheus do servico - metricas default do processo,
 *                    metricas RED de HTTP e metricas de dominio. Expoe o registry para
 *                    a rota /metrics.
 * Consumido por    : src/app.ts (hooks onRequest/onResponse), src/modules/health/health.routes.ts,
 *                    src/modules/readings/reading.service.ts
 * Regra            : Cardinalidade controlada - o label "route" usa o padrao da rota
 *                    (/assets/:id), NUNCA a URL concreta. Nome de metrica sempre com
 *                    unidade no sufixo (_seconds, _total, _bytes).
 */
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { ambiente } from '../config/env';

export const registroMetricas = new Registry();

/** Inicializa as metricas default do processo Node (heap, event loop, GC, handles). */
export function iniciarMetricasPadrao(): void {
  const env = ambiente();
  registroMetricas.setDefaultLabels({
    service: env.SERVICE_NAME,
    version: env.SERVICE_VERSION,
  });
  collectDefaultMetrics({ register: registroMetricas, prefix: 'nodejs_' });
}

export const totalRequisicoesHttp = new Counter({
  name: 'http_requests_total',
  help: 'Total de requisicoes HTTP processadas',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registroMetricas],
});

export const duracaoRequisicoesHttp = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duracao das requisicoes HTTP em segundos',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registroMetricas],
});

export const requisicoesEmVoo = new Gauge({
  name: 'http_requests_in_flight',
  help: 'Requisicoes HTTP em processamento neste instante',
  registers: [registroMetricas],
});

export const totalLoginsFalhos = new Counter({
  name: 'auth_login_failures_total',
  help: 'Total de tentativas de login rejeitadas',
  labelNames: ['motivo'] as const,
  registers: [registroMetricas],
});

export const totalLeiturasIngeridas = new Counter({
  name: 'readings_ingested_total',
  help: 'Total de leituras de ativos ingeridas no MongoDB',
  labelNames: ['tipo'] as const,
  registers: [registroMetricas],
});

export const saudeDependencia = new Gauge({
  name: 'dependency_up',
  help: 'Estado da dependencia externa (1 = saudavel, 0 = indisponivel)',
  labelNames: ['dependency'] as const,
  registers: [registroMetricas],
});

/** Normaliza a rota para manter a cardinalidade baixa no Prometheus. */
export function normalizarRota(rota: string | undefined, url: string): string {
  if (rota && rota.length > 0) return rota;
  const semQuery = url.split('?')[0] ?? url;
  return semQuery.replace(/\/[0-9a-fA-F-]{8,}/g, '/:id');
}

/** Registra uma observacao completa de requisicao HTTP. */
export function registrarRequisicao(
  metodo: string,
  rota: string,
  status: number,
  duracaoSegundos: number,
): void {
  const rotulos = { method: metodo, route: rota, status_code: String(status) };
  totalRequisicoesHttp.inc(rotulos);
  duracaoRequisicoesHttp.observe(rotulos, duracaoSegundos);
}

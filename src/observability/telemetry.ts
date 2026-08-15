/**
 * Responsabilidade : Inicializar o SDK OpenTelemetry (traces) com exportador OTLP/HTTP e
 *                    auto-instrumentacao de http, fastify, pg e mongodb.
 * Consumido por    : src/server.ts - PRECISA ser inicializado ANTES do require dos modulos
 *                    instrumentados (por isso o import dinamico em server.ts).
 * Regra            : Falha do collector NUNCA derruba a aplicacao - o exportador apenas
 *                    registra warning. Instrumentacao de fs/dns fica desligada (ruido).
 *                    A identidade do recurso e propagada via OTEL_SERVICE_NAME /
 *                    OTEL_RESOURCE_ATTRIBUTES, lidas nativamente pelo SDK.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ambiente } from '../config/env';

let sdk: NodeSDK | undefined;

/** Liga o tracing distribuido. No-op quando OTEL_ENABLED=false. */
export function iniciarTelemetria(): void {
  const env = ambiente();
  if (!env.OTEL_ENABLED) return;

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  process.env.OTEL_SERVICE_NAME ??= env.SERVICE_NAME;
  process.env.OTEL_RESOURCE_ATTRIBUTES ??= [
    `service.version=${env.SERVICE_VERSION}`,
    `deployment.environment=${env.NODE_ENV}`,
  ].join(',');

  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces`,
      timeoutMillis: 5000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

/** Encerra o SDK no graceful shutdown, drenando spans pendentes. */
export async function pararTelemetria(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown().catch(() => undefined);
  sdk = undefined;
}

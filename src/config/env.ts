/**
 * Responsabilidade : Validar e tipar TODAS as variaveis de ambiente no boot do processo.
 *                    Falha rapido (fail-fast) antes de qualquer conexao ou bind de porta.
 * Consumido por    : src/server.ts, src/app.ts, src/infra/*, src/plugins/*, scripts/*
 * Regra            : Nenhum modulo pode ler process.env diretamente. Toda leitura passa
 *                    por aqui. Segredos tem tamanho minimo obrigatorio. Sem defaults
 *                    silenciosos para credenciais.
 */
import { z } from 'zod';

const esquemaAmbiente = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().min(1).default('chaos-lab-api'),
  SERVICE_VERSION: z.string().min(1).default('1.0.0'),

  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- PostgreSQL (dados relacionais: usuarios, ativos) ---
  POSTGRES_URL: z.string().url(),
  POSTGRES_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  POSTGRES_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),

  // --- MongoDB (serie temporal: leituras dos ativos) ---
  MONGO_URL: z.string().min(1),
  MONGO_DB: z.string().min(1).default('chaoslab'),
  MONGO_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),

  // --- Seguranca ---
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de no minimo 32 caracteres'),
  JWT_ISSUER: z.string().min(1).default('chaos-lab'),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  WEBHOOK_HMAC_SECRET: z.string().min(16, 'WEBHOOK_HMAC_SECRET precisa de no minimo 16 caracteres'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),

  // --- Observabilidade ---
  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((valor) => valor === 'true'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default('http://localhost:4318'),
  METRICS_PATH: z.string().startsWith('/').default('/metrics'),
});

export type Ambiente = z.infer<typeof esquemaAmbiente>;

/**
 * Carrega e valida o ambiente. Lanca erro legivel com a lista completa de problemas
 * em vez de estourar um erro obscuro na primeira conexao.
 */
export function carregarAmbiente(fonte: NodeJS.ProcessEnv = process.env): Ambiente {
  const resultado = esquemaAmbiente.safeParse(fonte);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variaveis de ambiente invalidas:\n${problemas}`);
  }

  return resultado.data;
}

let cache: Ambiente | undefined;

/** Singleton do ambiente validado. Evita revalidar a cada import. */
export function ambiente(): Ambiente {
  if (!cache) cache = carregarAmbiente();
  return cache;
}

/** Util para testes: descarta o cache do ambiente. */
export function limparCacheAmbiente(): void {
  cache = undefined;
}

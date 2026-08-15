/**
 * Responsabilidade : Instanciar o logger estruturado (pino) com redacao de campos sensiveis
 *                    e correlacao com o trace ativo do OpenTelemetry.
 * Consumido por    : src/app.ts (logger do Fastify), src/infra/*, scripts/*
 * Regra            : Log SEMPRE em JSON fora de development. Nunca logar senha, token,
 *                    authorization header ou connection string completa.
 */
import { pino, type Logger } from 'pino';
import { ambiente } from '../config/env';

/** Cria o logger raiz do servico. */
export function criarLogger(): Logger {
  const env = ambiente();

  return pino({
    level: env.LOG_LEVEL,
    base: {
      service: env.SERVICE_NAME,
      version: env.SERVICE_VERSION,
      env: env.NODE_ENV,
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'senha',
        '*.password',
        '*.senha',
        '*.token',
        '*.jwt_secret',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
        : undefined,
  });
}

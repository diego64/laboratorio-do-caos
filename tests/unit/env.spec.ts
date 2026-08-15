/**
 * Responsabilidade : Provar que o contrato de ambiente falha rapido e com mensagem util.
 * Consumido por    : pnpm test
 * Regra            : Segredo curto e URL invalida precisam ser rejeitados no boot.
 */
import { describe, expect, it } from 'vitest';
import { carregarAmbiente } from '../../src/config/env';

const base = {
  POSTGRES_URL: 'postgresql://chaos:chaos@localhost:5432/chaoslab',
  MONGO_URL: 'mongodb://localhost:27017',
  JWT_SECRET: 'x'.repeat(32),
  WEBHOOK_HMAC_SECRET: 'y'.repeat(16),
};

describe('config/env', () => {
  it('aceita um ambiente minimo valido e aplica defaults', () => {
    const env = carregarAmbiente(base as NodeJS.ProcessEnv);

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.METRICS_PATH).toBe('/metrics');
    expect(env.OTEL_ENABLED).toBe(true);
  });

  it('rejeita JWT_SECRET curto', () => {
    expect(() => carregarAmbiente({ ...base, JWT_SECRET: 'curto' } as NodeJS.ProcessEnv)).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejeita POSTGRES_URL que nao e URL', () => {
    expect(() =>
      carregarAmbiente({ ...base, POSTGRES_URL: 'localhost' } as NodeJS.ProcessEnv),
    ).toThrow(/POSTGRES_URL/);
  });

  it('coage PORT textual para numero', () => {
    const env = carregarAmbiente({ ...base, PORT: '8080' } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(8080);
  });
});

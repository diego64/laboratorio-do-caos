/**
 * Responsabilidade : Definir um ambiente valido e deterministico para a suite de testes,
 *                    antes de qualquer import que leia process.env.
 * Consumido por    : vitest.config.ts (setupFiles)
 * Regra            : Nenhum teste depende de .env do desenvolvedor. Telemetria desligada.
 */
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'fatal';
process.env['OTEL_ENABLED'] = 'false';
process.env['POSTGRES_URL'] ??= 'postgresql://chaos:chaos@localhost:5432/laboratorio-do-caos-test';
process.env['MONGO_URL'] ??= 'mongodb://localhost:27017/laboratorio-do-caos-test';
process.env['MONGO_DB'] ??= 'laboratorio-do-caos-test';
process.env['JWT_SECRET'] ??= 'segredo-de-teste-com-mais-de-32-caracteres-ok';
process.env['WEBHOOK_HMAC_SECRET'] ??= 'segredo-hmac-de-teste';

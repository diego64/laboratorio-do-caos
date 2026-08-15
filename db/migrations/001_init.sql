-- SPEC: db/migrations/001_init.sql
-- Responsabilidade : Esquema base do servico - tabelas users e assets.
-- Consumido por    : scripts/migrate.ts, entrypoint do container postgres
-- Regra            : Toda migracao e idempotente (IF NOT EXISTS) e nao destrutiva.
--                    Rollback manual documentado em docs/runbooks/.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  nome          TEXT NOT NULL,
  papel         TEXT NOT NULL DEFAULT 'operador' CHECK (papel IN ('admin', 'operador')),
  hash_senha    TEXT NOT NULL,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_criado_em ON users (criado_em DESC);

CREATE TABLE IF NOT EXISTS assets (
  id                        UUID PRIMARY KEY,
  tag                       TEXT NOT NULL UNIQUE,
  nome                      TEXT NOT NULL,
  local                     TEXT NOT NULL,
  criticidade               TEXT NOT NULL DEFAULT 'media'
                            CHECK (criticidade IN ('baixa','media','alta','critica')),
  intervalo_manutencao_dias INTEGER NOT NULL DEFAULT 90 CHECK (intervalo_manutencao_dias > 0),
  ultima_manutencao_em      DATE,
  criado_em                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_criticidade ON assets (criticidade);
CREATE INDEX IF NOT EXISTS idx_assets_criado_em ON assets (criado_em DESC);

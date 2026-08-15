-- SPEC: db/migrations/002_audit.sql
-- Responsabilidade : Trilha de auditoria das manutencoes registradas.
-- Consumido por    : scripts/migrate.ts
-- Regra            : Append-only. Nenhum UPDATE ou DELETE e permitido nesta tabela.

CREATE TABLE IF NOT EXISTS maintenance_log (
  id           BIGSERIAL PRIMARY KEY,
  asset_id     UUID NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  executado_em DATE NOT NULL,
  registrado_por UUID REFERENCES users (id),
  registrado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_log_asset ON maintenance_log (asset_id, executado_em DESC);

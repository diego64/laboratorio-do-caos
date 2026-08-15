/**
 * Responsabilidade : Contratos das leituras de telemetria dos ativos (documento MongoDB).
 * Consumido por    : reading.routes.ts, reading.service.ts, reading.repository.ts
 * Regra            : `capturedAt` e sempre ISO-8601 em UTC. Valor numerico obrigatorio -
 *                    leitura sem valor e descartada na borda, nunca persistida como null.
 */
import { z } from 'zod';

export const tiposLeitura = ['temperatura', 'vibracao', 'pressao', 'corrente'] as const;

export const esquemaIngestaoLeitura = z.object({
  assetId: z.string().uuid('assetId precisa ser um UUID valido'),
  tipo: z.enum(tiposLeitura),
  valor: z.coerce.number().finite(),
  unidade: z.string().min(1).max(16),
  capturedAt: z
    .string()
    .datetime({ offset: true })
    .default(() => new Date().toISOString()),
});

export const esquemaConsultaLeituras = z.object({
  limite: z.coerce.number().int().min(1).max(500).default(100),
  desde: z.string().datetime({ offset: true }).optional(),
  tipo: z.enum(tiposLeitura).optional(),
});

export interface DocumentoLeitura {
  _id?: unknown;
  assetId: string;
  tipo: (typeof tiposLeitura)[number];
  valor: number;
  unidade: string;
  capturedAt: Date;
  ingestedAt: Date;
}

export type EntradaIngestaoLeitura = z.infer<typeof esquemaIngestaoLeitura>;
export type FiltroConsultaLeituras = z.infer<typeof esquemaConsultaLeituras>;

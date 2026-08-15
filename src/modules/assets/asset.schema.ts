/**
 * Responsabilidade : Contratos do agregado Ativo (equipamento monitorado).
 * Consumido por    : asset.routes.ts, asset.service.ts, asset.repository.ts
 * Regra            : `tag` e a chave natural de negocio, unica e imutavel apos a criacao.
 *                    `criticidade` dirige o SLA de manutencao e nao aceita valor livre.
 */
import { z } from 'zod';

export const criticidades = ['baixa', 'media', 'alta', 'critica'] as const;

export const esquemaCriacaoAtivo = z.object({
  tag: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[A-Z0-9-]+$/, 'Tag aceita apenas maiusculas, numeros e hifen'),
  nome: z.string().min(3).max(160),
  local: z.string().min(2).max(160),
  criticidade: z.enum(criticidades).default('media'),
  intervalo_manutencao_dias: z.coerce.number().int().min(1).max(3650).default(90),
});

export const esquemaAtivo = z.object({
  id: z.string().uuid(),
  tag: z.string(),
  nome: z.string(),
  local: z.string(),
  criticidade: z.enum(criticidades),
  intervalo_manutencao_dias: z.number().int(),
  ultima_manutencao_em: z.string().nullable(),
  criado_em: z.string(),
});

export const esquemaListagemAtivos = z.object({
  limite: z.coerce.number().int().min(1).max(100).default(20),
  pagina: z.coerce.number().int().min(1).default(1),
  criticidade: z.enum(criticidades).optional(),
});

export type EntradaCriacaoAtivo = z.infer<typeof esquemaCriacaoAtivo>;
export type Ativo = z.infer<typeof esquemaAtivo>;
export type FiltroListagemAtivos = z.infer<typeof esquemaListagemAtivos>;

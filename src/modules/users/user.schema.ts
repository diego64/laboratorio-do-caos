/**
 * Responsabilidade : Tipos e contratos do agregado Usuario.
 * Consumido por    : user.repository.ts, user.service.ts, user.routes.ts, auth.service.ts
 * Regra            : UsuarioPublico NUNCA carrega hash_senha. Toda saida HTTP usa
 *                    UsuarioPublico - o tipo e a barreira contra vazamento de credencial.
 */
import { z } from 'zod';

export const esquemaUsuarioPublico = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  nome: z.string(),
  papel: z.enum(['admin', 'operador']),
  ativo: z.boolean(),
  criado_em: z.string(),
});

export type UsuarioPublico = z.infer<typeof esquemaUsuarioPublico>;

/** Projecao interna que inclui o segredo. Nunca serializar em resposta HTTP. */
export interface UsuarioComSegredo extends UsuarioPublico {
  hash_senha: string;
}

export const esquemaAtualizacaoUsuario = z.object({
  nome: z.string().min(2).max(120).optional(),
  ativo: z.boolean().optional(),
});

export type EntradaAtualizacaoUsuario = z.infer<typeof esquemaAtualizacaoUsuario>;

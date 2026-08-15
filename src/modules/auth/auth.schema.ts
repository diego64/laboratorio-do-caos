/**
 * Responsabilidade : Contratos de entrada e saida do modulo de autenticacao (Zod).
 * Consumido por    : auth.routes.ts, auth.service.ts, tests/unit/auth-service.spec.ts
 * Regra            : Senha minima de 8 caracteres. Email normalizado para minusculas na
 *                    borda - o restante da aplicacao assume email ja normalizado.
 */
import { z } from 'zod';

export const esquemaRegistro = z.object({
  email: z.string().email('Email invalido').transform((valor) => valor.toLowerCase().trim()),
  senha: z.string().min(8, 'Senha precisa de no minimo 8 caracteres').max(128),
  nome: z.string().min(2, 'Nome precisa de no minimo 2 caracteres').max(120),
  papel: z.enum(['admin', 'operador']).default('operador'),
});

export const esquemaLogin = z.object({
  email: z.string().email('Email invalido').transform((valor) => valor.toLowerCase().trim()),
  senha: z.string().min(1, 'Senha obrigatoria'),
});

export const esquemaRespostaToken = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.string(),
  usuario: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    nome: z.string(),
    papel: z.enum(['admin', 'operador']),
  }),
});

export type EntradaRegistro = z.infer<typeof esquemaRegistro>;
export type EntradaLogin = z.infer<typeof esquemaLogin>;
export type RespostaToken = z.infer<typeof esquemaRespostaToken>;

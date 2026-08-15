/**
 * Responsabilidade : Converter schemas Zod em JSON Schema compativel com Fastify/AJV e
 *                    OpenAPI 3.1, mantendo o Zod como fonte unica da verdade.
 * Consumido por    : todos os arquivos *.routes.ts
 * Regra            : $refStrategy 'none' - schemas inline evitam colisao de $id entre rotas.
 *                    A chave $schema e removida porque o AJV do Fastify a rejeita.
 */
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Converte um schema Zod em JSON Schema pronto para uso no `schema` de uma rota. */
export function paraJsonSchema(schema: ZodTypeAny, nome?: string): Record<string, unknown> {
  const gerado = zodToJsonSchema(schema as never, {
    target: 'openApi3',
    $refStrategy: 'none',
    ...(nome ? { name: nome } : {}),
  }) as Record<string, unknown>;

  if (nome && gerado['definitions']) {
    const definicoes = gerado['definitions'] as Record<string, Record<string, unknown>>;
    return definicoes[nome] ?? {};
  }

  delete gerado['$schema'];
  return gerado;
}

/** Envelope de erro RFC 7807 reutilizado em todas as respostas de falha. */
export const jsonSchemaProblema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    correlationId: { type: 'string' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: { campo: { type: 'string' }, mensagem: { type: 'string' } },
      },
    },
  },
} as const;

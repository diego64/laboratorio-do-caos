/**
 * Responsabilidade : Handler global de erros do Fastify. Traduz qualquer excecao para
 *                    RFC 7807 e registra o erro com correlationId.
 * Consumido por    : src/app.ts (setErrorHandler / setNotFoundHandler)
 * Regra            : 5xx nunca expoe detail interno ao cliente. 4xx expoe mensagem util.
 *                    Todo erro logado carrega correlationId igual ao header x-correlation-id.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ErroAplicacao, type ProblemaDetalhe } from './errors';

/** Converte um ZodError na lista de detalhes do problema. */
export function mapearErroZod(erro: ZodError): Array<{ campo: string; mensagem: string }> {
  return erro.issues.map((issue) => ({
    campo: issue.path.join('.') || '(raiz)',
    mensagem: issue.message,
  }));
}

/** Handler global de erros. Registrado uma unica vez em app.ts. */
export function tratarErro(
  erro: FastifyError | Error,
  requisicao: FastifyRequest,
  resposta: FastifyReply,
): FastifyReply {
  const correlationId = (requisicao.headers['x-correlation-id'] as string) ?? requisicao.id;

  if (erro instanceof ZodError) {
    const problema: ProblemaDetalhe = {
      type: 'https://chaoslab.dev/errors/validation',
      title: 'Payload invalido',
      status: 422,
      instance: requisicao.url,
      correlationId,
      errors: mapearErroZod(erro),
    };
    requisicao.log.warn({ correlationId, errors: problema.errors }, 'validacao rejeitada');
    return resposta.code(422).type('application/problem+json').send(problema);
  }

  // Falha do AJV (schema da rota) - normalizada para o MESMO contrato do Zod (422).
  const validacaoFastify = (erro as FastifyError).validation;
  if (Array.isArray(validacaoFastify) && validacaoFastify.length > 0) {
    const problema: ProblemaDetalhe = {
      type: 'https://chaoslab.dev/errors/validation',
      title: 'Payload invalido',
      status: 422,
      instance: requisicao.url,
      correlationId,
      errors: validacaoFastify.map((item) => ({
        campo: (item.instancePath || item.schemaPath || '').replace(/^\//, '') || '(raiz)',
        mensagem: item.message ?? 'valor invalido',
      })),
    };
    requisicao.log.warn({ correlationId, errors: problema.errors }, 'validacao AJV rejeitada');
    return resposta.code(422).type('application/problem+json').send(problema);
  }

  if (erro instanceof ErroAplicacao) {
    const problema: ProblemaDetalhe = {
      type: erro.tipo,
      title: erro.message,
      status: erro.status,
      instance: requisicao.url,
      correlationId,
    };
    if (erro.detalhes) problema.errors = erro.detalhes;

    if (erro.status >= 500) {
      requisicao.log.error({ correlationId, err: erro }, 'erro de aplicacao 5xx');
    } else {
      requisicao.log.warn({ correlationId, status: erro.status }, erro.message);
    }
    return resposta.code(erro.status).type('application/problem+json').send(problema);
  }

  const statusFastify = (erro as FastifyError).statusCode;
  if (typeof statusFastify === 'number' && statusFastify < 500) {
    const problema: ProblemaDetalhe = {
      type: 'https://chaoslab.dev/errors/bad-request',
      title: erro.message,
      status: statusFastify,
      instance: requisicao.url,
      correlationId,
    };
    requisicao.log.warn({ correlationId, status: statusFastify }, erro.message);
    return resposta.code(statusFastify).type('application/problem+json').send(problema);
  }

  requisicao.log.error({ correlationId, err: erro }, 'erro nao tratado');
  const problema: ProblemaDetalhe = {
    type: 'https://chaoslab.dev/errors/internal',
    title: 'Erro interno do servidor',
    status: 500,
    detail: 'Use o correlationId para localizar o evento nos logs.',
    instance: requisicao.url,
    correlationId,
  };
  return resposta.code(500).type('application/problem+json').send(problema);
}

/** Handler de rota inexistente. Mantem o mesmo contrato RFC 7807. */
export function tratarNaoEncontrado(
  requisicao: FastifyRequest,
  resposta: FastifyReply,
): FastifyReply {
  const problema: ProblemaDetalhe = {
    type: 'https://chaoslab.dev/errors/not-found',
    title: 'Rota nao encontrada',
    status: 404,
    instance: requisicao.url,
    correlationId: (requisicao.headers['x-correlation-id'] as string) ?? requisicao.id,
  };
  return resposta.code(404).type('application/problem+json').send(problema);
}

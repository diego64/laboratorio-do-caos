/**
 * Responsabilidade : Hierarquia de erros de aplicacao e contrato de resposta de erro
 *                    no formato RFC 7807 (application/problem+json).
 * Consumido por    : src/shared/error-handler.ts, services e repositories de todos os modulos.
 * Regra            : Nenhum erro pode vazar stack trace ou mensagem de driver para o cliente.
 *                    Erro nao mapeado vira 500 generico com correlationId rastreavel no log.
 */

export interface ProblemaDetalhe {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
  errors?: Array<{ campo: string; mensagem: string }>;
}

export class ErroAplicacao extends Error {
  public readonly status: number;
  public readonly tipo: string;
  public readonly detalhes?: Array<{ campo: string; mensagem: string }>;

  constructor(
    mensagem: string,
    status: number,
    tipo: string,
    detalhes?: Array<{ campo: string; mensagem: string }>,
  ) {
    super(mensagem);
    this.name = new.target.name;
    this.status = status;
    this.tipo = tipo;
    if (detalhes) this.detalhes = detalhes;
  }
}

export class ErroValidacao extends ErroAplicacao {
  constructor(detalhes: Array<{ campo: string; mensagem: string }>) {
    super('Payload invalido', 422, 'https://chaoslab.dev/errors/validation', detalhes);
  }
}

export class ErroNaoAutenticado extends ErroAplicacao {
  constructor(mensagem = 'Credenciais invalidas ou ausentes') {
    super(mensagem, 401, 'https://chaoslab.dev/errors/unauthenticated');
  }
}

export class ErroNaoAutorizado extends ErroAplicacao {
  constructor(mensagem = 'Sem permissao para este recurso') {
    super(mensagem, 403, 'https://chaoslab.dev/errors/forbidden');
  }
}

export class ErroNaoEncontrado extends ErroAplicacao {
  constructor(recurso: string) {
    super(`${recurso} nao encontrado`, 404, 'https://chaoslab.dev/errors/not-found');
  }
}

export class ErroConflito extends ErroAplicacao {
  constructor(mensagem: string) {
    super(mensagem, 409, 'https://chaoslab.dev/errors/conflict');
  }
}

export class ErroDependenciaIndisponivel extends ErroAplicacao {
  constructor(dependencia: string) {
    super(
      `Dependencia indisponivel: ${dependencia}`,
      503,
      'https://chaoslab.dev/errors/dependency-unavailable',
    );
  }
}

/**
 * Responsabilidade : Ponto de entrada do processo - inicializa telemetria, valida ambiente,
 *                    sobe o HTTP server, garante indices do MongoDB e implementa o
 *                    graceful shutdown.
 * Consumido por    : Docker CMD, Kubernetes, `pnpm dev`, `pnpm start`
 * Regra            : Telemetria e inicializada ANTES de qualquer import de modulo
 *                    instrumentado. SIGTERM drena conexoes com prazo maximo de 15s e
 *                    entao encerra a forca - travar no shutdown gera pod zumbi no k8s.
 */
import { ambiente } from './config/env';
import { iniciarTelemetria, pararTelemetria } from './observability/telemetry';

const PRAZO_SHUTDOWN_MS = 15_000;

/** Sobe o servico completo. */
async function iniciar(): Promise<void> {
  const env = ambiente();
  iniciarTelemetria();

  // Imports tardios: garantem que a auto-instrumentacao do OTel ja esteja ativa.
  const { construirAplicacao } = await import('./app');
  const { garantirIndices, fecharConexaoMongo } = await import('./infra/mongo');
  const { fecharPool } = await import('./infra/postgres');

  const app = await construirAplicacao();

  // Indices sao best-effort no boot: falha aqui degrada performance, nao disponibilidade.
  await garantirIndices().catch((erro: Error) => {
    app.log.warn({ err: erro }, 'nao foi possivel garantir indices do MongoDB');
  });

  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info({ port: env.PORT, docs: `/docs` }, 'servico no ar');

  let encerrando = false;

  const encerrar = async (sinal: string): Promise<void> => {
    if (encerrando) return;
    encerrando = true;
    app.log.info({ sinal }, 'iniciando graceful shutdown');

    const prazo = setTimeout(() => {
      app.log.error('prazo de shutdown excedido - encerrando a forca');
      process.exit(1);
    }, PRAZO_SHUTDOWN_MS);
    prazo.unref();

    try {
      await app.close();
      await Promise.all([fecharPool(), fecharConexaoMongo()]);
      await pararTelemetria();
      clearTimeout(prazo);
      process.exit(0);
    } catch (erro) {
      app.log.error({ err: erro }, 'falha no shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));

  process.on('unhandledRejection', (motivo) => {
    app.log.error({ err: motivo }, 'unhandledRejection');
  });
  process.on('uncaughtException', (erro) => {
    app.log.fatal({ err: erro }, 'uncaughtException - encerrando');
    void encerrar('uncaughtException');
  });
}

iniciar().catch((erro: Error) => {
  process.stderr.write(`falha fatal no bootstrap: ${erro.message}\n`);
  process.exit(1);
});

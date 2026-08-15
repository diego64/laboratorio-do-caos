/**
 * Responsabilidade : Serializar o contrato OpenAPI gerado em tempo de execucao para
 *                    openapi.json, permitindo diff de contrato no CI.
 * Consumido por    : `pnpm openapi:dump`, job de CI que detecta breaking change de API
 * Regra            : O arquivo gerado e artefato, nao fonte. Divergencia entre o gerado e o
 *                    versionado deve reprovar o pipeline.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { construirAplicacao } from '../src/app';

async function exportar(): Promise<void> {
  const app = await construirAplicacao();
  const contrato = app.swagger();
  const destino = join(__dirname, '..', 'openapi.json');

  writeFileSync(destino, `${JSON.stringify(contrato, null, 2)}\n`, 'utf8');
  await app.close();

  process.stdout.write(`contrato exportado em ${destino}\n`);
}

exportar()
  .then(() => process.exit(0))
  .catch((erro: Error) => {
    process.stderr.write(`falha ao exportar contrato: ${erro.message}\n`);
    process.exit(1);
  });

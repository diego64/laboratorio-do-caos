/**
 * Responsabilidade : Validar o calculo puro de vencimento da manutencao preventiva.
 * Consumido por    : pnpm test
 * Regra            : A data de referencia e sempre injetada - o teste nunca depende do
 *                    relogio real da maquina.
 */
import { describe, expect, it } from 'vitest';
import { calcularSituacaoManutencao } from '../../src/modules/assets/asset.service';

const referencia = new Date('2026-06-01T00:00:00.000Z');

describe('asset.service :: calcularSituacaoManutencao', () => {
  it('considera vencido quando passou do intervalo', () => {
    const situacao = calcularSituacaoManutencao(
      {
        ultima_manutencao_em: '2026-01-01',
        criado_em: '2025-01-01T00:00:00Z',
        intervalo_manutencao_dias: 90,
      },
      referencia,
    );

    expect(situacao.dias_desde_ultima).toBe(151);
    expect(situacao.vencido).toBe(true);
    expect(situacao.dias_restantes).toBe(-61);
  });

  it('considera em dia quando dentro do intervalo', () => {
    const situacao = calcularSituacaoManutencao(
      {
        ultima_manutencao_em: '2026-05-15',
        criado_em: '2025-01-01T00:00:00Z',
        intervalo_manutencao_dias: 90,
      },
      referencia,
    );

    expect(situacao.vencido).toBe(false);
    expect(situacao.dias_restantes).toBe(73);
  });

  it('usa a data de criacao quando nunca houve manutencao', () => {
    const situacao = calcularSituacaoManutencao(
      {
        ultima_manutencao_em: null,
        criado_em: '2026-05-20T00:00:00Z',
        intervalo_manutencao_dias: 30,
      },
      referencia,
    );

    expect(situacao.dias_desde_ultima).toBe(12);
    expect(situacao.vencido).toBe(false);
  });
});

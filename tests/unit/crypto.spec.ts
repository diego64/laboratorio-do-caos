/**
 * Responsabilidade : Garantir as invariantes das primitivas criptograficas.
 * Consumido por    : pnpm test / pipeline de CI
 * Regra            : Cobrir happy path, hash malformado e assinatura adulterada.
 */
import { describe, expect, it } from 'vitest';
import {
  assinarPayload,
  gerarHashSenha,
  gerarIdentificador,
  gerarTokenAleatorio,
  validarAssinatura,
  verificarSenha,
} from '../../src/shared/crypto';

describe('crypto', () => {
  it('gera hash com formato versionado e salt distinto por chamada', async () => {
    const a = await gerarHashSenha('senha-super-segura');
    const b = await gerarHashSenha('senha-super-segura');

    expect(a.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(a).not.toEqual(b);
  });

  it('valida a senha correta e rejeita a incorreta', async () => {
    const hash = await gerarHashSenha('senha-super-segura');

    await expect(verificarSenha('senha-super-segura', hash)).resolves.toBe(true);
    await expect(verificarSenha('senha-errada-aqui', hash)).resolves.toBe(false);
  });

  it('rejeita senha curta na geracao do hash', async () => {
    await expect(gerarHashSenha('curta')).rejects.toThrow(/minimo 8 caracteres/);
  });

  it('retorna false para hash malformado em vez de lancar', async () => {
    await expect(verificarSenha('qualquer', 'formato-invalido')).resolves.toBe(false);
    await expect(verificarSenha('qualquer', 'bcrypt$1$2$3$4$5')).resolves.toBe(false);
  });

  it('assina e valida payload com HMAC', () => {
    const payload = JSON.stringify({ assetId: 'abc', valor: 42 });
    const assinatura = assinarPayload(payload, 'segredo-hmac-de-teste');

    expect(validarAssinatura(payload, assinatura, 'segredo-hmac-de-teste')).toBe(true);
    expect(validarAssinatura(payload, assinatura, 'outro-segredo')).toBe(false);
    expect(validarAssinatura(`${payload} `, assinatura, 'segredo-hmac-de-teste')).toBe(false);
  });

  it('gera identificadores e tokens unicos', () => {
    expect(gerarIdentificador()).not.toEqual(gerarIdentificador());
    expect(gerarTokenAleatorio(16)).toHaveLength(32);
  });
});

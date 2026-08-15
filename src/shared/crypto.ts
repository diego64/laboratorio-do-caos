/**
 * Responsabilidade : Primitivas criptograficas do servico usando exclusivamente node:crypto -
 *                    hash de senha (scrypt), comparacao em tempo constante, geracao de
 *                    identificadores e assinatura HMAC de webhooks.
 * Consumido por    : src/modules/auth/auth.service.ts, src/modules/users/user.service.ts,
 *                    src/modules/readings/reading.routes.ts, scripts/seed.ts
 * Regra            : Nunca comparar material secreto com === (timing attack). Salt aleatorio
 *                    de 16 bytes por senha. Formato do hash e versionado
 *                    (scrypt$N$r$p$salt$hash) para permitir rotacao de parametros.
 */
import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  senha: string | Buffer,
  salt: string | Buffer,
  tamanho: number,
  opcoes: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMETROS_SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const TAMANHO_HASH = 64;
const TAMANHO_SALT = 16;

/** Gera identificador unico (UUID v4) para entidades e correlacao de requisicoes. */
export function gerarIdentificador(): string {
  return randomUUID();
}

/** Gera token opaco aleatorio em hex - util para refresh tokens e api keys. */
export function gerarTokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Deriva o hash da senha com scrypt.
 * Retorno: scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
 */
export async function gerarHashSenha(senha: string): Promise<string> {
  if (senha.length < 8) {
    throw new Error('Senha precisa de no minimo 8 caracteres');
  }
  const salt = randomBytes(TAMANHO_SALT);
  const derivado = await scrypt(senha, salt, TAMANHO_HASH, PARAMETROS_SCRYPT);
  const { N, r, p } = PARAMETROS_SCRYPT;
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derivado.toString('hex')}`;
}

/**
 * Compara senha em texto plano com o hash armazenado, em tempo constante.
 * Retorna false para hash malformado em vez de lancar - evita oraculo de erro.
 */
export async function verificarSenha(senha: string, hashArmazenado: string): Promise<boolean> {
  const partes = hashArmazenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const N = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  const saltHex = partes[4];
  const hashHex = partes[5];

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const esperado = Buffer.from(hashHex, 'hex');
  const derivado = await scrypt(senha, salt, esperado.length, {
    N,
    r,
    p,
    maxmem: PARAMETROS_SCRYPT.maxmem,
  });

  if (derivado.length !== esperado.length) return false;
  return timingSafeEqual(derivado, esperado);
}

/** Assina payload de webhook com HMAC-SHA256. Retorna digest em hex. */
export function assinarPayload(payload: string, segredo: string): string {
  return createHmac('sha256', segredo).update(payload, 'utf8').digest('hex');
}

/** Valida assinatura de webhook em tempo constante. */
export function validarAssinatura(payload: string, assinatura: string, segredo: string): boolean {
  const esperado = Buffer.from(assinarPayload(payload, segredo), 'hex');
  let recebido: Buffer;
  try {
    recebido = Buffer.from(assinatura, 'hex');
  } catch {
    return false;
  }
  if (recebido.length !== esperado.length) return false;
  return timingSafeEqual(recebido, esperado);
}

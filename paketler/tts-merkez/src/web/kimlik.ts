// Kullanicilar, roller, parola (argon2id) ve denetim gunlugu (§9F Erisim).
//
// TOTP ve IP kisiti BU TURDA YOK; sema ve arayuz yeri hazir (TODO-BLOKE.md).

import { randomBytes, randomInt } from 'node:crypto';

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

import type { Db } from '../veritabani/baglanti.ts';

export type Rol = 'superadmin' | 'operator' | 'izleyici';

export type Kullanici = {
  id: number;
  kullanici_adi: string;
  rol: Rol;
  aktif: boolean;
  parola_degistir: boolean;
  son_giris: Date | null;
  olusturuldu: Date;
  totp_aktif: boolean;
};

/** Rol yetkileri — tek nokta. */
export const YETKILER = {
  superadmin: ['oku', 'uret', 'kelime_yonet', 'kullanici_yonet', 'ayar'],
  operator: ['oku', 'uret', 'kelime_yonet'],
  izleyici: ['oku'],
} as const satisfies Record<Rol, readonly string[]>;

export type Yetki = (typeof YETKILER)[Rol][number];

export function yetkisiVar(rol: Rol, yetki: string): boolean {
  return (YETKILER[rol] as readonly string[]).includes(yetki);
}

const ARGON = {
  // argon2id varsayilanlari; OWASP'in onerdigi araligin icinde.
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function parolaHashle(parola: string): Promise<string> {
  return argonHash(parola, ARGON);
}

export async function parolaDogrula(hash: string, parola: string): Promise<boolean> {
  try {
    return await argonVerify(hash, parola);
  } catch {
    return false;
  }
}

/**
 * Okunabilir ama tahmin edilemez parola uretir.
 * Sabit varsayilan parola KULLANILMAZ (Asama 5).
 */
export function parolaUret(uzunluk = 24): string {
  const alfabe = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let cikti = '';
  for (let i = 0; i < uzunluk; i++) cikti += alfabe[randomInt(alfabe.length)];
  return cikti;
}

export async function kullaniciEkle(
  db: Db,
  kullaniciAdi: string,
  parola: string,
  rol: Rol,
  { parolaDegistir = true }: { parolaDegistir?: boolean } = {},
): Promise<Kullanici> {
  const hash = await parolaHashle(parola);
  const satirlar = await db<Kullanici[]>`
    INSERT INTO kullanici (kullanici_adi, parola_hash, rol, parola_degistir)
    VALUES (${kullaniciAdi.trim()}, ${hash}, ${rol}, ${parolaDegistir})
    RETURNING id, kullanici_adi, rol, aktif, parola_degistir, son_giris, olusturuldu, totp_aktif
  `;
  return satirlar[0] as Kullanici;
}

export async function kullaniciSayisi(db: Db): Promise<number> {
  const satirlar = await db<{ adet: string }[]>`SELECT count(*)::text AS adet FROM kullanici`;
  return Number(satirlar[0]?.adet ?? 0);
}

export async function kullaniciListele(db: Db): Promise<Kullanici[]> {
  return db<Kullanici[]>`
    SELECT id, kullanici_adi, rol, aktif, parola_degistir, son_giris, olusturuldu, totp_aktif
      FROM kullanici ORDER BY kullanici_adi
  `;
}

export async function kullaniciBul(db: Db, id: number): Promise<Kullanici | null> {
  const satirlar = await db<Kullanici[]>`
    SELECT id, kullanici_adi, rol, aktif, parola_degistir, son_giris, olusturuldu, totp_aktif
      FROM kullanici WHERE id = ${id}
  `;
  return satirlar[0] ?? null;
}

/** Giris. Basarisizsa null — kullanici adi mi parola mi yanlis, disari sizmaz. */
export async function girisDogrula(
  db: Db,
  kullaniciAdi: string,
  parola: string,
): Promise<Kullanici | null> {
  const satirlar = await db<(Kullanici & { parola_hash: string })[]>`
    SELECT id, kullanici_adi, parola_hash, rol, aktif, parola_degistir, son_giris, olusturuldu, totp_aktif
      FROM kullanici WHERE kullanici_adi = ${kullaniciAdi.trim()}
  `;
  const k = satirlar[0];

  if (!k) {
    // Zamanlama farkindan kullanici adinin varligi anlasilmasin.
    await parolaHashle(randomBytes(16).toString('hex'));
    return null;
  }
  if (!k.aktif) return null;
  if (!(await parolaDogrula(k.parola_hash, parola))) return null;

  await db`UPDATE kullanici SET son_giris = now() WHERE id = ${k.id}`;

  const { parola_hash: _atilan, ...temiz } = k;
  return temiz;
}

export async function parolaDegistirKaydet(
  db: Db,
  kullaniciId: number,
  yeniParola: string,
  { zorunluDegisim = false }: { zorunluDegisim?: boolean } = {},
): Promise<void> {
  const hash = await parolaHashle(yeniParola);
  await db`
    UPDATE kullanici SET parola_hash = ${hash}, parola_degistir = ${zorunluDegisim}
     WHERE id = ${kullaniciId}
  `;
}

export async function kullaniciAktiflik(db: Db, id: number, aktif: boolean): Promise<void> {
  await db`UPDATE kullanici SET aktif = ${aktif} WHERE id = ${id}`;
}

export async function rolDegistir(db: Db, id: number, rol: Rol): Promise<void> {
  await db`UPDATE kullanici SET rol = ${rol} WHERE id = ${id}`;
}

// ── Denetim gunlugu ───────────────────────────────────────────────────────

export type DenetimKaydi = {
  kullaniciId?: number | null;
  kullaniciAdi?: string | null;
  eylem: string;
  hedef?: string | null;
  ayrinti?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Kim, ne zaman, ne yapti.
 *
 * Hasta verisi girmez; `ayrinti` icine kelime yazmak serbesttir cunku burada
 * kelime BANKA icerigidir (isim listesi yonetimi), anons kaydi degil — ama
 * yine de tek tek isim degil sayilar yazilmasi tercih edilir.
 */
export async function denetimYaz(db: Db, kayit: DenetimKaydi): Promise<void> {
  await db`
    INSERT INTO denetim_gunlugu (kullanici_id, kullanici_adi, eylem, hedef, ayrinti, ip)
    VALUES (
      ${kayit.kullaniciId ?? null},
      ${kayit.kullaniciAdi ?? null},
      ${kayit.eylem},
      ${kayit.hedef ?? null},
      ${db.json((kayit.ayrinti ?? {}) as never)},
      ${kayit.ip ?? null}
    )
  `;
}

export async function denetimListele(
  db: Db,
  { limit = 100, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  return db`
    SELECT id, kullanici_adi, eylem, hedef, ayrinti, ip, zaman
      FROM denetim_gunlugu ORDER BY zaman DESC LIMIT ${limit} OFFSET ${offset}
  ` as unknown as Promise<Array<Record<string, unknown>>>;
}

// Rotalarin paylastigi kucuk yardimcilar.

import type { Db } from '../../veritabani/baglanti.ts';

export type ProfilSatiri = {
  id: string;
  motor: string;
  motor_sesi: string;
  tiyer: string;
  ornek_hizi: number;
  varsayilan: boolean;
  aktif: boolean;
};

/** Klip kapsam tipleri (§9A). Arayuzdeki filtre ve secim listeleri buradan. */
export function tipListesi(): string[] {
  return ['ad', 'soyad', 'sayi', 'kalip', 'ton', 'poliklinik', 'doktor'];
}

export async function profilleriGetir(db: Db): Promise<ProfilSatiri[]> {
  return db<ProfilSatiri[]>`
    SELECT id, motor, motor_sesi, tiyer, ornek_hizi, varsayilan, aktif
      FROM ses_profili ORDER BY varsayilan DESC, id
  `;
}

export async function profilBul(db: Db, id: string): Promise<ProfilSatiri | null> {
  const satirlar = await db<ProfilSatiri[]>`
    SELECT id, motor, motor_sesi, tiyer, ornek_hizi, varsayilan, aktif
      FROM ses_profili WHERE id = ${id}
  `;
  return satirlar[0] ?? null;
}

export type SablonOgesi = { yuva: string; tur: 'kalip' | 'degisken'; tip: string; ornek: string };

export type SablonSatiri = {
  id: number;
  ad: string;
  metin: string;
  ogeler: SablonOgesi[];
  varsayilan: boolean;
};

export async function sablonlariGetir(db: Db): Promise<SablonSatiri[]> {
  return db<SablonSatiri[]>`
    SELECT id, ad, metin, ogeler, varsayilan FROM sablon ORDER BY varsayilan DESC, ad
  `;
}

/** Varsayilan sablon + yuva ornekleri/tipleri. Uretim ve onizleme bunu kullanir. */
export async function varsayilanSablon(db: Db): Promise<{
  id: number | null;
  metin: string;
  ornekler: Record<string, string>;
  tipler: Record<string, string>;
}> {
  const satirlar = await db<SablonSatiri[]>`
    SELECT id, ad, metin, ogeler, varsayilan FROM sablon
     ORDER BY varsayilan DESC, id LIMIT 1
  `;
  const s = satirlar[0];
  if (!s) {
    return { id: null, metin: 'sayın {ad} {soyad} lütfen {banko} nolu bankoya geçiniz', ornekler: {}, tipler: {} };
  }

  const ornekler: Record<string, string> = {};
  const tipler: Record<string, string> = {};
  for (const o of s.ogeler ?? []) {
    if (o.tur === 'degisken') {
      ornekler[o.yuva] = o.ornek;
      tipler[o.yuva] = o.tip;
    }
  }
  return { id: s.id, metin: s.metin, ornekler, tipler };
}

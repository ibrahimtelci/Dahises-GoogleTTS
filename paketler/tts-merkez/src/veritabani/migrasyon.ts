// Numaralı .sql dosyalarını sırayla uygular. Kütüphane yok (teknoloji yığını kararı).
//
// Her dosya kendi transaction'ında koşar; uygulananlar `_migrasyon` tablosunda
// sha256'sıyla birlikte tutulur. Uygulanmış bir dosya sonradan değiştirilirse
// koşucu durur — sessizce ayrışan şema, en pahalı hata türüdür.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Db } from './baglanti.ts';

export type MigrasyonSonucu = {
  uygulanan: string[];
  atlanan: string[];
};

const DOSYA_DESENI = /^(\d{3,})_[\w.-]+\.sql$/;

export async function migrasyonlariUygula(
  db: Db,
  dizin: string,
  gunluk?: { info: (o: unknown, m?: string) => void },
): Promise<MigrasyonSonucu> {
  await db`
    CREATE TABLE IF NOT EXISTS _migrasyon (
      ad          text PRIMARY KEY,
      sha256      text NOT NULL,
      uygulandi   timestamptz NOT NULL DEFAULT now()
    )
  `;

  const hepsi = (await readdir(dizin))
    .filter((d) => DOSYA_DESENI.test(d))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const kayitlar = await db<{ ad: string; sha256: string }[]>`
    SELECT ad, sha256 FROM _migrasyon
  `;
  const kayitliHash = new Map(kayitlar.map((k) => [k.ad, k.sha256]));

  const uygulanan: string[] = [];
  const atlanan: string[] = [];

  for (const dosya of hepsi) {
    const icerik = await readFile(join(dizin, dosya), 'utf8');
    const hash = createHash('sha256').update(icerik).digest('hex');
    const onceki = kayitliHash.get(dosya);

    if (onceki !== undefined) {
      if (onceki !== hash) {
        throw new Error(
          `Migrasyon ${dosya} uygulandıktan sonra değiştirilmiş.\n` +
            'Uygulanmış bir migrasyonu düzenleme; yeni numaralı bir dosya ekle.',
        );
      }
      atlanan.push(dosya);
      continue;
    }

    await db.begin(async (tx) => {
      await tx.unsafe(icerik);
      await tx`INSERT INTO _migrasyon (ad, sha256) VALUES (${dosya}, ${hash})`;
    });

    uygulanan.push(dosya);
    gunluk?.info({ migrasyon: dosya }, 'migrasyon uygulandı');
  }

  return { uygulanan, atlanan };
}

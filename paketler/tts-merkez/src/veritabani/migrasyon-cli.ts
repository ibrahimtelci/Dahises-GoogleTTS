// pnpm migrasyon — migrasyonları uygular ve sonucu yazar.

import { fileURLToPath } from 'node:url';

import { yapilandirma } from '../yapilandirma.ts';
import { dbAc } from './baglanti.ts';
import { migrasyonlariUygula } from './migrasyon.ts';

const MIGRASYON_DIZINI = fileURLToPath(new URL('../../../../migrasyonlar', import.meta.url));

const ayar = yapilandirma();
const db = dbAc(ayar.DATABASE_URL);

try {
  const sonuc = await migrasyonlariUygula(db, MIGRASYON_DIZINI);
  if (sonuc.uygulanan.length === 0) {
    console.log(`Migrasyon yok, hepsi güncel (${sonuc.atlanan.length} dosya).`);
  } else {
    console.log(`Uygulandı (${sonuc.uygulanan.length}):`);
    for (const d of sonuc.uygulanan) console.log('  + ' + d);
    console.log(`Zaten uygulanmıştı: ${sonuc.atlanan.length}`);
  }
} finally {
  await db.end();
}

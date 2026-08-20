// Kota paneli (§9F) — tiyer bazli cubuk, esik bantlari, kuyruk sayilari.

import type { FastifyInstance } from 'fastify';

import { kotaDurumu } from '../../uretim/kota.ts';
import { durumSayilari } from '../../uretim/kuyruk.ts';
import { sayfaVerisi } from '../sunucu.ts';

const AYLAR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

export async function kotaRotalari(app: FastifyInstance): Promise<void> {
  const { db, butce } = app.baglam;

  app.get('/kota', async (istek, yanit) => {
    const simdi = new Date();
    return yanit.view(
      'kota.eta',
      sayfaVerisi(istek, {
        baslik: 'Kota',
        aktif: 'kota',
        kotalar: await kotaDurumu(db),
        kuyruk: await durumSayilari(db),
        butce: butce.durum(),
        donemAdi: `${AYLAR[simdi.getMonth()]} ${simdi.getFullYear()}`,
      }),
    );
  });
}

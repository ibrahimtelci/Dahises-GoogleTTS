// Uretim gunlugu, sorunlu klipler, denetim gunlugu ve /saglik ucu.

import type { FastifyInstance } from 'fastify';

import { durumSayilari } from '../../uretim/kuyruk.ts';
import { kotaDurumu } from '../../uretim/kota.ts';
import { denetimListele } from '../kimlik.ts';
import { sayfaVerisi } from '../sunucu.ts';

export async function gunlukRotalari(app: FastifyInstance): Promise<void> {
  const { db, depo, butce } = app.baglam;

  app.get('/gunluk', async (istek, yanit) => {
    const uretim = await db`
      SELECT id, tur, profil, tiyer, klip_sayisi, karakter, sure_ms, basarili, hata, zaman
        FROM uretim_gunlugu ORDER BY zaman DESC LIMIT 100
    `;
    const sorunlu = await db`
      SELECT kelime, profil, durum, deneme, sonraki_deneme, hata
        FROM klip
       WHERE durum IN ('failed', 'engellendi', 'kota_bekliyor')
       ORDER BY olusturuldu DESC LIMIT 100
    `;

    return yanit.view(
      'gunluk.eta',
      sayfaVerisi(istek, {
        baslik: 'Günlük',
        aktif: 'gunluk',
        uretim,
        sorunlu,
        denetim: await denetimListele(db, { limit: 100 }),
      }),
    );
  });

  /**
   * /saglik — veritabani erisimi, banka dizini yazilabilirligi, kota durumu,
   * uretim kuyrugu sayilari. Oturum gerektirmez.
   */
  app.get('/saglik', async (_istek, yanit) => {
    const kontroller: Record<string, unknown> = {};
    let saglikli = true;

    try {
      const t0 = Date.now();
      await db`SELECT 1`;
      kontroller['veritabani'] = { durum: 'tamam', gecikmeMs: Date.now() - t0 };
    } catch (hata) {
      saglikli = false;
      kontroller['veritabani'] = { durum: 'hata', mesaj: (hata as Error).message };
    }

    try {
      const yazilabilir = await depo.yazilabilirMi();
      kontroller['banka_dizini'] = { durum: yazilabilir ? 'tamam' : 'hata', yol: depo.kok };
      if (!yazilabilir) saglikli = false;
    } catch (hata) {
      saglikli = false;
      kontroller['banka_dizini'] = { durum: 'hata', mesaj: (hata as Error).message };
    }

    try {
      const kotalar = await kotaDurumu(db);
      kontroller['kota'] = kotalar.map((k) => ({
        tiyer: k.tiyer,
        kullanilan: k.kullanilan,
        limitSert: k.limitSert,
        bant: k.bant,
      }));
      if (kotalar.some((k) => k.bant === 'dolu' && k.kesmeDestegi)) {
        kontroller['kota_uyarisi'] = 'en az bir tiyerde sert limit doldu';
      }
    } catch (hata) {
      saglikli = false;
      kontroller['kota'] = { durum: 'hata', mesaj: (hata as Error).message };
    }

    try {
      kontroller['kuyruk'] = await durumSayilari(db);
    } catch (hata) {
      saglikli = false;
      kontroller['kuyruk'] = { durum: 'hata', mesaj: (hata as Error).message };
    }

    kontroller['google_butcesi'] = butce.durum();

    return yanit.code(saglikli ? 200 : 503).send({
      durum: saglikli ? 'saglikli' : 'sorunlu',
      zaman: new Date().toISOString(),
      ...kontroller,
    });
  });
}

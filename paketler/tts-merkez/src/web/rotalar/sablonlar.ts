// Sablon (cumle kalibi) yonetimi.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sablonuAyristir } from '../../ses/metin.ts';
import { denetimYaz } from '../kimlik.ts';
import { sayfaVerisi, yetkiGerek } from '../sunucu.ts';
import { sablonlariGetir, type SablonOgesi } from './ortak.ts';

const yeniSemasi = z.object({
  ad: z.string().min(1).max(80),
  metin: z.string().min(1).max(500),
  ornekler: z.string().max(4000).optional().default(''),
});

/**
 * "degisken=ornek=tip" satirlarini oge listesine cevirir.
 * Tip verilmezse degisken adi tip sayilir.
 */
export function ogeleriKur(metin: string, ornekSatirlari: string): SablonOgesi[] {
  const ornekler = new Map<string, { ornek: string; tip: string }>();
  for (const satir of ornekSatirlari.split(/\r?\n/)) {
    const parcalar = satir.split('=').map((x) => x.trim());
    const [ad, ornek, tip] = parcalar;
    if (ad && ornek) ornekler.set(ad, { ornek, tip: tip && tip.length > 0 ? tip : ad });
  }

  return sablonuAyristir(metin).map((p) =>
    p.tur === 'kalip'
      ? { yuva: 'kalip:' + p.deger, tur: 'kalip' as const, tip: 'kalip', ornek: p.deger }
      : {
          yuva: p.deger,
          tur: 'degisken' as const,
          tip: ornekler.get(p.deger)?.tip ?? p.deger,
          ornek: ornekler.get(p.deger)?.ornek ?? p.deger,
        },
  );
}

export async function sablonRotalari(app: FastifyInstance): Promise<void> {
  const { db } = app.baglam;

  app.get('/sablonlar', async (istek, yanit) =>
    yanit.view(
      'sablonlar.eta',
      sayfaVerisi(istek, {
        baslik: 'Şablonlar',
        aktif: 'sablonlar',
        sablonlar: await sablonlariGetir(db),
        yazabilir: istek.session.kullanici?.rol !== 'izleyici',
      }),
    ),
  );

  app.post('/sablonlar', { preHandler: yetkiGerek('kelime_yonet') }, async (istek, yanit) => {
    const ayristirma = yeniSemasi.safeParse(istek.body);
    if (!ayristirma.success) {
      istek.session.bildirim = { tur: 'hata', metin: 'Şablon bilgileri eksik.' };
      return yanit.redirect('/sablonlar');
    }
    const { ad, metin, ornekler } = ayristirma.data;
    const ogeler = ogeleriKur(metin, ornekler);

    if (!ogeler.some((o) => o.tur === 'degisken')) {
      istek.session.bildirim = {
        tur: 'hata',
        metin: 'Şablonda en az bir {değişken} olmalı; yoksa taşıyıcı kurulamaz.',
      };
      return yanit.redirect('/sablonlar');
    }

    const varMi = await db<{ id: number }[]>`SELECT id FROM sablon LIMIT 1`;

    await db`
      INSERT INTO sablon (ad, metin, ogeler, varsayilan)
      VALUES (${ad}, ${metin}, ${db.json(ogeler as never)}, ${varMi.length === 0})
      ON CONFLICT (ad) DO UPDATE
         SET metin = EXCLUDED.metin, ogeler = EXCLUDED.ogeler, guncellendi = now()
    `;

    const k = istek.session.kullanici;
    await denetimYaz(db, {
      kullaniciId: k?.id ?? null,
      kullaniciAdi: k?.ad ?? null,
      eylem: 'sablon.kaydet',
      hedef: ad,
      ip: istek.ip,
    });

    istek.session.bildirim = { tur: 'basari', metin: `"${ad}" şablonu kaydedildi.` };
    return yanit.redirect('/sablonlar');
  });

  app.post('/sablonlar/:id/sil', { preHandler: yetkiGerek('kelime_yonet') }, async (istek, yanit) => {
    const id = Number((istek.params as { id: string }).id);
    await db`DELETE FROM sablon WHERE id = ${id}`;
    const k = istek.session.kullanici;
    await denetimYaz(db, {
      kullaniciId: k?.id ?? null,
      kullaniciAdi: k?.ad ?? null,
      eylem: 'sablon.sil',
      hedef: String(id),
      ip: istek.ip,
    });
    istek.session.bildirim = { tur: 'basari', metin: 'Şablon silindi.' };
    return yanit.redirect('/sablonlar');
  });
}

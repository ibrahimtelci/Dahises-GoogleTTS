// Kullanici yonetimi — yalniz superadmin.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  denetimYaz,
  kullaniciAktiflik,
  kullaniciEkle,
  kullaniciListele,
  parolaDegistirKaydet,
  parolaUret,
  rolDegistir,
  type Rol,
} from '../kimlik.ts';
import { sayfaVerisi, yetkiGerek } from '../sunucu.ts';

const rolSemasi = z.enum(['superadmin', 'operator', 'izleyici']);

/** Uretilen parola bir kez gosterilir; oturumda tutulur, DB'ye yazilmaz. */
const gosterilecekParolalar = new Map<number, { ad: string; parola: string }>();

export async function kullaniciRotalari(app: FastifyInstance): Promise<void> {
  const { db } = app.baglam;

  app.get('/kullanicilar', { preHandler: yetkiGerek('kullanici_yonet') }, async (istek, yanit) => {
    const oturumId = istek.session.kullanici?.id ?? 0;
    const gosterilecek = gosterilecekParolalar.get(oturumId);
    gosterilecekParolalar.delete(oturumId);

    return yanit.view(
      'kullanicilar.eta',
      sayfaVerisi(istek, {
        baslik: 'Kullanıcılar',
        aktif: 'kullanicilar',
        kullanicilar: await kullaniciListele(db),
        yeniParola: gosterilecek?.parola ?? null,
        yeniParolaKullanici: gosterilecek?.ad ?? null,
      }),
    );
  });

  app.post('/kullanicilar', { preHandler: yetkiGerek('kullanici_yonet') }, async (istek, yanit) => {
    const ayristirma = z
      .object({ kullaniciAdi: z.string().min(3).max(80), rol: rolSemasi })
      .safeParse(istek.body);

    if (!ayristirma.success) {
      istek.session.bildirim = { tur: 'hata', metin: 'Kullanıcı adı en az 3 karakter olmalı.' };
      return yanit.redirect('/kullanicilar');
    }

    const parola = parolaUret();
    try {
      const yeni = await kullaniciEkle(
        db,
        ayristirma.data.kullaniciAdi,
        parola,
        ayristirma.data.rol as Rol,
      );
      gosterilecekParolalar.set(istek.session.kullanici?.id ?? 0, {
        ad: yeni.kullanici_adi,
        parola,
      });
      await denetimIsle(istek, 'kullanici.ekle', yeni.kullanici_adi, { rol: yeni.rol });
    } catch {
      istek.session.bildirim = { tur: 'hata', metin: 'Bu kullanıcı adı zaten var.' };
    }
    return yanit.redirect('/kullanicilar');
  });

  app.post(
    '/kullanicilar/:id/parola-sifirla',
    { preHandler: yetkiGerek('kullanici_yonet') },
    async (istek, yanit) => {
      const id = Number((istek.params as { id: string }).id);
      const parola = parolaUret();
      await parolaDegistirKaydet(db, id, parola, { zorunluDegisim: true });

      const satirlar = await db<{ kullanici_adi: string }[]>`
        SELECT kullanici_adi FROM kullanici WHERE id = ${id}
      `;
      gosterilecekParolalar.set(istek.session.kullanici?.id ?? 0, {
        ad: satirlar[0]?.kullanici_adi ?? String(id),
        parola,
      });
      await denetimIsle(istek, 'kullanici.parola_sifirla', String(id));
      return yanit.redirect('/kullanicilar');
    },
  );

  app.post(
    '/kullanicilar/:id/aktiflik',
    { preHandler: yetkiGerek('kullanici_yonet') },
    async (istek, yanit) => {
      const id = Number((istek.params as { id: string }).id);
      const { aktif } = z.object({ aktif: z.enum(['evet', 'hayir']) }).parse(istek.body);

      if (id === istek.session.kullanici?.id && aktif === 'hayir') {
        istek.session.bildirim = { tur: 'hata', metin: 'Kendi hesabınızı pasifleştiremezsiniz.' };
        return yanit.redirect('/kullanicilar');
      }

      await kullaniciAktiflik(db, id, aktif === 'evet');
      await denetimIsle(istek, 'kullanici.aktiflik', String(id), { aktif: aktif === 'evet' });
      return yanit.redirect('/kullanicilar');
    },
  );

  app.post('/kullanicilar/:id/rol', { preHandler: yetkiGerek('kullanici_yonet') }, async (istek, yanit) => {
    const id = Number((istek.params as { id: string }).id);
    const { rol } = z.object({ rol: rolSemasi }).parse(istek.body);

    if (id === istek.session.kullanici?.id && rol !== 'superadmin') {
      istek.session.bildirim = {
        tur: 'hata',
        metin: 'Kendi superadmin rolünüzü düşüremezsiniz — sistem yönetimsiz kalabilir.',
      };
      return yanit.redirect('/kullanicilar');
    }

    await rolDegistir(db, id, rol as Rol);
    await denetimIsle(istek, 'kullanici.rol', String(id), { rol });
    istek.session.bildirim = { tur: 'basari', metin: 'Rol güncellendi.' };
    return yanit.redirect('/kullanicilar');
  });

  async function denetimIsle(
    istek: { session: { kullanici?: { id: number; ad: string } }; ip: string },
    eylem: string,
    hedef: string,
    ayrinti: Record<string, unknown> = {},
  ): Promise<void> {
    const k = istek.session.kullanici;
    await denetimYaz(db, {
      kullaniciId: k?.id ?? null,
      kullaniciAdi: k?.ad ?? null,
      eylem,
      hedef,
      ayrinti,
      ip: istek.ip,
    });
  }
}

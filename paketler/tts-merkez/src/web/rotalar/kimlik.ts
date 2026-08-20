// Giris, cikis, parola degistirme.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { denetimYaz, girisDogrula, parolaDogrula, parolaDegistirKaydet } from '../kimlik.ts';
import { sayfaVerisi } from '../sunucu.ts';

const girisSemasi = z.object({
  kullaniciAdi: z.string().min(1).max(120),
  parola: z.string().min(1).max(500),
});

const parolaSemasi = z.object({
  eskiParola: z.string().min(1).max(500),
  yeniParola: z.string().min(12, 'Yeni parola en az 12 karakter olmalı.').max(500),
  yeniParolaTekrar: z.string().min(1).max(500),
});

export async function kimlikRotalari(app: FastifyInstance): Promise<void> {
  const { db } = app.baglam;

  app.get('/giris', async (istek, yanit) => {
    if (istek.session.kullanici) return yanit.redirect('/kelimeler');
    return yanit.view('giris.eta', { baslik: 'Giriş', hata: null });
  });

  app.post('/giris', async (istek, yanit) => {
    const ayristirma = girisSemasi.safeParse(istek.body);
    if (!ayristirma.success) {
      return yanit.code(400).view('giris.eta', { baslik: 'Giriş', hata: 'Eksik bilgi.' });
    }

    const kullanici = await girisDogrula(
      db,
      ayristirma.data.kullaniciAdi,
      ayristirma.data.parola,
    );

    if (!kullanici) {
      // Hangi alanin yanlis oldugu soylenmez.
      await denetimYaz(db, {
        eylem: 'giris.basarisiz',
        hedef: ayristirma.data.kullaniciAdi,
        ip: istek.ip,
      });
      return yanit.code(401).view('giris.eta', {
        baslik: 'Giriş',
        hata: 'Kullanıcı adı veya parola hatalı.',
      });
    }

    istek.session.kullanici = {
      id: kullanici.id,
      ad: kullanici.kullanici_adi,
      rol: kullanici.rol,
      parolaDegistir: kullanici.parola_degistir,
    };

    await denetimYaz(db, {
      kullaniciId: kullanici.id,
      kullaniciAdi: kullanici.kullanici_adi,
      eylem: 'giris',
      ip: istek.ip,
    });

    return yanit.redirect(kullanici.parola_degistir ? '/parola' : '/kelimeler');
  });

  app.get('/cikis', async (istek, yanit) => {
    const k = istek.session.kullanici;
    if (k) {
      await denetimYaz(db, {
        kullaniciId: k.id,
        kullaniciAdi: k.ad,
        eylem: 'cikis',
        ip: istek.ip,
      });
    }
    await istek.session.destroy();
    return yanit.redirect('/giris');
  });

  app.get('/parola', async (istek, yanit) =>
    yanit.view('parola.eta', sayfaVerisi(istek, { baslik: 'Parola', aktif: '' })),
  );

  app.post('/parola', async (istek, yanit) => {
    const k = istek.session.kullanici;
    if (!k) return yanit.redirect('/giris');

    const ayristirma = parolaSemasi.safeParse(istek.body);
    if (!ayristirma.success) {
      istek.session.bildirim = {
        tur: 'hata',
        metin: ayristirma.error.issues[0]?.message ?? 'Geçersiz parola.',
      };
      return yanit.redirect('/parola');
    }

    const { eskiParola, yeniParola, yeniParolaTekrar } = ayristirma.data;

    if (yeniParola !== yeniParolaTekrar) {
      istek.session.bildirim = { tur: 'hata', metin: 'Yeni parolalar eşleşmiyor.' };
      return yanit.redirect('/parola');
    }

    const satirlar = await db<{ parola_hash: string }[]>`
      SELECT parola_hash FROM kullanici WHERE id = ${k.id}
    `;
    const hash = satirlar[0]?.parola_hash;
    if (!hash || !(await parolaDogrula(hash, eskiParola))) {
      istek.session.bildirim = { tur: 'hata', metin: 'Mevcut parola hatalı.' };
      return yanit.redirect('/parola');
    }

    await parolaDegistirKaydet(db, k.id, yeniParola);
    istek.session.kullanici = { ...k, parolaDegistir: false };
    await denetimYaz(db, {
      kullaniciId: k.id,
      kullaniciAdi: k.ad,
      eylem: 'parola.degistir',
      ip: istek.ip,
    });

    istek.session.bildirim = { tur: 'basari', metin: 'Parola değiştirildi.' };
    return yanit.redirect('/kelimeler');
  });
}

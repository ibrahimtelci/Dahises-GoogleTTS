// Ayarlar ekrani — Google kimligi ve ses profilleri (§6.6).
//
// Buradaki iki ayar da CALISMA ANINDA degisir; sunucu yeniden baslatilmaz.
// Kimlik degisince motor vekili yenilenir (motor/vekil.ts).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sayfaVerisi, yetkiGerek } from '../sunucu.ts';
import { denetimYaz } from '../kimlik.ts';
import { ayarYaz, maskele, motorKimligiCoz, motoruYenile } from '../../ayarlar.ts';
import { profilBul, profilleriGetir } from './ortak.ts';

const TIYER_ADLARI: Record<string, string> = {
  standard: 'Standard',
  wavenet: 'WaveNet',
  chirp3hd: 'Chirp 3 HD',
};

const CINSIYET_ADLARI: Record<string, string> = {
  FEMALE: 'Kadın',
  MALE: 'Erkek',
  NEUTRAL: 'Nötr',
};

export async function ayarRotalari(app: FastifyInstance): Promise<void> {
  const { db, motor, butce, ayar } = app.baglam;

  /** Ekranin ihtiyaci olan her sey — birden fazla rota kullaniyor. */
  async function sayfaDurumu(): Promise<Record<string, unknown>> {
    const kimlik = await motorKimligiCoz(db, ayar);
    return {
      kimlik: {
        kaynak: kimlik.kaynak,
        apiMaskeli: maskele(kimlik.apiAnahtari),
        servisHesabi: kimlik.servisHesabiYolu ?? null,
        motorAdi: motor.ad,
        sahte: motor.ad !== 'google',
      },
      profiller: await profilleriGetir(db),
      tiyerAdlari: TIYER_ADLARI,
    };
  }

  app.get('/ayarlar', { preHandler: yetkiGerek('ayar') }, async (istek, yanit) =>
    yanit.view(
      'ayarlar.eta',
      sayfaVerisi(istek, { baslik: 'Ayarlar', aktif: 'ayarlar', ...(await sayfaDurumu()) }),
    ),
  );

  // ── Google kimligi ─────────────────────────────────────────────────────

  app.post('/ayarlar/google', { preHandler: yetkiGerek('ayar') }, async (istek, yanit) => {
    const govde = z
      .object({
        apiAnahtari: z.string().max(400).optional().default(''),
        servisHesabi: z.string().max(600).optional().default(''),
        temizle: z.string().optional(),
      })
      .parse(istek.body);

    const kullaniciId = istek.session.kullanici?.id ?? null;

    if (govde.temizle) {
      await ayarYaz(db, 'google_api_anahtari', null, kullaniciId);
      await ayarYaz(db, 'google_servis_hesabi', null, kullaniciId);
      await denetimYaz(db, {
        eylem: 'ayar.google_temizlendi',
        hedef: 'sistem_ayari',
        ip: istek.ip,
        kullaniciId,
      });
    } else {
      // Bos gonderilen alan DEGISTIRILMEZ: kullanici anahtari maskeli gorup
      // yalnizca servis hesabini duzenleyebilmeli.
      if (govde.apiAnahtari.trim())
        await ayarYaz(db, 'google_api_anahtari', govde.apiAnahtari, kullaniciId);
      if (govde.servisHesabi.trim())
        await ayarYaz(db, 'google_servis_hesabi', govde.servisHesabi, kullaniciId);
      await denetimYaz(db, {
        eylem: 'ayar.google_guncellendi',
        hedef: 'sistem_ayari',
        ip: istek.ip,
        kullaniciId,
      });
    }

    const yeni = await motoruYenile(motor, db, ayar, butce);
    istek.session.bildirim =
      yeni.kaynak === 'yok'
        ? { tur: 'uyari', metin: 'Kimlik temizlendi — sahte motora düşüldü, Google’a gidilmeyecek.' }
        : {
            tur: 'basari',
            metin:
              'Kimlik güncellendi ve motor yenilendi (kaynak: ' +
              (yeni.kaynak === 'veritabani' ? 'ayarlar' : '.env') +
              '). Sunucu yeniden başlatılmadı.',
          };

    return yanit.redirect('/ayarlar');
  });

  /** Kimligi gercekten dener: listVoices cagirir. Karakter harcamaz. */
  app.post('/ayarlar/google/dene', { preHandler: yetkiGerek('ayar') }, async (istek, yanit) => {
    try {
      const sesler = await motor.sesleriListele(ayar.DIL_KODU);
      const kesilebilir = sesler.filter((s) => s.kesmeDestegi);
      return yanit.view('ayarlar-dene.eta', {
        tamam: true,
        motorAdi: motor.ad,
        toplam: sesler.length,
        kesilebilir: kesilebilir.length,
        hizlar: [...new Set(sesler.map((s) => s.dogalOrnekHizi))].join(', '),
      });
    } catch (hata) {
      return yanit.view('ayarlar-dene.eta', {
        tamam: false,
        mesaj: hata instanceof Error ? hata.message : String(hata),
      });
    }
  });

  // ── Ses secici: tiyer -> o tiyerdeki sesler (canli listVoices) ─────────

  app.get('/ayarlar/sesler', { preHandler: yetkiGerek('ayar') }, async (istek, yanit) => {
    const sorgu = z
      .object({ tiyer: z.string().max(20).optional().default(''), cinsiyet: z.string().max(10).optional().default('') })
      .parse(istek.query);

    let sesler = await motor.sesleriListele(ayar.DIL_KODU);
    // Kesme yontemini desteklemeyen ses profil olarak eklenemez (§6.6).
    sesler = sesler.filter((s) => s.kesmeDestegi);
    if (sorgu.tiyer) sesler = sesler.filter((s) => s.tiyer === sorgu.tiyer);
    if (sorgu.cinsiyet) sesler = sesler.filter((s) => s.cinsiyet === sorgu.cinsiyet);

    const mevcut = await profilleriGetir(db);
    const kullanilan = new Set(mevcut.map((p) => p.motor_sesi));

    return yanit.view('ayarlar-ses-secici.eta', {
      sesler: sesler.map((s) => ({
        ...s,
        cinsiyetAdi: CINSIYET_ADLARI[s.cinsiyet] ?? s.cinsiyet,
        tiyerAdi: TIYER_ADLARI[s.tiyer] ?? s.tiyer,
        zatenVar: kullanilan.has(s.ad),
      })),
      secilenTiyer: sorgu.tiyer,
      secilenCinsiyet: sorgu.cinsiyet,
    });
  });

  // ── Profil ekleme / varsayilan / durum ────────────────────────────────

  app.post('/ayarlar/profil', { preHandler: yetkiGerek('ayar') }, async (istek, yanit) => {
    const govde = z
      .object({
        id: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/, 'Yalnız küçük harf, rakam ve tire.'),
        motorSesi: z.string().min(1).max(80),
        varsayilanYap: z.string().optional(),
      })
      .parse(istek.body);

    const kullaniciId = istek.session.kullanici?.id ?? null;
    const sesler = await motor.sesleriListele(ayar.DIL_KODU);
    const ses = sesler.find((s) => s.ad === govde.motorSesi);

    if (!ses) {
      istek.session.bildirim = { tur: 'hata', metin: 'Ses bulunamadı: ' + govde.motorSesi };
      return yanit.redirect('/ayarlar');
    }
    if (!ses.kesmeDestegi) {
      // Sessizce eklenirse uretim hatti calisir gorunup damgasiz yanit alir.
      istek.session.bildirim = {
        tur: 'hata',
        metin:
          ses.ad + ' kesme yöntemini desteklemiyor (SSML işaretine damga döndürmüyor) ' +
          've profil olarak eklenemez — §6.6.',
      };
      return yanit.redirect('/ayarlar');
    }

    const varsayilanYap = Boolean(govde.varsayilanYap);

    await db.begin(async (tx) => {
      if (varsayilanYap) await tx`UPDATE ses_profili SET varsayilan = false WHERE varsayilan`;
      await tx`
        INSERT INTO ses_profili (id, motor, motor_sesi, tiyer, ornek_hizi, cinsiyet, varsayilan, aktif)
        VALUES (${govde.id}, 'google', ${ses.ad}, ${ses.tiyer}, ${ses.dogalOrnekHizi},
                ${ses.cinsiyet}, ${varsayilanYap}, true)
        ON CONFLICT (id) DO UPDATE
          SET motor_sesi = EXCLUDED.motor_sesi, tiyer = EXCLUDED.tiyer,
              ornek_hizi = EXCLUDED.ornek_hizi, cinsiyet = EXCLUDED.cinsiyet, aktif = true
      `;
    });

    await denetimYaz(db, {
      eylem: 'ayar.profil_eklendi',
      hedef: govde.id + ' → ' + ses.ad,
      ip: istek.ip,
      kullaniciId,
    });

    istek.session.bildirim = {
      tur: 'basari',
      metin:
        'Profil "' + govde.id + '" kaydedildi (' + ses.ad + ', ' + ses.dogalOrnekHizi + ' Hz).' +
        (varsayilanYap ? ' Varsayılan yapıldı.' : ''),
    };
    return yanit.redirect('/ayarlar');
  });

  app.post('/ayarlar/profil/:id/varsayilan', { preHandler: yetkiGerek('ayar') }, async (istek, yanit) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(istek.params);
    const profil = await profilBul(db, id);
    if (!profil) {
      istek.session.bildirim = { tur: 'hata', metin: 'Profil yok: ' + id };
      return yanit.redirect('/ayarlar');
    }
    if (!profil.aktif) {
      istek.session.bildirim = {
        tur: 'hata',
        metin: 'Pasif profil varsayılan yapılamaz. Önce etkinleştirin.',
      };
      return yanit.redirect('/ayarlar');
    }

    await db.begin(async (tx) => {
      await tx`UPDATE ses_profili SET varsayilan = false WHERE varsayilan`;
      await tx`UPDATE ses_profili SET varsayilan = true WHERE id = ${id}`;
    });

    await denetimYaz(db, {
      eylem: 'ayar.varsayilan_profil',
      hedef: id,
      ip: istek.ip,
      kullaniciId: istek.session.kullanici?.id ?? null,
    });

    istek.session.bildirim = {
      tur: 'basari',
      metin:
        'Varsayılan profil: ' + id + ' (' + profil.motor_sesi + '). ' +
        'Bundan sonraki üretim bu sesle yapılacak.',
    };
    return yanit.redirect('/ayarlar');
  });

  app.post('/ayarlar/profil/:id/durum', { preHandler: yetkiGerek('ayar') }, async (istek, yanit) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(istek.params);
    const profil = await profilBul(db, id);
    if (!profil) {
      istek.session.bildirim = { tur: 'hata', metin: 'Profil yok: ' + id };
      return yanit.redirect('/ayarlar');
    }
    if (profil.varsayilan && profil.aktif) {
      istek.session.bildirim = {
        tur: 'hata',
        metin: 'Varsayılan profil pasifleştirilemez. Önce başka bir profili varsayılan yapın.',
      };
      return yanit.redirect('/ayarlar');
    }

    await db`UPDATE ses_profili SET aktif = ${!profil.aktif} WHERE id = ${id}`;
    await denetimYaz(db, {
      eylem: profil.aktif ? 'ayar.profil_pasif' : 'ayar.profil_aktif',
      hedef: id,
      ip: istek.ip,
      kullaniciId: istek.session.kullanici?.id ?? null,
    });

    istek.session.bildirim = {
      tur: 'basari',
      metin: 'Profil "' + id + '" ' + (profil.aktif ? 'pasifleştirildi.' : 'etkinleştirildi.'),
    };
    return yanit.redirect('/ayarlar');
  });
}

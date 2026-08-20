// Ses profilleri + DENEME ekrani.
//
// Deneme Google'a GERCEK istek atar: maliyet onaydan once gosterilir ve kota
// sayacina islenir. Birlesik surum CAPRAZ kurulur (durustluk kurali).

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { denemeMaliyeti, denemeYap, type DenemeSonucu } from '../../deneme/capraz.ts';
import { kesmeDestekliyorMu } from '../../motor/google.ts';
import type { SesProfili, Tiyer } from '../../motor/arayuz.ts';
import type { TasiyiciYuva } from '../../ses/kesme.ts';
import { sablonuAyristir, unvanlariAc } from '../../ses/metin.ts';
import { kotaDurumu } from '../../uretim/kota.ts';
import { denetimYaz } from '../kimlik.ts';
import { sayfaVerisi, yetkiGerek } from '../sunucu.ts';
import { profilBul, profilleriGetir, sablonlariGetir } from './ortak.ts';

/** Uretilen deneme sesleri — kisa omurlu, surec ici. */
const denemeSesleri = new Map<string, { gercek: Buffer; birlesik: Buffer; olusturuldu: number }>();
const bekleyenDenemeler = new Map<
  string,
  { profil: string; yuvalar: TasiyiciYuva[]; olusturuldu: number }
>();

function temizle(): void {
  const sinir = Date.now() - 60 * 60 * 1000;
  for (const [k, v] of denemeSesleri) if (v.olusturuldu < sinir) denemeSesleri.delete(k);
  for (const [k, v] of bekleyenDenemeler) if (v.olusturuldu < sinir) bekleyenDenemeler.delete(k);
}

/** Serbest metni ya da sablon degerlerini taşıyıcı yuvalarina cevirir. */
export function denemeYuvalari(
  metin: string,
  sablonMetni: string | null,
): TasiyiciYuva[] {
  const degerDeseni = /^\s*\w+\s*=/;

  if (sablonMetni && degerDeseni.test(metin)) {
    const degerler: Record<string, string> = {};
    for (const parca of metin.split(',')) {
      const [ad, ...kalan] = parca.split('=');
      if (ad && kalan.length > 0) degerler[ad.trim()] = kalan.join('=').trim();
    }
    return sablonuAyristir(sablonMetni).map((p) =>
      p.tur === 'kalip'
        ? { yuva: 'kalip:' + p.deger, metin: p.deger }
        : { yuva: p.deger, metin: unvanlariAc(degerler[p.deger] ?? p.deger).sonuc },
    );
  }

  // Serbest metin: kelime kelime yuva. Tonlama yuvasi bilinmedigi icin yuva
  // adi sirayla verilir; deneme amacli yeterlidir.
  return unvanlariAc(metin)
    .sonuc.split(/\s+/)
    .filter(Boolean)
    .map((kelime, i) => ({ yuva: 'p' + String(i), metin: kelime }));
}

export async function sesRotalari(app: FastifyInstance): Promise<void> {
  const { db, motor, depo, butce, ayar } = app.baglam;

  app.get('/sesler', async (istek, yanit) =>
    yanit.view(
      'sesler.eta',
      sayfaVerisi(istek, {
        baslik: 'Sesler',
        aktif: 'sesler',
        profiller: await profilleriGetir(db),
        sablonlar: await sablonlariGetir(db),
      }),
    ),
  );

  app.get('/sesler/liste', async (istek, yanit) => {
    const sesler = await motor.sesleriListele(ayar.DIL_KODU);
    return yanit.view('ses-listesi.eta', { sesler });
  });

  app.post('/sesler/deneme/maliyet', { preHandler: yetkiGerek('uret') }, async (istek, yanit) => {
    const govde = z
      .object({
        profil: z.string().max(80),
        metin: z.string().min(1).max(500),
        sablonId: z.string().max(20).optional().default(''),
      })
      .parse(istek.body);

    const profilSatiri = await profilBul(db, govde.profil);
    if (!profilSatiri) {
      return yanit.type('text/html; charset=utf-8').send('<div class="uyari hata">Profil yok.</div>');
    }
    if (!kesmeDestekliyorMu(profilSatiri.motor_sesi)) {
      return yanit
        .type('text/html; charset=utf-8')
        .send(
          '<div class="uyari hata">Bu ses kesme yöntemini desteklemiyor (Chirp 3 HD, §6.6); deneme yapılamaz.</div>',
        );
    }

    let sablonMetni: string | null = null;
    if (govde.sablonId) {
      const s = await db<{ metin: string }[]>`
        SELECT metin FROM sablon WHERE id = ${Number(govde.sablonId)}
      `;
      sablonMetni = s[0]?.metin ?? null;
    }

    const yuvalar = denemeYuvalari(govde.metin, sablonMetni);
    const profil = profilNesnesi(profilSatiri);
    const maliyet = await denemeMaliyeti(db, profil, yuvalar);

    const kotalar = await kotaDurumu(db);
    const kota = kotalar.find((k) => k.tiyer === profil.tiyer) ?? kotalar[0];
    const b = butce.durum();

    let engel: string | null = null;
    if (kota && maliyet.karakter > kota.kalan) {
      engel = `${kota.tiyerAdi} kotasında yeterli karakter yok (kalan ${kota.kalan.toLocaleString('tr-TR')}).`;
    }
    if (!(await butce.yeterMi(maliyet.cagri))) {
      engel = `Google geliştirme bütçesi yetmiyor: ${b.kalanKlip} klip kaldı, bu deneme ${maliyet.cagri} çağrı ister.`;
    }

    const jeton = randomUUID();
    temizle();
    bekleyenDenemeler.set(jeton, { profil: profil.id, yuvalar, olusturuldu: Date.now() });

    return yanit.view('deneme-maliyet.eta', {
      cumle: yuvalar.map((y) => y.metin).join(' '),
      parcaSayisi: yuvalar.length,
      maliyet,
      kota,
      butce: b,
      engel,
      jeton,
    });
  });

  app.post('/sesler/deneme/calistir', { preHandler: yetkiGerek('uret') }, async (istek, yanit) => {
    const { jeton } = z.object({ jeton: z.string().uuid() }).parse(istek.body);
    const bekleyen = bekleyenDenemeler.get(jeton);
    if (!bekleyen) {
      return yanit
        .type('text/html; charset=utf-8')
        .send('<div class="uyari hata">Onay süresi doldu. Maliyeti yeniden hesaplayın.</div>');
    }
    bekleyenDenemeler.delete(jeton);

    const profilSatiri = await profilBul(db, bekleyen.profil);
    if (!profilSatiri) {
      return yanit.type('text/html; charset=utf-8').send('<div class="uyari hata">Profil yok.</div>');
    }

    let sonuc: DenemeSonucu;
    try {
      sonuc = await denemeYap({ db, motor, depo }, profilNesnesi(profilSatiri), bekleyen.yuvalar, {
        boslukMs: ayar.BIRLESTIRME_BOSLUK_MS,
        crossfadeMs: ayar.BIRLESTIRME_CROSSFADE_MS,
        kuyrukMs: ayar.KESME_KUYRUK_MS,
      });
    } catch (hata) {
      await db`
        INSERT INTO uretim_gunlugu (tur, profil, tiyer, basarili, hata)
        VALUES ('deneme', ${profilSatiri.id}, ${profilSatiri.tiyer}, false, ${(hata as Error).message})
      `;
      return yanit
        .type('text/html; charset=utf-8')
        .send(`<div class="uyari hata">Deneme başarısız: ${(hata as Error).message}</div>`);
    }

    const kimlik = randomUUID();
    denemeSesleri.set(kimlik, {
      gercek: sonuc.gercek.wav,
      birlesik: sonuc.birlesik.wav,
      olusturuldu: Date.now(),
    });

    await db`
      INSERT INTO uretim_gunlugu (tur, profil, tiyer, klip_sayisi, karakter, sure_ms, ayrinti)
      VALUES ('deneme', ${profilSatiri.id}, ${profilSatiri.tiyer},
              ${sonuc.birlesik.parcalar.length}, ${sonuc.toplamKarakter}, ${sonuc.birlesik.sureMs},
              ${db.json({ cagri: sonuc.cagriSayisi } as never)})
    `;
    const k = istek.session.kullanici;
    await denetimYaz(db, {
      kullaniciId: k?.id ?? null,
      kullaniciAdi: k?.ad ?? null,
      eylem: 'deneme.calistir',
      hedef: profilSatiri.id,
      ayrinti: { karakter: sonuc.toplamKarakter, cagri: sonuc.cagriSayisi },
      ip: istek.ip,
    });

    const fark = sonuc.birlesik.sureMs - sonuc.gercek.sureMs;
    const yuzde = sonuc.gercek.sureMs > 0 ? (fark / sonuc.gercek.sureMs) * 100 : 0;

    return yanit.view('deneme-sonuc.eta', {
      sonuc,
      kimlik,
      sureFarki: `${fark >= 0 ? '+' : ''}${fark} ms (%${yuzde.toFixed(1)})`,
    });
  });

  app.get('/sesler/deneme/ses/:kimlik/:hangi.wav', async (istek, yanit) => {
    const p = istek.params as { kimlik: string; hangi: string };
    const kayit = denemeSesleri.get(p.kimlik);
    if (!kayit) return yanit.code(404).send('ses yok');
    const wav = p.hangi === 'gercek' ? kayit.gercek : kayit.birlesik;
    return yanit.type('audio/wav').send(wav);
  });

  function profilNesnesi(p: {
    id: string;
    motor: string;
    motor_sesi: string;
    tiyer: string;
    ornek_hizi: number;
  }): SesProfili {
    return {
      id: p.id,
      motor: p.motor,
      motorSesi: p.motor_sesi,
      tiyer: p.tiyer as Tiyer,
      ornekHizi: Number(p.ornek_hizi),
    };
  }
}

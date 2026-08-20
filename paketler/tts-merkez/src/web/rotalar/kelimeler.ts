// Kelime veritabani ekrani (§9F) + toplu ekleme.
//
// 250 bin satirlik tabloyu filtresiz sorgulayan tek bir ekran yok:
// SUNUCU TARAFI SAYFALAMA zorunlu.

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { engelSebebi, kucukHarf, normalize, unvanlariAc } from '../../ses/metin.ts';
import { tasiyiciKur } from '../../ses/kesme.ts';
import { wavYaz } from '../../ses/pcm.ts';
import { kotaDurumu } from '../../uretim/kota.ts';
import { kuyrugaEkle } from '../../uretim/kuyruk.ts';
import { yuvalariTanimla, tasiyiciSayisiTahmini } from '../../uretim/planlayici.ts';
import { denetimYaz } from '../kimlik.ts';
import { kacir, sayfaVerisi, yetkiGerek } from '../sunucu.ts';
import { varsayilanSablon, profilleriGetir, tipListesi } from './ortak.ts';

const SAYFA_BOYUTU = 50;

const DURUMLAR = ['pending', 'uretiliyor', 'ready', 'failed', 'engellendi', 'kota_bekliyor'] as const;

const DURUM_ETIKETI: Record<string, string> = {
  pending: 'bekliyor',
  uretiliyor: 'üretiliyor',
  ready: 'hazır',
  failed: 'hatalı',
  engellendi: 'engellendi',
  kota_bekliyor: 'kota bekliyor',
};

const filtreSemasi = z.object({
  q: z.string().max(200).optional().default(''),
  durum: z.string().max(40).optional().default(''),
  tip: z.string().max(40).optional().default(''),
  profil: z.string().max(80).optional().default(''),
  kaynak: z.string().max(20).optional().default(''),
  baslangic: z.string().max(20).optional().default(''),
  bitis: z.string().max(20).optional().default(''),
  sayfa: z.coerce.number().int().min(1).optional().default(1),
});

type OnizlemeSatiri = {
  ham: string;
  normal: string;
  tip: string;
  degisti: boolean;
  mevcut: boolean;
  engelSebebi: string | null;
};

/** Onaylanmayi bekleyen onizlemeler — kisa omurlu, surec ici. */
const bekleyenOnizlemeler = new Map<
  string,
  { profil: string; hastaneId: number; satirlar: OnizlemeSatiri[]; olusturuldu: number }
>();

function eskileriTemizle(): void {
  const sinir = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of bekleyenOnizlemeler) if (v.olusturuldu < sinir) bekleyenOnizlemeler.delete(k);
}

type MultipartAlan = { type?: string; value?: unknown; toBuffer?: () => Promise<Buffer> };

/**
 * Gövdeyi düz `{alan: metin}` haline getirir.
 *
 * `@fastify/multipart` `attachFieldsToBody` ile alanları `{type,value}` nesnesi,
 * dosyaları `{type:'file', toBuffer()}` olarak veriyor; urlencoded gövde ise
 * düz string. İki biçim de aynı ayrıştırıcıya girsin diye tek yerde düzleniyor.
 */
async function govdeyiDuzlestir(govde: unknown): Promise<Record<string, string>> {
  const cikti: Record<string, string> = {};
  if (!govde || typeof govde !== 'object') return cikti;

  for (const [ad, deger] of Object.entries(govde as Record<string, unknown>)) {
    if (typeof deger === 'string') {
      cikti[ad] = deger;
      continue;
    }
    const alan = deger as MultipartAlan;
    if (alan?.type === 'file' && typeof alan.toBuffer === 'function') {
      const tampon = await alan.toBuffer();
      // Dosya adı çakışmasın diye ayrı anahtar; ayrıştırıcı ikisini birleştirir.
      cikti['__dosya'] = tampon.toString('utf8');
      continue;
    }
    if (alan && 'value' in alan) cikti[ad] = String(alan.value ?? '');
  }
  return cikti;
}

export async function kelimeRotalari(app: FastifyInstance): Promise<void> {
  const { db, depo, butce, ayar } = app.baglam;

  app.get('/kelimeler', async (istek, yanit) => {
    const f = filtreSemasi.parse(istek.query);
    const offset = (f.sayfa - 1) * SAYFA_BOYUTU;

    const kosullar = db`
      ${f.q ? db`AND k.kelime ILIKE ${'%' + f.q + '%'}` : db``}
      ${f.durum ? db`AND k.durum = ${f.durum}` : db``}
      ${f.profil ? db`AND k.profil = ${f.profil}` : db``}
      ${f.kaynak ? db`AND k.kaynak = ${f.kaynak}` : db``}
      ${f.baslangic ? db`AND k.olusturuldu >= ${f.baslangic}::date` : db``}
      ${f.bitis ? db`AND k.olusturuldu < (${f.bitis}::date + interval '1 day')` : db``}
      ${f.tip ? db`AND EXISTS (SELECT 1 FROM klip_kapsam kk WHERE kk.klip_id = k.id AND kk.tip = ${f.tip})` : db``}
    `;

    const sayim = await db<{ adet: string }[]>`
      SELECT count(*)::text AS adet FROM klip k WHERE true ${kosullar}
    `;
    const toplam = Number(sayim[0]?.adet ?? 0);

    // Varsayilan gorunum: cevrilmemisler once (ready en sonda).
    const satirlar = await db`
      SELECT k.id, k.kelime, k.telaffuz, k.profil, k.durum, k.hash, k.sure_ms, k.surum,
             k.kaynak, k.hata, k.olusturuldu,
             (SELECT string_agg(DISTINCT kk.tip, ', ') FROM klip_kapsam kk WHERE kk.klip_id = k.id) AS tipler
        FROM klip k
       WHERE true ${kosullar}
       ORDER BY (k.durum = 'ready') ASC, k.olusturuldu DESC, k.id DESC
       LIMIT ${SAYFA_BOYUTU} OFFSET ${offset}
    `;

    const kotalar = await kotaDurumu(db);
    const dolu = kotalar.filter((k) => k.bant === 'dolu' && k.kesmeDestegi);
    const b = butce.durum();

    const kilitSebepleri: string[] = [];
    if (dolu.length > 0) {
      kilitSebepleri.push(
        dolu.map((k) => `${k.tiyerAdi} aylık kota sert limiti (%90) doldu`).join(', '),
      );
    }
    if (b.kalanKlip === 0) {
      kilitSebepleri.push(`Google geliştirme bütçesi doldu (${b.klip}/${b.klipSiniri} klip)`);
    }

    const sorguDizesi = (sayfa: number): string => {
      const p = new URLSearchParams();
      for (const [ad, deger] of Object.entries({ ...f, sayfa })) {
        if (deger !== '' && deger !== undefined) p.set(ad, String(deger));
      }
      return '/kelimeler?' + p.toString();
    };

    return yanit.view(
      'kelimeler.eta',
      sayfaVerisi(istek, {
        baslik: 'Kelimeler',
        aktif: 'kelimeler',
        satirlar,
        toplam,
        sayfa: f.sayfa,
        sonSayfa: Math.max(1, Math.ceil(toplam / SAYFA_BOYUTU)),
        filtre: f,
        durumlar: DURUMLAR,
        tipler: tipListesi(),
        profiller: await profilleriGetir(db),
        durumEtiketi: (d: string) => DURUM_ETIKETI[d] ?? d,
        sayfaBaglantisi: sorguDizesi,
        yazabilir: istek.session.kullanici?.rol !== 'izleyici',
        uretimKilitli: kilitSebepleri.length > 0,
        kilitSebebi: kilitSebepleri.join(' · '),
      }),
    );
  });

  // ── Satir islemleri ────────────────────────────────────────────────────

  app.get('/kelimeler/:id/dinle', async (istek, yanit) => {
    const id = Number((istek.params as { id: string }).id);
    const satirlar = await db<{ kelime: string; profil: string; hash: string | null }[]>`
      SELECT kelime, profil, hash FROM klip WHERE id = ${id}
    `;
    const s = satirlar[0];
    if (!s?.hash) return yanit.type('text/html; charset=utf-8').send('<span class="soluk kucuk">ses yok</span>');
    return yanit
      .type('text/html; charset=utf-8')
      .send(`<audio controls autoplay src="/kelimeler/${id}/ses.wav"></audio>`);
  });

  app.get('/kelimeler/:id/ses.wav', async (istek, yanit) => {
    const id = Number((istek.params as { id: string }).id);
    const satirlar = await db<{ profil: string; hash: string | null }[]>`
      SELECT profil, hash FROM klip WHERE id = ${id}
    `;
    const s = satirlar[0];
    if (!s?.hash) return yanit.code(404).send('klip yok');

    const profilSatiri = await db<{ ornek_hizi: number }[]>`
      SELECT ornek_hizi FROM ses_profili WHERE id = ${s.profil}
    `;
    const hiz = Number(profilSatiri[0]?.ornek_hizi ?? ayar.BANKA_ORNEKLEME_HIZI);

    try {
      const pcm = await depo.oku(s.profil, s.hash);
      return yanit.type('audio/wav').send(wavYaz(pcm, hiz));
    } catch {
      return yanit.code(404).send('dosya yok');
    }
  });

  app.post(
    '/kelimeler/:id/yeniden-uret',
    { preHandler: yetkiGerek('uret') },
    async (istek, yanit) => {
      const id = Number((istek.params as { id: string }).id);
      await db`
        UPDATE klip
           SET durum = 'pending', hata = NULL, deneme = 0,
               sahiplenildi = NULL, sonraki_deneme = now()
         WHERE id = ${id}
      `;
      await denetimIsle(istek, 'klip.yeniden_uret', String(id));
      return satiriYenile(app, yanit, istek, id);
    },
  );

  app.post(
    '/kelimeler/:id/engelle',
    { preHandler: yetkiGerek('kelime_yonet') },
    async (istek, yanit) => {
      const id = Number((istek.params as { id: string }).id);
      const satirlar = await db<{ kelime: string }[]>`
        UPDATE klip SET durum = 'engellendi', hata = 'admin tarafından engellendi'
         WHERE id = ${id} RETURNING kelime
      `;
      const kelime = satirlar[0]?.kelime;
      if (kelime) {
        await db`
          INSERT INTO engellenen (kelime, sebep, aciklama, ekleyen)
          VALUES (${kelime}, 'elle', 'admin arayüzünden', ${istek.session.kullanici?.ad ?? null})
          ON CONFLICT (kelime) DO NOTHING
        `;
      }
      await denetimIsle(istek, 'kelime.engelle', String(id));
      return satiriYenile(app, yanit, istek, id);
    },
  );

  app.post(
    '/kelimeler/:id/engeli-kaldir',
    { preHandler: yetkiGerek('kelime_yonet') },
    async (istek, yanit) => {
      const id = Number((istek.params as { id: string }).id);
      const satirlar = await db<{ kelime: string }[]>`
        UPDATE klip SET durum = 'pending', hata = NULL, deneme = 0, sonraki_deneme = now()
         WHERE id = ${id} RETURNING kelime
      `;
      if (satirlar[0]) await db`DELETE FROM engellenen WHERE kelime = ${satirlar[0].kelime}`;
      await denetimIsle(istek, 'kelime.engeli_kaldir', String(id));
      return satiriYenile(app, yanit, istek, id);
    },
  );

  app.get('/kelimeler/:id/telaffuz', async (istek, yanit) => {
    const id = Number((istek.params as { id: string }).id);
    const satirlar = await db<{ kelime: string; telaffuz: string | null }[]>`
      SELECT kelime, telaffuz FROM klip WHERE id = ${id}
    `;
    const s = satirlar[0];
    if (!s) return yanit.code(404).send('yok');
    return yanit.type('text/html; charset=utf-8').send(`
      <form hx-post="/kelimeler/${id}/telaffuz" hx-target="#satir-${id}" hx-swap="outerHTML"
            style="display:flex;gap:4px;margin-top:4px">
        <input name="telaffuz" value="${kacir(s.telaffuz ?? '')}" placeholder="${kacir(s.kelime)}"
               style="width:140px" class="mono">
        <button class="ikincil kucuk" type="submit">kaydet</button>
      </form>
      <div class="kucuk soluk">TTS'e fiilen gönderilecek metin. Boş bırakılırsa kelime gönderilir.</div>
    `);
  });

  app.post(
    '/kelimeler/:id/telaffuz',
    { preHandler: yetkiGerek('kelime_yonet') },
    async (istek, yanit) => {
      const id = Number((istek.params as { id: string }).id);
      const govde = z.object({ telaffuz: z.string().max(200).optional() }).parse(istek.body);
      const deger = (govde.telaffuz ?? '').trim();
      await db`
        UPDATE klip
           SET telaffuz = ${deger === '' ? null : deger},
               durum = 'pending', hata = NULL, deneme = 0, sonraki_deneme = now()
         WHERE id = ${id}
      `;
      await denetimIsle(istek, 'klip.telaffuz_degistir', String(id));
      return satiriYenile(app, yanit, istek, id);
    },
  );

  // ── Toplu ekleme ───────────────────────────────────────────────────────

  app.get('/toplu', async (istek, yanit) =>
    yanit.view(
      'toplu.eta',
      sayfaVerisi(istek, {
        baslik: 'Toplu ekleme',
        aktif: 'toplu',
        profiller: await profilleriGetir(db),
        tipler: tipListesi(),
      }),
    ),
  );

  app.post('/toplu/onizleme', { preHandler: yetkiGerek('kelime_yonet') }, async (istek, yanit) => {
    // Form multipart gelebilir (CSV yüklemesi) veya urlencoded (yalnız yapıştırma).
    const duz = await govdeyiDuzlestir(istek.body);

    const govde = z
      .object({
        metin: z.string().max(2_000_000).optional().default(''),
        profil: z.string().max(80),
        varsayilanTip: z.string().max(40).default('ad'),
        hastaneId: z.coerce.number().int().min(0).default(0),
      })
      .parse(duz);

    // Yüklenen dosya ile yapıştırılan metin aynı ayrıştırıcıdan geçer.
    const hamMetin = [govde.metin, duz['__dosya'] ?? ''].filter(Boolean).join('\n');

    const girdiler = hamMetin
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const satirlar: OnizlemeSatiri[] = [];
    const gorulen = new Set<string>();

    for (const satir of girdiler) {
      const [hamKelime, hamTip] = satir.split(',').map((x) => x.trim());
      if (!hamKelime) continue;
      const tip = hamTip && hamTip.length > 0 ? hamTip : govde.varsayilanTip;

      // Unvan acilimi ONCE: "Dr." icindeki nokta kisaltilmis ad sayilirdi.
      const acilmis = unvanlariAc(hamKelime).sonuc;

      for (const token of acilmis.split(/\s+/).filter(Boolean)) {
        const sebep = engelSebebi(token);
        const { sonuc, degisti, seslendirilemez } = normalize(token);
        const normal = kucukHarf(sonuc);
        const anahtar = normal + '|' + tip;

        if (!sebep && !seslendirilemez && gorulen.has(anahtar)) continue;
        gorulen.add(anahtar);

        const mevcut =
          !sebep && !seslendirilemez
            ? (
                await db<{ id: number }[]>`
                  SELECT id FROM klip WHERE kelime = ${normal} AND profil = ${govde.profil}
                `
              ).length > 0
            : false;

        satirlar.push({
          ham: token,
          normal: seslendirilemez ? '' : normal,
          tip,
          degisti,
          mevcut,
          // 'latin_disi' yalniz Kiril/Arap gibi alfabeler icin; ayristirma artigi
          // ('&' gibi) 'okunamaz' sayilir — arayuzde sebep dogru okunsun.
          engelSebebi: sebep ?? (seslendirilemez ? 'okunamaz' : null),
        });
      }
    }

    const yeniler = satirlar.filter((s) => !s.engelSebebi && !s.mevcut);
    const profilSatiri = await db<{ tiyer: string }[]>`
      SELECT tiyer FROM ses_profili WHERE id = ${govde.profil}
    `;
    const tiyer = profilSatiri[0]?.tiyer ?? 'standard';

    const sablon = await varsayilanSablon(db);
    const yuvalar = yuvalariTanimla(sablon.metin, sablon.ornekler, sablon.tipler);
    const degiskenSayisi = yuvalar.filter((y) => y.tur === 'degisken').length;
    const tasiyiciSayisi = tasiyiciSayisiTahmini(yeniler.length, degiskenSayisi);
    const tekTasiyiciKarakter = tasiyiciKur(
      yuvalar.map((y) => ({ yuva: y.yuva, metin: y.ornek })),
    ).karakter;

    const kotalar = await kotaDurumu(db);
    const kota = kotalar.find((k) => k.tiyer === tiyer) ?? kotalar[0];
    const b = butce.durum();
    const karakter = tasiyiciSayisi * tekTasiyiciKarakter;

    let engel: string | null = null;
    if (kota && karakter > kota.kalan) {
      engel = `Bu ekleme ${kota.tiyerAdi} kotasının kalanını (${kota.kalan.toLocaleString('tr-TR')}) aşıyor. Üretim kota dolduğunda durur ve kalan klipler kota_bekliyor durumunda bırakılır.`;
    }
    if (yeniler.length > b.kalanKlip) {
      engel = `Google geliştirme bütçesi yetmiyor: ${b.kalanKlip} klip kaldı, ${yeniler.length} klip isteniyor. Kelimeler kuyruğa eklenebilir ama üretim bütçe sınırında durur.`;
    }

    const jeton = randomUUID();
    eskileriTemizle();
    bekleyenOnizlemeler.set(jeton, {
      profil: govde.profil,
      hastaneId: govde.hastaneId,
      satirlar,
      olusturuldu: Date.now(),
    });

    return yanit.view('toplu-onizleme.eta', {
      satirlar,
      jeton,
      kota,
      butce: b,
      engel,
      ozet: {
        toplam: satirlar.length,
        yeni: yeniler.length,
        mevcut: satirlar.filter((s) => s.mevcut).length,
        degisen: satirlar.filter((s) => s.degisti && !s.engelSebebi).length,
        engellenen: satirlar.filter((s) => s.engelSebebi).length,
        karakter,
        tasiyici: tasiyiciSayisi,
      },
    });
  });

  app.post('/toplu/onayla', { preHandler: yetkiGerek('kelime_yonet') }, async (istek, yanit) => {
    const { jeton } = z.object({ jeton: z.string().uuid() }).parse(await govdeyiDuzlestir(istek.body));
    const onizleme = bekleyenOnizlemeler.get(jeton);
    if (!onizleme) {
      return yanit
        .type('text/html; charset=utf-8')
        .send('<div class="uyari hata">Önizleme süresi doldu. Lütfen yeniden önizleyin.</div>');
    }
    bekleyenOnizlemeler.delete(jeton);

    let eklenen = 0;
    let engellenen = 0;

    for (const s of onizleme.satirlar) {
      if (s.engelSebebi) {
        await db`
          INSERT INTO engellenen (kelime, sebep, aciklama, ekleyen)
          VALUES (${kucukHarf(s.ham)}, ${s.engelSebebi}, 'toplu eklemede tespit edildi',
                  ${istek.session.kullanici?.ad ?? null})
          ON CONFLICT (kelime) DO NOTHING
        `;
        engellenen++;
        continue;
      }
      if (s.mevcut || !s.normal) continue;
      await kuyrugaEkle(db, s.normal, onizleme.profil, s.tip, {
        hastaneId: onizleme.hastaneId,
        kaynak: 'toplu',
      });
      eklenen++;
    }

    await denetimIsle(istek, 'toplu.ekle', onizleme.profil, { eklenen, engellenen });
    await db`
      INSERT INTO uretim_gunlugu (tur, profil, klip_sayisi, karakter, ayrinti)
      VALUES ('kuyruk', ${onizleme.profil}, ${eklenen}, 0,
              ${db.json({ engellenen } as never)})
    `;

    return yanit.type('text/html; charset=utf-8').send(
      `<div class="uyari basari"><strong>${eklenen}</strong> kelime kuyruğa eklendi` +
        (engellenen > 0 ? `, ${engellenen} kayıt engellenenler listesine yazıldı` : '') +
        `. <a href="/kelimeler?durum=pending">Kuyruğu gör</a></div>`,
    );
  });

  async function denetimIsle(
    istek: FastifyRequest,
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

/** Tek satiri yeniden render eder — HTMX outerHTML degisimi icin. */
async function satiriYenile(
  app: FastifyInstance,
  yanit: { type: (t: string) => { send: (v: unknown) => unknown } },
  istek: FastifyRequest,
  id: number,
): Promise<unknown> {
  const { db } = app.baglam;
  const satirlar = await db<
    {
      id: number;
      kelime: string;
      telaffuz: string | null;
      profil: string;
      durum: string;
      sure_ms: number | null;
      surum: number | null;
      kaynak: string;
      hata: string | null;
      olusturuldu: Date;
      tipler: string | null;
    }[]
  >`
    SELECT k.id, k.kelime, k.telaffuz, k.profil, k.durum, k.sure_ms, k.surum, k.kaynak,
           k.hata, k.olusturuldu,
           (SELECT string_agg(DISTINCT kk.tip, ', ') FROM klip_kapsam kk WHERE kk.klip_id = k.id) AS tipler
      FROM klip k WHERE k.id = ${id}
  `;
  const s = satirlar[0];
  if (!s) return yanit.type('text/html; charset=utf-8').send('');

  const yazabilir = istek.session.kullanici?.rol !== 'izleyici';
  const etiket = DURUM_ETIKETI[s.durum] ?? s.durum;

  const dinle =
    s.durum === 'ready'
      ? `<button class="ikincil kucuk" hx-get="/kelimeler/${id}/dinle" hx-target="#ses-${id}" hx-swap="innerHTML">▶ dinle</button>`
      : '';

  const islemler = yazabilir
    ? `<button class="ikincil kucuk" hx-post="/kelimeler/${id}/yeniden-uret" hx-target="#satir-${id}" hx-swap="outerHTML">↻ yeniden üret</button>` +
      (s.durum === 'engellendi'
        ? `<button class="ikincil kucuk" hx-post="/kelimeler/${id}/engeli-kaldir" hx-target="#satir-${id}" hx-swap="outerHTML">↺ engeli kaldır</button>`
        : `<button class="tehlike kucuk" hx-post="/kelimeler/${id}/engelle" hx-target="#satir-${id}" hx-swap="outerHTML" hx-confirm="Bu kelime engellensin mi?">⛔ engelle</button>`) +
      `<button class="ikincil kucuk" hx-get="/kelimeler/${id}/telaffuz" hx-target="#ses-${id}" hx-swap="innerHTML">✎ telaffuz</button>`
    : '';

  return yanit.type('text/html; charset=utf-8').send(`
    <tr id="satir-${id}">
      <td class="mono">${kacir(s.kelime)}</td>
      <td class="mono soluk">${kacir(s.telaffuz ?? '—')}</td>
      <td>${kacir(s.tipler ?? '—')}</td>
      <td>${kacir(s.profil)}</td>
      <td><span class="rozet ${kacir(s.durum)}">${kacir(etiket)}</span>
        ${s.hata ? `<div class="kucuk soluk">${kacir(String(s.hata).slice(0, 60))}</div>` : ''}</td>
      <td>${s.sure_ms ? kacir(s.sure_ms) + ' ms' : '—'}</td>
      <td class="soluk">${s.surum ?? '—'}</td>
      <td class="soluk">${kacir(s.kaynak)}</td>
      <td class="soluk kucuk">${kacir(new Date(s.olusturuldu).toLocaleString('tr-TR'))}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">${dinle}${islemler}</div><div id="ses-${id}"></div></td>
    </tr>
  `);
}

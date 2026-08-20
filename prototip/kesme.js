// Taşıyıcı cümleden kesme yöntemi — yalıtılmış sentezin alternatifi.
//
//   node kesme.js
//
// Fikir: "Mehmet" klibini tek başına ürettirmek yerine, tam bir cümlenin içinde
// ürettirip SSML <mark> zaman damgalarıyla oradan kesip almak. Kesilen parça
// cümle ortası tonlamasını taşır: sonu düşmez, perdesi doğru yerde başlar.
//
// DÜRÜSTLÜK KURALI: parçalar bir cümleden kesilip AYNI cümle yeniden kurulursa
// sonuç doğal olarak kusursuz çıkar — bu bir şey kanıtlamaz. Bu yüzden aşağıda
// ÇAPRAZ kurulum yapılıyor: her parça başka bir cümleden geliyor ve sonuç,
// hiç üretilmemiş yeni bir cümle.
//
// Taşıyıcılar önbelleğe alınır; ayar turları ek Google maliyeti getirmez.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { birlestir, wavYaz, seviyeNormalize, pcmUzunlukSn } from './src/ses.js';

{
  const envYolu = fileURLToPath(new URL('./.env', import.meta.url));
  if (existsSync(envYolu)) process.loadEnvFile(envYolu);
}

const ANAHTAR = process.env.GOOGLE_TTS_API_KEY;

// Ses argumanla degistirilebilir; her ses kendi klasorune ve onbellegine yazar.
//   node kesme.js --ses=tr-TR-Wavenet-D
const SES = (process.argv.find((a) => a.startsWith('--ses=')) ?? '').split('=')[1] || 'tr-TR-Standard-A';
const HIZ = 24000;
const CIKTI = join('cikti', 'kesme', SES);
const ONBELLEK = join(CIKTI, 'onbellek');
mkdirSync(ONBELLEK, { recursive: true });

console.log('\nSes: ' + SES);

let harcanan = 0;

// ── Google (v1beta1 — zaman damgası için gerekli) ────────────────────────

function riffPcm(tampon) {
  if (tampon.toString('ascii', 0, 4) !== 'RIFF') return tampon;
  let k = 12;
  while (k + 8 <= tampon.length) {
    const ad = tampon.toString('ascii', k, k + 4);
    const boy = tampon.readUInt32LE(k + 4);
    if (ad === 'data') return tampon.subarray(k + 8, k + 8 + boy);
    k += 8 + boy + (boy % 2);
  }
  return tampon;
}

/** Önbellekli SSML sentezi. Aynı ssml ikinci kez istenirse Google'a gidilmez. */
async function sentezleSsml(ssml, onbellekAdi) {
  const pcmYolu = join(ONBELLEK, onbellekAdi + '.pcm');
  const jsonYolu = join(ONBELLEK, onbellekAdi + '.json');

  if (existsSync(pcmYolu) && existsSync(jsonYolu)) {
    return { pcm: readFileSync(pcmYolu), damgalar: JSON.parse(readFileSync(jsonYolu, 'utf8')), onbellekten: true };
  }

  harcanan += ssml.length;   // Google SSML etiketlerini de sayar (§6.4)
  const yanit = await fetch(
    'https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=' + encodeURIComponent(ANAHTAR),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { ssml },
        voice: { languageCode: 'tr-TR', name: SES },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: HIZ },
        enableTimePointing: ['SSML_MARK'],
      }),
    });
  if (!yanit.ok) throw new Error('TTS ' + yanit.status + ': ' + (await yanit.text()).slice(0, 300));

  const veri = await yanit.json();
  const pcm = riffPcm(Buffer.from(veri.audioContent, 'base64'));
  const damgalar = veri.timepoints ?? [];
  writeFileSync(pcmYolu, pcm);
  writeFileSync(jsonYolu, JSON.stringify(damgalar));
  return { pcm, damgalar, onbellekten: false };
}

// ── Taşıyıcı cümle ───────────────────────────────────────────────────────

const OGELER = ['sayın', 'ad', 'soyad', 'lütfen', 'sayi', 'nolu bankoya geçiniz'];

function tasiyici({ ad, soyad, sayi }) {
  const degerler = { ad, soyad, sayi };
  return '<speak>' + OGELER.map((oge, i) => {
    const metin = degerler[oge] ?? oge;
    return '<mark name="m' + i + '"/>' + metin + (i < OGELER.length - 1 ? ' ' : '.');
  }).join('') + '</speak>';
}

/**
 * Damgalar arasındaki dilimleri çıkarır.
 *
 * `kuyrukMs`: parçanın sonuna, bir sonraki damganın ötesinden eklenen pay.
 * Damga kelimenin METİN sınırını verir; sondaki ünsüzün bırakılışı ("Öztürk"teki k)
 * o noktadan sonra biter. Pay verilmezse kelime sonları kesik duyulur.
 * Bu pay birleştirmede crossfade ile eritilir, tekrar duyulmaz.
 */
function parcalariKes(pcm, damgalar, { kuyrukMs = 0 } = {}) {
  const zaman = new Map(damgalar.map((d) => [d.markName, Number(d.timeSeconds)]));
  const toplamSn = pcmUzunlukSn(pcm, HIZ);
  const ornek = (sn) => Math.max(0, Math.min(pcm.length, Math.round(sn * HIZ) * 2));

  const parcalar = {};
  for (let i = 0; i < OGELER.length; i++) {
    const bas = zaman.get('m' + i);
    if (bas === undefined) continue;
    const sonDamga = zaman.get('m' + (i + 1)) ?? toplamSn;
    const son = i === OGELER.length - 1 ? toplamSn : sonDamga + kuyrukMs / 1000;
    parcalar[OGELER[i]] = pcm.subarray(ornek(bas), ornek(son));
  }
  return parcalar;
}

const TASIYICILAR = [
  { ad: 'Mehmet', soyad: 'Karabulut', sayi: 'üç' },
  { ad: 'Ayşe', soyad: 'Yılmaz', sayi: 'on iki' },
  { ad: 'Hüseyin', soyad: 'Öztürk', sayi: 'yedi' },
  { ad: 'Mustafa', soyad: 'Çelik', sayi: 'bir' },
];

const CAPRAZ = [
  { etiket: 'mehmet-yilmaz-yedi',   ad: [0, 'Mehmet'],  soyad: [1, 'Yılmaz'], sayi: [2, 'yedi'],   kalip: 0 },
  { etiket: 'ayse-ozturk-bir',      ad: [1, 'Ayşe'],    soyad: [2, 'Öztürk'], sayi: [3, 'bir'],    kalip: 1 },
  { etiket: 'huseyin-celik-on-iki', ad: [2, 'Hüseyin'], soyad: [3, 'Çelik'],  sayi: [1, 'on iki'], kalip: 2 },
];

// ── Es düzenleri ─────────────────────────────────────────────────────────
// Beş dikiş var:  sayın→ad, ad→soyad, soyad→lütfen, lütfen→sayı, sayı→kuyruk
//
// Türkçede doğal öbekleme:  "sayın Ayşe Öztürk" | "lütfen bir nolu bankoya geçiniz"
// Yani es İSİMDEN SONRA olmalı; "sayın"dan sonra veya sayıdan sonra değil.

const DUZENLER = [
  { ad: 'K1-es-yok',        esler: [0, 0, 0, 0, 0],        kuyrukMs: 50,
    aciklama: 'hiç es yok (önceki tur)' },
  { ad: 'K2-esit-40',       esler: [40, 40, 40, 40, 40],   kuyrukMs: 50,
    aciklama: 'her dikişte eşit 40 ms es' },
  { ad: 'K3-dogal-120',     esler: [0, 0, 120, 0, 0],      kuyrukMs: 50,
    aciklama: 'DOĞAL ÖBEK: yalnız isimden sonra 120 ms' },
  { ad: 'K4-dogal-200',     esler: [0, 0, 200, 0, 0],      kuyrukMs: 50,
    aciklama: 'DOĞAL ÖBEK: isimden sonra 200 ms' },
  { ad: 'K5-dogal-ad-soyad', esler: [0, 35, 160, 0, 0],    kuyrukMs: 50,
    aciklama: 'isimden sonra 160 ms + ad/soyad arası hafif 35 ms' },
  { ad: 'K6-dogal-sayi',    esler: [0, 0, 160, 0, 60],     kuyrukMs: 50,
    aciklama: 'isimden sonra 160 ms + sayıdan sonra 60 ms' },
];

// ── Üret ─────────────────────────────────────────────────────────────────

console.log('\nTaşıyıcı cümleler...');
const hamTasiyicilar = [];
for (const [i, t] of TASIYICILAR.entries()) {
  const sonuc = await sentezleSsml(tasiyici(t), 'tasiyici-' + (i + 1));
  hamTasiyicilar.push(sonuc);
  console.log('  [' + (i + 1) + '] ' + t.ad + ' ' + t.soyad + ' / ' + t.sayi +
              '  damga: ' + sonuc.damgalar.length + (sonuc.onbellekten ? '  (önbellekten)' : ''));
}

const sessizlik = (sn) => Buffer.alloc(Math.round(HIZ * sn) * 2);

/**
 * Es düzenine göre parçaları birleştirir.
 *
 * Kuyruk payı (§parcalariKes) yalnızca crossfade'de eritilmek üzere var: içinde
 * BİR SONRAKİ kelimenin başlangıcı duruyor. Es koyacaksak payı önce kırpmak
 * zorundayız, yoksa "kelimenin ilk 38 ms'i → es → kelime baştan" diye kekeleme
 * duyulur. Bırakılan 15 ms yalnız son ünsüğün bırakılışını taşır.
 */
function kur(capraz, bankalar, esler, { kuyrukMs = 50 } = {}) {
  const dizi = [
    bankalar[capraz.kalip]['sayın'],
    bankalar[capraz.ad[0]].ad,
    bankalar[capraz.soyad[0]].soyad,
    bankalar[capraz.kalip]['lütfen'],
    bankalar[capraz.sayi[0]].sayi,
    bankalar[capraz.kalip]['nolu bankoya geçiniz'],
  ].map((p) => seviyeNormalize(p));

  const KALAN_BIRAKMA_MS = 15;
  const kirp = (pcm, ms) => {
    const bayt = Math.round(HIZ * ms / 1000) * 2;
    return bayt > 0 && bayt < pcm.length ? pcm.subarray(0, pcm.length - bayt) : pcm;
  };

  let sonuc = dizi[0];
  for (let i = 1; i < dizi.length; i++) {
    const es = esler[i - 1] ?? 0;

    if (es > 0) {
      sonuc = kirp(sonuc, Math.max(0, kuyrukMs - KALAN_BIRAKMA_MS));
      sonuc = birlestir([sonuc, dizi[i]], { hiz: HIZ, boslukMs: es, crossfadeMs: 0, sifirGecis: false });
    } else {
      sonuc = birlestir([sonuc, dizi[i]], { hiz: HIZ, boslukMs: 0, crossfadeMs: 45, sifirGecis: true });
    }
  }
  return sonuc;
}

console.log('\nEs düzenleri deneniyor...\n');
console.log('  Düzen'.padEnd(24) + 'Süre'.padStart(7) + '   Açıklama');
console.log('  ' + '─'.repeat(72));

/** Çapraz cümlenin gerçek hâli — A/B için. Önbellekli. */
async function referansAl(c) {
  const duz = 'sayın ' + c.ad[1] + ' ' + c.soyad[1] + ' lütfen ' + c.sayi[1] + ' nolu bankoya geçiniz.';
  const { pcm } = await sentezleSsml('<speak>' + duz + '</speak>', 'referans-' + c.etiket);
  return pcm;
}

for (const duzen of DUZENLER) {
  const bankalar = hamTasiyicilar.map((t) => parcalariKes(t.pcm, t.damgalar, { kuyrukMs: duzen.kuyrukMs }));

  for (const c of CAPRAZ) {
    const birlesik = kur(c, bankalar, duzen.esler, { kuyrukMs: duzen.kuyrukMs });
    writeFileSync(join(CIKTI, duzen.ad + '__' + c.etiket + '.wav'), wavYaz(birlesik, HIZ));

    // Düzen karşılaştırması tek cümle üzerinden — hep aynı cümle olsun ki fark ayara ait olsun.
    if (c === CAPRAZ[1]) {
      const referans = await referansAl(c);
      writeFileSync(join(CIKTI, 'ab-' + duzen.ad + '.wav'),
        wavYaz(Buffer.concat([referans, sessizlik(0.8), birlesik]), HIZ));
      console.log('  ' + duzen.ad.padEnd(22) + pcmUzunlukSn(birlesik, HIZ).toFixed(2).padStart(6) + ' sn   ' + duzen.aciklama);
    }
  }
}

// Kazanan düzenin tek cümleye özgü olmadığını doğrula: üç çapraz cümlenin hepsinde A/B.
const KAZANAN = DUZENLER.find((d) => d.ad === 'K1-es-yok');
{
  const bankalar = hamTasiyicilar.map((t) => parcalariKes(t.pcm, t.damgalar, { kuyrukMs: KAZANAN.kuyrukMs }));
  for (const c of CAPRAZ) {
    const referans = await referansAl(c);
    const birlesik = kur(c, bankalar, KAZANAN.esler, { kuyrukMs: KAZANAN.kuyrukMs });
    writeFileSync(join(CIKTI, 'dogrulama-' + KAZANAN.ad + '__' + c.etiket + '.wav'),
      wavYaz(Buffer.concat([referans, sessizlik(0.8), birlesik]), HIZ));
  }
}

console.log('\nHarcanan karakter (bu koşuda): ' + harcanan);
console.log('Dosyalar: ' + CIKTI);
console.log('\n  ab-K*.wav       → önce gerçek cümle, 0,8 sn ara, sonra o düzen');
console.log('  K*__*.wav       → her düzen, üç çapraz cümlenin hepsinde');
console.log('\nDinleme sırası: ab-K1-es-yok → ab-K3-dogal-120 → ab-K4-dogal-200 → ab-K5-dogal-ad-soyad\n');

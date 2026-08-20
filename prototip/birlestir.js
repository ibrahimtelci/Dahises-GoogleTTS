// Mini bankadan cümle kurar ve dinlenecek varyantları yazar.
//
//   node birlestir.js
//
// Üretilen her dosya bir soruyu cevaplar. Sıralama önemli: önce 01 ve 02'yi
// arka arkaya dinle — asıl karar orada verilir.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { birlestir, wsola, wavYaz, pcmUzunlukSn, sessizlikKirp, seviyeNormalize } from './src/ses.js';
import { sayiyaMetin, sayiyiBilesenlereAyir, normalize, tokenlaraBol } from './src/sablon.js';
import { SABLON, CUMLELER, YABANCI_ISIMLER } from './src/veri.js';
import { dosyaAdi } from './src/dosya.js';

const KOK = 'cikti';
const BANKA = join(KOK, 'banka');
const BANKA_HAM = join(KOK, 'banka-ham');
const ORNEKLER = join(KOK, 'ornekler');

if (!existsSync(join(KOK, 'manifest.json'))) {
  console.error('Banka yok. Önce:  node uret.js --calistir');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(KOK, 'manifest.json'), 'utf8'));
const HIZ = manifest.ornekHizi;
mkdirSync(ORNEKLER, { recursive: true });

const onbellek = new Map();

function klip(anahtar, { ham = false } = {}) {
  const nihai = (ham ? 'ham|' : '') + anahtar;
  if (onbellek.has(nihai)) return onbellek.get(nihai);
  const yol = join(ham ? BANKA_HAM : BANKA, dosyaAdi(anahtar));
  if (!existsSync(yol)) {
    console.warn('  ! klip yok: ' + anahtar);
    return null;
  }
  const veri = readFileSync(yol);
  onbellek.set(nihai, veri);
  return veri;
}

const yazilanlar = [];

function yaz(ad, pcm, aciklama) {
  const yol = join(ORNEKLER, ad + '.wav');
  writeFileSync(yol, wavYaz(pcm, HIZ));
  yazilanlar.push({ ad, sn: pcmUzunlukSn(pcm, HIZ), aciklama });
}

/** Bir cümlenin klip anahtarlarını sırayla verir. */
function cumleAnahtarlari(cumle, { sayiBilesenli = false, virgullu = false } = {}) {
  const sayiParcalari = sayiBilesenli
    ? sayiyiBilesenlereAyir(cumle.banko).map((k) => 'sayi:' + k)
    : ['sayi:' + sayiyaMetin(cumle.banko)];

  const adAnahtari = (alan, deger) => tokenlaraBol(deger)
    .map((t) => alan + ':' + normalize(t).sonuc.toLocaleLowerCase('tr-TR'));

  return [
    (virgullu ? 'kalipv:' : 'kalip:') + 'sayın',
    ...adAnahtari('ad', cumle.ad),
    ...adAnahtari('soyad', cumle.soyad),
    (virgullu ? 'kalipv:' : 'kalip:') + 'lütfen',
    ...sayiParcalari,
    'kalip:nolu bankoya geçiniz',
  ];
}

function kur(cumle, secenekler = {}) {
  const { ham = false, sayiBilesenli = false, virgullu = false, ...birlestirmeSecenekleri } = secenekler;
  const klipler = cumleAnahtarlari(cumle, { sayiBilesenli, virgullu }).map((a) => klip(a, { ham }));
  return birlestir(klipler.filter(Boolean), { hiz: HIZ, ...birlestirmeSecenekleri });
}

const etiket = (c) => c.ad.toLocaleLowerCase('tr-TR') + '-' + c.soyad.toLocaleLowerCase('tr-TR');

console.log('\nÖrnekler üretiliyor...\n');

// ── 01 / 02: asıl karşılaştırma ──────────────────────────────────────────
// Tek seferde sentezlenmiş tam cümle vs bankadan birleştirilmiş.
// Bu ikisi arasındaki fark, projenin gidip gitmeyeceğini söyleyen tek ölçüdür.

const sessizlik = (sn) => Buffer.alloc(Math.round(HIZ * sn) * 2);

for (const [i, cumle] of CUMLELER.entries()) {
  const referans = klip('referans:' + (i + 1));
  const birlesik = kur(cumle);

  if (referans) yaz('01-referans-' + etiket(cumle), referans, 'Google tam cümle (altın standart)');
  yaz('02-birlesik-' + etiket(cumle), birlesik, 'bankadan birleştirildi (40 ms boşluk, 8 ms crossfade)');

  // A/B: ikisi tek dosyada arka arkaya — kulak, dosya değiştirirken referansı unutur.
  if (referans) {
    yaz('00-ab-' + etiket(cumle),
        Buffer.concat([referans, sessizlik(0.8), birlesik]),
        'ÖNCE referans, 0,8 sn ara, SONRA birleştirilmiş — asıl karar dosyası');
  }
}

// ── 03: sessizlik kırpma ve seviye normalizasyonu neden gerekli ─────────

const ornek = CUMLELER[0];
yaz('03a-islenmis', kur(ornek), 'kırpılmış + normalize edilmiş klipler');
yaz('03b-islenmemis', kur(ornek, { ham: true }),
    'Google çıktısı ham — sessizlikler birikir, cümle robotik akar');

// ── 04: crossfade süresi ────────────────────────────────────────────────

for (const cf of [0, 5, 10, 20, 40]) {
  yaz('04-crossfade-' + String(cf).padStart(2, '0') + 'ms', kur(ornek, { crossfadeMs: cf }),
      cf === 0 ? 'crossfade yok — dikişte tıklama duyuluyor mu?' : cf + ' ms crossfade');
}

// ── 05: kelimeler arası boşluk ──────────────────────────────────────────

for (const bosluk of [0, 20, 40, 60, 100]) {
  yaz('05-bosluk-' + String(bosluk).padStart(3, '0') + 'ms', kur(ornek, { boslukMs: bosluk }),
      bosluk + ' ms sessizlik');
}

// ── 06: WSOLA time-stretch (§5.1) ───────────────────────────────────────

const temel = kur(ornek);
const wsolaSureleri = [];

for (const oran of [0.8, 0.9, 1.1, 1.2, 1.5]) {
  const basla = performance.now();
  const gerilmis = wsola(temel, HIZ, oran);
  const gecen = performance.now() - basla;
  wsolaSureleri.push({ oran, ms: gecen, sn: pcmUzunlukSn(gerilmis, HIZ) });
  yaz('06-hiz-' + oran.toFixed(1) + 'x', gerilmis, oran + 'x hız — perde korunuyor mu, artefakt var mı?');
}

// ── 07: sayı — bütün klip mi, bileşen birleştirme mi (§6.3) ─────────────

const sayiCumlesi = CUMLELER.at(-1);   // banko 145
yaz('07a-sayi-butun', kur(sayiCumlesi, { sayiBilesenli: false }),
    '"yüz kırk beş" tek klip olarak');
yaz('07b-sayi-bilesen', kur(sayiCumlesi, { sayiBilesenli: true }),
    '"yüz" + "kırk" + "beş" birleştirilerek');

// ── 08: cümle ortası öbeğe virgül (§7.5 kural 2) ────────────────────────

yaz('08a-noktalamasiz', kur(ornek, { virgullu: false }), 'sabit öbekler noktalamasız üretildi');
yaz('08b-virgullu', kur(ornek, { virgullu: true }), 'sabit öbekler virgülle üretildi');

// ── 09: yabancı isimler ─────────────────────────────────────────────────

const yabanciKlipler = [];
for (const isim of YABANCI_ISIMLER) {
  const { sonuc } = normalize(isim.ham);
  const parca = klip('soyad:' + sonuc.toLocaleLowerCase('tr-TR'));
  if (parca) yabanciKlipler.push(parca);
}
if (yabanciKlipler.length > 0) {
  yaz('09-yabanci-isimler', birlestir(yabanciKlipler, { hiz: HIZ, boslukMs: 350, crossfadeMs: 0 }),
      YABANCI_ISIMLER.length + ' yabancı isim arka arkaya (normalize edilmiş hâlleriyle)');
}

for (const isim of YABANCI_ISIMLER.filter((i) => i.abTesti)) {
  const { sonuc } = normalize(isim.ham);
  const hamKlip = klip('ham:' + isim.ham.toLocaleLowerCase('tr-TR'));
  const normKlip = klip('soyad:' + sonuc.toLocaleLowerCase('tr-TR'));
  if (hamKlip && normKlip) {
    yaz('09-ab-' + isim.ham.toLocaleLowerCase('tr-TR'),
        birlestir([hamKlip, normKlip], { hiz: HIZ, boslukMs: 500, crossfadeMs: 0 }),
        'önce ham "' + isim.ham + '", sonra normalize "' + sonuc + '"');
  }
}

// ── Rapor ────────────────────────────────────────────────────────────────

console.log('Yazılan dosyalar (' + ORNEKLER + '):\n');
for (const y of yazilanlar) {
  console.log('  ' + y.ad.padEnd(30) + y.sn.toFixed(2).padStart(6) + ' sn   ' + y.aciklama);
}

console.log('\n── WSOLA süre ölçümü (§7.1.1 kapısı: 30 ms) ──');
for (const o of wsolaSureleri) {
  const durum = o.ms > 30 ? 'AŞTI' : 'tamam';
  console.log('  ' + o.oran.toFixed(1) + 'x   ' + o.ms.toFixed(1).padStart(6) + ' ms   ' +
              o.sn.toFixed(2) + ' sn çıktı   ' + durum);
}
const enKotu = Math.max(...wsolaSureleri.map((o) => o.ms));
console.log('  En kötü: ' + enKotu.toFixed(1) + ' ms — ' +
            (enKotu > 30 ? 'WASM değerlendir veya bakedRate profiline yönlendir (§4.4)' : 'saf JS yeterli'));

console.log('\n── Dinleme sırası ──');
console.log('  1. 01-referans-* ve 02-birlesik-* dosyalarını ÇİFT ÇİFT dinle. Asıl karar burada.');
console.log('  2. 03b (işlenmemiş) — kırpma olmasa ne olurdu.');
console.log('  3. 04-crossfade-00ms — dikişte tıklama var mı?');
console.log('  4. 07a / 07b — sayı yaklaşımı seçimi.');
console.log('  5. 09-* — yabancı isimler kabul edilebilir mi?');
console.log('');

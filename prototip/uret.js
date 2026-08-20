// Mini banka üretici — Google TTS'e gider, klipleri diske yazar.
//
//   node uret.js              → SADECE planı gösterir, Google'a gitmez (varsayılan)
//   node uret.js --calistir   → gerçekten üretir
//   node uret.js --calistir --ses=tr-TR-Wavenet-B --hiz=24000
//
// Kasıtlı olarak kuru çalışma varsayılan: her Google çağrısı aylık kotadan yer.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { sentezle, harcanan } from './src/google.js';
import { sessizlikKirp, seviyeNormalize, pcmUzunlukSn } from './src/ses.js';
import { sablonuAyristir, normalize, sayiyaMetin, sayiyiBilesenlereAyir, tokenlaraBol } from './src/sablon.js';
import { SABLON, CUMLELER, YABANCI_ISIMLER, SES_VARSAYILAN, ORNEK_HIZI_VARSAYILAN } from './src/veri.js';
import { dosyaAdi } from './src/dosya.js';

const argumanlar = process.argv.slice(2);
const calistir = argumanlar.includes('--calistir');
const ses = (argumanlar.find((a) => a.startsWith('--ses=')) ?? '').split('=')[1] || SES_VARSAYILAN;
const ornekHizi = Number((argumanlar.find((a) => a.startsWith('--hiz=')) ?? '').split('=')[1]) || ORNEK_HIZI_VARSAYILAN;

const KOK = 'cikti';
const BANKA = join(KOK, 'banka');
const BANKA_HAM = join(KOK, 'banka-ham');

// ── Üretilecekler listesi ────────────────────────────────────────────────

const plan = [];
const gorulen = new Set();

function ekle(anahtar, metin, not) {
  if (gorulen.has(anahtar)) return;
  gorulen.add(anahtar);
  plan.push({ anahtar, metin, not });
}

// 1) Şablonun sabit öbekleri (§7.4 — öbek düzeyinde, kelime kelime değil)
const sablonParcalari = sablonuAyristir(SABLON);
for (const [i, parca] of sablonParcalari.entries()) {
  if (parca.tur !== 'kalip') continue;
  ekle('kalip:' + parca.deger, parca.deger, 'sabit öbek');
  // A/B: cümle ortasındaki öbeğe virgül koymak tonlamayı düzeltiyor mu? (§7.5 kural 2)
  const sonMu = i === sablonParcalari.length - 1;
  if (!sonMu) ekle('kalipv:' + parca.deger, parca.deger + ',', 'sabit öbek, virgüllü (A/B)');
}

// 2) Ad ve soyadlar — ayrı klipler (§7.2)
for (const cumle of CUMLELER) {
  for (const [alan, deger] of [['ad', cumle.ad], ['soyad', cumle.soyad]]) {
    for (const token of tokenlaraBol(deger)) {
      const { sonuc } = normalize(token);
      ekle(alan + ':' + sonuc.toLocaleLowerCase('tr-TR'), sonuc, alan);
    }
  }
}

// 3) Sayılar — iki yaklaşım yan yana (§6.3 dipnotu)
for (const cumle of CUMLELER) {
  const butun = sayiyaMetin(cumle.banko);
  ekle('sayi:' + butun, butun, 'sayı, bütün klip');
  for (const bilesen of sayiyiBilesenlereAyir(cumle.banko)) {
    ekle('sayi:' + bilesen, bilesen, 'sayı, bileşen');
  }
}

// 4) Yabancı isimler (§13 madde 2)
for (const isim of YABANCI_ISIMLER) {
  const { sonuc, degisti } = normalize(isim.ham);
  ekle('soyad:' + sonuc.toLocaleLowerCase('tr-TR'), sonuc,
       'yabancı isim' + (degisti ? ' (normalize: ' + isim.ham + ' → ' + sonuc + ')' : ''));
  if (isim.abTesti && degisti) {
    ekle('ham:' + isim.ham.toLocaleLowerCase('tr-TR'), isim.ham, 'yabancı isim, HAM (A/B)');
  }
}

// 5) Altın standart — tam cümlenin tek seferde sentezi.
//    Birleştirmenin ne kadar uzağa düştüğünü ancak buna karşı ölçebiliriz.
for (const [i, cumle] of CUMLELER.entries()) {
  const metin = SABLON
    .replace('{ad}', cumle.ad)
    .replace('{soyad}', cumle.soyad)
    .replace('{banko}', sayiyaMetin(cumle.banko)) + '.';
  ekle('referans:' + (i + 1), metin, 'TAM CÜMLE referansı');
}

// ── Plan raporu ──────────────────────────────────────────────────────────

const toplamKarakter = plan.reduce((t, p) => t + p.metin.length, 0);

console.log('\nSes:            ' + ses);
console.log('Örnekleme hızı: ' + ornekHizi + ' Hz');
console.log('Klip sayısı:    ' + plan.length);
console.log('Karakter:       ' + toplamKarakter +
            '  (4.000.000 aylık ücretsiz kotanın %' + (toplamKarakter / 4_000_000 * 100).toFixed(4) + ')');
console.log('');

for (const p of plan) {
  console.log('  ' + p.anahtar.padEnd(34) + JSON.stringify(p.metin).padEnd(40) + (p.not ?? ''));
}

if (!calistir) {
  console.log('\nKURU ÇALIŞMA — Google\'a hiçbir istek gitmedi.');
  console.log('Gerçekten üretmek için:  node uret.js --calistir\n');
  process.exit(0);
}

// ── Üretim ───────────────────────────────────────────────────────────────

mkdirSync(BANKA, { recursive: true });
mkdirSync(BANKA_HAM, { recursive: true });

const manifest = { ses, ornekHizi, uretildi: new Date().toISOString(), klipler: {} };
let sira = 0;

for (const p of plan) {
  sira++;
  const hedef = join(BANKA, dosyaAdi(p.anahtar));

  if (existsSync(hedef)) {
    console.log('[' + sira + '/' + plan.length + '] atlandı (var): ' + p.anahtar);
    continue;
  }

  let ham;
  try {
    ham = await sentezle(p.metin, { ses, ornekHizi });
  } catch (hata) {
    console.error('\n' + hata.message + '\n');
    console.error('Üretilen klipler korundu; sorun giderilince aynı komut kaldığı yerden devam eder.');
    process.exit(1);
  }
  const kirpilmis = sessizlikKirp(ham, ornekHizi);
  const islenmis = seviyeNormalize(kirpilmis);

  writeFileSync(join(BANKA_HAM, dosyaAdi(p.anahtar)), ham);
  writeFileSync(hedef, islenmis);

  manifest.klipler[p.anahtar] = {
    metin: p.metin,
    not: p.not,
    hamMs: Math.round(pcmUzunlukSn(ham, ornekHizi) * 1000),
    islenmisMs: Math.round(pcmUzunlukSn(islenmis, ornekHizi) * 1000),
  };

  const kirpilanMs = Math.round((pcmUzunlukSn(ham, ornekHizi) - pcmUzunlukSn(islenmis, ornekHizi)) * 1000);
  console.log('[' + sira + '/' + plan.length + '] ' + p.anahtar.padEnd(30) +
              String(manifest.klipler[p.anahtar].islenmisMs).padStart(5) + ' ms' +
              '  (sessizlik kırpıldı: ' + kirpilanMs + ' ms)');
}

writeFileSync(join(KOK, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log('\nBitti. Harcanan karakter: ' + harcanan());
console.log('Klipler: ' + BANKA + '  (işlenmemiş kopyalar: ' + BANKA_HAM + ')');
console.log('\nSıradaki:  node birlestir.js\n');

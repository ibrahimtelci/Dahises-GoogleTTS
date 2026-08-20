// Ayar turu — birleştirmenin "tane tane" durmasını kapatmayı dener.
//
//   node ayar.js
//
// Google'a gitmez, mevcut bankayı kullanır. Her çıktı referansla aynı dosyada
// arka arkaya: önce Google'ın tam cümlesi, 0,8 sn ara, sonra denenen ayar.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { birlestir, wsola, wavYaz, pcmUzunlukSn } from './src/ses.js';
import { sayiyaMetin, normalize, tokenlaraBol } from './src/sablon.js';
import { CUMLELER } from './src/veri.js';
import { dosyaAdi } from './src/dosya.js';

const KOK = 'cikti';
const BANKA = join(KOK, 'banka');
const AYAR = join(KOK, 'ayar');

if (!existsSync(join(KOK, 'manifest.json'))) {
  console.error('Banka yok. Önce:  node uret.js --calistir --ses=tr-TR-Standard-A');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(KOK, 'manifest.json'), 'utf8'));
const HIZ = manifest.ornekHizi;
mkdirSync(AYAR, { recursive: true });

const onbellek = new Map();
function klip(anahtar) {
  if (!onbellek.has(anahtar)) {
    const yol = join(BANKA, dosyaAdi(anahtar));
    onbellek.set(anahtar, existsSync(yol) ? readFileSync(yol) : null);
  }
  return onbellek.get(anahtar);
}

const sessizlik = (sn) => Buffer.alloc(Math.round(HIZ * sn) * 2);
const etiket = (c) => c.ad.toLocaleLowerCase('tr-TR') + '-' + c.soyad.toLocaleLowerCase('tr-TR');
const adAnahtari = (alan, deger) => tokenlaraBol(deger)
  .map((t) => alan + ':' + normalize(t).sonuc.toLocaleLowerCase('tr-TR'));

/** Cümlenin klip anahtarları. `kisa` → "sayın" ve "lütfen" atılır (6 parça yerine 4). */
function anahtarlar(cumle, { virgullu = false, kisa = false } = {}) {
  const on = virgullu ? 'kalipv:' : 'kalip:';
  return [
    ...(kisa ? [] : [on + 'sayın']),
    ...adAnahtari('ad', cumle.ad),
    ...adAnahtari('soyad', cumle.soyad),
    ...(kisa ? [] : [on + 'lütfen']),
    'sayi:' + sayiyaMetin(cumle.banko),
    'kalip:nolu bankoya geçiniz',
  ];
}

function kur(cumle, { virgullu, kisa, boslukMs, crossfadeMs, oran }) {
  const parcalar = anahtarlar(cumle, { virgullu, kisa }).map(klip).filter(Boolean);
  const birlesik = birlestir(parcalar, { hiz: HIZ, boslukMs, crossfadeMs, sifirGecis: true });
  return oran && oran !== 1 ? wsola(birlesik, HIZ, oran) : birlesik;
}

// ── Denenecek ayarlar ────────────────────────────────────────────────────

const AYARLAR = [
  { ad: 'A-temel', boslukMs: 40, crossfadeMs: 8, oran: 1.0,
    aciklama: 'mevcut varsayılan — karşılaştırma tabanı' },
  { ad: 'B-bosluksuz', boslukMs: 0, crossfadeMs: 15, oran: 1.0,
    aciklama: 'kelime arası boşluk yok, crossfade 15 ms' },
  { ad: 'C-bosluksuz-hizli', boslukMs: 0, crossfadeMs: 15, oran: 1.15,
    aciklama: 'boşluksuz + %15 hızlandırılmış' },
  { ad: 'D-bosluksuz-daha-hizli', boslukMs: 0, crossfadeMs: 20, oran: 1.25,
    aciklama: 'boşluksuz + %25 hızlandırılmış' },
  { ad: 'E-virgullu-hizli', boslukMs: 0, crossfadeMs: 15, oran: 1.15, virgullu: true,
    aciklama: 'sabit öbekler virgülle üretilmiş + boşluksuz + %15 hızlı' },
  { ad: 'F-uzun-crossfade', boslukMs: 0, crossfadeMs: 45, oran: 1.15,
    aciklama: 'uzun crossfade (45 ms) — kelimeler birbirine karışıyor mu?' },
  { ad: 'G-kisa-sablon', boslukMs: 0, crossfadeMs: 15, oran: 1.15, kisa: true,
    aciklama: '"sayın" ve "lütfen" atıldı — 6 parça yerine 4 dikiş' },
];

// ── Üret ─────────────────────────────────────────────────────────────────

const ornek = CUMLELER[0];
const referans = klip('referans:1');
const referansSn = referans ? pcmUzunlukSn(referans, HIZ) : 0;

console.log('\nReferans (Google tam cümle): ' + referansSn.toFixed(2) + ' sn\n');
console.log('  Ayar'.padEnd(28) + 'Süre'.padStart(7) + '  Referansa göre');
console.log('  ' + '─'.repeat(60));

for (const ayar of AYARLAR) {
  const { ad, aciklama, ...secenekler } = ayar;
  const birlesik = kur(ornek, secenekler);
  const sn = pcmUzunlukSn(birlesik, HIZ);
  const fark = ((sn / referansSn - 1) * 100);

  writeFileSync(join(AYAR, ad + '.wav'), wavYaz(birlesik, HIZ));
  if (referans) {
    writeFileSync(join(AYAR, 'ab-' + ad + '.wav'),
      wavYaz(Buffer.concat([referans, sessizlik(0.8), birlesik]), HIZ));
  }

  console.log('  ' + ad.padEnd(26) + sn.toFixed(2).padStart(6) + ' sn' +
              ('  ' + (fark >= 0 ? '+' : '') + fark.toFixed(0) + '%').padStart(9) +
              '   ' + aciklama);
}

// En umut verici ayarı beş cümlenin hepsinde üret.
const enIyiTahmin = AYARLAR.find((a) => a.ad === 'C-bosluksuz-hizli');
for (const [i, cumle] of CUMLELER.entries()) {
  const { ad, aciklama, ...secenekler } = enIyiTahmin;
  const ref = klip('referans:' + (i + 1));
  const birlesik = kur(cumle, secenekler);
  if (ref) {
    writeFileSync(join(AYAR, 'tum-ab-' + etiket(cumle) + '.wav'),
      wavYaz(Buffer.concat([ref, sessizlik(0.8), birlesik]), HIZ));
  }
}

console.log('\nDosyalar: ' + AYAR);
console.log('\n  ab-*.wav        → önce referans, 0,8 sn ara, sonra o ayar (tek cümle)');
console.log('  tum-ab-*.wav    → C ayarı beş cümlenin hepsinde');
console.log('  (ayarın kendisi tek başına dinlenmek istenirse ab- önekisiz dosyalar)\n');
console.log('Dinleme sırası: ab-A-temel → ab-B-bosluksuz → ab-C-bosluksuz-hizli → ab-G-kisa-sablon\n');

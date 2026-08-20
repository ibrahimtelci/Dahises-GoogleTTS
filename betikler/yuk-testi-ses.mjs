// Yük testi — ses zinciri. Hastane servisine (`ses-bankasi`) taşınacak kod bu;
// istek yolunda çalışacak olan da bu. Ölçülen tepe salvo 9 istek/sn (§3).
//
//   node betikler/yuk-testi-ses.mjs
//
// Google'a hiç gitmez, veritabanına dokunmaz. Saf CPU ölçümü.

import { performance } from 'node:perf_hooks';

// Windows'ta mutlak yol ESM'de gecersiz; file:// URL ile yukle.
const SES = new URL('../paketler/tts-merkez/src/ses/', import.meta.url);
const { birlestir, wavYaz, floatToPcm, pcmUzunlukSn } = await import(new URL('pcm.ts', SES).href);
const { normalize, sayiyaMetin, parcalaraAyir } = await import(new URL('metin.ts', SES).href);
const { tasiyiciKur, parcalariKes, xmlKacir } = await import(new URL('kesme.ts', SES).href);

const HIZ = 24000;
const ms = (n) => n.toFixed(3).padStart(9) + ' ms';

/** Gerçekçi klip: konuşma benzeri zarflı iki harmonik. */
function klip(sn, temel = 200) {
  const n = Math.round(HIZ * sn);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const zarf = Math.min(1, i / (HIZ * 0.02), (n - i) / (HIZ * 0.02));
    f[i] = 0.4 * zarf * Math.sin(2 * Math.PI * temel * i / HIZ)
         + 0.15 * zarf * Math.sin(2 * Math.PI * temel * 2 * i / HIZ);
  }
  return floatToPcm(f);
}

function olc(ad, fn, tur = 200) {
  for (let i = 0; i < 20; i++) fn();          // ısınma (JIT)
  const s = [];
  for (let i = 0; i < tur; i++) {
    const t = performance.now();
    fn();
    s.push(performance.now() - t);
  }
  s.sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  console.log('  ' + ad.padEnd(44) + 'ortanca ' + ms(p(0.5)) +
              '   p99 ' + ms(p(0.99)) + '   en kötü ' + ms(s.at(-1)));
  return { ortanca: p(0.5), p99: p(0.99), enKotu: s.at(-1) };
}

// Tipik anons: 5 parça — "sayın" + ad + soyad + "lütfen" + "hedefe geçiniz"
const parcalar = [klip(0.45, 190), klip(0.55, 210), klip(0.75, 200), klip(0.50, 195), klip(1.60, 205)];
const AYAR = { hiz: HIZ, boslukMs: 0, crossfadeMs: 45, sifirGecis: true };

console.log('\n══ SES ZİNCİRİ — istek yolundaki işlemler ══');
console.log('  anons: 5 parça, ' + parcalar.reduce((t, p) => t + pcmUzunlukSn(p, HIZ), 0).toFixed(2) + ' sn ham\n');

const r = {};
r.birlestir = olc('birleştirme (5 parça, 45 ms crossfade)', () => birlestir(parcalar, AYAR));
const birlesik = birlestir(parcalar, AYAR);
r.wav = olc('WAV başlığı ekleme', () => wavYaz(birlesik, HIZ));
r.tam = olc('TAM İSTEK: birleştir + WAV', () => wavYaz(birlestir(parcalar, AYAR), HIZ));

console.log('\n══ METİN İŞLEME ══');
r.normalize = olc('normalize (tek token)', () => normalize('Karabuluttoğlu'), 2000);
r.sayi = olc('sayı → metin (1214)', () => sayiyaMetin(1214), 2000);
r.parcala = olc('şablon parçalama', () =>
  parcalaraAyir('sayın {adSoyad} lütfen {hedef}', { adSoyad: 'Mehmet Ali Karabulut', hedef: 'Yeşil Alan 4' }), 2000);
r.kacir = olc('XML kaçışı', () => xmlKacir("O'Brien & <Sons>"), 5000);

console.log('\n══ TAŞIYICI KURMA / KESME (üretim yolu, istek yolu değil) ══');
const yuvalar = [
  { tip: 'kalip', metin: 'sayın' }, { tip: 'ad', metin: 'Mehmet' },
  { tip: 'soyad', metin: 'Karabulut' }, { tip: 'kalip', metin: 'lütfen' },
  { tip: 'sayi', metin: 'üç' }, { tip: 'kalip', metin: 'nolu bankoya geçiniz' },
];
r.tasiyici = olc('taşıyıcı SSML kurma', () => tasiyiciKur(yuvalar), 2000);
const tamPcm = Buffer.concat(parcalar);
const damgalar = [0, 0.45, 1.0, 1.75, 2.25, 3.85].map((sn, i) => ({ markName: 'm' + i, timeSeconds: sn }));
r.kesme = olc("damgalardan dilimleme", () => parcalariKes(tamPcm, damgalar, yuvalar, { hiz: HIZ, kuyrukMs: 50 }), 2000);

// ── Salvo simülasyonu ────────────────────────────────────────────────────

console.log('\n══ SALVO — ölçülen tepe: 1 saniyede 9 istek (§3) ══');
for (const n of [9, 20, 50, 100]) {
  const t = performance.now();
  for (let i = 0; i < n; i++) wavYaz(birlestir(parcalar, AYAR), HIZ);
  const gecen = performance.now() - t;
  const cekirdek = (gecen / 1000 * 100).toFixed(2);
  console.log('  ' + String(n).padStart(3) + ' istek/sn  →  ' + gecen.toFixed(1).padStart(7) +
              ' ms işlem   =  tek çekirdeğin %' + cekirdek.padStart(6) + "'i");
}

// ── Teorik tavan ─────────────────────────────────────────────────────────

const t0 = performance.now();
let sayac = 0;
while (performance.now() - t0 < 2000) { wavYaz(birlestir(parcalar, AYAR), HIZ); sayac++; }
const tavan = sayac / 2;

console.log('\n══ ÖZET ══\n');
console.log('  İstek başına (ortanca)      ' + ms(r.tam.ortanca));
console.log('  İstek başına (p99)          ' + ms(r.tam.p99));
console.log('  Teorik tavan                ' + Math.round(tavan).toLocaleString('tr-TR') + ' istek/sn (tek çekirdek)');
console.log('  Ölçülen tepe salvo          9 istek/sn');
console.log('  Güvenlik payı               ' + Math.round(tavan / 9).toLocaleString('tr-TR') + ' kat');
console.log('');
console.log('  Doküman §10 iddiası: istek başına ~2 ms, tavan 500–1.000 istek/sn');
console.log('  Ölçülen:             istek başına ' + r.tam.ortanca.toFixed(2) + ' ms, tavan ' + Math.round(tavan) + ' istek/sn');
console.log('');

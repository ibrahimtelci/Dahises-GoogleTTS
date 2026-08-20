// Google'a gitmeden DSP zincirini doğrular. Sentetik sinüs kullanır.
//
//   node kendini-test.js

import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';

import {
  wavYaz, birlestir, wsola, perdeKaydir, sessizlikKirp, seviyeNormalize,
  pcmToFloat, floatToPcm, pcmUzunlukSn,
} from './src/ses.js';
import { normalize, sayiyaMetin, sayiyiBilesenlereAyir, sablonuAyristir, parcalaraAyir } from './src/sablon.js';
import { SABLON } from './src/veri.js';

const HIZ = 24000;
let gecen = 0;
let kalan = 0;

function test(ad, fn) {
  try {
    fn();
    console.log('  ok   ' + ad);
    gecen++;
  } catch (hata) {
    console.log('  HATA ' + ad + '\n       ' + hata.message);
    kalan++;
  }
}

/** Belirli süre ve frekansta sinüs üretir; başına/sonuna sessizlik ekleyebilir. */
function sinus(sn, frekans = 220, sessizlikSn = 0) {
  const sessiz = Math.round(HIZ * sessizlikSn);
  const n = Math.round(HIZ * sn);
  const f = new Float32Array(sessiz + n + sessiz);
  for (let i = 0; i < n; i++) f[sessiz + i] = 0.5 * Math.sin(2 * Math.PI * frekans * i / HIZ);
  return floatToPcm(f);
}

console.log('\n── Sayı → metin ──');
test('145 → yüz kırk beş', () => assert.equal(sayiyaMetin(145), 'yüz kırk beş'));
test('1 → bir', () => assert.equal(sayiyaMetin(1), 'bir'));
test('12 → on iki', () => assert.equal(sayiyaMetin(12), 'on iki'));
test('100 → yüz', () => assert.equal(sayiyaMetin(100), 'yüz'));
test('200 → iki yüz', () => assert.equal(sayiyaMetin(200), 'iki yüz'));
test('1000 → bin', () => assert.equal(sayiyaMetin(1000), 'bin'));
test('2025 → iki bin yirmi beş', () => assert.equal(sayiyaMetin(2025), 'iki bin yirmi beş'));
test('9999 → dokuz bin dokuz yüz doksan dokuz',
     () => assert.equal(sayiyaMetin(9999), 'dokuz bin dokuz yüz doksan dokuz'));
test('aralık dışı hata verir', () => assert.throws(() => sayiyaMetin(10000)));

console.log('\n── Sayı bileşenleri ──');
test('145 → [yüz, kırk, beş]',
     () => assert.deepEqual(sayiyiBilesenlereAyir(145), ['yüz', 'kırk', 'beş']));
test('245 → [iki yüz, kırk, beş] (iki yüz tek bileşen)',
     () => assert.deepEqual(sayiyiBilesenlereAyir(245), ['iki yüz', 'kırk', 'beş']));
test('3000 → [üç bin]',
     () => assert.deepEqual(sayiyiBilesenlereAyir(3000), ['üç bin']));

console.log('\n── Normalizasyon (§7.5 kural 6) ──');
test('Wagner → Vagner', () => assert.equal(normalize('Wagner').sonuc, 'Vagner'));
test('Quentin → Kuentin', () => assert.equal(normalize('Quentin').sonuc, 'Kuentin'));
test('Xavier → Ksavier', () => assert.equal(normalize('Xavier').sonuc, 'Ksavier'));
test('Türkçe isim değişmez', () => {
  const r = normalize('Öztürk');
  assert.equal(r.sonuc, 'Öztürk');
  assert.equal(r.degisti, false);
});
test('tire boşluğa döner', () => assert.equal(normalize('Ali-Rıza').sonuc, 'Ali Rıza'));
test('Kiril seslendirilemez', () => assert.equal(normalize('Владимир').seslendirilemez, true));
test('Arap harfleri seslendirilemez', () => assert.equal(normalize('محمود').seslendirilemez, true));
test('Çince seslendirilemez', () => assert.equal(normalize('李明').seslendirilemez, true));

console.log('\n── Şablon ──');
test('şablon 6 parçaya ayrılır', () => {
  const p = sablonuAyristir(SABLON);
  assert.equal(p.length, 6);
  assert.equal(p[0].deger, 'sayın');
  assert.equal(p[1].deger, 'ad');
  assert.equal(p[5].deger, 'nolu bankoya geçiniz');
});
test('parçalama doğru anahtarları verir', () => {
  const p = parcalaraAyir(SABLON, { ad: 'Mehmet', soyad: 'Karabulut', banko: 3 });
  assert.deepEqual(p.map((x) => x.anahtar), [
    'kalip:sayın', 'ad:mehmet', 'soyad:karabulut', 'kalip:lütfen',
    'sayi:üç', 'kalip:nolu bankoya geçiniz',
  ]);
});
test('birleşik ad iki tokena bölünür (§7.5 kural 8)', () => {
  const p = parcalaraAyir(SABLON, { ad: 'Ayşe Nur', soyad: 'Kaya', banko: 1 });
  assert.ok(p.some((x) => x.anahtar === 'ad:ayşe'));
  assert.ok(p.some((x) => x.anahtar === 'ad:nur'));
});
test('Latin dışı token atlanır (degrade)', () => {
  const p = parcalaraAyir(SABLON, { ad: 'Владимир', soyad: 'Kaya', banko: 1 });
  assert.ok(p.some((x) => x.atlandi === true));
});

console.log('\n── WAV ──');
test('başlık 44 bayt ve RIFF/WAVE', () => {
  const w = wavYaz(sinus(0.1), HIZ);
  assert.equal(w.toString('ascii', 0, 4), 'RIFF');
  assert.equal(w.toString('ascii', 8, 12), 'WAVE');
  assert.equal(w.readUInt32LE(24), HIZ);
  assert.equal(w.readUInt16LE(22), 1);              // mono
  assert.equal(w.length, 44 + 0.1 * HIZ * 2);
});

console.log('\n── Sessizlik kırpma ──');
test('baştaki ve sondaki sessizlik gider', () => {
  const ham = sinus(0.30, 220, 0.25);              // 0.25 + 0.30 + 0.25 = 0.80 sn
  const kirpik = sessizlikKirp(ham, HIZ);
  const sure = pcmUzunlukSn(kirpik, HIZ);
  assert.ok(sure > 0.28 && sure < 0.40, 'beklenen ~0.33 sn, gelen ' + sure.toFixed(3));
});
test('tamamen sessiz klip bozulmaz', () => {
  const sessiz = floatToPcm(new Float32Array(HIZ));
  assert.equal(sessizlikKirp(sessiz, HIZ).length, sessiz.length);
});

console.log('\n── Seviye normalizasyonu ──');
test('farklı seviyeler aynı RMS\'e gelir', () => {
  const rms = (pcm) => {
    const f = pcmToFloat(pcm);
    let t = 0;
    for (let i = 0; i < f.length; i++) t += f[i] * f[i];
    return Math.sqrt(t / f.length);
  };
  const sessizce = floatToPcm(pcmToFloat(sinus(0.2)).map((v) => v * 0.05));
  const gurultulu = sinus(0.2);
  const a = rms(seviyeNormalize(sessizce));
  const b = rms(seviyeNormalize(gurultulu));
  assert.ok(Math.abs(a - b) < 0.01, 'RMS farkı ' + Math.abs(a - b).toFixed(4));
});

console.log('\n── Birleştirme (§7.6) ──');
test('süre = parçalar + boşluklar - crossfade', () => {
  const klipler = [sinus(0.20), sinus(0.20), sinus(0.20)];
  const sonuc = birlestir(klipler, { hiz: HIZ, boslukMs: 40, crossfadeMs: 0, sifirGecis: false });
  const beklenen = 0.60 + 2 * 0.040;
  const gercek = pcmUzunlukSn(sonuc, HIZ);
  assert.ok(Math.abs(gercek - beklenen) < 0.005, 'beklenen ' + beklenen + ', gelen ' + gercek.toFixed(3));
});
test('crossfade süreyi kısaltır', () => {
  const klipler = [sinus(0.20), sinus(0.20)];
  const cfsiz = pcmUzunlukSn(birlestir(klipler, { hiz: HIZ, boslukMs: 0, crossfadeMs: 0, sifirGecis: false }), HIZ);
  const cfli = pcmUzunlukSn(birlestir(klipler, { hiz: HIZ, boslukMs: 0, crossfadeMs: 20, sifirGecis: false }), HIZ);
  assert.ok(Math.abs((cfsiz - cfli) - 0.020) < 0.003, 'fark ' + (cfsiz - cfli).toFixed(4));
});
test('boş liste boş sonuç verir', () => assert.equal(birlestir([], { hiz: HIZ }).length, 0));
test('dikişte süreksizlik sıçraması yok', () => {
  // Crossfade'siz, farklı fazlarda iki sinüs: en büyük örnekten-örneğe sıçramayı ölç.
  const birlesik = pcmToFloat(birlestir([sinus(0.2, 220), sinus(0.2, 330)],
    { hiz: HIZ, boslukMs: 0, crossfadeMs: 10, sifirGecis: true }));
  let enBuyukSicrama = 0;
  for (let i = 1; i < birlesik.length; i++) {
    enBuyukSicrama = Math.max(enBuyukSicrama, Math.abs(birlesik[i] - birlesik[i - 1]));
  }
  // 330 Hz sinüsün doğal örnek farkı ~0.09; sıçrama bunun çok üstündeyse dikiş kötü.
  assert.ok(enBuyukSicrama < 0.25, 'en büyük sıçrama ' + enBuyukSicrama.toFixed(3));
});

console.log('\n── WSOLA (§5.1) ──');
for (const oran of [0.8, 1.2, 1.5]) {
  test(oran + 'x → süre 1/' + oran + ' oranında değişir', () => {
    const giris = sinus(4.0, 220);
    const cikis = wsola(giris, HIZ, oran);
    const beklenen = 4.0 / oran;
    const gercek = pcmUzunlukSn(cikis, HIZ);
    assert.ok(Math.abs(gercek - beklenen) / beklenen < 0.10,
              'beklenen ~' + beklenen.toFixed(2) + ' sn, gelen ' + gercek.toFixed(2) + ' sn');
  });
}
test('1.0x kopya döner (işlem yok)', () => {
  const giris = sinus(1.0);
  assert.equal(wsola(giris, HIZ, 1.0).length, giris.length);
});
test('perde korunur (chipmunk yok)', () => {
  // Sıfır geçiş sayarak temel frekansı tahmin et.
  const frekansTahmin = (pcm) => {
    const f = pcmToFloat(pcm);
    let gecis = 0;
    for (let i = 1; i < f.length; i++) if (f[i - 1] < 0 && f[i] >= 0) gecis++;
    return gecis / (f.length / HIZ);
  };
  const giris = sinus(3.0, 220);
  const hizli = wsola(giris, HIZ, 1.5);
  const fark = Math.abs(frekansTahmin(hizli) - 220) / 220;
  assert.ok(fark < 0.10, 'perde %' + (fark * 100).toFixed(1) + ' kaydı — chipmunk etkisi');
});

console.log('\n── Perde kaydırma ──');
test('+2 yarım ton süreyi korur', () => {
  const giris = sinus(2.0, 220);
  const cikis = perdeKaydir(giris, HIZ, 2);
  const fark = Math.abs(pcmUzunlukSn(cikis, HIZ) - 2.0) / 2.0;
  assert.ok(fark < 0.12, 'süre %' + (fark * 100).toFixed(1) + ' kaydı');
});

console.log('\n── Başarım (§7.1.1 kapısı: 30 ms) ──');
{
  const dortSaniye = sinus(4.0, 220);
  const olcumler = [];
  for (const oran of [0.8, 1.2]) {
    wsola(dortSaniye, HIZ, oran);                                  // ısınma
    const basla = performance.now();
    for (let i = 0; i < 5; i++) wsola(dortSaniye, HIZ, oran);
    olcumler.push({ oran, ms: (performance.now() - basla) / 5 });
  }
  for (const o of olcumler) {
    console.log('  WSOLA ' + o.oran + 'x  →  ' + o.ms.toFixed(1) + ' ms' +
                (o.ms > 30 ? '   AŞTI' : '   tamam'));
  }

  const klipler = Array.from({ length: 6 }, () => sinus(0.7, 220));
  const basla = performance.now();
  for (let i = 0; i < 100; i++) birlestir(klipler, { hiz: HIZ, boslukMs: 40, crossfadeMs: 8 });
  const ms = (performance.now() - basla) / 100;
  console.log('  6 klip birleştirme  →  ' + ms.toFixed(2) + ' ms' + (ms > 1 ? '   (§10: ~1 ms bekleniyordu)' : ''));
}

console.log('\n' + gecen + ' geçti, ' + kalan + ' kaldı\n');
process.exit(kalan > 0 ? 1 : 0);

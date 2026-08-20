// prototip/kendini-test.js'deki DSP testleri (14 adet) + basarim olcumu.
// Google'a gitmez; sentetik sinus kullanir.

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'node:test';

import {
  birlestir,
  floatToPcm,
  pcmToFloat,
  pcmUzunlukSn,
  perdeKaydir,
  seviyeNormalize,
  sessizlikKirp,
  sondanKirp,
  wavYaz,
  wsola,
} from '../src/ses/pcm.ts';

const HIZ = 24000;

/** Belirli sure ve frekansta sinus; basina/sonuna sessizlik eklenebilir. */
function sinus(sn: number, frekans = 220, sessizlikSn = 0): Buffer {
  const sessiz = Math.round(HIZ * sessizlikSn);
  const n = Math.round(HIZ * sn);
  const f = new Float32Array(sessiz + n + sessiz);
  for (let i = 0; i < n; i++) f[sessiz + i] = 0.5 * Math.sin((2 * Math.PI * frekans * i) / HIZ);
  return floatToPcm(f);
}

describe('WAV', () => {
  it('başlık 44 bayt ve RIFF/WAVE', () => {
    const w = wavYaz(sinus(0.1), HIZ);
    assert.equal(w.toString('ascii', 0, 4), 'RIFF');
    assert.equal(w.toString('ascii', 8, 12), 'WAVE');
    assert.equal(w.readUInt32LE(24), HIZ);
    assert.equal(w.readUInt16LE(22), 1); // mono
    assert.equal(w.length, 44 + 0.1 * HIZ * 2);
  });
});

describe('Sessizlik kırpma', () => {
  it('baştaki ve sondaki sessizlik gider', () => {
    const ham = sinus(0.3, 220, 0.25); // 0.25 + 0.30 + 0.25 = 0.80 sn
    const kirpik = sessizlikKirp(ham, HIZ);
    const sure = pcmUzunlukSn(kirpik, HIZ);
    assert.ok(sure > 0.28 && sure < 0.4, 'beklenen ~0.33 sn, gelen ' + sure.toFixed(3));
  });

  it('tamamen sessiz klip bozulmaz', () => {
    const sessiz = floatToPcm(new Float32Array(HIZ));
    assert.equal(sessizlikKirp(sessiz, HIZ).length, sessiz.length);
  });
});

describe('Seviye normalizasyonu', () => {
  it('farklı seviyeler aynı RMS\'e gelir', () => {
    const rms = (pcm: Buffer): number => {
      const f = pcmToFloat(pcm);
      let t = 0;
      for (let i = 0; i < f.length; i++) t += (f[i] as number) * (f[i] as number);
      return Math.sqrt(t / f.length);
    };
    const sessizce = floatToPcm(pcmToFloat(sinus(0.2)).map((v) => v * 0.05));
    const gurultulu = sinus(0.2);
    const a = rms(seviyeNormalize(sessizce));
    const b = rms(seviyeNormalize(gurultulu));
    assert.ok(Math.abs(a - b) < 0.01, 'RMS farkı ' + Math.abs(a - b).toFixed(4));
  });
});

describe('Birleştirme (§7.6)', () => {
  it('süre = parçalar + boşluklar - crossfade', () => {
    const klipler = [sinus(0.2), sinus(0.2), sinus(0.2)];
    const sonuc = birlestir(klipler, { hiz: HIZ, boslukMs: 40, crossfadeMs: 0, sifirGecis: false });
    const beklenen = 0.6 + 2 * 0.04;
    const gercek = pcmUzunlukSn(sonuc, HIZ);
    assert.ok(Math.abs(gercek - beklenen) < 0.005, `beklenen ${beklenen}, gelen ${gercek.toFixed(3)}`);
  });

  it('crossfade süreyi kısaltır', () => {
    const klipler = [sinus(0.2), sinus(0.2)];
    const cfsiz = pcmUzunlukSn(
      birlestir(klipler, { hiz: HIZ, boslukMs: 0, crossfadeMs: 0, sifirGecis: false }),
      HIZ,
    );
    const cfli = pcmUzunlukSn(
      birlestir(klipler, { hiz: HIZ, boslukMs: 0, crossfadeMs: 20, sifirGecis: false }),
      HIZ,
    );
    assert.ok(Math.abs(cfsiz - cfli - 0.02) < 0.003, 'fark ' + (cfsiz - cfli).toFixed(4));
  });

  it('boş liste boş sonuç verir', () =>
    assert.equal(birlestir([], { hiz: HIZ }).length, 0));

  it('dikişte süreksizlik sıçraması yok', () => {
    const birlesik = pcmToFloat(
      birlestir([sinus(0.2, 220), sinus(0.2, 330)], {
        hiz: HIZ,
        boslukMs: 0,
        crossfadeMs: 10,
        sifirGecis: true,
      }),
    );
    let enBuyukSicrama = 0;
    for (let i = 1; i < birlesik.length; i++) {
      enBuyukSicrama = Math.max(enBuyukSicrama, Math.abs((birlesik[i] as number) - (birlesik[i - 1] as number)));
    }
    assert.ok(enBuyukSicrama < 0.25, 'en büyük sıçrama ' + enBuyukSicrama.toFixed(3));
  });

  // ── Yeni: §7.6 ölçülmüş varsayılan ──
  it('§7.6 varsayılanı: 0 ms boşluk + 45 ms crossfade süreyi kısaltır', () => {
    const klipler = [sinus(0.3), sinus(0.3)];
    const sonuc = birlestir(klipler, { hiz: HIZ, boslukMs: 0, crossfadeMs: 45, sifirGecis: true });
    const sure = pcmUzunlukSn(sonuc, HIZ);
    assert.ok(sure < 0.6 && sure > 0.54, 'beklenen ~0.555 sn, gelen ' + sure.toFixed(3));
  });

  it('kuyruk payı kırpma sondan doğru miktarı alır', () => {
    const p = sinus(0.5);
    const kirpik = sondanKirp(p, HIZ, 35);
    assert.ok(
      Math.abs(pcmUzunlukSn(p, HIZ) - pcmUzunlukSn(kirpik, HIZ) - 0.035) < 0.001,
      'kırpılan ' + (pcmUzunlukSn(p, HIZ) - pcmUzunlukSn(kirpik, HIZ)).toFixed(4),
    );
  });
});

describe('WSOLA (§5.1)', () => {
  for (const oran of [0.8, 1.2, 1.5]) {
    it(`${oran}x → süre 1/${oran} oranında değişir`, () => {
      const giris = sinus(4.0, 220);
      const cikis = wsola(giris, HIZ, oran);
      const beklenen = 4.0 / oran;
      const gercek = pcmUzunlukSn(cikis, HIZ);
      assert.ok(
        Math.abs(gercek - beklenen) / beklenen < 0.1,
        `beklenen ~${beklenen.toFixed(2)} sn, gelen ${gercek.toFixed(2)} sn`,
      );
    });
  }

  it('1.0x kopya döner (işlem yok)', () => {
    const giris = sinus(1.0);
    assert.equal(wsola(giris, HIZ, 1.0).length, giris.length);
  });

  it('perde korunur (chipmunk yok)', () => {
    const frekansTahmin = (pcm: Buffer): number => {
      const f = pcmToFloat(pcm);
      let gecis = 0;
      for (let i = 1; i < f.length; i++) {
        if ((f[i - 1] as number) < 0 && (f[i] as number) >= 0) gecis++;
      }
      return gecis / (f.length / HIZ);
    };
    const giris = sinus(3.0, 220);
    const hizli = wsola(giris, HIZ, 1.5);
    const fark = Math.abs(frekansTahmin(hizli) - 220) / 220;
    assert.ok(fark < 0.1, 'perde %' + (fark * 100).toFixed(1) + ' kaydı — chipmunk etkisi');
  });
});

describe('Perde kaydırma', () => {
  it('+2 yarım ton süreyi korur', () => {
    const giris = sinus(2.0, 220);
    const cikis = perdeKaydir(giris, HIZ, 2);
    const fark = Math.abs(pcmUzunlukSn(cikis, HIZ) - 2.0) / 2.0;
    assert.ok(fark < 0.12, 'süre %' + (fark * 100).toFixed(1) + ' kaydı');
  });
});

describe('Başarım (§7.1.1 kapısı: 30 ms)', () => {
  it('WSOLA ve birleştirme süresi ölçülür', () => {
    const dortSaniye = sinus(4.0, 220);
    for (const oran of [0.8, 1.2]) {
      wsola(dortSaniye, HIZ, oran); // ısınma
      const basla = performance.now();
      for (let i = 0; i < 5; i++) wsola(dortSaniye, HIZ, oran);
      const ms = (performance.now() - basla) / 5;
      console.log(`      WSOLA ${oran}x → ${ms.toFixed(1)} ms${ms > 30 ? '   AŞTI (§7.1.1)' : '   tamam'}`);
    }

    const klipler = Array.from({ length: 6 }, () => sinus(0.7, 220));
    const basla = performance.now();
    for (let i = 0; i < 100; i++) {
      birlestir(klipler, { hiz: HIZ, boslukMs: 0, crossfadeMs: 45 });
    }
    const ms = (performance.now() - basla) / 100;
    console.log(`      6 klip birleştirme → ${ms.toFixed(2)} ms`);
    // Birlestirme istek yolunda; §10 ~1 ms bekliyor. Bu bir OLCUM testidir ve
    // makine yukune duyarlidir; kapi genis tutuldu ki yalniz gercek regresyon
    // (orn. kazara O(n^2)) yakalansin, gurultu degil.
    assert.ok(ms < 20, '6 klip birleştirme ' + ms.toFixed(2) + ' ms — §10 ~1 ms bekliyordu');
  });
});

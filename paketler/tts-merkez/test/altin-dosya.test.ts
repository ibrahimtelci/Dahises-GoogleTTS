// Altin dosya testleri: sabit girdi -> bayt-birebir cikti.
//
// Ses birlestirme kodu degistiginde ciktinin SESSIZCE degismedigini bu yakalar.
// Bir hash tutmazsa, crossfade egrisinde veya sifir gecis aramasindaki bir
// degisiklik testlerden gecer ama bankadaki butun klipleri bozar.
//
// Hash degistiyse: ya bilincli bir iyilestirme yaptiniz (beklenen degeri
// guncelleyin ve KARARLAR.md'ye yazin) ya da farkinda olmadan ciktiyi bozdunuz.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  birlestir,
  floatToPcm,
  seviyeNormalize,
  sondanKirp,
  wavYaz,
} from '../src/ses/pcm.ts';
import { parcalariKes, tasiyiciKur } from '../src/ses/kesme.ts';
import { SahteMotor } from '../src/motor/sahte.ts';
import type { SesProfili } from '../src/motor/arayuz.ts';

const HIZ = 24000;

const PROFIL: SesProfili = {
  id: 'altin',
  motor: 'sahte',
  motorSesi: 'tr-TR-Standard-A',
  tiyer: 'standard',
  ornekHizi: HIZ,
};

function hash(tampon: Buffer): string {
  return createHash('sha256').update(tampon).digest('hex');
}

/** Deterministik girdi — rastgelelik yok, zaman yok. */
function testSinusu(sn: number, frekans: number): Buffer {
  const n = Math.round(HIZ * sn);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = 0.5 * Math.sin((2 * Math.PI * frekans * i) / HIZ);
  return floatToPcm(f);
}

describe('Altın dosya — ses zinciri bayt-birebir', () => {
  it('§7.6 birleştirme (0 ms boşluk, 45 ms crossfade, sıfır geçiş)', () => {
    const parcalar = [
      testSinusu(0.4, 180),
      testSinusu(0.3, 220),
      testSinusu(0.5, 260),
      testSinusu(0.2, 300),
    ];
    const sonuc = birlestir(parcalar, {
      hiz: HIZ,
      boslukMs: 0,
      crossfadeMs: 45,
      sifirGecis: true,
    });

    assert.equal(sonuc.length, 60720, 'çıktı uzunluğu değişti');
    assert.equal(
      hash(sonuc),
      '5e3f54c62aaff14fece75e16ab8facb4e82697ed74fe517bb2f82c20ec46b204',
      'BİRLEŞTİRME ÇIKTISI DEĞİŞTİ — bilinçli mi?',
    );
  });

  it('seviye normalizasyonu deterministik', () => {
    const p = testSinusu(0.25, 200);
    assert.equal(
      hash(seviyeNormalize(p)),
      '9589a6e53ce5d31145e12fd6d08507b91a9d2ec5211dd67efd7a674e1aca5062',
      'NORMALİZASYON ÇIKTISI DEĞİŞTİ',
    );
  });

  it('WAV başlığı bayt-birebir', () => {
    const w = wavYaz(testSinusu(0.1, 220), HIZ);
    assert.equal(
      w.subarray(0, 44).toString('hex'),
      '52494646e412000057415645666d74201000000001000100c05d000080bb00000200100064617461c0120000',
      'WAV BAŞLIĞI DEĞİŞTİ',
    );
  });

  it('kuyruk payı kırpma deterministik', () => {
    const p = testSinusu(0.3, 240);
    assert.equal(hash(sondanKirp(p, HIZ, 35)), '6a53afd538e46888fae8cefc4fdb15cfc9b30af576c255e9407caa3efab7cb43', 'KIRPMA ÇIKTISI DEĞİŞTİ');
  });

  it('taşıyıcı SSML metni birebir', () => {
    const { ssml } = tasiyiciKur([
      { yuva: 'kalip:sayın', metin: 'sayın' },
      { yuva: 'ad', metin: 'Mehmet' },
      { yuva: 'soyad', metin: "O'Brien & <Sons>" },
      { yuva: 'kalip:lütfen', metin: 'lütfen' },
    ]);
    assert.equal(
      ssml,
      '<speak><mark name="m0"/>sayın <mark name="m1"/>Mehmet ' +
        '<mark name="m2"/>O&apos;Brien &amp; &lt;Sons&gt; <mark name="m3"/>lütfen.</speak>',
      'SSML ÜRETİMİ DEĞİŞTİ — kaçış veya işaret yapısı bozulmuş olabilir',
    );
  });

  it('uçtan uca kesme zinciri deterministik', async () => {
    const motor = new SahteMotor();
    const yuvalar = [
      { yuva: 'kalip:sayın', metin: 'sayın' },
      { yuva: 'ad', metin: 'Mehmet' },
      { yuva: 'soyad', metin: 'Karabulut' },
      { yuva: 'kalip:lütfen', metin: 'lütfen' },
    ];
    const { ssml, yuvalar: kurulan } = tasiyiciKur(yuvalar);
    const { pcm, damgalar } = await motor.ssmlSentezle(ssml, PROFIL, yuvalar.length);
    const parcalar = parcalariKes(pcm, damgalar, kurulan, { hiz: HIZ, kuyrukMs: 50 });
    const birlesik = birlestir(
      parcalar.map((p) => seviyeNormalize(p.pcm)),
      { hiz: HIZ, boslukMs: 0, crossfadeMs: 45, sifirGecis: true },
    );
    assert.equal(hash(birlesik), '2e1e49345ac1934794924a8726aee3e90c869654d5a158cbc3dee60af71c6b17', 'KESME + BİRLEŞTİRME ZİNCİRİ DEĞİŞTİ');
  });
});

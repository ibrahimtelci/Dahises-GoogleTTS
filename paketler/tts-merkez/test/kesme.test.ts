// Tasiyici cumleden kesme (§7.5) — kritik kisit 1, 2, 10.
// Google'a gitmez: sahte motor kullanilir.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SahteMotor } from '../src/motor/sahte.ts';
import { ButceBekcisi } from '../src/motor/butce.ts';
import { MotorHatasi } from '../src/motor/arayuz.ts';
import type { SesProfili } from '../src/motor/arayuz.ts';
import { KesmeHatasi, parcalariKes, tasiyiciKur, tasiyiciMaliyeti, xmlKacir } from '../src/ses/kesme.ts';
import { pcmUzunlukMs } from '../src/ses/pcm.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HIZ = 24000;

const PROFIL: SesProfili = {
  id: 'kadin-1',
  motor: 'sahte',
  motorSesi: 'tr-TR-Standard-A',
  tiyer: 'standard',
  ornekHizi: HIZ,
};

const YUVALAR = [
  { yuva: 'kalip:sayın', metin: 'sayın' },
  { yuva: 'ad', metin: 'Mehmet' },
  { yuva: 'soyad', metin: 'Karabulut' },
  { yuva: 'kalip:lütfen', metin: 'lütfen' },
  { yuva: 'sayi', metin: 'üç' },
  { yuva: 'kalip:nolu bankoya geçiniz', metin: 'nolu bankoya geçiniz' },
];

describe('XML kaçışı (kritik kısıt 10 / §7.5 kural 7)', () => {
  it('apostrof kaçırılır: O\'Brien', () => assert.equal(xmlKacir("O'Brien"), 'O&apos;Brien'));
  it('ampersan kaçırılır: Smith & Sons', () =>
    assert.equal(xmlKacir('Smith & Sons'), 'Smith &amp; Sons'));
  it('açılı parantez kaçırılır: <test>', () =>
    assert.equal(xmlKacir('<test>'), '&lt;test&gt;'));
  it('tırnak kaçırılır', () => assert.equal(xmlKacir('"tırnak"'), '&quot;tırnak&quot;'));
  it('ampersan önce kaçırılır (çift kaçış yok)', () =>
    assert.equal(xmlKacir('&lt;'), '&amp;lt;'));

  it('kaçış taşıyıcı kurucusunun İÇİNDE yapılır — çağıran hatırlamak zorunda değil', () => {
    for (const tehlikeli of ["O'Brien", 'Smith & Sons', '<test>', '"tırnak"']) {
      const { ssml } = tasiyiciKur([
        { yuva: 'kalip', metin: 'sayın' },
        { yuva: 'soyad', metin: tehlikeli },
      ]);
      // Ham karakterler SSML gövdesine sızmamalı.
      const govde = ssml.replace(/<speak>|<\/speak>|<mark name="m\d+"\/>/g, '');
      assert.ok(!govde.includes('<'), `"${tehlikeli}" için ham < sızdı: ${ssml}`);
      assert.ok(!govde.includes('>'), `"${tehlikeli}" için ham > sızdı: ${ssml}`);
      assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(govde), `"${tehlikeli}" için ham & sızdı: ${ssml}`);
      assert.ok(!govde.includes("'"), `"${tehlikeli}" için ham apostrof sızdı: ${ssml}`);
      assert.ok(!govde.includes('"'), `"${tehlikeli}" için ham tırnak sızdı: ${ssml}`);
    }
  });

  it('işaret yapısı tehlikeli girdiyle bozulmaz — damga sayısı korunur', () => {
    const { ssml, yuvalar } = tasiyiciKur([
      { yuva: 'ad', metin: 'Smith & Sons' },
      { yuva: 'soyad', metin: '<test>' },
      { yuva: 'kalip', metin: "O'Brien" },
    ]);
    const isaretler = ssml.match(/<mark name="m\d+"\/>/g) ?? [];
    assert.equal(isaretler.length, yuvalar.length);
  });
});

describe('Taşıyıcı cümle kurma (§7.5 kural 2)', () => {
  it('her öğeden önce bir işaret koyar', () => {
    const { ssml } = tasiyiciKur(YUVALAR);
    const isaretler = ssml.match(/<mark name="(m\d+)"\/>/g) ?? [];
    assert.equal(isaretler.length, 6);
    assert.ok(ssml.startsWith('<speak><mark name="m0"/>sayın '));
    assert.ok(ssml.endsWith('nolu bankoya geçiniz.</speak>'));
  });

  it('bitişik işaret üretmez — her işaretin ardından metin gelir', () => {
    const { ssml } = tasiyiciKur(YUVALAR);
    assert.ok(!/<mark name="m\d+"\/>\s*<mark/.test(ssml), 'bitişik işaret var: ' + ssml);
  });

  it('boş yuva reddedilir (tek damgaya indirgenirdi)', () => {
    assert.throws(
      () => tasiyiciKur([{ yuva: 'ad', metin: 'Mehmet' }, { yuva: 'soyad', metin: '  ' }]),
      KesmeHatasi,
    );
  });

  it('yuvasız taşıyıcı reddedilir', () => assert.throws(() => tasiyiciKur([]), KesmeHatasi));

  it('karakter maliyeti SSML etiketlerini de sayar (§6.4)', () => {
    const maliyet = tasiyiciMaliyeti(YUVALAR);
    const duzMetin = YUVALAR.map((y) => y.metin).join(' ').length;
    assert.ok(maliyet > duzMetin, 'etiketler sayılmamış');
    // §7.5: etiketler karakterin kabaca yarisini olusturur.
    assert.ok(maliyet > duzMetin * 1.5, `maliyet ${maliyet}, düz metin ${duzMetin}`);
  });
});

describe('Damgadan dilimleme (§7.5 kural 3, 4)', () => {
  const motor = new SahteMotor();

  it('her yuva için bir parça çıkar ve sıra korunur', async () => {
    const { ssml, yuvalar } = tasiyiciKur(YUVALAR);
    const { pcm, damgalar } = await motor.ssmlSentezle(ssml, PROFIL, yuvalar.length);
    const parcalar = parcalariKes(pcm, damgalar, yuvalar, { hiz: HIZ, kuyrukMs: 50 });

    assert.equal(parcalar.length, 6);
    assert.deepEqual(parcalar.map((p) => p.yuva), YUVALAR.map((y) => y.yuva));
    for (const p of parcalar) assert.ok(p.pcm.length > 0, `${p.yuva} boş çıktı`);
  });

  it('kuyruk payı parçayı ~50 ms uzatır (§7.5 kural 4)', async () => {
    const { ssml, yuvalar } = tasiyiciKur(YUVALAR);
    const { pcm, damgalar } = await motor.ssmlSentezle(ssml, PROFIL, yuvalar.length);

    const paysiz = parcalariKes(pcm, damgalar, yuvalar, { hiz: HIZ, kuyrukMs: 0 });
    const payli = parcalariKes(pcm, damgalar, yuvalar, { hiz: HIZ, kuyrukMs: 50 });

    // Son yuva haric hepsi uzamali; son yuva zaten cumlenin sonuna kadar gider.
    for (let i = 0; i < yuvalar.length - 1; i++) {
      const fark =
        pcmUzunlukMs((payli[i] as { pcm: Buffer }).pcm, HIZ) -
        pcmUzunlukMs((paysiz[i] as { pcm: Buffer }).pcm, HIZ);
      assert.ok(Math.abs(fark - 50) < 2, `yuva ${i}: pay farkı ${fark} ms`);
    }
  });

  it('son parça cümle sonuna kadar gider, taşmaz', async () => {
    const { ssml, yuvalar } = tasiyiciKur(YUVALAR);
    const { pcm, damgalar } = await motor.ssmlSentezle(ssml, PROFIL, yuvalar.length);
    const parcalar = parcalariKes(pcm, damgalar, yuvalar, { hiz: HIZ, kuyrukMs: 50 });
    const son = parcalar[parcalar.length - 1] as { bitisMs: number };
    assert.equal(son.bitisMs, pcmUzunlukMs(pcm, HIZ));
  });

  it('parçaların toplamı taşıyıcıyı aşmaz', async () => {
    const { ssml, yuvalar } = tasiyiciKur(YUVALAR);
    const { pcm, damgalar } = await motor.ssmlSentezle(ssml, PROFIL, yuvalar.length);
    const parcalar = parcalariKes(pcm, damgalar, yuvalar, { hiz: HIZ, kuyrukMs: 0 });
    const toplam = parcalar.reduce((t, p) => t + p.pcm.length, 0);
    assert.equal(toplam, pcm.length);
  });

  it('damga yoksa anlaşılır hata verir', () => {
    assert.throws(
      () => parcalariKes(Buffer.alloc(1000), [], YUVALAR, { hiz: HIZ, kuyrukMs: 50 }),
      /Chirp 3 HD/,
    );
  });

  it('Chirp 3 HD davranışı yakalanır: bütün damgalar sıfır (§6.6)', async () => {
    const chirp = new SahteMotor({ damgalariSifirla: true });
    const { ssml, yuvalar } = tasiyiciKur(YUVALAR);
    const { pcm, damgalar } = await chirp.ssmlSentezle(ssml, PROFIL, yuvalar.length);
    assert.throws(() => parcalariKes(pcm, damgalar, yuvalar, { hiz: HIZ, kuyrukMs: 50 }), /sıfır/);
  });

  it('eksik işaret anlaşılır hata verir', async () => {
    const { ssml, yuvalar } = tasiyiciKur(YUVALAR);
    const { pcm, damgalar } = await motor.ssmlSentezle(ssml, PROFIL, yuvalar.length);
    assert.throws(
      () => parcalariKes(pcm, damgalar.slice(0, 3), yuvalar, { hiz: HIZ, kuyrukMs: 50 }),
      /işareti yanıtta yok/,
    );
  });
});

describe('Bütçe bekçisi — Google 50 klip sert sınırı', () => {
  const gecici = (): string => join(tmpdir(), `butce-${process.pid}-${Math.random()}.json`);

  it('sınır aşılacaksa istek gönderilmez', async () => {
    const b = new ButceBekcisi(gecici(), 10);
    await b.harca(6, 300);
    await assert.rejects(() => b.harca(6, 300), /bütçesi aşılacaktı/);
    assert.equal(b.durum().klip, 6, 'reddedilen çağrı sayaca yazılmamalı');
  });

  it('kalan klip doğru sayılır', async () => {
    const b = new ButceBekcisi(gecici(), 50);
    await b.harca(6, 300);
    await b.harca(6, 300);
    assert.equal(b.durum().kalanKlip, 38);
    assert.equal(b.durum().cagri, 2);
  });

  it('sayaç diske yazılır — süreç yeniden başlayınca sıfırlanmaz', async () => {
    const yol = gecici();
    const a = new ButceBekcisi(yol, 50);
    await a.harca(7, 400);
    const b = new ButceBekcisi(yol, 50);
    await b.yukle();
    assert.equal(b.durum().klip, 7);
  });

  it('yeterMi istek atmadan sorar', async () => {
    const b = new ButceBekcisi(gecici(), 10);
    await b.harca(8, 100);
    assert.equal(await b.yeterMi(2), true);
    assert.equal(await b.yeterMi(3), false);
  });
});

describe('Sahte motor — hata yolları', () => {
  it('geçici hata gecici olarak işaretlenir', async () => {
    const motor = new SahteMotor({
      hataUret: () => new MotorHatasi('429 deneme', { durumKodu: 429, gecici: true }),
    });
    await assert.rejects(
      () => motor.sentezle('deneme', PROFIL),
      (h: unknown) => h instanceof MotorHatasi && h.gecici,
    );
  });

  it('çağrı sayacı testlerde doğrulanabilir', async () => {
    const motor = new SahteMotor();
    await motor.sentezle('bir', PROFIL);
    await motor.sentezle('iki', PROFIL);
    assert.equal(motor.cagriSayisi, 2);
  });
});

// Uretim hatti — gercek PostgreSQL'e karsi, SAHTE motorla. Google'a gitmez.
//
// Hata yollari kapsanir: kota dolu, Google hatasi, gecersiz SSML, bayat pending.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { MotorHatasi } from '../src/motor/arayuz.ts';
import type { SesProfili } from '../src/motor/arayuz.ts';
import { SahteMotor } from '../src/motor/sahte.ts';
import { KlipDeposu, pcmHash } from '../src/depo/klip-deposu.ts';
import {
  bayatlariSupur,
  durumSayilari,
  kapsamHastaneId,
  kotaBekleyenleriGeriAl,
  kuyrugaEkle,
  partiSahiplen,
  tekSahiplen,
} from '../src/uretim/kuyruk.ts';
import { KotaDoluHatasi, kotaDurumu, kotaDus, kotaIade, topluUretimeIzinVar } from '../src/uretim/kota.ts';
import { delta, kapsamGenisledigindeSurumArtir, partiyiHazirYap } from '../src/uretim/surum.ts';
import { tasiyicilariPlanla, yuvalariTanimla } from '../src/uretim/planlayici.ts';
import { Uretici } from '../src/uretim/uretici.ts';
import { testOrtamiAc, VERITABANI_VAR, type TestOrtami } from './yardim.ts';

const HIZ = 24000;
const SABLON = 'sayın {ad} {soyad} lütfen {banko} nolu bankoya geçiniz';

const PROFIL: SesProfili = {
  id: 'kadin-1',
  motor: 'sahte',
  motorSesi: 'tr-TR-Standard-A',
  tiyer: 'standard',
  ornekHizi: HIZ,
};

const AYAR = { kuyrukMs: 50, denemeSiniri: 3, sahiplenmeYasiSn: 60, partiBoyutu: 200 };

const SESSIZ = { info: () => {}, warn: () => {}, error: () => {} };

const YUVALAR = yuvalariTanimla(SABLON, { ad: 'Mehmet', soyad: 'Karabulut', banko: 'üç' });

describe('Üretim hattı (PostgreSQL + sahte motor)', { skip: !VERITABANI_VAR && 'DATABASE_URL yok' }, () => {
  let ortam: TestOrtami;

  before(async () => {
    ortam = await testOrtamiAc();
  });

  after(async () => {
    await ortam.kapat();
  });

  it('migrasyonlar temiz şemada baştan koşuyor', async () => {
    const tablolar = await ortam.db<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = ${ortam.sema}
    `;
    const adlar = tablolar.map((t) => t.table_name).sort();
    for (const beklenen of [
      'klip', 'klip_kapsam', 'banka_surum', 'kota', 'sablon', 'ses_profili',
      'kullanici', 'denetim_gunlugu', 'engellenen', 'tiyer', 'oturum', 'uretim_gunlugu',
    ]) {
      assert.ok(adlar.includes(beklenen), `${beklenen} tablosu yok`);
    }
  });

  it('klip.telaffuz ve klip.sonraki_deneme kolonları var (§9A)', async () => {
    const kolonlar = await ortam.db<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = ${ortam.sema} AND table_name = 'klip'
    `;
    const adlar = kolonlar.map((k) => k.column_name);
    assert.ok(adlar.includes('telaffuz'));
    assert.ok(adlar.includes('sonraki_deneme'));
    assert.ok(adlar.includes('hastane_id') === false, 'hastane_id klip_kapsam tablosunda olmalı');
  });

  it('hastane_id kolonu klip_kapsam\'da var ve varsayılanı 0', async () => {
    const [satir] = await ortam.db<{ column_default: string | null }[]>`
      SELECT column_default FROM information_schema.columns
       WHERE table_schema = ${ortam.sema} AND table_name = 'klip_kapsam' AND column_name = 'hastane_id'
    `;
    assert.ok(String(satir?.column_default ?? '').startsWith('0'));
  });

  it('Türkçe collation: İSTANBUL ve istanbul tek satır olur', async () => {
    await kuyrugaEkle(ortam.db, 'İSTANBUL', 'collate-testi', 'ad');
    await kuyrugaEkle(ortam.db, 'istanbul', 'collate-testi', 'ad');
    const satirlar = await ortam.db`SELECT id FROM klip WHERE profil = 'collate-testi'`;
    assert.equal(satirlar.length, 1, 'Türkçe küçük harf kuralı UNIQUE anahtarında uygulanmadı');
  });

  it('kapsam kuralı tek noktada: doktor/poliklinik hastaneye özel, diğerleri ortak havuz', () => {
    assert.equal(kapsamHastaneId('ad', 7), 0);
    assert.equal(kapsamHastaneId('soyad', 7), 0);
    assert.equal(kapsamHastaneId('sayi', 7), 0);
    assert.equal(kapsamHastaneId('doktor', 7), 7);
    assert.equal(kapsamHastaneId('poliklinik', 7), 7);
  });

  it('uçtan uca: kuyruğa ekle → üret → ready + dosya diskte', async () => {
    const motor = new SahteMotor();
    const depo = new KlipDeposu(ortam.bankaDizini);
    const uretici = new Uretici(ortam.db, motor, depo, AYAR, SESSIZ);

    for (const [kelime, tip] of [
      ['yılmaz', 'soyad'], ['ayşe', 'ad'], ['öztürk', 'soyad'], ['hüseyin', 'ad'],
    ] as const) {
      await kuyrugaEkle(ortam.db, kelime, PROFIL.id, tip);
    }

    const sonuc = await uretici.partiUret(PROFIL, YUVALAR);

    assert.equal(sonuc.uretilen, 4, 'dört klip üretilmeliydi: ' + sonuc.hatalar.join('; '));
    assert.equal(sonuc.basarisiz, 0);
    assert.ok(sonuc.tasiyici >= 2, 'iki taşıyıcı bekleniyordu');

    const satirlar = await ortam.db<{ kelime: string; durum: string; hash: string; sure_ms: number; surum: number }[]>`
      SELECT kelime, durum, hash, sure_ms, surum FROM klip WHERE profil = ${PROFIL.id} ORDER BY kelime
    `;
    assert.equal(satirlar.length, 4);
    for (const s of satirlar) {
      assert.equal(s.durum, 'ready');
      assert.ok(s.hash && s.hash.length === 64, 'hash sha256 değil');
      assert.ok(Number(s.sure_ms) > 0);
      assert.ok(Number(s.surum) > 0);
      assert.ok(await depo.varMi(PROFIL.id, s.hash), `dosya diskte yok: ${s.hash}`);
    }
  });

  it('içerik adresli düzen: veri/banka/<profil>/<hash[0:2]>/<hash[2:4]>/<hash>.pcm', async () => {
    const depo = new KlipDeposu(ortam.bankaDizini);
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const { hash, yeni } = await depo.yaz('profil-x', pcm);
    assert.equal(hash, pcmHash(pcm));
    assert.equal(yeni, true);
    assert.ok(depo.yol('profil-x', hash).includes(hash.slice(0, 2)));
    assert.ok(depo.yol('profil-x', hash).includes(hash.slice(2, 4)));
    assert.deepEqual(await depo.oku('profil-x', hash), pcm);

    const ikinci = await depo.yaz('profil-x', pcm);
    assert.equal(ikinci.yeni, false, 'aynı içerik iki kez saklanmamalı');
  });

  it('deneme sıfırlanır — §A.2 tuzağı: deneme=3 ile ready kalan klip bir daha üretilemezdi', async () => {
    const [satir] = await ortam.db<{ id: number }[]>`
      INSERT INTO klip (kelime, profil, durum, deneme) VALUES ('deneme-testi', 'p2', 'pending', 2)
      RETURNING id
    `;
    await partiyiHazirYap(ortam.db, 'p2', [{ id: Number(satir?.id), hash: 'a'.repeat(64), sureMs: 100 }]);
    const [sonra] = await ortam.db<{ deneme: number; durum: string }[]>`
      SELECT deneme, durum FROM klip WHERE id = ${Number(satir?.id)}
    `;
    assert.equal(Number(sonra?.deneme), 0, 'deneme sıfırlanmadı');
    assert.equal(sonra?.durum, 'ready');
  });

  it('parti tek versiyon artışı alır — nextval kullanılmaz', async () => {
    const idler: number[] = [];
    for (const k of ['a1', 'a2', 'a3']) {
      const [s] = await ortam.db<{ id: number }[]>`
        INSERT INTO klip (kelime, profil, durum) VALUES (${k}, 'p3', 'pending') RETURNING id
      `;
      idler.push(Number(s?.id));
    }
    const surum = await partiyiHazirYap(
      ortam.db, 'p3', idler.map((id) => ({ id, hash: 'b'.repeat(64), sureMs: 50 })),
    );
    const satirlar = await ortam.db<{ surum: number }[]>`SELECT surum FROM klip WHERE profil = 'p3'`;
    assert.ok(satirlar.every((s) => Number(s.surum) === surum), 'parti aynı sürümü paylaşmalı');

    const diziler = await ortam.db<{ c: string }[]>`
      SELECT count(*)::text AS c FROM information_schema.sequences
       WHERE sequence_schema = ${ortam.sema} AND sequence_name LIKE '%surum%'
    `;
    assert.equal(Number(diziler[0]?.c), 0, 'banka_surum için sequence tanımlanmamalı (§A.2)');
  });

  it('kapsam genişleyince sürüm artar — yoksa delta klibi hiç döndürmez (§9B)', async () => {
    const [s] = await ortam.db<{ id: number }[]>`
      INSERT INTO klip (kelime, profil, durum) VALUES ('kapsam-testi', 'p4', 'pending') RETURNING id
    `;
    const id = Number(s?.id);
    await ortam.db`INSERT INTO klip_kapsam (klip_id, tip, hastane_id) VALUES (${id}, 'doktor', 3)`;
    const ilkSurum = await partiyiHazirYap(ortam.db, 'p4', [{ id, hash: 'c'.repeat(64), sureMs: 10 }]);

    // HST-11 aynı kelimeyi ilk kez ister; kapsam genişler.
    await ortam.db`INSERT INTO klip_kapsam (klip_id, tip, hastane_id) VALUES (${id}, 'doktor', 11)`;
    const yeniSurum = await kapsamGenisledigindeSurumArtir(ortam.db, id, 'p4');

    assert.ok(yeniSurum !== null && yeniSurum > ilkSurum, 'sürüm artmadı');
    const gelen = await delta(ortam.db, 'p4', ilkSurum, 11);
    assert.equal(gelen.length, 1, 'klip HST-11 deltasında görünmedi');
  });

  it('single-flight: aynı klibi iki isteyen aynı anda sahiplenemez (§9B)', async () => {
    const ilk = await tekSahiplen(ortam.db, 'tekil', 'p5', AYAR);
    const ikinci = await tekSahiplen(ortam.db, 'tekil', 'p5', AYAR);
    assert.ok(ilk !== null, 'ilk sahiplenme başarısız');
    assert.equal(ikinci, null, 'ikinci istek de sahiplendi — Google\'a iki çağrı giderdi');
  });

  it('bayat pending süpürülür ve failed olur (§9B)', async () => {
    await ortam.db`
      INSERT INTO klip (kelime, profil, durum, sahiplenildi)
      VALUES ('bayat', 'p6', 'pending', now() - interval '10 minutes')
    `;
    const supurulen = await bayatlariSupur(ortam.db, 5);
    assert.ok(supurulen >= 1);
    const [s] = await ortam.db<{ durum: string; hata: string }[]>`
      SELECT durum, hata FROM klip WHERE kelime = 'bayat' AND profil = 'p6'
    `;
    assert.equal(s?.durum, 'failed');
    assert.match(String(s?.hata), /zaman aşımı/);
  });

  it('takılı kalan uretiliyor da kurtarılır', async () => {
    await ortam.db`
      INSERT INTO klip (kelime, profil, durum, sahiplenildi)
      VALUES ('takili', 'p6b', 'uretiliyor', now() - interval '10 minutes')
    `;
    await bayatlariSupur(ortam.db, 5);
    const [s] = await ortam.db<{ durum: string }[]>`
      SELECT durum FROM klip WHERE kelime = 'takili' AND profil = 'p6b'
    `;
    assert.equal(s?.durum, 'failed');
  });

  it('deneme sınırına ulaşan klip yeniden sahiplenilmez', async () => {
    await ortam.db`
      INSERT INTO klip (kelime, profil, durum, deneme) VALUES ('yorgun', 'p7', 'failed', 3)
    `;
    const parti = await partiSahiplen(ortam.db, 'p7', 10, AYAR);
    assert.equal(parti.length, 0, 'deneme >= 3 olan klip yeniden alındı');
  });

  it('geri çekilme: sonraki_deneme geleceğe atılan klip hemen alınmaz', async () => {
    await ortam.db`
      INSERT INTO klip (kelime, profil, durum, deneme, sonraki_deneme)
      VALUES ('bekleyen', 'p8', 'failed', 1, now() + interval '5 minutes')
    `;
    assert.equal((await partiSahiplen(ortam.db, 'p8', 10, AYAR)).length, 0);
    await ortam.db`UPDATE klip SET sonraki_deneme = now() WHERE profil = 'p8'`;
    assert.equal((await partiSahiplen(ortam.db, 'p8', 10, AYAR)).length, 1);
  });
});

describe('Kota koruması (§6.4)', { skip: !VERITABANI_VAR && 'DATABASE_URL yok' }, () => {
  let ortam: TestOrtami;

  before(async () => {
    ortam = await testOrtamiAc();
  });

  after(async () => {
    await ortam.kapat();
  });

  it('Standard ve WaveNet ayrı havuzlar — biri dolunca diğeri etkilenmez', async () => {
    await ortam.db`UPDATE tiyer SET aylik_kota = 1000 WHERE kod = 'standard'`;
    await kotaDus(ortam.db, 'standard', 500);
    await kotaDus(ortam.db, 'wavenet', 500);

    const durum = await kotaDurumu(ortam.db);
    const std = durum.find((d) => d.tiyer === 'standard');
    const wav = durum.find((d) => d.tiyer === 'wavenet');
    assert.equal(std?.kullanilan, 500);
    assert.equal(wav?.kullanilan, 500);
    assert.notEqual(std?.limitToplam, wav?.limitToplam, 'tiyer limitleri ayrı olmalı');
  });

  it('sert limit %90 — kotanın tamamı değil', async () => {
    const durum = await kotaDurumu(ortam.db);
    const wav = durum.find((d) => d.tiyer === 'wavenet');
    assert.equal(wav?.limitToplam, 1_000_000);
    assert.equal(wav?.limitSert, 900_000, 'WaveNet sert limiti 900K olmalı (§6.4)');
    const std = durum.find((d) => d.tiyer === 'standard');
    assert.equal(std?.limitSert, 900, 'test için 1000 yapılan kotanın %90\'ı');
  });

  it('sert limit aşılacaksa satır dönmez ve çağrı yapılmaz', async () => {
    await assert.rejects(() => kotaDus(ortam.db, 'standard', 1000), KotaDoluHatasi);
    const durum = await kotaDurumu(ortam.db);
    assert.equal(durum.find((d) => d.tiyer === 'standard')?.kullanilan, 500, 'reddedilen çağrı sayaca yazıldı');
  });

  it('iade edilen karakter sayaçtan düşer', async () => {
    await kotaIade(ortam.db, 'standard', 200);
    const durum = await kotaDurumu(ortam.db);
    assert.equal(durum.find((d) => d.tiyer === 'standard')?.kullanilan, 300);
  });

  it('%85 kritik eşikte toplu üretim durur, tekil üretim devam eder', async () => {
    await kotaDus(ortam.db, 'standard', 570); // 870 / 1000 = %87
    assert.equal(await topluUretimeIzinVar(ortam.db, 'standard'), false);
    const durum = await kotaDurumu(ortam.db);
    assert.equal(durum.find((d) => d.tiyer === 'standard')?.bant, 'kritik');
  });

  it('Chirp 3 HD kesme desteklemiyor olarak işaretli (§6.6)', async () => {
    const durum = await kotaDurumu(ortam.db);
    assert.equal(durum.find((d) => d.tiyer === 'chirp3hd')?.kesmeDestegi, false);
    assert.equal(durum.find((d) => d.tiyer === 'standard')?.kesmeDestegi, true);
  });

  it('kota dolunca üretim durur, klipler kota_bekliyor olur — kaybolmaz', async () => {
    const motor = new SahteMotor();
    const depo = new KlipDeposu(ortam.bankaDizini);
    const uretici = new Uretici(ortam.db, motor, depo, AYAR, SESSIZ);

    for (const k of ['kotalik1', 'kotalik2']) {
      await kuyrugaEkle(ortam.db, k, 'kota-profil', 'ad');
    }
    const sonuc = await uretici.partiUret(
      { ...PROFIL, id: 'kota-profil', tiyer: 'standard' }, YUVALAR,
    );

    assert.equal(sonuc.uretilen, 0);
    assert.equal(sonuc.kotaBekleyen, 2);
    assert.equal(motor.cagriSayisi, 0, 'kota dolu olmasına rağmen Google çağrısı yapıldı');

    const sayilar = await durumSayilari(ortam.db);
    assert.ok((sayilar['kota_bekliyor'] ?? 0) >= 2);
  });

  it('kota yenilenince bekleyenler geri alınır', async () => {
    await ortam.db`UPDATE klip SET sonraki_deneme = now() WHERE durum = 'kota_bekliyor'`;
    const geriAlinan = await kotaBekleyenleriGeriAl(ortam.db);
    assert.ok(geriAlinan >= 2);
  });
});

describe('Hata yolları', { skip: !VERITABANI_VAR && 'DATABASE_URL yok' }, () => {
  let ortam: TestOrtami;

  before(async () => {
    ortam = await testOrtamiAc();
  });

  after(async () => {
    await ortam.kapat();
  });

  it('Google geçici hatası: klip failed olur, sonraki_deneme ileri atılır, kota iade edilir', async () => {
    const motor = new SahteMotor({
      hataUret: () => new MotorHatasi('429 Too Many Requests', { durumKodu: 429, gecici: true }),
    });
    const uretici = new Uretici(ortam.db, motor, new KlipDeposu(ortam.bankaDizini), AYAR, SESSIZ);

    await kuyrugaEkle(ortam.db, 'hatali', 'hata-profil', 'ad');
    const sonuc = await uretici.partiUret({ ...PROFIL, id: 'hata-profil' }, YUVALAR);

    assert.equal(sonuc.uretilen, 0);
    assert.equal(sonuc.basarisiz, 1);

    const [s] = await ortam.db<{ durum: string; sonraki_deneme: Date }[]>`
      SELECT durum, sonraki_deneme FROM klip WHERE kelime = 'hatali' AND profil = 'hata-profil'
    `;
    assert.equal(s?.durum, 'failed');
    assert.ok((s?.sonraki_deneme as Date).getTime() > Date.now(), 'geri çekilme uygulanmadı');

    const durum = await kotaDurumu(ortam.db);
    assert.equal(
      durum.find((d) => d.tiyer === 'standard')?.kullanilan, 0,
      'ses üretilmediği halde kota harcanmış görünüyor',
    );
  });

  it('geçersiz SSML: damgasız yanıt anlaşılır hataya döner, klip failed olur', async () => {
    const motor = new SahteMotor({ damgasiz: true });
    const uretici = new Uretici(ortam.db, motor, new KlipDeposu(ortam.bankaDizini), AYAR, SESSIZ);

    await kuyrugaEkle(ortam.db, 'damgasiz', 'damga-profil', 'ad');
    const sonuc = await uretici.partiUret({ ...PROFIL, id: 'damga-profil' }, YUVALAR);

    assert.equal(sonuc.basarisiz, 1);
    assert.match(sonuc.hatalar.join(' '), /Chirp 3 HD|zaman damgası/);
  });

  it('tehlikeli karakterli kelime üretimi bozmaz (XML kaçışı)', async () => {
    const motor = new SahteMotor();
    const depo = new KlipDeposu(ortam.bankaDizini);
    const uretici = new Uretici(ortam.db, motor, depo, AYAR, SESSIZ);

    for (const k of ["o'brien", 'smith & sons', '<test>', '"tırnak"']) {
      await kuyrugaEkle(ortam.db, k, 'kacis-profil', 'soyad');
    }
    const sonuc = await uretici.partiUret({ ...PROFIL, id: 'kacis-profil' }, YUVALAR);
    assert.equal(sonuc.uretilen, 4, 'kaçış hatası: ' + sonuc.hatalar.join('; '));
  });

  it('telaffuz kolonu doluysa TTS\'e o metin gider (§9A)', async () => {
    const motor = new SahteMotor();
    const uretici = new Uretici(ortam.db, motor, new KlipDeposu(ortam.bankaDizini), AYAR, SESSIZ);

    await ortam.db`
      INSERT INTO klip (kelime, telaffuz, profil, durum)
      VALUES ('wagner', 'vagner', 'telaffuz-profil', 'pending')
    `;
    const parti = await partiSahiplen(ortam.db, 'telaffuz-profil', 10, AYAR);
    assert.equal(parti[0]?.telaffuz, 'vagner');

    await ortam.db`UPDATE klip SET durum = 'pending', sahiplenildi = NULL, deneme = 0 WHERE profil = 'telaffuz-profil'`;
    const sonuc = await uretici.partiUret({ ...PROFIL, id: 'telaffuz-profil' }, YUVALAR);
    assert.equal(sonuc.uretilen, 1);
  });
});

describe('Taşıyıcı planlama (§9D)', () => {
  it('her taşıyıcı birden fazla token taşır — maliyet bölüşülür', () => {
    const bekleyenler = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      kelime: `k${i}`,
      telaffuz: `k${i}`,
      tip: i % 2 === 0 ? 'ad' : 'soyad',
    }));
    const tasiyicilar = tasiyicilariPlanla(bekleyenler, YUVALAR);
    assert.equal(tasiyicilar.length, 3, 'iki değişken yuvaya altı token üç taşıyıcı eder');
    assert.equal(tasiyicilar.reduce((t, x) => t + x.saklanan, 0), 6);
  });

  it('boş yuva bırakmaz — dolgu değeri konur', () => {
    const tasiyicilar = tasiyicilariPlanla(
      [{ id: 1, kelime: 'tek', telaffuz: 'tek', tip: 'ad' }], YUVALAR,
    );
    assert.equal(tasiyicilar.length, 1);
    for (const y of tasiyicilar[0]?.yuvalar ?? []) {
      assert.ok(y.metin.trim().length > 0, `${y.yuva} boş kaldı`);
    }
    assert.equal(tasiyicilar[0]?.saklanan, 1, 'yalnız gerçek kelime saklanmalı');
  });

  it('kalıp kelimeler kalıp yuvasından üretilir', () => {
    const tasiyicilar = tasiyicilariPlanla(
      [{ id: 9, kelime: 'sayın', telaffuz: 'sayın', tip: 'kalip' }], YUVALAR,
    );
    const kalipYuva = tasiyicilar[0]?.yuvalar.find((y) => y.yuva === 'kalip:sayın');
    assert.equal(kalipYuva?.klipId, 9);
  });
});

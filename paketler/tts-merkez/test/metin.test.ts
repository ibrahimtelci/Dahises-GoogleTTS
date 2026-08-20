// prototip/kendini-test.js'deki metin testleri (24 adet) + yeni eklenenler.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  engelSebebi,
  normalize,
  parcalaraAyir,
  sablonDegiskenleri,
  sablonuAyristir,
  sayiyaMetin,
  sayiyiBilesenlereAyir,
  unvanlariAc,
} from '../src/ses/metin.ts';

const SABLON = 'sayın {ad} {soyad} lütfen {banko} nolu bankoya geçiniz';

describe('Sayı → metin', () => {
  it('145 → yüz kırk beş', () => assert.equal(sayiyaMetin(145), 'yüz kırk beş'));
  it('1 → bir', () => assert.equal(sayiyaMetin(1), 'bir'));
  it('12 → on iki', () => assert.equal(sayiyaMetin(12), 'on iki'));
  it('100 → yüz', () => assert.equal(sayiyaMetin(100), 'yüz'));
  it('200 → iki yüz', () => assert.equal(sayiyaMetin(200), 'iki yüz'));
  it('1000 → bin', () => assert.equal(sayiyaMetin(1000), 'bin'));
  it('2025 → iki bin yirmi beş', () => assert.equal(sayiyaMetin(2025), 'iki bin yirmi beş'));
  it('9999 → dokuz bin dokuz yüz doksan dokuz', () =>
    assert.equal(sayiyaMetin(9999), 'dokuz bin dokuz yüz doksan dokuz'));
  it('aralık dışı hata verir', () => assert.throws(() => sayiyaMetin(10000)));
});

describe('Sayı bileşenleri', () => {
  it('145 → [yüz, kırk, beş]', () =>
    assert.deepEqual(sayiyiBilesenlereAyir(145), ['yüz', 'kırk', 'beş']));
  it('245 → [iki yüz, kırk, beş] (iki yüz tek bileşen)', () =>
    assert.deepEqual(sayiyiBilesenlereAyir(245), ['iki yüz', 'kırk', 'beş']));
  it('3000 → [üç bin]', () => assert.deepEqual(sayiyiBilesenlereAyir(3000), ['üç bin']));
});

describe('Normalizasyon (§7.5.1)', () => {
  it('Wagner → Vagner', () => assert.equal(normalize('Wagner').sonuc, 'Vagner'));
  it('Quentin → Kuentin', () => assert.equal(normalize('Quentin').sonuc, 'Kuentin'));
  it('Xavier → Ksavier', () => assert.equal(normalize('Xavier').sonuc, 'Ksavier'));
  it('Türkçe isim değişmez', () => {
    const r = normalize('Öztürk');
    assert.equal(r.sonuc, 'Öztürk');
    assert.equal(r.degisti, false);
  });
  it('tire boşluğa döner', () => assert.equal(normalize('Ali-Rıza').sonuc, 'Ali Rıza'));
  it('Kiril seslendirilemez', () => assert.equal(normalize('Владимир').seslendirilemez, true));
  it('Arap harfleri seslendirilemez', () => assert.equal(normalize('محمود').seslendirilemez, true));
  it('Çince seslendirilemez', () => assert.equal(normalize('李明').seslendirilemez, true));
});

describe('Şablon', () => {
  it('şablon 6 parçaya ayrılır', () => {
    const p = sablonuAyristir(SABLON);
    assert.equal(p.length, 6);
    assert.equal(p[0]?.deger, 'sayın');
    assert.equal(p[1]?.deger, 'ad');
    assert.equal(p[5]?.deger, 'nolu bankoya geçiniz');
  });

  it('parçalama doğru anahtarları verir', () => {
    const p = parcalaraAyir(SABLON, { ad: 'Mehmet', soyad: 'Karabulut', banko: 3 });
    assert.deepEqual(
      p.map((x) => x.anahtar),
      ['kalip:sayın', 'ad:mehmet', 'soyad:karabulut', 'kalip:lütfen', 'sayi:üç', 'kalip:nolu bankoya geçiniz'],
    );
  });

  it('birleşik ad iki tokena bölünür (§7.5.1 kural 6)', () => {
    const p = parcalaraAyir(SABLON, { ad: 'Ayşe Nur', soyad: 'Kaya', banko: 1 });
    assert.ok(p.some((x) => x.anahtar === 'ad:ayşe'));
    assert.ok(p.some((x) => x.anahtar === 'ad:nur'));
  });

  it('Latin dışı token atlanır (degrade)', () => {
    const p = parcalaraAyir(SABLON, { ad: 'Владимир', soyad: 'Kaya', banko: 1 });
    assert.ok(p.some((x) => x.atlandi === true));
  });

  // ── Yeni ──
  it('değişken listesi çıkarılır', () =>
    assert.deepEqual(sablonDegiskenleri(SABLON), ['ad', 'soyad', 'banko']));

  it('Türkçe küçük harf kuralı: İSMAİL → ismail', () => {
    const p = parcalaraAyir('{ad}', { ad: 'İSMAİL' });
    assert.equal(p[0]?.anahtar, 'ad:ismail');
  });
});

describe('Unvan açılımı (§7.5.1 kural 3)', () => {
  it('Uzm.Dr. → Uzman Doktor', () =>
    assert.equal(unvanlariAc('Uzm.Dr. EDA BİRGÜL').sonuc, 'Uzman Doktor EDA BİRGÜL'));
  it('Prof.Dr. → Profesör Doktor', () =>
    assert.equal(unvanlariAc('Prof.Dr. OĞUZ POYANLI').sonuc, 'Profesör Doktor OĞUZ POYANLI'));
  it('Dr.Öğr.Üyesi → Doktor Öğretim Üyesi', () =>
    assert.equal(unvanlariAc('Dr.Öğr.Üyesi GÜLSÜM ÇEBİ').sonuc, 'Doktor Öğretim Üyesi GÜLSÜM ÇEBİ'));
  it('Op.Dr. → Operatör Doktor', () =>
    assert.equal(unvanlariAc('Op.Dr. Ahmet Kaya').sonuc, 'Operatör Doktor Ahmet Kaya'));
  it('unvansız metne dokunmaz', () =>
    assert.equal(unvanlariAc('Ahmet Kaya').degisti, false));
  it('şablon yolunda unvan açılır, harf harf okunmaz', () => {
    const p = parcalaraAyir('{doktor}', { doktor: 'Uzm.Dr. Eda Birgül' });
    assert.deepEqual(p.map((x) => x.metin), ['Uzman', 'Doktor', 'Eda', 'Birgül']);
  });
});

describe('Engellenecekler (§7.5.2)', () => {
  it('maskelenmiş ad', () => assert.equal(engelSebebi('AHM*T'), 'maskeli'));
  it('yıldız kaydı', () => assert.equal(engelSebebi('***'), 'maskeli'));
  it('kısaltılmış ad: a.hayri', () => assert.equal(engelSebebi('a.hayri'), 'kisaltilmis'));
  it('kısaltılmış ad: h.', () => assert.equal(engelSebebi('h.'), 'kisaltilmis'));
  it('iki harfli token', () => assert.equal(engelSebebi('ab'), 'kisaltilmis'));
  it('TEST kaydı', () => assert.equal(engelSebebi('TEST'), 'test'));
  it('Latin dışı', () => assert.equal(engelSebebi('Владимир'), 'latin_disi'));
  it('temiz isim engellenmez', () => assert.equal(engelSebebi('Karabulut'), null));
  it('engelli token şablon yolunda atlanır', () => {
    const p = parcalaraAyir('{ad}', { ad: 'a.hayri' });
    assert.equal(p[0]?.atlandi, true);
  });
});

describe('Apostroflu adlar bankaya girebilmeli (§7.5 kural 7)', () => {
  it("O'Brien seslendirilebilir sayılır", () => {
    const r = normalize("O'Brien");
    assert.equal(r.seslendirilemez, false, "O'Brien yanlışlıkla engelleniyor");
    assert.equal(r.sonuc, "O'Brien");
  });
  it("O'Brien engel listesine düşmez", () => assert.equal(engelSebebi("O'Brien"), null));
  it('ayrıştırma artığı & okunamaz kalır', () =>
    assert.equal(normalize('&').seslendirilemez, true));
  it('Kiril hâlâ latin_disi', () => assert.equal(engelSebebi('Владимир'), 'latin_disi'));
});

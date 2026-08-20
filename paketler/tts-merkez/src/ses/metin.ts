// Normalizasyon, unvan acilimi, sayi -> metin, sablon parcalama (§7.5.1, §7.5.2).
//
// prototip/src/sablon.js'den tasindi; unvan acilimi ve engellenecek tespiti eklendi.

// ── Normalizasyon (§7.5.1 kural 4) ────────────────────────────────────────

const HARF_ESLEME: Record<string, string> = {
  w: 'v', W: 'V',
  q: 'k', Q: 'K',
  x: 'ks', X: 'Ks',
  ñ: 'n', Ñ: 'N',
  ß: 'ss',
  é: 'e', è: 'e', ê: 'e', ë: 'e', É: 'E', È: 'E', Ê: 'E',
  á: 'a', à: 'a', â: 'a', ä: 'a', Á: 'A', À: 'A', Â: 'A', Ä: 'A',
  í: 'i', ì: 'i', î: 'i', ï: 'i', Í: 'I', Ì: 'I', Î: 'I',
  ó: 'o', ò: 'o', ô: 'o', Ó: 'O', Ò: 'O', Ô: 'O',
  ú: 'u', ù: 'u', û: 'u', Ú: 'U', Ù: 'U', Û: 'U',
  ý: 'i', Ý: 'I',
  '-': ' ',
};

const TURKCE_HARF = /^[a-zA-ZçÇğĞıİöÖşŞüÜ'’ ]+$/;   // apostrof: O'Brien gibi adlar bankaya girebilmeli;
                                              // SSML riski XML kacisiyla cozuluyor (§7.5 kural 7).
const LATIN_DISI = /[^ -ɏḀ-ỿ]/;

export type NormalizeSonucu = {
  sonuc: string;
  degisti: boolean;
  seslendirilemez: boolean;
};

/** Bir tokeni bankaya girecek haline cevirir. */
export function normalize(ham: string): NormalizeSonucu {
  const girdi = String(ham).trim();

  if (LATIN_DISI.test(girdi)) {
    // Kiril, Arap harfleri vb. — isim yerine sira numarasi anons edilir (§7.5.1).
    return { sonuc: '', degisti: true, seslendirilemez: true };
  }

  let cikti = '';
  for (const harf of girdi) cikti += HARF_ESLEME[harf] ?? harf;
  cikti = cikti.replace(/\s+/g, ' ').trim();

  return {
    sonuc: cikti,
    degisti: cikti.toLocaleLowerCase('tr-TR') !== girdi.toLocaleLowerCase('tr-TR'),
    seslendirilemez: !TURKCE_HARF.test(cikti),
  };
}

/** Bankada anahtar olarak kullanilan kucuk harf hali — Turkce kurallariyla. */
export function kucukHarf(metin: string): string {
  return metin.toLocaleLowerCase('tr-TR');
}

/** Birlesik adlari boler — "Ayse Nur" iki klip olur, kardinalite patlamaz (§7.5.1 kural 6). */
export function tokenlaraBol(metin: string): string[] {
  return String(metin).trim().split(/\s+/).filter(Boolean);
}

// ── Unvan acilimi (§7.5.1 kural 3) ────────────────────────────────────────
//
// Gercek veride doktor adlari "Uzm.Dr. EDA BIRGUL" bicimindedir. Kisaltma
// acilmazsa TTS harf harf okur.

const UNVANLAR: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDr\.?\s*Ögr\.?\s*Üyesi\b/giu, 'Doktor Öğretim Üyesi'],
  [/\bDr\.?\s*Öğr\.?\s*Üyesi\b/giu, 'Doktor Öğretim Üyesi'],
  [/\bProf\.?\s*Dr\.?/giu, 'Profesör Doktor'],
  [/\bDoç\.?\s*Dr\.?/giu, 'Doçent Doktor'],
  [/\bUzm\.?\s*Dr\.?/giu, 'Uzman Doktor'],
  [/\bUz\.?\s*Dr\.?/giu, 'Uzman Doktor'],
  [/\bOp\.?\s*Dr\.?/giu, 'Operatör Doktor'],
  [/\bYrd\.?\s*Doç\.?\s*Dr\.?/giu, 'Yardımcı Doçent Doktor'],
  [/\bProf\.(?!\w)/giu, 'Profesör'],
  [/\bDoç\.(?!\w)/giu, 'Doçent'],
  [/\bDr\.(?!\w)/giu, 'Doktor'],
  [/\bDt\.(?!\w)/giu, 'Diş Hekimi'],
  [/\bHem\.(?!\w)/giu, 'Hemşire'],
];

/**
 * Unvan kisaltmalarini acar. Normalizasyondan ONCE calismali: "Dr." icindeki
 * nokta, engellenecek tespitinde "kisaltilmis ad" sayilir.
 */
export function unvanlariAc(metin: string): { sonuc: string; degisti: boolean } {
  let cikti = String(metin);
  for (const [desen, karsilik] of UNVANLAR) cikti = cikti.replace(desen, karsilik);
  cikti = cikti.replace(/\s+/g, ' ').trim();
  return { sonuc: cikti, degisti: cikti !== String(metin).trim() };
}

// ── Engellenecekler (§7.5.2) ──────────────────────────────────────────────

export type EngelSebebi = 'maskeli' | 'kisaltilmis' | 'test' | 'latin_disi' | 'okunamaz' | null;

const TEST_KAYITLARI = new Set(['test', 'deneme', 'xxx', 'yyy', 'zzz', 'null', 'undefined']);

/**
 * Token bankaya girmemeli mi? Girmemeliyse sebebini doner.
 * Unvanlar bu cagridan ONCE acilmis olmali.
 */
export function engelSebebi(token: string): EngelSebebi {
  const t = String(token).trim();
  if (t.length === 0) return 'test';
  if (t.includes('*')) return 'maskeli';
  if (LATIN_DISI.test(t)) return 'latin_disi';
  if (TEST_KAYITLARI.has(kucukHarf(t))) return 'test';
  // "a.hayri", "h." gibi kisaltmalar; 1-2 harfli tokenlar.
  if (t.includes('.')) return 'kisaltilmis';
  if (t.replace(/[^\p{L}]/gu, '').length <= 2) return 'kisaltilmis';
  return null;
}

// ── Sayı → metin (§7.5.1 kural 2) ─────────────────────────────────────────

const BIRLER = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const ONLAR = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];

/** 0–9999 arasi sayiyi Turkce okunusuna cevirir. */
export function sayiyaMetin(n: number | string): string {
  const sayi = Math.trunc(Number(n));
  if (!Number.isFinite(sayi) || sayi < 0 || sayi > 9999) {
    throw new RangeError('Desteklenen aralık 0–9999: ' + String(n));
  }
  if (sayi === 0) return 'sıfır';

  const parcalar: string[] = [];
  const bin = Math.floor(sayi / 1000);
  const yuz = Math.floor((sayi % 1000) / 100);
  const on = Math.floor((sayi % 100) / 10);
  const bir = sayi % 10;

  if (bin > 0) parcalar.push(bin === 1 ? 'bin' : BIRLER[bin] + ' bin');
  if (yuz > 0) parcalar.push(yuz === 1 ? 'yüz' : BIRLER[yuz] + ' yüz');
  if (on > 0) parcalar.push(ONLAR[on] as string);
  if (bir > 0) parcalar.push(BIRLER[bir] as string);

  return parcalar.join(' ');
}

/** Sayiyi bilesenlerine ayirir — bankada ~150 klip yeterli olur. */
export function sayiyiBilesenlereAyir(n: number | string): string[] {
  return sayiyaMetin(n)
    .split(' ')
    .reduce<string[]>((birikim, kelime) => {
      // "iki yuz" ve "uc bin" iki kelimelik tek bilesendir; ayri okunursa tonlama bozulur.
      const onceki = birikim[birikim.length - 1];
      if ((kelime === 'yüz' || kelime === 'bin') && onceki && BIRLER.includes(onceki)) {
        birikim[birikim.length - 1] = onceki + ' ' + kelime;
      } else {
        birikim.push(kelime);
      }
      return birikim;
    }, []);
}

// ── Şablon (§7.4) ─────────────────────────────────────────────────────────

export type SablonParcasi =
  | { tur: 'kalip'; deger: string }
  | { tur: 'degisken'; deger: string };

/**
 * Sablonu sabit obeklere ve degiskenlere ayirir (§7.4 — kelime kelime DEGIL,
 * anlamli obek duzeyinde: daha az dikis, daha dogal tonlama).
 */
export function sablonuAyristir(sablon: string): SablonParcasi[] {
  const parcalar: SablonParcasi[] = [];
  const desen = /\{(\w+)\}/g;
  let son = 0;
  let eslesme: RegExpExecArray | null;

  while ((eslesme = desen.exec(sablon)) !== null) {
    const sabit = sablon.slice(son, eslesme.index).trim();
    if (sabit) parcalar.push({ tur: 'kalip', deger: sabit });
    parcalar.push({ tur: 'degisken', deger: eslesme[1] as string });
    son = eslesme.index + eslesme[0].length;
  }
  const kuyruk = sablon.slice(son).trim();
  if (kuyruk) parcalar.push({ tur: 'kalip', deger: kuyruk });

  return parcalar;
}

/** Sablondaki degisken adlari — arayuzde yuva listesi icin. */
export function sablonDegiskenleri(sablon: string): string[] {
  return sablonuAyristir(sablon)
    .filter((p): p is { tur: 'degisken'; deger: string } => p.tur === 'degisken')
    .map((p) => p.deger);
}

export type KlipParcasi = {
  anahtar: string | null;
  tip: string;
  metin: string;
  atlandi?: boolean;
};

/** Sablonu ve parametreleri, bankadan istenecek klip anahtarlarina cevirir. */
export function parcalaraAyir(
  sablon: string,
  parametreler: Record<string, string | number | null | undefined>,
  { sayiBilesenli = false }: { sayiBilesenli?: boolean } = {},
): KlipParcasi[] {
  const cikti: KlipParcasi[] = [];

  for (const parca of sablonuAyristir(sablon)) {
    if (parca.tur === 'kalip') {
      cikti.push({ anahtar: 'kalip:' + parca.deger, tip: 'kalip', metin: parca.deger });
      continue;
    }

    const ham = parametreler[parca.deger];
    if (ham === undefined || ham === null) continue;

    if (typeof ham === 'number') {
      const kelimeler = sayiBilesenli ? sayiyiBilesenlereAyir(ham) : [sayiyaMetin(ham)];
      for (const kelime of kelimeler) {
        cikti.push({ anahtar: 'sayi:' + kelime, tip: 'sayi', metin: kelime });
      }
      continue;
    }

    for (const token of tokenlaraBol(unvanlariAc(ham).sonuc)) {
      const { sonuc, seslendirilemez } = normalize(token);
      if (seslendirilemez || !sonuc || engelSebebi(token) !== null) {
        cikti.push({ anahtar: null, tip: parca.deger, metin: token, atlandi: true });
        continue;
      }
      cikti.push({ anahtar: parca.deger + ':' + kucukHarf(sonuc), tip: parca.deger, metin: sonuc });
    }
  }

  return cikti;
}

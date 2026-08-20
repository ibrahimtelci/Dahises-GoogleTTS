// Tasiyici planlama (§9D).
//
// "Her tasiyici bir ad ve bir soyad tasir; sabit obekler (sayin, lutfen) her
// tasiyicida tekrar uretilir ama yalniz bir kez saklanir. Iki token bir cumleyi
// paylastigi icin karakter maliyeti token basina ~52'ye bolunur."
//
// Burada genellestirildi: sablondaki HER degisken yuvasina bekleyen bir kelime
// yerlestirilir; yuvaya uyan kelime kalmadiysa ornek deger (dolgu) konur ve o
// dilim atilir. Atilan dilim de Google'a gitmis sestir — butce onu da sayar.

import type { TasiyiciYuva } from '../ses/kesme.ts';
import { sablonuAyristir } from '../ses/metin.ts';

export type BekleyenKelime = {
  id: number;
  kelime: string;
  /** TTS'e FIILEN gonderilecek metin: telaffuz doluysa o, degilse kelime (§9A). */
  telaffuz: string;
  tip: string;
};

/** Sablonun yuva tanimi — `sablon.ogeler` jsonb'sinden gelir. */
export type YuvaTanimi = {
  yuva: string;
  tur: 'kalip' | 'degisken';
  /** Yuvaya uyan bekleyen kelime yoksa konacak deger. */
  ornek: string;
  /** Bu yuvaya hangi tipteki kelime girer. Varsayilan: yuva adi. */
  tip: string;
};

/**
 * Tonlama siniflari (§7.5 kural 5).
 *
 * "Ad ve soyad FARKLI tonlama yuvalaridir." Bir soyadi sayi yuvasindan kesmek
 * yanlis konturlu klip uretir. Tam eslesme bulunamazsa en fazla ayni sinif
 * icinde kaydirilir; sinif disina cikan yerlestirme `idealDegil` ile
 * isaretlenir ki kalite sorunu sessiz kalmasin.
 */
const TONLAMA_SINIFI: Record<string, string> = {
  ad: 'isim',
  soyad: 'isim',
  doktor: 'isim',
  sayi: 'sayi',
  banko: 'sayi',
  poliklinik: 'ifade',
  hedef: 'ifade',
  kalip: 'kalip',
};

function sinif(tip: string): string {
  return TONLAMA_SINIFI[tip] ?? 'ifade';
}

export type PlanliYuva = TasiyiciYuva & {
  /** Bu dilim saklanacaksa hangi klip satirina ait. */
  klipId: number | null;
  /** Saklanacak kelime (kucuk harf anahtar). */
  kelime: string | null;
  tip: string;
  /** Kelime ideal tonlama yuvasina degil, ayni sinifta baska bir yuvaya kondu. */
  idealDegil: boolean;
};

export type Tasiyici = {
  yuvalar: PlanliYuva[];
  /** Bu tasiyicidan saklanacak klip sayisi. */
  saklanan: number;
};

/**
 * Sablon metninden yuva tanimlari uretir. `ornekler` her degisken icin dolgu
 * degeri verir; verilmeyen degisken icin yuva adi kullanilir.
 */
export function yuvalariTanimla(
  sablonMetni: string,
  ornekler: Record<string, string> = {},
  tipler: Record<string, string> = {},
): YuvaTanimi[] {
  return sablonuAyristir(sablonMetni).map((p) =>
    p.tur === 'kalip'
      ? { yuva: 'kalip:' + p.deger, tur: 'kalip' as const, ornek: p.deger, tip: 'kalip' }
      : {
          yuva: p.deger,
          tur: 'degisken' as const,
          ornek: ornekler[p.deger] ?? p.deger,
          tip: tipler[p.deger] ?? p.deger,
        },
  );
}

/**
 * Bekleyen kelimeleri tasiyicilara dagitir.
 *
 * Bir kelime yuvaya tipine gore girer; 'kalip' tipli kelimeler kalip
 * yuvalarina, digerleri ayni adli degisken yuvasina. Uyan yuva yoksa kelime
 * ilk uygun degisken yuvasina konur — kesme yine calisir, yalniz tonlama yuvasi
 * ideal olmaz.
 */
export function tasiyicilariPlanla(
  bekleyenler: BekleyenKelime[],
  yuvaTanimlari: YuvaTanimi[],
): Tasiyici[] {
  const degiskenYuvalar = yuvaTanimlari.filter((y) => y.tur === 'degisken');
  if (degiskenYuvalar.length === 0) {
    throw new Error('Şablonda hiç değişken yuva yok; taşıyıcı kurulamaz.');
  }

  // Tipe gore kuyruklar.
  const kuyruklar = new Map<string, BekleyenKelime[]>();
  for (const k of bekleyenler) {
    const liste = kuyruklar.get(k.tip) ?? [];
    liste.push(k);
    kuyruklar.set(k.tip, liste);
  }

  const kalanVar = (): boolean => [...kuyruklar.values()].some((l) => l.length > 0);

  /**
   * Yuvaya kelime secer. Once TAM tip eslesmesi, sonra ayni tonlama sinifi.
   * Sinif disina cikilmaz: yanlis tonlama yuvasindan kesilen klip, uretilmemis
   * klipten daha kotudur — cumle ortasinda duyulur (§7.5 kural 5).
   */
  const al = (yuvaTipi: string): { kelime: BekleyenKelime; idealDegil: boolean } | null => {
    const tam = kuyruklar.get(yuvaTipi);
    if (tam && tam.length > 0) {
      return { kelime: tam.shift() as BekleyenKelime, idealDegil: false };
    }
    for (const [tip, liste] of kuyruklar) {
      if (tip === 'kalip' || liste.length === 0) continue;
      if (sinif(tip) === sinif(yuvaTipi)) {
        return { kelime: liste.shift() as BekleyenKelime, idealDegil: true };
      }
    }
    return null;
  };

  const kalipAl = (kalipMetni: string): BekleyenKelime | null => {
    const liste = kuyruklar.get('kalip');
    if (!liste) return null;
    const i = liste.findIndex((k) => k.kelime === kalipMetni.toLocaleLowerCase('tr-TR'));
    return i >= 0 ? (liste.splice(i, 1)[0] as BekleyenKelime) : null;
  };

  const tasiyicilar: Tasiyici[] = [];

  while (kalanVar()) {
    const yuvalar: PlanliYuva[] = [];
    let saklanan = 0;

    for (const tanim of yuvaTanimlari) {
      if (tanim.tur === 'kalip') {
        const kalip = kalipAl(tanim.ornek);
        yuvalar.push({
          yuva: tanim.yuva,
          metin: kalip ? kalip.telaffuz : tanim.ornek,
          klipId: kalip ? kalip.id : null,
          kelime: kalip ? kalip.kelime : null,
          tip: 'kalip',
          idealDegil: false,
        });
        if (kalip) saklanan++;
        continue;
      }

      const secim = al(tanim.tip);
      yuvalar.push({
        yuva: tanim.yuva,
        metin: secim ? secim.kelime.telaffuz : tanim.ornek,
        klipId: secim ? secim.kelime.id : null,
        kelime: secim ? secim.kelime.kelime : null,
        tip: secim ? secim.kelime.tip : tanim.tip,
        idealDegil: secim ? secim.idealDegil : false,
      });
      if (secim) saklanan++;
    }

    if (saklanan === 0) {
      // Kalan kelimelerin tipine uyan yuva yok. Sessizce sonsuz donguye
      // girmek yerine cagirana bildir: sablon eksik.
      const kalanTipler = [...kuyruklar.entries()]
        .filter(([, l]) => l.length > 0)
        .map(([t]) => t);
      throw new Error(
        `Şablonda şu tiplere uygun yuva yok: ${kalanTipler.join(', ')}. ` +
          'Bu kelimeler üretilemez; şablona uygun bir yuva ekleyin veya kelimelerin tipini düzeltin.',
      );
    }
    tasiyicilar.push({ yuvalar, saklanan });
  }

  return tasiyicilar;
}

/** Kac klip icin kac tasiyici gerekir — onay ekranindaki maliyet tahmini icin. */
export function tasiyiciSayisiTahmini(klipSayisi: number, degiskenYuvaSayisi: number): number {
  return Math.ceil(klipSayisi / Math.max(1, degiskenYuvaSayisi));
}

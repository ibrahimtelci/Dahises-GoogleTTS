// Tasiyici cumleden kesme — uretimin cekirdegi (§7.5, kritik kisit 1).
//
// Klip tek basina sentezlenmez. TTS "Mehmet"i yalniz uretirken onu bitmis bir
// cumle sayar: sonuna dusen tonlama, son hece uzatmasi, sonda catlak ses koyar.
// Bunun yerine parca tam bir cumlenin icinde urettirilir ve SSML <mark> zaman
// damgalariyla oradan kesilir; kesilen parca cumle ortasi tonlamasini tasir.
//
// prototip/kesme.js'den tasindi.

import { ORNEK_BAYT } from './pcm.ts';

/** Tasiyicidaki bir yuva: hangi tip ve o yuvaya konan metin. */
export type TasiyiciYuva = {
  /** Yuva adi — 'kalip:sayın', 'ad', 'soyad', 'sayi' gibi. Damga adi buradan turemez. */
  yuva: string;
  /** Yuvaya konan gorunur metin. SSML'e girmeden once KACIRILIR. */
  metin: string;
};

export type TasiyiciCumle = {
  ssml: string;
  yuvalar: TasiyiciYuva[];
  /** Google'in sayacagi karakter: SSML'in tamami, etiketler dahil (§6.4). */
  karakter: number;
};

export class KesmeHatasi extends Error {
  override name = 'KesmeHatasi';
}

/**
 * XML kacisi — TEK NOKTA (kritik kisit 10 / §7.5 kural 7).
 *
 * Kelime dogrudan SSML'e gomuluyor; icinde & < > " ' gecen bir kayit ya istegi
 * bozar ya da isaret yapisini sabote eder — ve tum kesme mantigi isaretlere
 * baglidir. Bu fonksiyon tasiyici kurucusunun ICINDE cagrilir; cagiranin
 * hatirlamasina birakilmaz.
 */
export function xmlKacir(metin: string): string {
  return String(metin)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Damga adi yuva sirasindan turer: m0, m1, ... */
export function damgaAdi(sira: number): string {
  return 'm' + String(sira);
}

/**
 * Tasiyici cumlenin SSML'ini kurar.
 *
 * Her ogeden ONCE bir isaret konur; bir ogenin bitisi bir sonrakinin
 * isaretinden alinir (§7.5 kural 2). Bitisik iki isaret Google tarafindan tek
 * damgaya indirgendigi icin bos yuva kabul edilmez.
 */
export function tasiyiciKur(
  yuvalar: TasiyiciYuva[],
  { sonNoktalama = '.' }: { sonNoktalama?: string } = {},
): TasiyiciCumle {
  if (yuvalar.length === 0) {
    throw new KesmeHatasi('Taşıyıcı en az bir yuva içermeli.');
  }

  const parcalar: string[] = ['<speak>'];

  for (const [i, yuva] of yuvalar.entries()) {
    const metin = String(yuva.metin).trim();
    if (metin.length === 0) {
      throw new KesmeHatasi(
        `Yuva "${yuva.yuva}" boş. Bitişik iki işaret Google tarafından tek damgaya ` +
          'indirgenir ve kesme bozulur (§7.5 kural 2).',
      );
    }
    const sonMu = i === yuvalar.length - 1;
    parcalar.push(`<mark name="${damgaAdi(i)}"/>`);
    parcalar.push(xmlKacir(metin));
    parcalar.push(sonMu ? xmlKacir(sonNoktalama) : ' ');
  }

  parcalar.push('</speak>');
  const ssml = parcalar.join('');

  return { ssml, yuvalar: yuvalar.map((y) => ({ ...y })), karakter: ssml.length };
}

/** Google v1beta1 yanitindaki zaman damgasi. */
export type Damga = { markName: string; timeSeconds: number };

export type KesilmisParca = {
  yuva: string;
  metin: string;
  pcm: Buffer;
  baslangicMs: number;
  /** Kuyruk payi DAHIL bitis. */
  bitisMs: number;
};

export type KesmeSecenekleri = {
  hiz: number;
  /**
   * Parcanin sonuna, bir sonraki damganin otesinden eklenen pay (§7.5 kural 4).
   * Damga kelimenin METIN sinirini verir; son unsuzun birakilisi o noktadan
   * sonra biter. Pay verilmezse kelime sonlari kesik duyulur. Bu pay
   * birlestirmede crossfade ile eritilir (§7.6), tekrar duyulmaz.
   *
   * DIKKAT: pay bir sonraki kelimenin baslangicini da icerir. Araya es
   * koyulacaksa pay ONCE kirpilmalidir (§7.6) — yoksa kekeleme duyulur.
   */
  kuyrukMs: number;
};

/**
 * Damgalar arasindaki dilimleri cikarir.
 *
 * Kesilen parcaya sessizlik kirpma UYGULANMAZ (kritik kisit 2).
 */
export function parcalariKes(
  pcm: Buffer,
  damgalar: Damga[],
  yuvalar: TasiyiciYuva[],
  { hiz, kuyrukMs }: KesmeSecenekleri,
): KesilmisParca[] {
  if (damgalar.length === 0) {
    throw new KesmeHatasi(
      'Yanıtta hiç zaman damgası yok. Chirp 3 HD sesleri SSML <mark> etiketlerini ' +
        'sessizce yok sayar ve bu mimaride kullanılamaz (§6.6). ' +
        'Ayrıca v1beta1 uç noktası ve enableTimePointing:[SSML_MARK] alanını doğrula.',
    );
  }

  const zaman = new Map(damgalar.map((d) => [d.markName, Number(d.timeSeconds)]));

  // Tum damgalar sifirsa ses uretilmis ama isaretler yok sayilmis demektir.
  if ([...zaman.values()].every((v) => v === 0)) {
    throw new KesmeHatasi(
      'Bütün zaman damgaları sıfır — ses işaretleri yok sayıyor (Chirp 3 HD davranışı, §6.6).',
    );
  }

  const toplamSn = pcm.length / ORNEK_BAYT / hiz;
  const ornekBayt = (sn: number): number =>
    Math.max(0, Math.min(pcm.length, Math.round(sn * hiz) * ORNEK_BAYT));

  const parcalar: KesilmisParca[] = [];

  for (let i = 0; i < yuvalar.length; i++) {
    const yuva = yuvalar[i] as TasiyiciYuva;
    const bas = zaman.get(damgaAdi(i));
    if (bas === undefined) {
      throw new KesmeHatasi(
        `"${damgaAdi(i)}" işareti yanıtta yok — yuva "${yuva.yuva}" kesilemedi. ` +
          'Bitişik işaretler tek damgaya indirgenmiş olabilir (§7.5 kural 2).',
      );
    }

    const sonDamga = zaman.get(damgaAdi(i + 1)) ?? toplamSn;
    const sonMu = i === yuvalar.length - 1;
    const son = sonMu ? toplamSn : Math.min(toplamSn, sonDamga + kuyrukMs / 1000);

    parcalar.push({
      yuva: yuva.yuva,
      metin: yuva.metin,
      pcm: pcm.subarray(ornekBayt(bas), ornekBayt(son)),
      baslangicMs: Math.round(bas * 1000),
      bitisMs: Math.round(son * 1000),
    });
  }

  return parcalar;
}

/**
 * Bir tasiyicinin karakter maliyetini onceden hesaplar — onay ekrani icin.
 * Google SSML etiketlerini de sayar (§6.4).
 */
export function tasiyiciMaliyeti(yuvalar: TasiyiciYuva[]): number {
  return tasiyiciKur(yuvalar).karakter;
}

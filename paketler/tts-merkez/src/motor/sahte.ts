// Sahte ses motoru — testler ve Google'sız geliştirme icin.
//
// Sinus uretir ve SSML <mark> etiketlerine gercekci zaman damgalari doner:
// her yuvanin suresi metin uzunluguyla orantilidir. Boylece kesme mantigi
// Google'a hic gitmeden uctan uca test edilebilir.
//
// Cagri sayaci tutar — testin kac istek attigini dogrulamak icin.

import { floatToPcm } from '../ses/pcm.ts';
import type { Damga } from '../ses/kesme.ts';
import {
  MotorHatasi,
  type MotorSesi,
  type SentezSonucu,
  type SesMotoru,
  type SesProfili,
} from './arayuz.ts';

export type SahteAyarlari = {
  /** Karakter basina sure — gercekci bir konusma hizi. */
  saniyeBasinaKarakter?: number;
  /** Kac cagridan sonra hata uretilsin (hata yolu testleri icin). */
  hataUret?: (cagriNo: number) => MotorHatasi | null;
  /** Damgalari sifirla — Chirp 3 HD davranisini taklit eder (§6.6). */
  damgalariSifirla?: boolean;
  /** Hic damga dondurme. */
  damgasiz?: boolean;
};

export class SahteMotor implements SesMotoru {
  readonly ad = 'sahte';
  #cagri = 0;
  #karakter = 0;
  readonly #ayar: SahteAyarlari;

  constructor(ayar: SahteAyarlari = {}) {
    this.#ayar = ayar;
  }

  get cagriSayisi(): number {
    return this.#cagri;
  }

  get harcananKarakter(): number {
    return this.#karakter;
  }

  sifirla(): void {
    this.#cagri = 0;
    this.#karakter = 0;
  }

  async sentezle(metin: string, profil: SesProfili): Promise<SentezSonucu> {
    this.#sayacArtir(metin.length);
    const sure = this.#sure(metin);
    return {
      pcm: this.#sinus(sure, profil.ornekHizi, 220),
      karakter: metin.length,
      damgalar: [],
    };
  }

  async ssmlSentezle(ssml: string, profil: SesProfili, _klipSayisi = 1): Promise<SentezSonucu> {
    this.#sayacArtir(ssml.length);

    const yuvalar = ssmlYuvalariniAyristir(ssml);
    if (yuvalar.length === 0) {
      throw new MotorHatasi('Sahte motor: SSML içinde <mark> bulunamadı.');
    }

    const damgalar: Damga[] = [];
    let konum = 0;
    const parcalar: Buffer[] = [];

    for (const [i, yuva] of yuvalar.entries()) {
      damgalar.push({
        markName: yuva.isaret,
        timeSeconds: this.#ayar.damgalariSifirla ? 0 : konum,
      });
      const sure = this.#sure(yuva.metin);
      // Her yuva farkli frekansta — dilimlemenin dogru yerden kestigi olculebilir.
      parcalar.push(this.#sinus(sure, profil.ornekHizi, 180 + i * 40));
      konum += sure;
    }

    return {
      pcm: Buffer.concat(parcalar),
      karakter: ssml.length,
      damgalar: this.#ayar.damgasiz ? [] : damgalar,
    };
  }

  async sesleriListele(dilKodu: string): Promise<MotorSesi[]> {
    this.#cagri++;
    return [
      { ad: `${dilKodu}-Standard-A`, dilKodlari: [dilKodu], cinsiyet: 'FEMALE', dogalOrnekHizi: 24000, tiyer: 'standard', kesmeDestegi: true },
      { ad: `${dilKodu}-Standard-B`, dilKodlari: [dilKodu], cinsiyet: 'MALE', dogalOrnekHizi: 24000, tiyer: 'standard', kesmeDestegi: true },
      { ad: `${dilKodu}-Wavenet-D`, dilKodlari: [dilKodu], cinsiyet: 'FEMALE', dogalOrnekHizi: 24000, tiyer: 'wavenet', kesmeDestegi: true },
      { ad: `${dilKodu}-Chirp3-HD-Aoede`, dilKodlari: [dilKodu], cinsiyet: 'FEMALE', dogalOrnekHizi: 24000, tiyer: 'chirp3hd', kesmeDestegi: false },
    ];
  }

  #sayacArtir(karakter: number): void {
    this.#cagri++;
    this.#karakter += karakter;
    const hata = this.#ayar.hataUret?.(this.#cagri);
    if (hata) throw hata;
  }

  #sure(metin: string): number {
    const oran = this.#ayar.saniyeBasinaKarakter ?? 14;
    return Math.max(0.08, metin.trim().length / oran);
  }

  #sinus(sn: number, hiz: number, frekans: number): Buffer {
    const n = Math.round(hiz * sn);
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = 0.5 * Math.sin((2 * Math.PI * frekans * i) / hiz);
    return floatToPcm(f);
  }
}

/** SSML'deki isaret + onu izleyen metni cikarir. Sahte motor ve testler kullanir. */
export function ssmlYuvalariniAyristir(ssml: string): Array<{ isaret: string; metin: string }> {
  const sonuc: Array<{ isaret: string; metin: string }> = [];
  const desen = /<mark name="([^"]+)"\/>([^<]*)/g;
  let eslesme: RegExpExecArray | null;
  while ((eslesme = desen.exec(ssml)) !== null) {
    sonuc.push({ isaret: eslesme[1] as string, metin: (eslesme[2] as string).trim() });
  }
  return sonuc;
}

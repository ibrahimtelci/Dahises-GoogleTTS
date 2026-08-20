// Ses motoru arayuzu (§6.6).
//
// Google'a ozgu hicbir sey bu arayuzun disina sizmaz; yarin Polly'ye gecmek
// tek dosya degistirir. Uretim hatti ve deneme ekrani yalniz bu tipleri gorur.

import type { Damga } from '../ses/kesme.ts';

export type Tiyer = 'standard' | 'wavenet' | 'chirp3hd';

/** Profil tanimi — veritabanindan gelir, koda gomulmez. */
export type SesProfili = {
  id: string;
  motor: string;
  motorSesi: string;
  tiyer: Tiyer;
  ornekHizi: number;
};

export type SentezSonucu = {
  /** Ham PCM: mono, 16-bit signed LE, profilin ornek hizinda. */
  pcm: Buffer;
  /** Bu cagrida Google'in sayacagi karakter (SSML etiketleri dahil). */
  karakter: number;
  /** Yalniz SSML sentezinde dolar. */
  damgalar: Damga[];
};

export type MotorSesi = {
  ad: string;
  dilKodlari: string[];
  cinsiyet: string;
  dogalOrnekHizi: number;
  tiyer: Tiyer | 'bilinmeyen';
  /** Kesme yontemini destekliyor mu — Chirp 3 HD desteklemiyor (§6.6). */
  kesmeDestegi: boolean;
};

export interface SesMotoru {
  readonly ad: string;

  /** Duz metni seslendirir. Deneme ekranindaki "gercek" surum bunu kullanir. */
  sentezle(metin: string, profil: SesProfili): Promise<SentezSonucu>;

  /**
   * SSML'i seslendirir ve <mark> zaman damgalarini doner (§7.5).
   * v1beta1 + enableTimePointing gerektirir.
   */
  ssmlSentezle(ssml: string, profil: SesProfili, klipSayisi: number): Promise<SentezSonucu>;

  /** Canli ses listesi — arayuzde elle yazilmaz (§9F). */
  sesleriListele(dilKodu: string): Promise<MotorSesi[]>;
}

export class MotorHatasi extends Error {
  override name = 'MotorHatasi';
  readonly durumKodu: number | undefined;
  /** 429/5xx gibi gecici hatalarda true — ustel geri cekilme uygulanir (§7.5 kural 9). */
  readonly gecici: boolean;

  constructor(mesaj: string, secenekler: { durumKodu?: number; gecici?: boolean } = {}) {
    super(mesaj);
    this.durumKodu = secenekler.durumKodu;
    this.gecici = secenekler.gecici ?? false;
  }
}

export class ButceHatasi extends Error {
  override name = 'ButceHatasi';
}

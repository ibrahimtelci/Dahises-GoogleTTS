// Motor vekili — ici calisma aninda degistirilebilen SesMotoru sarmalayicisi.
//
// Neden gerekli: rotalar `const { motor } = app.baglam` diye kayit aninda
// destructure ediyor. Motoru dogrudan degistirmek o referansi guncellemez.
// Vekil sabit bir nesne olarak kalir, icindeki gercek motor degisir.
//
// Boylece Google API anahtari ayarlar ekranindan degistirilince sunucuyu
// yeniden baslatmaya gerek kalmaz.

import type { MotorSesi, SentezSonucu, SesMotoru, SesProfili } from './arayuz.ts';

export class MotorVekili implements SesMotoru {
  #ic: SesMotoru;

  constructor(baslangic: SesMotoru) {
    this.#ic = baslangic;
  }

  /** Icteki gercek motoru degistirir. Destructure edilmis referanslar gecerli kalir. */
  degistir(yeni: SesMotoru): void {
    this.#ic = yeni;
  }

  /** Su anki gercek motor — tanilama ve `ad` gosterimi icin. */
  get gercek(): SesMotoru {
    return this.#ic;
  }

  get ad(): string {
    return this.#ic.ad;
  }

  async sentezle(metin: string, profil: SesProfili): Promise<SentezSonucu> {
    return this.#ic.sentezle(metin, profil);
  }

  async ssmlSentezle(
    ssml: string,
    profil: SesProfili,
    klipSayisi: number,
  ): Promise<SentezSonucu> {
    return this.#ic.ssmlSentezle(ssml, profil, klipSayisi);
  }

  async sesleriListele(dilKodu: string): Promise<MotorSesi[]> {
    return this.#ic.sesleriListele(dilKodu);
  }
}

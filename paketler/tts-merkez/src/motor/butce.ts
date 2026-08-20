// Gelistirme butce bekcisi — Google'a giden toplam klip sayisini sert sinirlar.
//
// Gorev kisiti: gelistirme boyunca Google'a giden toplam cagri 50 KLIBI
// gecmeyecek. Sayac diske yazilir; surec yeniden baslayinca sifirlanmaz —
// yoksa "her kosuda 50" olur ve sinir anlamsizlasir.
//
// Bu, §6.4'teki aylik KOTA sayacindan ayri ve ondan once calisan ikinci bir
// duvardir. Kota tiyer bazli ve aylik; bu ise gelistirme turunun tamamina ait.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { ButceHatasi } from './arayuz.ts';

export type ButceDurumu = {
  klip: number;
  klipSiniri: number;
  karakter: number;
  cagri: number;
  kalanKlip: number;
  guncellendi: string;
};

type ButceDosyasi = {
  klip: number;
  karakter: number;
  cagri: number;
  guncellendi: string;
};

const BOS: ButceDosyasi = { klip: 0, karakter: 0, cagri: 0, guncellendi: '' };

export class ButceBekcisi {
  readonly #yol: string;
  readonly #siniri: number;
  readonly #cagriSiniri: number;
  #durum: ButceDosyasi = { ...BOS };
  #yuklendi = false;

  /**
   * @param klipSiniri Bankaya SAKLANACAK klip sayisi tavani.
   * @param cagriSiniri Toplam istek tavani. Bir tasiyici cagrisi birden fazla
   *   dilim uretir ama yalniz saklananlar klip olur; bu ikinci tavan, tek dilim
   *   saklayan cok sayida cagrinin sinirdan kacmasini onler.
   */
  constructor(dosyaYolu: string, klipSiniri: number, cagriSiniri = klipSiniri) {
    this.#yol = dosyaYolu;
    this.#siniri = klipSiniri;
    this.#cagriSiniri = cagriSiniri;
  }

  static varsayilanYol(bankaDizini: string): string {
    return join(dirname(bankaDizini), 'google-butce.json');
  }

  async yukle(): Promise<void> {
    if (this.#yuklendi) return;
    try {
      const ham = await readFile(this.#yol, 'utf8');
      const okunan = JSON.parse(ham) as Partial<ButceDosyasi>;
      this.#durum = {
        klip: Number(okunan.klip ?? 0),
        karakter: Number(okunan.karakter ?? 0),
        cagri: Number(okunan.cagri ?? 0),
        guncellendi: String(okunan.guncellendi ?? ''),
      };
    } catch {
      this.#durum = { ...BOS };
    }
    this.#yuklendi = true;
  }

  durum(): ButceDurumu {
    return {
      klip: this.#durum.klip,
      klipSiniri: this.#siniri,
      karakter: this.#durum.karakter,
      cagri: this.#durum.cagri,
      kalanKlip: Math.max(0, this.#siniri - this.#durum.klip),
      guncellendi: this.#durum.guncellendi,
    };
  }

  /**
   * Cagridan ONCE calisir. Butce yetmiyorsa istek hic gonderilmez.
   *
   * @param klipSayisi Bu cagrinin uretecegi klip sayisi (tasiyicidaki yuva sayisi;
   *                   duz metin sentezinde 1).
   */
  async harca(klipSayisi: number, karakter: number): Promise<void> {
    await this.yukle();
    const yeni = this.#durum.klip + klipSayisi;
    if (yeni > this.#siniri) {
      throw new ButceHatasi(
        `Google geliştirme bütçesi aşılacaktı: sınır ${this.#siniri} klip, ` +
          `harcanan ${this.#durum.klip}, bu çağrı ${klipSayisi} klip isterdi. ` +
          'İstek gönderilmedi. Sınır GOOGLE_KLIP_BUTCESI ile yönetilir; ' +
          'yükseltmek proje sahibinin kararıdır.',
      );
    }
    if (this.#durum.cagri + 1 > this.#cagriSiniri) {
      throw new ButceHatasi(
        `Google geliştirme bütçesi aşılacaktı: çağrı tavanı ${this.#cagriSiniri}, ` +
          `yapılan ${this.#durum.cagri}. İstek gönderilmedi.`,
      );
    }
    this.#durum = {
      klip: yeni,
      karakter: this.#durum.karakter + karakter,
      cagri: this.#durum.cagri + 1,
      guncellendi: new Date().toISOString(),
    };
    await this.#yaz();
  }

  /** Butce yeter mi — istek gondermeden sormak icin (onay ekrani). */
  async yeterMi(klipSayisi: number): Promise<boolean> {
    await this.yukle();
    return this.#durum.klip + klipSayisi <= this.#siniri;
  }

  async #yaz(): Promise<void> {
    await mkdir(dirname(this.#yol), { recursive: true });
    const gecici = this.#yol + '.' + process.pid + '.tmp';
    await writeFile(gecici, JSON.stringify(this.#durum, null, 2), 'utf8');
    await rename(gecici, this.#yol);
  }
}

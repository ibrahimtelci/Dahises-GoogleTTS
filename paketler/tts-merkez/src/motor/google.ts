// Google Cloud TTS adaptoru — REST, sifir SDK bagimliligi (Node yerlesik fetch).
//
// v1beta1 ZORUNLU (kritik kisit 1 / §7.5 kural 1): enableTimePointing alani
// v1'de yok, 400 "Unknown name" doner.
//
// prototip/src/google.js'den tasindi; butce bekcisi, hiz siniri ve geri
// cekilme eklendi.

import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { riffPcmCikar } from '../ses/pcm.ts';
import type { Damga } from '../ses/kesme.ts';
import {
  MotorHatasi,
  type MotorSesi,
  type SentezSonucu,
  type SesMotoru,
  type SesProfili,
  type Tiyer,
} from './arayuz.ts';
import type { ButceBekcisi } from './butce.ts';
import { HizSinirlayici } from './hiz-sinirlayici.ts';

const UC = 'https://texttospeech.googleapis.com/v1beta1';

export type GoogleAyarlari = {
  apiAnahtari?: string | undefined;
  servisHesabiYolu?: string | undefined;
  dilKodu: string;
  eszamanlilik: number;
  saniyedeIstek: number;
  butce: ButceBekcisi;
  /** Gecici hatada kac kez yeniden denensin (istek ici). */
  denemeSayisi?: number;
  fetchUygulamasi?: typeof fetch;
};

type SentezYaniti = {
  audioContent?: string;
  timepoints?: Array<{ markName?: string; timeSeconds?: number }>;
};

type SesYaniti = {
  voices?: Array<{
    name?: string;
    languageCodes?: string[];
    ssmlGender?: string;
    naturalSampleRateHertz?: number;
  }>;
};

/** Ses adindan tiyeri cikarir: tr-TR-Wavenet-D -> wavenet. */
export function sesTiyeri(sesAdi: string): Tiyer | 'bilinmeyen' {
  const ad = sesAdi.toLowerCase();
  if (ad.includes('chirp')) return 'chirp3hd';
  if (ad.includes('wavenet')) return 'wavenet';
  if (ad.includes('standard')) return 'standard';
  return 'bilinmeyen';
}

/** Chirp 3 HD isaretlere sifir damga donuyor — kesme yontemi calismiyor (§6.6). */
export function kesmeDestekliyorMu(sesAdi: string): boolean {
  return sesTiyeri(sesAdi) !== 'chirp3hd';
}

export class GoogleMotoru implements SesMotoru {
  readonly ad = 'google';
  readonly #ayar: GoogleAyarlari;
  readonly #sinirlayici: HizSinirlayici;
  readonly #fetch: typeof fetch;
  #tokenOnbellek: { token: string; bitis: number } | null = null;

  constructor(ayar: GoogleAyarlari) {
    this.#ayar = ayar;
    this.#sinirlayici = new HizSinirlayici({
      eszamanlilik: ayar.eszamanlilik,
      saniyedeIstek: ayar.saniyedeIstek,
    });
    this.#fetch = ayar.fetchUygulamasi ?? globalThis.fetch;
  }

  async sentezle(metin: string, profil: SesProfili): Promise<SentezSonucu> {
    return this.#sentez({ input: { text: metin } }, profil, metin.length, 1);
  }

  async ssmlSentezle(
    ssml: string,
    profil: SesProfili,
    klipSayisi: number,
  ): Promise<SentezSonucu> {
    if (!kesmeDestekliyorMu(profil.motorSesi)) {
      throw new MotorHatasi(
        `${profil.motorSesi} kesme yöntemini desteklemiyor: SSML <mark> etiketlerine ` +
          'sıfır zaman damgası dönüyor (§6.6). Bu ses bu mimaride kullanılamaz.',
      );
    }
    return this.#sentez(
      { input: { ssml }, enableTimePointing: ['SSML_MARK'] },
      profil,
      ssml.length,
      klipSayisi,
    );
  }

  async sesleriListele(dilKodu: string): Promise<MotorSesi[]> {
    const veri = (await this.#istek(
      '/voices?languageCode=' + encodeURIComponent(dilKodu),
      undefined,
    )) as SesYaniti;

    return (veri.voices ?? []).map((s) => {
      const ad = String(s.name ?? '');
      return {
        ad,
        dilKodlari: s.languageCodes ?? [],
        cinsiyet: String(s.ssmlGender ?? 'BELIRSIZ'),
        dogalOrnekHizi: Number(s.naturalSampleRateHertz ?? 0),
        tiyer: sesTiyeri(ad),
        kesmeDestegi: kesmeDestekliyorMu(ad),
      };
    });
  }

  async #sentez(
    govdeParcasi: Record<string, unknown>,
    profil: SesProfili,
    karakter: number,
    klipSayisi: number,
  ): Promise<SentezSonucu> {
    // Butce cagridan ONCE rezerve edilir; istek hic gitmeyebilir.
    await this.#ayar.butce.harca(klipSayisi, karakter);

    const govde = {
      ...govdeParcasi,
      voice: { languageCode: this.#ayar.dilKodu, name: profil.motorSesi },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: profil.ornekHizi },
    };

    const veri = (await this.#istek('/text:synthesize', govde)) as SentezYaniti;

    if (!veri.audioContent) {
      throw new MotorHatasi('Google yanıtında ses verisi yok.');
    }

    const pcm = riffPcmCikar(Buffer.from(veri.audioContent, 'base64'));
    const damgalar: Damga[] = (veri.timepoints ?? []).map((d) => ({
      markName: String(d.markName ?? ''),
      timeSeconds: Number(d.timeSeconds ?? 0),
    }));

    return { pcm, karakter, damgalar };
  }

  async #istek(yol: string, govde: unknown): Promise<unknown> {
    const denemeSayisi = this.#ayar.denemeSayisi ?? 3;
    let sonHata: MotorHatasi | null = null;

    for (let deneme = 1; deneme <= denemeSayisi; deneme++) {
      try {
        return await this.#sinirlayici.calistir(() => this.#hamIstek(yol, govde));
      } catch (hata) {
        if (!(hata instanceof MotorHatasi) || !hata.gecici || deneme === denemeSayisi) throw hata;
        sonHata = hata;
        // Istek ici kisa geri cekilme; kalici basarisizlikta kuyruk
        // klip.sonraki_deneme'yi dakikalar olceginde ileri atar (§9A).
        await new Promise((coz) => setTimeout(coz, 250 * 2 ** (deneme - 1)));
      }
    }

    throw sonHata ?? new MotorHatasi('Google isteği başarısız.');
  }

  async #hamIstek(yol: string, govde: unknown): Promise<unknown> {
    let url = UC + yol;
    const basliklar: Record<string, string> = { 'content-type': 'application/json' };

    if (this.#ayar.apiAnahtari) {
      url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(this.#ayar.apiAnahtari);
    } else if (this.#ayar.servisHesabiYolu) {
      basliklar['authorization'] = 'Bearer ' + (await this.#servisHesabiTokeni());
    } else {
      throw new MotorHatasi(
        'Google kimliği yok. .env içinde GOOGLE_TTS_API_KEY veya ' +
          'GOOGLE_APPLICATION_CREDENTIALS tanımla.',
      );
    }

    let yanit: Response;
    try {
      yanit = await this.#fetch(url, {
        method: govde ? 'POST' : 'GET',
        headers: basliklar,
        body: govde ? JSON.stringify(govde) : undefined,
      });
    } catch (hata) {
      // Ag hatasi gecicidir.
      throw new MotorHatasi('Google\'a ulaşılamadı: ' + (hata as Error).message, { gecici: true });
    }

    if (!yanit.ok) {
      const metin = (await yanit.text()).slice(0, 500);
      const gecici = yanit.status === 429 || yanit.status >= 500;
      throw new MotorHatasi(`Google TTS ${yanit.status}: ${metin}`, {
        durumKodu: yanit.status,
        gecici,
      });
    }

    return yanit.json();
  }

  async #servisHesabiTokeni(): Promise<string> {
    if (this.#tokenOnbellek && this.#tokenOnbellek.bitis > Date.now() + 60_000) {
      return this.#tokenOnbellek.token;
    }

    const yol = this.#ayar.servisHesabiYolu as string;
    const anahtar = JSON.parse(await readFile(yol, 'utf8')) as {
      client_email: string;
      private_key: string;
    };
    const simdi = Math.floor(Date.now() / 1000);
    const b64url = (x: string | Buffer): string =>
      Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const baslik = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const iddia = b64url(
      JSON.stringify({
        iss: anahtar.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: simdi + 3600,
        iat: simdi,
      }),
    );
    // sign() kodlama verilmezse Buffer doner; b64url onu dogrudan alir.
    // Base64 string verip tekrar base64'lemek imzayi bozar.
    const imza = b64url(createSign('RSA-SHA256').update(baslik + '.' + iddia).sign(anahtar.private_key));

    const yanit = await this.#fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: baslik + '.' + iddia + '.' + imza,
      }),
    });

    if (!yanit.ok) {
      throw new MotorHatasi('OAuth başarısız: ' + yanit.status + ' ' + (await yanit.text()));
    }

    const veri = (await yanit.json()) as { access_token: string; expires_in: number };
    this.#tokenOnbellek = {
      token: veri.access_token,
      bitis: Date.now() + veri.expires_in * 1000,
    };
    return this.#tokenOnbellek.token;
  }
}

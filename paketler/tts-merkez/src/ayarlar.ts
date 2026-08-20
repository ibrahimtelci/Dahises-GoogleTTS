// Calisma aninda degistirilebilen sistem ayarlari (migrasyon 007).
//
// Oncelik: veritabani > .env. Tablo bosken .env gecerli kalir.

import type { Db } from './veritabani/baglanti.ts';
import type { Yapilandirma } from './yapilandirma.ts';
import type { ButceBekcisi } from './motor/butce.ts';
import type { SesMotoru } from './motor/arayuz.ts';
import { GoogleMotoru } from './motor/google.ts';
import { SahteMotor } from './motor/sahte.ts';
import type { MotorVekili } from './motor/vekil.ts';

export const AYAR_ANAHTARLARI = ['google_api_anahtari', 'google_servis_hesabi'] as const;
export type AyarAnahtari = (typeof AYAR_ANAHTARLARI)[number];

export type MotorKimligi = {
  apiAnahtari: string | undefined;
  servisHesabiYolu: string | undefined;
  /** Deger nereden geldi — arayuzde gosterilir. */
  kaynak: 'veritabani' | 'env' | 'yok';
};

/** Tek bir ayari okur; yoksa undefined. */
export async function ayarOku(db: Db, anahtar: AyarAnahtari): Promise<string | undefined> {
  const satirlar = await db<{ deger: string | null }[]>`
    SELECT deger FROM sistem_ayari WHERE anahtar = ${anahtar}
  `;
  const deger = satirlar[0]?.deger;
  return deger && deger.trim() !== '' ? deger : undefined;
}

/** Ayari yazar. `deger` bos/null ise satir silinir ve .env'e geri dusulur. */
export async function ayarYaz(
  db: Db,
  anahtar: AyarAnahtari,
  deger: string | null,
  kullaniciId: number | null,
): Promise<void> {
  if (deger === null || deger.trim() === '') {
    await db`DELETE FROM sistem_ayari WHERE anahtar = ${anahtar}`;
    return;
  }
  await db`
    INSERT INTO sistem_ayari (anahtar, deger, guncelleyen, guncellendi)
    VALUES (${anahtar}, ${deger.trim()}, ${kullaniciId}, now())
    ON CONFLICT (anahtar) DO UPDATE
      SET deger = EXCLUDED.deger,
          guncelleyen = EXCLUDED.guncelleyen,
          guncellendi = now()
  `;
}

/** Gecerli motor kimligi: once veritabani, sonra .env. */
export async function motorKimligiCoz(db: Db, ayar: Yapilandirma): Promise<MotorKimligi> {
  const dbAnahtar = await ayarOku(db, 'google_api_anahtari');
  const dbHesap = await ayarOku(db, 'google_servis_hesabi');

  if (dbAnahtar || dbHesap) {
    return { apiAnahtari: dbAnahtar, servisHesabiYolu: dbHesap, kaynak: 'veritabani' };
  }
  if (ayar.GOOGLE_TTS_API_KEY || ayar.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      apiAnahtari: ayar.GOOGLE_TTS_API_KEY,
      servisHesabiYolu: ayar.GOOGLE_APPLICATION_CREDENTIALS,
      kaynak: 'env',
    };
  }
  return { apiAnahtari: undefined, servisHesabiYolu: undefined, kaynak: 'yok' };
}

/** Kimlikten motor uretir. Kimlik yoksa SahteMotor — panel yine acilir. */
export function motorKur(
  kimlik: MotorKimligi,
  ayar: Yapilandirma,
  butce: ButceBekcisi,
): SesMotoru {
  if (kimlik.kaynak === 'yok') return new SahteMotor();
  return new GoogleMotoru({
    apiAnahtari: kimlik.apiAnahtari,
    servisHesabiYolu: kimlik.servisHesabiYolu,
    dilKodu: ayar.DIL_KODU,
    eszamanlilik: ayar.GOOGLE_ESZAMANLILIK,
    saniyedeIstek: ayar.GOOGLE_ISTEK_HIZI_SN,
    butce,
  });
}

/** Ayar degisince motoru yeniden kurar. Vekil sayesinde yeniden baslatma gerekmez. */
export async function motoruYenile(
  vekil: MotorVekili,
  db: Db,
  ayar: Yapilandirma,
  butce: ButceBekcisi,
): Promise<MotorKimligi> {
  const kimlik = await motorKimligiCoz(db, ayar);
  vekil.degistir(motorKur(kimlik, ayar, butce));
  return kimlik;
}

/** Anahtari arayuzde gostermek icin maskeler: son 4 karakter disi gizli. */
export function maskele(deger: string | undefined): string {
  if (!deger) return '—';
  if (deger.length <= 4) return '****';
  return '••••••••' + deger.slice(-4);
}

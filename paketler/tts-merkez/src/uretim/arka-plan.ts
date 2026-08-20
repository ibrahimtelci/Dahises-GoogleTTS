// Arka plan isleri: bayat pending supurucusu ve uretim dongusu (§9B).
//
// Sessizce takili kalan bir uretim, fark edilmeyen bir uretimdir.

import type { Db } from '../veritabani/baglanti.ts';
import { bayatlariSupur, kotaBekleyenleriGeriAl } from './kuyruk.ts';
import { yuvalariTanimla } from './planlayici.ts';
import { topluUretimeIzinVar } from './kota.ts';
import type { Gunlukcu, Uretici } from './uretici.ts';
import { varsayilanSablon } from '../web/rotalar/ortak.ts';
import type { SesProfili, Tiyer } from '../motor/arayuz.ts';

export type ArkaPlanAyarlari = {
  supurucuAralikSn: number;
  bayatPendingDk: number;
  /** Uretim dongusu araligi. 0 = kapali (elle tetikleme). */
  uretimAralikSn?: number;
};

export class ArkaPlanIsleri {
  readonly #db: Db;
  readonly #uretici: Uretici;
  readonly #gunluk: Gunlukcu;
  readonly #ayar: ArkaPlanAyarlari;
  #zamanlayicilar: NodeJS.Timeout[] = [];
  #uretimKosuyor = false;

  constructor(db: Db, uretici: Uretici, gunluk: Gunlukcu, ayar: ArkaPlanAyarlari) {
    this.#db = db;
    this.#uretici = uretici;
    this.#gunluk = gunluk;
    this.#ayar = ayar;
  }

  basla(): void {
    const supurucu = setInterval(() => {
      void this.supur();
    }, this.#ayar.supurucuAralikSn * 1000);
    supurucu.unref();
    this.#zamanlayicilar.push(supurucu);

    const uretimAralik = this.#ayar.uretimAralikSn ?? 30;
    if (uretimAralik > 0) {
      const uretim = setInterval(() => {
        void this.uretimTuru();
      }, uretimAralik * 1000);
      uretim.unref();
      this.#zamanlayicilar.push(uretim);
    }
  }

  durdur(): void {
    for (const z of this.#zamanlayicilar) clearInterval(z);
    this.#zamanlayicilar = [];
  }

  async supur(): Promise<void> {
    try {
      const supurulen = await bayatlariSupur(this.#db, this.#ayar.bayatPendingDk);
      if (supurulen > 0) {
        this.#gunluk.warn({ adet: supurulen }, 'bayat pending süpürüldü');
        await this.#db`
          INSERT INTO uretim_gunlugu (tur, klip_sayisi, basarili, hata)
          VALUES ('supurucu', ${supurulen}, false, 'sahiplenme zaman aşımı')
        `;
      }

      const geriAlinan = await kotaBekleyenleriGeriAl(this.#db);
      if (geriAlinan > 0) {
        this.#gunluk.info({ adet: geriAlinan }, 'kota yenilendi, bekleyenler geri alındı');
      }
    } catch (hata) {
      this.#gunluk.error({ hata: (hata as Error).message }, 'süpürücü hatası');
    }
  }

  /** Bekleyen klipleri uretir. Ayni anda tek tur calisir. */
  async uretimTuru(): Promise<void> {
    if (this.#uretimKosuyor) return;
    this.#uretimKosuyor = true;

    try {
      const profiller = await this.#db<
        { id: string; motor: string; motor_sesi: string; tiyer: string; ornek_hizi: number }[]
      >`
        SELECT id, motor, motor_sesi, tiyer, ornek_hizi FROM ses_profili WHERE aktif
      `;
      if (profiller.length === 0) return;

      const sablon = await varsayilanSablon(this.#db);
      const yuvalar = yuvalariTanimla(sablon.metin, sablon.ornekler, sablon.tipler);

      for (const p of profiller) {
        const bekleyen = await this.#db<{ adet: string }[]>`
          SELECT count(*)::text AS adet FROM klip
           WHERE profil = ${p.id} AND durum IN ('pending', 'failed')
             AND sonraki_deneme <= now()
        `;
        if (Number(bekleyen[0]?.adet ?? 0) === 0) continue;

        // %85 kritik esikte yeni TOPLU uretim durur (§6.4).
        if (!(await topluUretimeIzinVar(this.#db, p.tiyer))) {
          this.#gunluk.warn({ tiyer: p.tiyer }, 'kota kritik eşikte — toplu üretim atlandı');
          continue;
        }

        const profil: SesProfili = {
          id: p.id,
          motor: p.motor,
          motorSesi: p.motor_sesi,
          tiyer: p.tiyer as Tiyer,
          ornekHizi: Number(p.ornek_hizi),
        };

        const sonuc = await this.#uretici.partiUret(profil, yuvalar);
        if (sonuc.uretilen > 0 || sonuc.basarisiz > 0 || sonuc.kotaBekleyen > 0) {
          this.#gunluk.info(
            {
              profil: p.id,
              uretilen: sonuc.uretilen,
              basarisiz: sonuc.basarisiz,
              kotaBekleyen: sonuc.kotaBekleyen,
              tasiyici: sonuc.tasiyici,
            },
            'üretim turu tamamlandı',
          );
          await this.#db`
            INSERT INTO uretim_gunlugu (tur, profil, tiyer, klip_sayisi, karakter, basarili, hata)
            VALUES ('tasiyici', ${p.id}, ${p.tiyer}, ${sonuc.uretilen}, ${sonuc.karakter},
                    ${sonuc.basarisiz === 0 && sonuc.kotaBekleyen === 0},
                    ${sonuc.hatalar.length > 0 ? sonuc.hatalar.join(' | ').slice(0, 500) : null})
          `;
        }
      }
    } catch (hata) {
      this.#gunluk.error({ hata: (hata as Error).message }, 'üretim turu hatası');
    } finally {
      this.#uretimKosuyor = false;
    }
  }
}

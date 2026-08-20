// Uretim hatti (§9D).
//
//   bekleyenleri sahiplen
//     -> TASIYICI CUMLEYE yerlestir, SSML <mark> ile isaretle
//     -> kota dus (cagridan ONCE, atomik)
//     -> v1beta1 text:synthesize + enableTimePointing
//     -> zaman damgalarindan parcalari kes, 50 ms kuyruk payi birak
//     -> seviye normalize et   [sessizlik KIRPMA — kesilmis parcaya uygulanmaz]
//     -> klibi ATOMIK yaz (gecici -> fsync -> rename)
//     -> parti halinde banka_surum artir ve 'ready' yap

import { ButceHatasi, MotorHatasi, type SesMotoru, type SesProfili } from '../motor/arayuz.ts';
import { geriCekilmeDakika } from '../motor/hiz-sinirlayici.ts';
import type { KlipDeposu } from '../depo/klip-deposu.ts';
import { parcalariKes, tasiyiciKur } from '../ses/kesme.ts';
import { pcmUzunlukMs, seviyeNormalize } from '../ses/pcm.ts';
import type { Db } from '../veritabani/baglanti.ts';
import { KotaDoluHatasi, kotaDus, kotaIade } from './kota.ts';
import { basarisizIsaretle, kotaBekliyorIsaretle, partiSahiplen } from './kuyruk.ts';
import { tasiyicilariPlanla, type BekleyenKelime, type Tasiyici, type YuvaTanimi } from './planlayici.ts';
import { partiyiHazirYap, type HazirKlip } from './surum.ts';

export type UreticiAyarlari = {
  kuyrukMs: number;
  denemeSiniri: number;
  sahiplenmeYasiSn: number;
  partiBoyutu: number;
};

export type UretimSonucu = {
  uretilen: number;
  basarisiz: number;
  kotaBekleyen: number;
  karakter: number;
  tasiyici: number;
  hatalar: string[];
};

export type Gunlukcu = {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
};

export class Uretici {
  readonly #db: Db;
  readonly #motor: SesMotoru;
  readonly #depo: KlipDeposu;
  readonly #ayar: UreticiAyarlari;
  readonly #gunluk: Gunlukcu;

  constructor(
    db: Db,
    motor: SesMotoru,
    depo: KlipDeposu,
    ayar: UreticiAyarlari,
    gunluk: Gunlukcu,
  ) {
    this.#db = db;
    this.#motor = motor;
    this.#depo = depo;
    this.#ayar = ayar;
    this.#gunluk = gunluk;
  }

  /** Kuyruktan bir parti alip uretir. Hicbir sey yoksa sifirlarla doner. */
  async partiUret(
    profil: SesProfili,
    yuvaTanimlari: YuvaTanimi[],
    { adet }: { adet?: number } = {},
  ): Promise<UretimSonucu> {
    const satirlar = await partiSahiplen(this.#db, profil.id, adet ?? this.#ayar.partiBoyutu, {
      denemeSiniri: this.#ayar.denemeSiniri,
      sahiplenmeYasiSn: this.#ayar.sahiplenmeYasiSn,
    });

    if (satirlar.length === 0) {
      return { uretilen: 0, basarisiz: 0, kotaBekleyen: 0, karakter: 0, tasiyici: 0, hatalar: [] };
    }

    const bekleyenler: BekleyenKelime[] = await Promise.all(
      satirlar.map(async (s) => ({
        id: Number(s.id),
        kelime: s.kelime,
        telaffuz: s.telaffuz ?? s.kelime,
        tip: await this.#tipBul(Number(s.id)),
      })),
    );

    return this.tasiyicilariUret(profil, tasiyicilariPlanla(bekleyenler, yuvaTanimlari));
  }

  /** Planlanmis tasiyicilari uretir. Deneme ekrani da bunu kullanir. */
  async tasiyicilariUret(profil: SesProfili, tasiyicilar: Tasiyici[]): Promise<UretimSonucu> {
    const sonuc: UretimSonucu = {
      uretilen: 0,
      basarisiz: 0,
      kotaBekleyen: 0,
      karakter: 0,
      tasiyici: 0,
      hatalar: [],
    };

    const hazirlar: HazirKlip[] = [];

    for (const tasiyici of tasiyicilar) {
      const klipIdler = tasiyici.yuvalar
        .map((y) => y.klipId)
        .filter((x): x is number => x !== null);

      try {
        const uretilenler = await this.#tekTasiyiciUret(profil, tasiyici);
        hazirlar.push(...uretilenler);
        sonuc.tasiyici++;
        sonuc.karakter += uretilenler.length > 0 ? (uretilenler[0]?.karakter ?? 0) : 0;
      } catch (hata) {
        if (hata instanceof KotaDoluHatasi) {
          // Kalan tokenlar kaybolmaz; ertesi ay kota yenilenince devam edilir (§9D).
          await kotaBekliyorIsaretle(this.#db, klipIdler);
          sonuc.kotaBekleyen += klipIdler.length;
          sonuc.hatalar.push(hata.message);
          this.#gunluk.warn({ tiyer: profil.tiyer }, 'kota sert limiti — üretim durdu');
          break;
        }

        if (hata instanceof ButceHatasi) {
          await kotaBekliyorIsaretle(this.#db, klipIdler);
          sonuc.kotaBekleyen += klipIdler.length;
          sonuc.hatalar.push(hata.message);
          this.#gunluk.warn({}, 'Google geliştirme bütçesi doldu — üretim durdu');
          break;
        }

        const mesaj = (hata as Error).message;
        const gecici = hata instanceof MotorHatasi && hata.gecici;
        for (const id of klipIdler) {
          const satir = await this.#denemeSayisi(id);
          await basarisizIsaretle(this.#db, id, mesaj, gecici ? geriCekilmeDakika(satir) : 60);
        }
        sonuc.basarisiz += klipIdler.length;
        sonuc.hatalar.push(mesaj);
        this.#gunluk.error({ gecici, hata: mesaj }, 'taşıyıcı üretimi başarısız');
      }
    }

    // Parti halinde tek versiyon artisi (§A.2) — nextval() yok.
    if (hazirlar.length > 0) {
      await partiyiHazirYap(
        this.#db,
        profil.id,
        hazirlar.map((h) => ({ id: h.id, hash: h.hash, sureMs: h.sureMs })),
      );
      sonuc.uretilen = hazirlar.length;
    }

    return sonuc;
  }

  async #tekTasiyiciUret(
    profil: SesProfili,
    tasiyici: Tasiyici,
  ): Promise<Array<HazirKlip & { karakter: number }>> {
    const { ssml, yuvalar, karakter } = tasiyiciKur(tasiyici.yuvalar);

    // Kota cagridan ONCE ve atomik (§6.4 Katman 1). Satir donmezse cagri yok.
    await kotaDus(this.#db, profil.tiyer, karakter);

    let yanit;
    try {
      // Butce SAKLANACAK klip sayisini sayar; dolgu dilimleri bankaya girmez.
      yanit = await this.#motor.ssmlSentezle(ssml, profil, tasiyici.saklanan);
    } catch (hata) {
      // Ses uretilmedi — dusulen karakteri geri ver, sayac gercegi yansitsin.
      await kotaIade(this.#db, profil.tiyer, karakter);
      throw hata;
    }

    const parcalar = parcalariKes(yanit.pcm, yanit.damgalar, yuvalar, {
      hiz: profil.ornekHizi,
      kuyrukMs: this.#ayar.kuyrukMs,
    });

    const cikti: Array<HazirKlip & { karakter: number }> = [];

    for (const [i, parca] of parcalar.entries()) {
      const planli = tasiyici.yuvalar[i];
      if (!planli || planli.klipId === null) continue; // dolgu dilimi — atilir

      // Seviye normalize EDILIR, sessizlik kirpma UYGULANMAZ (kritik kisit 2).
      const pcm = seviyeNormalize(parca.pcm);

      // ATOMIK: gecici -> fsync -> rename -> SONRA veritabani (kritik kisit 11).
      const { hash } = await this.#depo.yaz(profil.id, pcm);

      cikti.push({
        id: planli.klipId,
        hash,
        sureMs: pcmUzunlukMs(pcm, profil.ornekHizi),
        karakter,
      });
    }

    return cikti;
  }

  async #tipBul(klipId: number): Promise<string> {
    const satirlar = await this.#db<{ tip: string }[]>`
      SELECT tip FROM klip_kapsam WHERE klip_id = ${klipId} ORDER BY tip LIMIT 1
    `;
    return satirlar[0]?.tip ?? 'ad';
  }

  async #denemeSayisi(klipId: number): Promise<number> {
    const satirlar = await this.#db<{ deneme: number }[]>`
      SELECT deneme FROM klip WHERE id = ${klipId}
    `;
    return Number(satirlar[0]?.deneme ?? 1);
  }
}

// Tiyer bazli kota sayaci — sert durdurma (§6.4, kritik kisit 5).
//
// Standard 4M ile WaveNet 1M AYRI havuzlardir; tek sayacla izlenemez.
// Kontrol her Google cagrisindan ONCE ve atomik SQL ile yapilir: satir
// donmezse cagri yapilmaz.
//
// Sert limit kotanin tamami degil %90'i: Google bosluklari, noktalamayi ve
// SSML etiketlerini de sayar, ayrica ay donumu saat farki olabilir.

import type { Db } from '../veritabani/baglanti.ts';

export type KotaDurumu = {
  tiyer: string;
  tiyerAdi: string;
  donem: string;
  kullanilan: number;
  limitSert: number;
  limitToplam: number;
  kalan: number;
  yuzde: number;
  bant: 'normal' | 'uyari' | 'kritik' | 'dolu';
  uyariEsigi: number;
  kritikEsik: number;
  sifirlanma: string;
  kesmeDestegi: boolean;
};

export class KotaDoluHatasi extends Error {
  override name = 'KotaDoluHatasi';
  readonly tiyer: string;
  constructor(tiyer: string, istenen: number, mesaj?: string) {
    super(
      mesaj ??
        `${tiyer} tiyerinde aylık kota sert limitine ulaşıldı (${istenen} karakter istendi). ` +
          'Google çağrısı yapılmadı. Kota ayın 1\'inde yenilenir (§6.4).',
    );
    this.tiyer = tiyer;
  }
}

/** Donemin ilk gunu — kota satirinin anahtari. */
export function donem(tarih: Date = new Date()): string {
  return `${tarih.getUTCFullYear()}-${String(tarih.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Kota satirini yoksa acar. Limitler tiyer tanimindan turer, koda gomulmez. */
export async function kotaSatiriniHazirla(db: Db, tiyer: string): Promise<void> {
  await db`
    INSERT INTO kota (tiyer, donem, kullanilan, limit_sert, limit_toplam)
    SELECT t.kod,
           date_trunc('month', now())::date,
           0,
           floor(t.aylik_kota * t.sert_oran)::bigint,
           t.aylik_kota
      FROM tiyer t
     WHERE t.kod = ${tiyer}
    ON CONFLICT (tiyer, donem) DO NOTHING
  `;
}

/**
 * Kotayi cagridan ONCE ve atomik olarak dusur (§6.4 Katman 1).
 *
 * Satir donmezse cagri YAPILMAZ. RETURNING ile atomik oldugu icin eszamanli
 * isteklerde yaris durumu olusmaz.
 */
export async function kotaDus(
  db: Db,
  tiyer: string,
  karakter: number,
): Promise<{ kullanilan: number; limitSert: number }> {
  await kotaSatiriniHazirla(db, tiyer);

  const satirlar = await db<{ kullanilan: string; limit_sert: string }[]>`
    UPDATE kota
       SET kullanilan = kullanilan + ${karakter},
           guncellendi = now()
     WHERE tiyer = ${tiyer}
       AND donem = date_trunc('month', now())::date
       AND kullanilan + ${karakter} <= limit_sert
    RETURNING kullanilan, limit_sert
  `;

  const satir = satirlar[0];
  if (!satir) throw new KotaDoluHatasi(tiyer, karakter);

  return { kullanilan: Number(satir.kullanilan), limitSert: Number(satir.limit_sert) };
}

/**
 * Harcanmayan karakteri iade eder.
 *
 * Kota cagridan once dusuluyor; istek hic gitmediyse (butce reddi, gecici ag
 * hatasi) dusulen miktar geri verilmezse sayac gercekten harcanmamis karakteri
 * kalici olarak yer.
 */
export async function kotaIade(db: Db, tiyer: string, karakter: number): Promise<void> {
  await db`
    UPDATE kota
       SET kullanilan = greatest(0, kullanilan - ${karakter}),
           guncellendi = now()
     WHERE tiyer = ${tiyer}
       AND donem = date_trunc('month', now())::date
  `;
}

/** Kota paneli icin tum tiyerlerin durumu. */
export async function kotaDurumu(db: Db): Promise<KotaDurumu[]> {
  const satirlar = await db<
    {
      kod: string;
      ad: string;
      aylik_kota: string;
      uyari_oran: string;
      kritik_oran: string;
      kesme_destegi: boolean;
      donem: Date | null;
      kullanilan: string | null;
      limit_sert: string | null;
      limit_toplam: string | null;
    }[]
  >`
    SELECT t.kod, t.ad, t.aylik_kota, t.uyari_oran, t.kritik_oran, t.kesme_destegi,
           k.donem, k.kullanilan, k.limit_sert, k.limit_toplam
      FROM tiyer t
      LEFT JOIN kota k
        ON k.tiyer = t.kod AND k.donem = date_trunc('month', now())::date
     ORDER BY t.aylik_kota DESC, t.kod
  `;

  return satirlar.map((s) => {
    const toplam = Number(s.limit_toplam ?? s.aylik_kota);
    const sert = Number(s.limit_sert ?? Math.floor(Number(s.aylik_kota) * 0.9));
    const kullanilan = Number(s.kullanilan ?? 0);
    const uyariEsigi = Math.floor(toplam * Number(s.uyari_oran));
    const kritikEsik = Math.floor(toplam * Number(s.kritik_oran));

    let bant: KotaDurumu['bant'] = 'normal';
    if (kullanilan >= sert) bant = 'dolu';
    else if (kullanilan >= kritikEsik) bant = 'kritik';
    else if (kullanilan >= uyariEsigi) bant = 'uyari';

    const simdi = new Date();
    const sonraki = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth() + 1, 1));

    return {
      tiyer: s.kod,
      tiyerAdi: s.ad,
      donem: donem(),
      kullanilan,
      limitSert: sert,
      limitToplam: toplam,
      kalan: Math.max(0, sert - kullanilan),
      yuzde: sert > 0 ? Math.min(100, (kullanilan / sert) * 100) : 0,
      bant,
      uyariEsigi,
      kritikEsik,
      sifirlanma: sonraki.toISOString().slice(0, 10),
      kesmeDestegi: s.kesme_destegi,
    };
  });
}

/**
 * Yeni TOPLU uretim baslatilabilir mi? %85 kritik esikte toplu uretim durur
 * (§6.4), tekil fallback uretimi %90'a kadar devam eder.
 */
export async function topluUretimeIzinVar(db: Db, tiyer: string): Promise<boolean> {
  const hepsi = await kotaDurumu(db);
  const d = hepsi.find((x) => x.tiyer === tiyer);
  return d ? d.bant === 'normal' || d.bant === 'uyari' : false;
}

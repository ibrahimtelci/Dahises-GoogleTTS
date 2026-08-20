// Uretim kuyrugu — Redis yok (kritik kisit 12). Kuyruk `klip` tablosunda,
// sahiplenme ve FOR UPDATE SKIP LOCKED ile.
//
// Durumlar: pending -> uretiliyor -> ready | failed | engellendi | kota_bekliyor

import type { Db } from '../veritabani/baglanti.ts';
import { kucukHarf } from '../ses/metin.ts';

export type KlipDurumu =
  | 'pending'
  | 'uretiliyor'
  | 'ready'
  | 'failed'
  | 'engellendi'
  | 'kota_bekliyor';

export type KlipSatiri = {
  id: number;
  kelime: string;
  telaffuz: string | null;
  profil: string;
  durum: KlipDurumu;
  hash: string | null;
  sure_ms: number | null;
  surum: number | null;
  kaynak: string;
  deneme: number;
  hata: string | null;
};

/**
 * Kapsam hastane kurali TEK NOKTADA yasar (§9B).
 *
 * Toplu uretim ve fallback yolunda ayri ayri yazilmamali — iki yolun
 * ayrismasi bu hatanin kaynagiydi.
 */
export function kapsamHastaneId(tip: string, hastaneId: number): number {
  return tip === 'doktor' || tip === 'poliklinik' ? hastaneId : 0;
}

/** Kelimeyi kuyruga ekler (idempotent). Zaten varsa dokunmaz. */
export async function kuyrugaEkle(
  db: Db,
  kelime: string,
  profil: string,
  tip: string,
  { hastaneId = 0, kaynak = 'toplu' }: { hastaneId?: number; kaynak?: string } = {},
): Promise<{ id: number; yeni: boolean }> {
  const anahtar = kucukHarf(kelime);

  const eklenen = await db<{ id: number }[]>`
    INSERT INTO klip (kelime, profil, durum, kaynak)
    VALUES (${anahtar}, ${profil}, 'pending', ${kaynak})
    ON CONFLICT (kelime, profil) DO NOTHING
    RETURNING id
  `;

  let id: number;
  let yeni: boolean;

  if (eklenen[0]) {
    id = Number(eklenen[0].id);
    yeni = true;
  } else {
    const mevcut = await db<{ id: number }[]>`
      SELECT id FROM klip WHERE kelime = ${anahtar} AND profil = ${profil}
    `;
    id = Number((mevcut[0] as { id: number }).id);
    yeni = false;
  }

  // Kapsam HER istekte yazilir, klip zaten varsa bile (§9B).
  await db`
    INSERT INTO klip_kapsam (klip_id, tip, hastane_id)
    VALUES (${id}, ${tip}, ${kapsamHastaneId(tip, hastaneId)})
    ON CONFLICT (klip_id, tip, hastane_id) DO NOTHING
  `;

  return { id, yeni };
}

/**
 * Uretilecek klipleri sahiplenir.
 *
 * FOR UPDATE SKIP LOCKED: birden fazla isci ayni satiri almaz.
 * `sonraki_deneme <= now()` filtresi ustel geri cekilmeyi uygular — bu kolon
 * olmadan tek bir kalici hata kotayi ve API limitini yakar (§9A).
 */
export async function partiSahiplen(
  db: Db,
  profil: string,
  adet: number,
  { denemeSiniri, sahiplenmeYasiSn }: { denemeSiniri: number; sahiplenmeYasiSn: number },
): Promise<KlipSatiri[]> {
  return db.begin(async (tx) => {
    const adaylar = await tx<{ id: number }[]>`
      SELECT id FROM klip
       WHERE profil = ${profil}
         AND deneme < ${denemeSiniri}
         AND sonraki_deneme <= now()
         AND (
              durum = 'pending' AND (sahiplenildi IS NULL
                                     OR sahiplenildi < now() - make_interval(secs => ${sahiplenmeYasiSn}))
           OR durum = 'failed'
           OR durum = 'kota_bekliyor'
         )
       ORDER BY (durum = 'pending') DESC, olusturuldu
       LIMIT ${adet}
       FOR UPDATE SKIP LOCKED
    `;

    if (adaylar.length === 0) return [];

    const idler = adaylar.map((a) => Number(a.id));

    return tx<KlipSatiri[]>`
      UPDATE klip
         SET durum = 'uretiliyor',
             sahiplenildi = now(),
             deneme = deneme + 1
       WHERE id = ANY(${idler}::bigint[])
      RETURNING id, kelime, telaffuz, profil, durum, hash, sure_ms, surum, kaynak, deneme, hata
    `;
  }) as Promise<KlipSatiri[]>;
}

/**
 * Tek klibi sahiplenme (§9B single-flight).
 *
 * Satir donduyse uretimi sen sahiplendin. Donmediyse baskasi uretiyor ya da
 * klip zaten hazir — cagiran mevcut durumu okur.
 */
export async function tekSahiplen(
  db: Db,
  kelime: string,
  profil: string,
  { denemeSiniri, sahiplenmeYasiSn }: { denemeSiniri: number; sahiplenmeYasiSn: number },
): Promise<{ id: number; deneme: number } | null> {
  const anahtar = kucukHarf(kelime);

  const satirlar = await db<{ id: number; deneme: number }[]>`
    INSERT INTO klip (kelime, profil, durum, sahiplenildi, deneme, kaynak)
    VALUES (${anahtar}, ${profil}, 'pending', now(), 1, 'fallback')
    ON CONFLICT (kelime, profil) DO UPDATE
       SET durum = 'pending',
           sahiplenildi = now(),
           deneme = klip.deneme + 1
     WHERE (klip.durum = 'failed' AND klip.deneme < ${denemeSiniri})
        OR (klip.durum = 'pending'
            AND klip.sahiplenildi < now() - make_interval(secs => ${sahiplenmeYasiSn}))
    RETURNING id, deneme
  `;

  const s = satirlar[0];
  return s ? { id: Number(s.id), deneme: Number(s.deneme) } : null;
}

/** Basarisizlik: geri cekilmeyi ileri at (§9A). */
export async function basarisizIsaretle(
  db: Db,
  klipId: number,
  hata: string,
  geriCekilmeDk: number,
): Promise<void> {
  await db`
    UPDATE klip
       SET durum = 'failed',
           hata = ${hata.slice(0, 500)},
           sonraki_deneme = now() + make_interval(mins => ${geriCekilmeDk})
     WHERE id = ${klipId}
  `;
}

/** Kota dolu: klip kaybolmaz, ertesi ay kota yenilenince devam edilir (§9D). */
export async function kotaBekliyorIsaretle(db: Db, klipIdler: number[]): Promise<void> {
  if (klipIdler.length === 0) return;
  await db`
    UPDATE klip
       SET durum = 'kota_bekliyor',
           hata = 'aylık kota sert limiti',
           sonraki_deneme = date_trunc('month', now()) + interval '1 month'
     WHERE id = ANY(${klipIdler}::bigint[])
  `;
}

export async function engelle(db: Db, klipId: number, sebep: string): Promise<void> {
  await db`
    UPDATE klip SET durum = 'engellendi', hata = ${sebep} WHERE id = ${klipId}
  `;
}

/**
 * Bayat 'pending' supurucusu (§9B).
 *
 * Sessizce takili kalan bir uretim, fark edilmeyen bir uretimdir.
 * 'uretiliyor' da ayni sekilde kurtarilir: isci coktuyse satir orada kalir.
 */
export async function bayatlariSupur(db: Db, bayatDk: number): Promise<number> {
  const satirlar = await db<{ id: number }[]>`
    UPDATE klip
       SET durum = 'failed',
           hata = 'sahiplenme zaman aşımı',
           sonraki_deneme = now()
     WHERE durum IN ('pending', 'uretiliyor')
       AND sahiplenildi IS NOT NULL
       AND sahiplenildi < now() - make_interval(mins => ${bayatDk})
    RETURNING id
  `;
  return satirlar.length;
}

/** Kota yenilendiginde bekleyenleri geri al. */
export async function kotaBekleyenleriGeriAl(db: Db): Promise<number> {
  const satirlar = await db<{ id: number }[]>`
    UPDATE klip
       SET durum = 'pending', hata = NULL, sahiplenildi = NULL, sonraki_deneme = now()
     WHERE durum = 'kota_bekliyor' AND sonraki_deneme <= now()
    RETURNING id
  `;
  return satirlar.length;
}

export async function durumSayilari(db: Db): Promise<Record<string, number>> {
  const satirlar = await db<{ durum: string; adet: string }[]>`
    SELECT durum, count(*)::text AS adet FROM klip GROUP BY durum
  `;
  return Object.fromEntries(satirlar.map((s) => [s.durum, Number(s.adet)]));
}

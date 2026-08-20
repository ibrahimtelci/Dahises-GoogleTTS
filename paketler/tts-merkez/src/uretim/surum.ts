// Banka versiyonlama (§A.2).
//
// nextval() / sequence KULLANILMAZ. Buradaki guvenlik UPDATE banka_surum'un
// transaction boyunca SATIR KILIDI tutmasindan gelir: versiyon alma sirasi ile
// commit sirasi ayni olur. Sequence'e cevrilirse numara alma sirasi commit
// sirasindan ayrisir ve sessiz klip kaybi baslar — hastane 11'i gorup senkron
// olur, 10 numarali klip sonra commit eder ve delta sorgusunda (surum > 11) bir
// daha asla gorunmez. Bu bir optimizasyon degil, veri kaybidir.
//
// Yan etki: ayni kilit, ayni profildeki uretimleri serilestirir. Bu yuzden
// toplu uretim PARTI halinde commit edilir: N klip, tek versiyon artisi.

import type { Db } from '../veritabani/baglanti.ts';

export type HazirKlip = {
  id: number;
  hash: string;
  sureMs: number;
};

/** Profilin versiyon satirini yoksa acar. */
export async function surumSatiriniHazirla(db: Db, profil: string): Promise<void> {
  await db`
    INSERT INTO banka_surum (profil, surum) VALUES (${profil}, 0)
    ON CONFLICT (profil) DO NOTHING
  `;
}

/**
 * Bir partiyi tek transaction'da, tek versiyon artisiyla 'ready' yapar.
 *
 * `deneme = 0` ZORUNLU (§A.2): sifirlanmazsa iki kez basarisiz olup ucuncude
 * uretilen bir klip deneme=3 ile kalir ve ileride yeniden uretim gerektiginde
 * sahiplenmedeki `deneme < 3` kosulu o satiri kalici olarak kilitler.
 */
export async function partiyiHazirYap(
  db: Db,
  profil: string,
  klipler: HazirKlip[],
): Promise<number> {
  if (klipler.length === 0) return 0;

  await surumSatiriniHazirla(db, profil);

  return db.begin(async (tx) => {
    const surumSatiri = await tx<{ surum: number }[]>`
      UPDATE banka_surum SET surum = surum + 1 WHERE profil = ${profil} RETURNING surum
    `;
    const surum = Number((surumSatiri[0] as { surum: number }).surum);

    await tx`
      UPDATE klip AS k
         SET durum   = 'ready',
             surum   = ${surum},
             hash    = g.hash,
             sure_ms = g.sure_ms,
             hata    = NULL,
             deneme  = 0
        FROM (
          SELECT unnest(${klipler.map((k) => k.id)}::bigint[]) AS id,
                 unnest(${klipler.map((k) => k.hash)}::text[])   AS hash,
                 unnest(${klipler.map((k) => k.sureMs)}::int[])  AS sure_ms
        ) AS g
       WHERE k.id = g.id
    `;

    return surum;
  }) as Promise<number>;
}

/**
 * Kapsam gercekten genisledi ve klip zaten 'ready' ise klibi yeni bir
 * versiyona tasir (§9B). Aksi halde delta sorgusu (surum > $2) klibi yeni
 * kapsanan hastaneye HICBIR ZAMAN dondurmez.
 */
export async function kapsamGenisledigindeSurumArtir(
  db: Db,
  klipId: number,
  profil: string,
): Promise<number | null> {
  await surumSatiriniHazirla(db, profil);

  return db.begin(async (tx) => {
    const hazirMi = await tx<{ id: number }[]>`
      SELECT id FROM klip WHERE id = ${klipId} AND durum = 'ready'
    `;
    if (hazirMi.length === 0) return null;

    const s = await tx<{ surum: number }[]>`
      UPDATE banka_surum SET surum = surum + 1 WHERE profil = ${profil} RETURNING surum
    `;
    const surum = Number((s[0] as { surum: number }).surum);

    await tx`UPDATE klip SET surum = ${surum} WHERE id = ${klipId} AND durum = 'ready'`;
    return surum;
  }) as Promise<number | null>;
}

/** Hastanenin bildirdigi bankVersion'dan sonraki klipler (§A.2 delta sorgusu). */
export async function delta(
  db: Db,
  profil: string,
  surumdenSonra: number,
  hastaneId: number,
): Promise<Array<{ kelime: string; hash: string; sure_ms: number; surum: number }>> {
  return db`
    SELECT k.kelime, k.hash, k.sure_ms, k.surum
      FROM klip k
      JOIN klip_kapsam kk ON kk.klip_id = k.id
     WHERE k.profil = ${profil} AND k.durum = 'ready' AND k.surum > ${surumdenSonra}
       AND kk.hastane_id IN (0, ${hastaneId})
     ORDER BY k.surum
  ` as unknown as Promise<Array<{ kelime: string; hash: string; sure_ms: number; surum: number }>>;
}

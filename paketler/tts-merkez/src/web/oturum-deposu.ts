// PostgreSQL oturum deposu — Redis yok.
// @fastify/session'in bekledigi callback arayuzu.

import type { Db } from '../veritabani/baglanti.ts';

type Oturum = Record<string, unknown>;
type Geri = (hata?: Error | null, oturum?: Oturum | null) => void;

export class PgOturumDeposu {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  set(sid: string, oturum: Oturum, geri: Geri): void {
    const bitis =
      (oturum['cookie'] as { expires?: Date } | undefined)?.expires ??
      new Date(Date.now() + 12 * 60 * 60 * 1000);

    this.#db`
      INSERT INTO oturum (sid, veri, bitis)
      VALUES (${sid}, ${this.#db.json(oturum as never)}, ${bitis})
      ON CONFLICT (sid) DO UPDATE SET veri = EXCLUDED.veri, bitis = EXCLUDED.bitis
    `
      .then(() => geri(null))
      .catch((h: Error) => geri(h));
  }

  get(sid: string, geri: Geri): void {
    this.#db<{ veri: Oturum }[]>`
      SELECT veri FROM oturum WHERE sid = ${sid} AND bitis > now()
    `
      .then((satirlar) => geri(null, satirlar[0]?.veri ?? null))
      .catch((h: Error) => geri(h));
  }

  destroy(sid: string, geri: Geri): void {
    this.#db`DELETE FROM oturum WHERE sid = ${sid}`
      .then(() => geri(null))
      .catch((h: Error) => geri(h));
  }

  /** Suresi dolmus oturumlari temizler — periyodik is. */
  async temizle(): Promise<number> {
    const silinen = await this.#db<{ sid: string }[]>`
      DELETE FROM oturum WHERE bitis <= now() RETURNING sid
    `;
    return silinen.length;
  }
}

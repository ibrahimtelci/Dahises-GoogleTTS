// Google hiz siniri (§7.5 kural 9): eszamanlilik 5-10 + token bucket.
//
// Toplu uretim on binlerce klip demek; sinirsiz paralel istek 429 yagmuru
// uretir. Bu iki mekanizma birlikte calisir: semafor ayni anda kac istek
// oldugunu, kova saniyede kac istek baslatildigini sinirlar.

export class HizSinirlayici {
  readonly #eszamanlilikSiniri: number;
  readonly #saniyedeIstek: number;
  #aktif = 0;
  #kuyruk: Array<() => void> = [];
  #jeton: number;
  #sonDolum: number;

  constructor({
    eszamanlilik,
    saniyedeIstek,
  }: {
    eszamanlilik: number;
    saniyedeIstek: number;
  }) {
    this.#eszamanlilikSiniri = Math.max(1, eszamanlilik);
    this.#saniyedeIstek = Math.max(0.1, saniyedeIstek);
    this.#jeton = this.#saniyedeIstek;
    this.#sonDolum = Date.now();
  }

  async calistir<T>(is: () => Promise<T>): Promise<T> {
    await this.#slotAl();
    try {
      await this.#jetonBekle();
      return await is();
    } finally {
      this.#slotBirak();
    }
  }

  #slotAl(): Promise<void> {
    if (this.#aktif < this.#eszamanlilikSiniri) {
      this.#aktif++;
      return Promise.resolve();
    }
    return new Promise<void>((coz) => {
      this.#kuyruk.push(() => {
        this.#aktif++;
        coz();
      });
    });
  }

  #slotBirak(): void {
    this.#aktif--;
    const sonraki = this.#kuyruk.shift();
    if (sonraki) sonraki();
  }

  async #jetonBekle(): Promise<void> {
    for (;;) {
      const simdi = Date.now();
      const gecen = (simdi - this.#sonDolum) / 1000;
      this.#jeton = Math.min(this.#saniyedeIstek, this.#jeton + gecen * this.#saniyedeIstek);
      this.#sonDolum = simdi;

      if (this.#jeton >= 1) {
        this.#jeton -= 1;
        return;
      }

      const beklemeMs = Math.ceil(((1 - this.#jeton) / this.#saniyedeIstek) * 1000);
      await new Promise((coz) => setTimeout(coz, beklemeMs));
    }
  }
}

/** Ustel geri cekilme adimlari (§9A): 1 dk -> 5 dk -> 30 dk. */
export const GERI_CEKILME_DK = [1, 5, 30] as const;

export function geriCekilmeDakika(deneme: number): number {
  const i = Math.min(Math.max(deneme, 1), GERI_CEKILME_DK.length) - 1;
  return GERI_CEKILME_DK[i] as number;
}

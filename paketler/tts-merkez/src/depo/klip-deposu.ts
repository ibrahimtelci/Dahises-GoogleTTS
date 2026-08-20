// Icerik adresli klip deposu.
//
//   veri/banka/<profil>/<hash[0:2]>/<hash[2:4]>/<hash>.pcm
//
// Tek dizinde yuz binlerce dosya dosya sistemini bogar; parcali dizin bunu
// cozer, ayni icerik iki kez saklanmaz ve yol kolonu tutmaya gerek kalmaz.
//
// YAZIM ATOMIK (kritik kisit 11 / §7.5 kural 8):
//   gecici dosya -> fsync -> rename -> SONRA veritabanina 'ready'
// Ters sirada cokme, veritabaninda var olmayan dosyaya isaret birakir.

import { createHash } from 'node:crypto';
import { open, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function pcmHash(pcm: Buffer): string {
  return createHash('sha256').update(pcm).digest('hex');
}

export class KlipDeposu {
  readonly #kok: string;

  constructor(bankaDizini: string) {
    this.#kok = bankaDizini;
  }

  get kok(): string {
    return this.#kok;
  }

  /** Hash'ten dosya yolu turer; yol veritabaninda tutulmaz. */
  yol(profil: string, hash: string): string {
    return join(this.#kok, profil, hash.slice(0, 2), hash.slice(2, 4), hash + '.pcm');
  }

  /**
   * Klibi atomik yazar ve hash'ini doner.
   * Ayni icerik zaten varsa yeniden yazmaz.
   */
  async yaz(profil: string, pcm: Buffer): Promise<{ hash: string; yeni: boolean }> {
    const hash = pcmHash(pcm);
    const hedef = this.yol(profil, hash);

    if (await this.varMi(profil, hash)) return { hash, yeni: false };

    await mkdir(dirname(hedef), { recursive: true });
    const gecici = hedef + '.' + process.pid + '.' + Date.now() + '.tmp';

    const dosya = await open(gecici, 'w');
    try {
      await dosya.writeFile(pcm);
      await dosya.sync(); // fsync — rename'den ONCE
    } finally {
      await dosya.close();
    }

    try {
      await rename(gecici, hedef);
    } catch (hata) {
      await unlink(gecici).catch(() => {});
      throw hata;
    }

    return { hash, yeni: true };
  }

  async oku(profil: string, hash: string): Promise<Buffer> {
    return readFile(this.yol(profil, hash));
  }

  async varMi(profil: string, hash: string): Promise<boolean> {
    try {
      const s = await stat(this.yol(profil, hash));
      return s.isFile() && s.size > 0;
    } catch {
      return false;
    }
  }

  /** /saglik ucu icin: banka dizini yazilabilir mi? */
  async yazilabilirMi(): Promise<boolean> {
    const deneme = join(this.#kok, '.yazma-denemesi-' + process.pid);
    try {
      await mkdir(this.#kok, { recursive: true });
      const d = await open(deneme, 'w');
      await d.close();
      await unlink(deneme);
      return true;
    } catch {
      return false;
    }
  }
}

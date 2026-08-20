// Ses denemesi — CAPRAZ kurulum.
//
// DURUSTLUK KURALI (gorev tanimi, §7.5 "Dogrulama kurali"):
// Parcalar tek bir tasiyicidan kesilip AYNI cumle yeniden kurulursa sonuc
// yapay olarak kusursuz cikar ve hicbir sey kanitlamaz. Bu yuzden birlestirilmis
// surumun her parcasi FARKLI bir tasiyici cumleden gelir; bankada zaten varsa
// bankadaki klip kullanilir.

import type { KlipDeposu } from '../depo/klip-deposu.ts';
import type { SesMotoru, SesProfili } from '../motor/arayuz.ts';
import { parcalariKes, tasiyiciKur, type TasiyiciYuva } from '../ses/kesme.ts';
import { birlestir, pcmUzunlukMs, seviyeNormalize, wavYaz } from '../ses/pcm.ts';
import { kucukHarf } from '../ses/metin.ts';
import type { Db } from '../veritabani/baglanti.ts';
import { kotaDus, kotaIade } from '../uretim/kota.ts';

/** Capraz tasiyicilarda kullanilacak dolgu havuzu — deneme cumlesinden FARKLI. */
export const DOLGU_HAVUZU: Record<string, string[]> = {
  isim: ['Kemal', 'Selin', 'Barış', 'Nurten', 'Serkan', 'Deniz', 'Aylin', 'Tolga'],
  soyad: ['Aydın', 'Doğan', 'Kurt', 'Şimşek', 'Aslan', 'Bulut', 'Ateş', 'Koç'],
  sayi: ['iki', 'dört', 'altı', 'sekiz', 'dokuz', 'on bir', 'on üç', 'on beş'],
  ifade: ['danışmaya', 'poliklinik girişine', 'birinci kata', 'bekleme salonuna'],
};

export type ParcaKaynagi = 'banka' | 'yeni-tasiyici';

export type DenemeParcasi = {
  yuva: string;
  metin: string;
  kaynak: ParcaKaynagi;
  /** Kacinci capraz tasiyicidan geldigi (yeni-tasiyici ise). */
  tasiyiciNo: number | null;
  sureMs: number;
};

export type DenemeSonucu = {
  gercek: { wav: Buffer; sureMs: number; karakter: number };
  birlesik: { wav: Buffer; sureMs: number; karakter: number; parcalar: DenemeParcasi[] };
  toplamKarakter: number;
  cagriSayisi: number;
};

export type BirlestirmeAyari = {
  boslukMs: number;
  crossfadeMs: number;
  kuyrukMs: number;
};

/**
 * Deneme maliyetini ONCEDEN hesaplar — onay ekrani icin. Google'a gitmez.
 *
 * Bankada olan parca icin tasiyici kurulmaz; yalniz eksikler icin capraz
 * tasiyici gerekir. Ayrica "gercek" surum icin tam cumle bir kez sentezlenir.
 */
export async function denemeMaliyeti(
  db: Db,
  profil: SesProfili,
  yuvalar: TasiyiciYuva[],
): Promise<{ karakter: number; cagri: number; yeniKlip: number; bankadan: number }> {
  const duzCumle = yuvalar.map((y) => y.metin).join(' ') + '.';
  let karakter = duzCumle.length; // gercek surum
  let cagri = 1;
  let yeniKlip = 0;
  let bankadan = 0;

  for (const [i, yuva] of yuvalar.entries()) {
    if (await bankadaVarMi(db, yuva.metin, profil.id)) {
      bankadan++;
      continue;
    }
    karakter += tasiyiciKur(caprazTasiyiciKur(yuvalar, i)).karakter;
    cagri++;
    yeniKlip++;
  }

  return { karakter, cagri, yeniKlip, bankadan };
}

async function bankadaVarMi(db: Db, kelime: string, profil: string): Promise<boolean> {
  const satirlar = await db<{ hash: string }[]>`
    SELECT hash FROM klip
     WHERE kelime = ${kucukHarf(kelime)} AND profil = ${profil}
       AND durum = 'ready' AND hash IS NOT NULL
  `;
  return satirlar.length > 0;
}

async function bankadanOku(
  db: Db,
  depo: KlipDeposu,
  kelime: string,
  profil: string,
): Promise<Buffer | null> {
  const satirlar = await db<{ hash: string }[]>`
    SELECT hash FROM klip
     WHERE kelime = ${kucukHarf(kelime)} AND profil = ${profil}
       AND durum = 'ready' AND hash IS NOT NULL
  `;
  const hash = satirlar[0]?.hash;
  if (!hash) return null;
  try {
    return await depo.oku(profil, hash);
  } catch {
    return null;
  }
}

/**
 * i. yuva icin capraz tasiyici kurar: hedef kelime kendi yuvasinda kalir,
 * DIGER butun yuvalar dolgu havuzundan doldurulur. Boylece her parca farkli
 * bir cumleden gelir ve sonuc hic uretilmemis bir cumle olur.
 */
export function caprazTasiyiciKur(yuvalar: TasiyiciYuva[], hedefIndeks: number): TasiyiciYuva[] {
  return yuvalar.map((y, j) => {
    if (j === hedefIndeks) return { ...y };
    return { yuva: y.yuva, metin: dolguSec(y.yuva, hedefIndeks + j) };
  });
}

function dolguSec(yuvaAdi: string, tohum: number): string {
  const havuz =
    yuvaAdi === 'soyad'
      ? DOLGU_HAVUZU['soyad']
      : yuvaAdi === 'ad' || yuvaAdi === 'doktor'
        ? DOLGU_HAVUZU['isim']
        : yuvaAdi === 'sayi' || yuvaAdi === 'banko'
          ? DOLGU_HAVUZU['sayi']
          : yuvaAdi.startsWith('kalip:')
            ? [yuvaAdi.slice('kalip:'.length)] // kalip metni sabittir
            : DOLGU_HAVUZU['ifade'];
  const liste = havuz as string[];
  return liste[tohum % liste.length] as string;
}

/**
 * Iki surum uretir:
 *   gercek    — cumlenin tamami tek seferde sentezlenir
 *   birlesik  — her parca FARKLI bir tasiyicidan kesilir, sonra birlestirilir
 */
export async function denemeYap(
  { db, motor, depo }: { db: Db; motor: SesMotoru; depo: KlipDeposu },
  profil: SesProfili,
  yuvalar: TasiyiciYuva[],
  ayar: BirlestirmeAyari,
): Promise<DenemeSonucu> {
  let toplamKarakter = 0;
  let cagriSayisi = 0;

  // ── Gercek surum: cumlenin tamami tek seferde ──
  const duzCumle = yuvalar.map((y) => y.metin).join(' ') + '.';
  await kotaDus(db, profil.tiyer, duzCumle.length);
  let gercekPcm: Buffer;
  try {
    const yanit = await motor.sentezle(duzCumle, profil);
    gercekPcm = yanit.pcm;
    toplamKarakter += yanit.karakter;
    cagriSayisi++;
  } catch (hata) {
    await kotaIade(db, profil.tiyer, duzCumle.length);
    throw hata;
  }

  // ── Birlesik surum: her parca farkli tasiyicidan ──
  const parcalar: DenemeParcasi[] = [];
  const sesler: Buffer[] = [];

  for (const [i, yuva] of yuvalar.entries()) {
    const bankadaki = await bankadanOku(db, depo, yuva.metin, profil.id);

    if (bankadaki) {
      sesler.push(bankadaki);
      parcalar.push({
        yuva: yuva.yuva,
        metin: yuva.metin,
        kaynak: 'banka',
        tasiyiciNo: null,
        sureMs: pcmUzunlukMs(bankadaki, profil.ornekHizi),
      });
      continue;
    }

    const caprazYuvalar = caprazTasiyiciKur(yuvalar, i);
    const { ssml, yuvalar: kurulan, karakter } = tasiyiciKur(caprazYuvalar);

    await kotaDus(db, profil.tiyer, karakter);
    let yanit;
    try {
      yanit = await motor.ssmlSentezle(ssml, profil, 1);
    } catch (hata) {
      await kotaIade(db, profil.tiyer, karakter);
      throw hata;
    }
    toplamKarakter += yanit.karakter;
    cagriSayisi++;

    const kesilen = parcalariKes(yanit.pcm, yanit.damgalar, kurulan, {
      hiz: profil.ornekHizi,
      kuyrukMs: ayar.kuyrukMs,
    });

    // Kesilen parcaya sessizlik kirpma UYGULANMAZ (kritik kisit 2).
    const pcm = seviyeNormalize((kesilen[i] as { pcm: Buffer }).pcm);
    sesler.push(pcm);
    parcalar.push({
      yuva: yuva.yuva,
      metin: yuva.metin,
      kaynak: 'yeni-tasiyici',
      tasiyiciNo: i + 1,
      sureMs: pcmUzunlukMs(pcm, profil.ornekHizi),
    });
  }

  // §7.6: 0 ms bosluk, 45 ms crossfade, sifir gecis acik.
  const birlesikPcm = birlestir(sesler, {
    hiz: profil.ornekHizi,
    boslukMs: ayar.boslukMs,
    crossfadeMs: ayar.crossfadeMs,
    sifirGecis: true,
  });

  return {
    gercek: {
      wav: wavYaz(gercekPcm, profil.ornekHizi),
      sureMs: pcmUzunlukMs(gercekPcm, profil.ornekHizi),
      karakter: duzCumle.length,
    },
    birlesik: {
      wav: wavYaz(birlesikPcm, profil.ornekHizi),
      sureMs: pcmUzunlukMs(birlesikPcm, profil.ornekHizi),
      karakter: toplamKarakter - duzCumle.length,
      parcalar,
    },
    toplamKarakter,
    cagriSayisi,
  };
}

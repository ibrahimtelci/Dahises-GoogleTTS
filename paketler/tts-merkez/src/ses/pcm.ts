// Ham PCM (mono, 16-bit signed LE) üzerinde in-process ses işleme.
// Harici process yok (kritik kısıt 7) — hepsi buffer manipülasyonu.
//
// prototip/src/ses.js'den taşındı; davranış birebir korundu.

export const ORNEK_BAYT = 2;

export function pcmUzunlukSn(pcm: Buffer, hiz: number): number {
  return pcm.length / ORNEK_BAYT / hiz;
}

export function pcmUzunlukMs(pcm: Buffer, hiz: number): number {
  return Math.round(pcmUzunlukSn(pcm, hiz) * 1000);
}

// PCM <-> Float32 (-1..1). DSP'yi float üzerinde yapmak taşmayı önler.
export function pcmToFloat(pcm: Buffer): Float32Array {
  const n = Math.floor(pcm.length / ORNEK_BAYT);
  const cikti = new Float32Array(n);
  for (let i = 0; i < n; i++) cikti[i] = pcm.readInt16LE(i * ORNEK_BAYT) / 32768;
  return cikti;
}

export function floatToPcm(f: Float32Array): Buffer {
  const pcm = Buffer.allocUnsafe(f.length * ORNEK_BAYT);
  for (let i = 0; i < f.length; i++) {
    let d = Math.round((f[i] as number) * 32768);
    if (d > 32767) d = 32767;
    if (d < -32768) d = -32768;
    pcm.writeInt16LE(d, i * ORNEK_BAYT);
  }
  return pcm;
}

// ── WAV ────────────────────────────────────────────────────────────────────

/** PCM'e 44 baytlik baslik ekler; tarayici <audio> ile dogrudan calar. */
export function wavYaz(pcm: Buffer, hiz: number): Buffer {
  const baslik = Buffer.alloc(44);
  baslik.write('RIFF', 0);
  baslik.writeUInt32LE(36 + pcm.length, 4);
  baslik.write('WAVE', 8);
  baslik.write('fmt ', 12);
  baslik.writeUInt32LE(16, 16);
  baslik.writeUInt16LE(1, 20); // PCM
  baslik.writeUInt16LE(1, 22); // mono
  baslik.writeUInt32LE(hiz, 24);
  baslik.writeUInt32LE(hiz * ORNEK_BAYT, 28);
  baslik.writeUInt16LE(ORNEK_BAYT, 32);
  baslik.writeUInt16LE(16, 34);
  baslik.write('data', 36);
  baslik.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([baslik, pcm]);
}

/** LINEAR16 yaniti RIFF baslikli gelir; ham PCM'e indir. */
export function riffPcmCikar(tampon: Buffer): Buffer {
  if (tampon.length < 12 || tampon.toString('ascii', 0, 4) !== 'RIFF') return tampon;
  let konum = 12;
  while (konum + 8 <= tampon.length) {
    const parcaAdi = tampon.toString('ascii', konum, konum + 4);
    const parcaBoyu = tampon.readUInt32LE(konum + 4);
    if (parcaAdi === 'data') return tampon.subarray(konum + 8, konum + 8 + parcaBoyu);
    konum += 8 + parcaBoyu + (parcaBoyu % 2);
  }
  return tampon;
}

// ── Üretim kalitesi (§7.5.1) ──────────────────────────────────────────────

/**
 * Bas ve son sessizligi kirpar.
 *
 * TASIYICIDAN KESILEN PARCAYA UYGULANMAZ (kritik kisit 2 / §7.5 kural 3):
 * parcanin sinirlari zaten dogaldir, kirpma sessiz unsuzleri yer.
 * Yalniz tek basina sentezlenmis ses icin anlamlidir.
 */
export function sessizlikKirp(
  pcm: Buffer,
  hiz: number,
  { esikDb = -45, payMs = 15 }: { esikDb?: number; payMs?: number } = {},
): Buffer {
  const f = pcmToFloat(pcm);
  const esik = Math.pow(10, esikDb / 20);
  const pencere = Math.max(1, Math.round(hiz * 0.005)); // 5 ms RMS penceresi

  const rmsUstu = (merkez: number): boolean => {
    let toplam = 0;
    let adet = 0;
    for (let i = merkez; i < Math.min(f.length, merkez + pencere); i++) {
      toplam += (f[i] as number) * (f[i] as number);
      adet++;
    }
    return adet > 0 && Math.sqrt(toplam / adet) > esik;
  };

  let bas = 0;
  while (bas < f.length && !rmsUstu(bas)) bas += pencere;
  let son = Math.max(0, f.length - pencere);
  while (son > bas && !rmsUstu(son)) son -= pencere;

  if (bas >= son) return pcm; // tamamen sessiz — dokunma

  const pay = Math.round((hiz * payMs) / 1000);
  bas = Math.max(0, bas - pay);
  son = Math.min(f.length, son + pencere + pay);
  return pcm.subarray(bas * ORNEK_BAYT, son * ORNEK_BAYT);
}

/** Tum klipleri ayni RMS seviyesine getirir, tepe degeri sinirlar (§7.5.1 kural 1). */
export function seviyeNormalize(
  pcm: Buffer,
  { hedefRmsDb = -20, tepeTavanDb = -1 }: { hedefRmsDb?: number; tepeTavanDb?: number } = {},
): Buffer {
  const f = pcmToFloat(pcm);
  let toplam = 0;
  for (let i = 0; i < f.length; i++) toplam += (f[i] as number) * (f[i] as number);
  const rms = Math.sqrt(toplam / Math.max(1, f.length));
  if (rms < 1e-6) return pcm;

  let kazanc = Math.pow(10, hedefRmsDb / 20) / rms;

  let tepe = 0;
  for (let i = 0; i < f.length; i++) tepe = Math.max(tepe, Math.abs(f[i] as number));
  const tepeTavan = Math.pow(10, tepeTavanDb / 20);
  if (tepe * kazanc > tepeTavan) kazanc = tepeTavan / tepe;

  const cikti = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) cikti[i] = (f[i] as number) * kazanc;
  return floatToPcm(cikti);
}

// ── Birleştirme (§7.6) ────────────────────────────────────────────────────

/** Sifir gecise en yakin noktayi bulur — dikiste tiklama sesini onler. */
function sifirGecisAra(f: Float32Array, konum: number, yaricap: number): number {
  let enIyi = konum;
  let enIyiDeger = Math.abs(f[konum] ?? 0);
  const bas = Math.max(1, konum - yaricap);
  const son = Math.min(f.length - 1, konum + yaricap);
  for (let i = bas; i < son; i++) {
    const onceki = f[i - 1] as number;
    const simdiki = f[i] as number;
    if ((onceki <= 0 && simdiki >= 0) || (onceki >= 0 && simdiki <= 0)) {
      const deger = Math.abs(simdiki);
      if (deger < enIyiDeger) {
        enIyi = i;
        enIyiDeger = deger;
      }
    }
  }
  return enIyi;
}

export type BirlestirmeSecenekleri = {
  hiz: number;
  boslukMs?: number;
  crossfadeMs?: number;
  sifirGecis?: boolean;
};

/**
 * Klipleri birlestirir. Sira: [klip A] -> crossfade -> [sessizlik] -> [klip B]
 *
 * Olculmus varsayilan (§7.6): bosluk 0 ms, crossfade 45 ms, sifir gecis acik.
 * Degerler yapilandirmadan gelir, cagiran verir.
 */
export function birlestir(klipler: Buffer[], secenekler: BirlestirmeSecenekleri): Buffer {
  const { hiz, boslukMs = 0, crossfadeMs = 45, sifirGecis = true } = secenekler;
  const gecerli = klipler.filter((k) => k && k.length > 0);
  if (gecerli.length === 0) return Buffer.alloc(0);

  const bosluk = Math.round((hiz * boslukMs) / 1000);
  const cf = Math.round((hiz * crossfadeMs) / 1000);

  let sonuc = pcmToFloat(gecerli[0] as Buffer);

  for (let k = 1; k < gecerli.length; k++) {
    let sonraki = pcmToFloat(gecerli[k] as Buffer);

    if (sifirGecis && sonraki.length > 64) {
      const kaydir = sifirGecisAra(sonraki, 0, Math.min(64, sonraki.length - 2));
      if (kaydir > 0) sonraki = sonraki.subarray(kaydir);
    }

    const ortusme = Math.min(cf, sonuc.length, sonraki.length);
    const yeni = new Float32Array(sonuc.length + bosluk + sonraki.length - ortusme);

    yeni.set(sonuc, 0);

    if (ortusme > 0) {
      // Onceki klibin kuyrugu sonerken sonraki klibin basi yukselir.
      const basla = sonuc.length - ortusme;
      for (let i = 0; i < ortusme; i++) {
        const t = i / ortusme;
        yeni[basla + i] = (sonuc[basla + i] as number) * (1 - t) + (sonraki[i] as number) * t;
      }
      // Bosluk crossfade sonrasi gelir; aksi halde iki klip boslukta ust uste biner.
      for (let i = 0; i < bosluk; i++) yeni[sonuc.length + i] = 0;
      yeni.set(sonraki.subarray(ortusme), sonuc.length + bosluk);
    } else {
      for (let i = 0; i < bosluk; i++) yeni[sonuc.length + i] = 0;
      yeni.set(sonraki, sonuc.length + bosluk);
    }

    sonuc = yeni;
  }

  return floatToPcm(sonuc);
}

/** Sondan `ms` kadar kirpar. Es koyulacaksa kuyruk payi ONCE kirpilmali (§7.6). */
export function sondanKirp(pcm: Buffer, hiz: number, ms: number): Buffer {
  const bayt = Math.round((hiz * ms) / 1000) * ORNEK_BAYT;
  return bayt > 0 && bayt < pcm.length ? pcm.subarray(0, pcm.length - bayt) : pcm;
}

export function sessizlik(hiz: number, sn: number): Buffer {
  return Buffer.alloc(Math.round(hiz * sn) * ORNEK_BAYT);
}

// ── WSOLA time-stretch (§5.1) ─────────────────────────────────────────────

/**
 * Perdeyi bozmadan hiz degistirir. Basit yeniden ornekleme perdeyi de degistirir
 * (chipmunk etkisi) — dokuman bunu acikca yasakliyor.
 *
 * @param oran 1.2 -> yuzde 20 daha hizli (sure 1/1.2 olur)
 */
export function wsola(pcm: Buffer, hiz: number, oran: number): Buffer {
  if (Math.abs(oran - 1) < 1e-3) return pcm;

  const x = pcmToFloat(pcm);
  const N = Math.round(hiz * 0.04); // 40 ms cerceve
  const Hs = Math.round(N / 2); // sentez adimi
  const Ha = Math.round(Hs * oran); // analiz adimi
  const arama = Math.round(hiz * 0.01); // +/- 10 ms arama penceresi
  const ortusme = N - Hs;

  if (x.length < N + arama * 2) return pcm;

  const pencere = new Float32Array(N);
  for (let i = 0; i < N; i++) pencere[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  const ciktiUzunluk = Math.ceil(x.length / oran) + N;
  const y = new Float32Array(ciktiUzunluk);
  const agirlik = new Float32Array(ciktiUzunluk);

  let girisKonum = 0;
  let ciktiKonum = 0;
  let hedefKuyruk: Float32Array | null = null; // onceki cercevenin dogal devami

  while (girisKonum + N < x.length && ciktiKonum + N < ciktiUzunluk) {
    let enIyiKaydirma = 0;

    if (hedefKuyruk) {
      let enIyiSkor = -Infinity;
      for (let d = -arama; d <= arama; d++) {
        const bas = girisKonum + d;
        if (bas < 0 || bas + ortusme >= x.length) continue;
        let skor = 0;
        for (let i = 0; i < ortusme; i += 2) {
          skor += (x[bas + i] as number) * (hedefKuyruk[i] as number);
        }
        if (skor > enIyiSkor) {
          enIyiSkor = skor;
          enIyiKaydirma = d;
        }
      }
    }

    const cerceveBas = Math.max(0, girisKonum + enIyiKaydirma);
    if (cerceveBas + N >= x.length) break;

    for (let i = 0; i < N; i++) {
      const j = ciktiKonum + i;
      y[j] = (y[j] as number) + (x[cerceveBas + i] as number) * (pencere[i] as number);
      agirlik[j] = (agirlik[j] as number) + (pencere[i] as number);
    }

    hedefKuyruk = x.subarray(cerceveBas + Hs, cerceveBas + Hs + ortusme);
    ciktiKonum += Hs;
    girisKonum = cerceveBas + Ha;
  }

  const son = Math.min(ciktiKonum + N, ciktiUzunluk);
  const sonuc = new Float32Array(son);
  for (let i = 0; i < son; i++) {
    sonuc[i] = (agirlik[i] as number) > 1e-6 ? (y[i] as number) / (agirlik[i] as number) : 0;
  }

  return floatToPcm(sonuc);
}

/** Perde kaydirma: WSOLA ile uzat/kisalt, sonra ters oranda yeniden ornekle. */
export function perdeKaydir(pcm: Buffer, hiz: number, yarimTon: number): Buffer {
  if (yarimTon === 0) return pcm;
  const oran = Math.pow(2, yarimTon / 12);
  const uzatilmis = pcmToFloat(wsola(pcm, hiz, 1 / oran));

  const n = Math.round(uzatilmis.length / oran);
  const cikti = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const kaynak = i * oran;
    const a = Math.floor(kaynak);
    const t = kaynak - a;
    cikti[i] = (uzatilmis[a] ?? 0) * (1 - t) + (uzatilmis[a + 1] ?? 0) * t;
  }
  return floatToPcm(cikti);
}

// Ham PCM (mono, 16-bit signed LE) üzerinde in-process ses işleme.
// Harici process yok, bağımlılık yok — hedef mimarinin kuralı burada da geçerli.

const ORNEK_BAYT = 2;

export function pcmUzunlukSn(pcm, hiz) {
  return pcm.length / ORNEK_BAYT / hiz;
}

// PCM <-> Float32 (-1..1) dönüşümleri. DSP'yi float üzerinde yapmak taşmayı önler.
export function pcmToFloat(pcm) {
  const n = Math.floor(pcm.length / ORNEK_BAYT);
  const cikti = new Float32Array(n);
  for (let i = 0; i < n; i++) cikti[i] = pcm.readInt16LE(i * ORNEK_BAYT) / 32768;
  return cikti;
}

export function floatToPcm(f) {
  const pcm = Buffer.allocUnsafe(f.length * ORNEK_BAYT);
  for (let i = 0; i < f.length; i++) {
    let d = Math.round(f[i] * 32768);
    if (d > 32767) d = 32767;
    if (d < -32768) d = -32768;
    pcm.writeInt16LE(d, i * ORNEK_BAYT);
  }
  return pcm;
}

// ── WAV ────────────────────────────────────────────────────────────────────

export function wavYaz(pcm, hiz) {
  const baslik = Buffer.alloc(44);
  baslik.write('RIFF', 0);
  baslik.writeUInt32LE(36 + pcm.length, 4);
  baslik.write('WAVE', 8);
  baslik.write('fmt ', 12);
  baslik.writeUInt32LE(16, 16);
  baslik.writeUInt16LE(1, 20);              // PCM
  baslik.writeUInt16LE(1, 22);              // mono
  baslik.writeUInt32LE(hiz, 24);
  baslik.writeUInt32LE(hiz * ORNEK_BAYT, 28);
  baslik.writeUInt16LE(ORNEK_BAYT, 32);
  baslik.writeUInt16LE(16, 34);
  baslik.write('data', 36);
  baslik.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([baslik, pcm]);
}

// ── Üretim kalitesi (§7.5) ────────────────────────────────────────────────

/**
 * Baş ve son sessizliği kırpar. Kırpılmazsa kelimeler arası duraklama birikir
 * ve cümle robotik akar — dokümanın 1. kalite kuralı.
 */
export function sessizlikKirp(pcm, hiz, { esikDb = -45, payMs = 15 } = {}) {
  const f = pcmToFloat(pcm);
  const esik = Math.pow(10, esikDb / 20);
  const pencere = Math.max(1, Math.round(hiz * 0.005));   // 5 ms RMS penceresi

  const rmsUstu = (merkez) => {
    let toplam = 0;
    let adet = 0;
    for (let i = merkez; i < Math.min(f.length, merkez + pencere); i++) {
      toplam += f[i] * f[i];
      adet++;
    }
    return adet > 0 && Math.sqrt(toplam / adet) > esik;
  };

  let bas = 0;
  while (bas < f.length && !rmsUstu(bas)) bas += pencere;
  let son = Math.max(0, f.length - pencere);
  while (son > bas && !rmsUstu(son)) son -= pencere;

  if (bas >= son) return pcm;                              // tamamen sessiz — dokunma

  const pay = Math.round(hiz * payMs / 1000);
  bas = Math.max(0, bas - pay);
  son = Math.min(f.length, son + pencere + pay);
  return pcm.subarray(bas * ORNEK_BAYT, son * ORNEK_BAYT);
}

/** Tüm klipleri aynı RMS seviyesine getirir, tepe değeri sınırlar (§7.5 kural 3). */
export function seviyeNormalize(pcm, { hedefRmsDb = -20, tepeTavanDb = -1 } = {}) {
  const f = pcmToFloat(pcm);
  let toplam = 0;
  for (let i = 0; i < f.length; i++) toplam += f[i] * f[i];
  const rms = Math.sqrt(toplam / Math.max(1, f.length));
  if (rms < 1e-6) return pcm;

  let kazanc = Math.pow(10, hedefRmsDb / 20) / rms;

  let tepe = 0;
  for (let i = 0; i < f.length; i++) tepe = Math.max(tepe, Math.abs(f[i]));
  const tepeTavan = Math.pow(10, tepeTavanDb / 20);
  if (tepe * kazanc > tepeTavan) kazanc = tepeTavan / tepe;

  const cikti = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) cikti[i] = f[i] * kazanc;
  return floatToPcm(cikti);
}

// ── Birleştirme (§7.6) ────────────────────────────────────────────────────

/** Sıfır geçişe en yakın noktayı bulur — dikişte tıklama sesini önler. */
function sifirGecisAra(f, konum, yaricap) {
  let enIyi = konum;
  let enIyiDeger = Math.abs(f[konum] ?? 0);
  const bas = Math.max(1, konum - yaricap);
  const son = Math.min(f.length - 1, konum + yaricap);
  for (let i = bas; i < son; i++) {
    if ((f[i - 1] <= 0 && f[i] >= 0) || (f[i - 1] >= 0 && f[i] <= 0)) {
      const deger = Math.abs(f[i]);
      if (deger < enIyiDeger) {
        enIyi = i;
        enIyiDeger = deger;
      }
    }
  }
  return enIyi;
}

/**
 * Klipleri birleştirir.
 * Sıra: [klip A] → crossfade → [sessizlik] → [klip B]
 *
 * @param {Buffer[]} klipler
 * @param {{hiz:number, boslukMs?:number, crossfadeMs?:number, sifirGecis?:boolean}} secenekler
 */
export function birlestir(klipler, { hiz, boslukMs = 40, crossfadeMs = 8, sifirGecis = true }) {
  const gecerli = klipler.filter((k) => k && k.length > 0);
  if (gecerli.length === 0) return Buffer.alloc(0);

  const bosluk = Math.round(hiz * boslukMs / 1000);
  const cf = Math.round(hiz * crossfadeMs / 1000);

  let sonuc = pcmToFloat(gecerli[0]);

  for (let k = 1; k < gecerli.length; k++) {
    let sonraki = pcmToFloat(gecerli[k]);

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
        yeni[basla + i] = sonuc[basla + i] * (1 - t) + sonraki[i] * t;
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

// ── WSOLA time-stretch (§5.1) ─────────────────────────────────────────────

/**
 * Perdeyi bozmadan hız değiştirir. Basit yeniden örnekleme perdeyi de değiştirir
 * (chipmunk etkisi) — kabul edilemez, doküman bunu açıkça yasaklıyor.
 *
 * @param {Buffer} pcm
 * @param {number} hiz      örnekleme hızı
 * @param {number} oran     1.2 → yüzde 20 daha hızlı (süre 1/1.2 olur)
 */
export function wsola(pcm, hiz, oran) {
  if (Math.abs(oran - 1) < 1e-3) return pcm;

  const x = pcmToFloat(pcm);
  const N = Math.round(hiz * 0.040);          // 40 ms çerçeve
  const Hs = Math.round(N / 2);               // sentez adımı
  const Ha = Math.round(Hs * oran);           // analiz adımı
  const arama = Math.round(hiz * 0.010);      // arti/eksi 10 ms arama penceresi
  const ortusme = N - Hs;

  if (x.length < N + arama * 2) return pcm;

  const pencere = new Float32Array(N);
  for (let i = 0; i < N; i++) pencere[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));

  const ciktiUzunluk = Math.ceil(x.length / oran) + N;
  const y = new Float32Array(ciktiUzunluk);
  const agirlik = new Float32Array(ciktiUzunluk);

  let girisKonum = 0;
  let ciktiKonum = 0;
  let hedefKuyruk = null;                     // önceki çerçevenin doğal devamı

  while (girisKonum + N < x.length && ciktiKonum + N < ciktiUzunluk) {
    let enIyiKaydirma = 0;

    if (hedefKuyruk) {
      let enIyiSkor = -Infinity;
      for (let d = -arama; d <= arama; d++) {
        const bas = girisKonum + d;
        if (bas < 0 || bas + ortusme >= x.length) continue;
        let skor = 0;
        for (let i = 0; i < ortusme; i += 2) skor += x[bas + i] * hedefKuyruk[i];
        if (skor > enIyiSkor) {
          enIyiSkor = skor;
          enIyiKaydirma = d;
        }
      }
    }

    const cerceveBas = Math.max(0, girisKonum + enIyiKaydirma);
    if (cerceveBas + N >= x.length) break;

    for (let i = 0; i < N; i++) {
      y[ciktiKonum + i] += x[cerceveBas + i] * pencere[i];
      agirlik[ciktiKonum + i] += pencere[i];
    }

    hedefKuyruk = x.subarray(cerceveBas + Hs, cerceveBas + Hs + ortusme);
    ciktiKonum += Hs;
    girisKonum = cerceveBas + Ha;
  }

  const son = Math.min(ciktiKonum + N, ciktiUzunluk);
  const sonuc = new Float32Array(son);
  for (let i = 0; i < son; i++) sonuc[i] = agirlik[i] > 1e-6 ? y[i] / agirlik[i] : 0;

  return floatToPcm(sonuc);
}

/** Perde kaydırma: WSOLA ile uzat/kısalt, sonra ters oranda yeniden örnekle. */
export function perdeKaydir(pcm, hiz, yarimTon) {
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

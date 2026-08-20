// KUCUK toplu uretim denemesi — gercek Google, butce bekcisi altinda.
//
//   node --env-file=.env betikler/toplu-deneme.ts
//
// Tam listeyle CALISTIRMAZ: sabit, kucuk bir kelime kumesi uretir ve uretim
// hattinin ucunu ucuna dogrular (kuyruk -> tasiyici -> kesme -> atomik yazim ->
// parti halinde surum artisi -> ready).

import { resolve } from 'node:path';

import { yapilandirma } from '../paketler/tts-merkez/src/yapilandirma.ts';
import { dbAc } from '../paketler/tts-merkez/src/veritabani/baglanti.ts';
import { ButceBekcisi } from '../paketler/tts-merkez/src/motor/butce.ts';
import { GoogleMotoru } from '../paketler/tts-merkez/src/motor/google.ts';
import type { SesProfili, Tiyer } from '../paketler/tts-merkez/src/motor/arayuz.ts';
import { KlipDeposu } from '../paketler/tts-merkez/src/depo/klip-deposu.ts';
import { Uretici } from '../paketler/tts-merkez/src/uretim/uretici.ts';
import { kuyrugaEkle } from '../paketler/tts-merkez/src/uretim/kuyruk.ts';
import { yuvalariTanimla } from '../paketler/tts-merkez/src/uretim/planlayici.ts';
import { kotaDurumu } from '../paketler/tts-merkez/src/uretim/kota.ts';
import { varsayilanSablon } from '../paketler/tts-merkez/src/web/rotalar/ortak.ts';

/** Kucuk ve sabit: 3 tasiyici = 9 klip. */
const KELIMELER: Array<[string, string]> = [
  ['karabulut', 'soyad'],
  ['yılmaz', 'soyad'],
  ['öztürk', 'soyad'],
  ['mehmet', 'ad'],
  ['ayşe', 'ad'],
  ['hüseyin', 'ad'],
  ['üç', 'sayi'],
  ['on iki', 'sayi'],
  ['yedi', 'sayi'],
];

const ayar = yapilandirma();
const db = dbAc(ayar.DATABASE_URL);
const bankaDizini = resolve(process.cwd(), ayar.BANKA_DIZINI);
const depo = new KlipDeposu(bankaDizini);
const butce = new ButceBekcisi(ButceBekcisi.varsayilanYol(bankaDizini), ayar.GOOGLE_KLIP_BUTCESI);
await butce.yukle();

console.log('Bütçe (başlangıç):', JSON.stringify(butce.durum()));

if (!(await butce.yeterMi(KELIMELER.length))) {
  console.log('BÜTÇE YETMİYOR — istek gönderilmedi.');
  await db.end();
  process.exit(0);
}

const motor = new GoogleMotoru({
  apiAnahtari: ayar.GOOGLE_TTS_API_KEY,
  servisHesabiYolu: ayar.GOOGLE_APPLICATION_CREDENTIALS,
  dilKodu: ayar.DIL_KODU,
  eszamanlilik: ayar.GOOGLE_ESZAMANLILIK,
  saniyedeIstek: ayar.GOOGLE_ISTEK_HIZI_SN,
  butce,
});

const profilSatiri = await db<
  { id: string; motor: string; motor_sesi: string; tiyer: string; ornek_hizi: number }[]
>`SELECT id, motor, motor_sesi, tiyer, ornek_hizi FROM ses_profili WHERE varsayilan LIMIT 1`;

const p = profilSatiri[0];
if (!p) {
  console.log('Varsayılan profil yok — önce sunucuyu bir kez açın (ilk kurulum profili oluşturur).');
  await db.end();
  process.exit(1);
}

const profil: SesProfili = {
  id: p.id,
  motor: p.motor,
  motorSesi: p.motor_sesi,
  tiyer: p.tiyer as Tiyer,
  ornekHizi: Number(p.ornek_hizi),
};
console.log('Profil:', JSON.stringify(profil));

for (const [kelime, tip] of KELIMELER) {
  await kuyrugaEkle(db, kelime, profil.id, tip, { kaynak: 'toplu' });
}

const sablon = await varsayilanSablon(db);
const yuvalar = yuvalariTanimla(sablon.metin, sablon.ornekler, sablon.tipler);
console.log('Şablon:', sablon.metin);

const uretici = new Uretici(
  db,
  motor,
  depo,
  {
    kuyrukMs: ayar.KESME_KUYRUK_MS,
    denemeSiniri: ayar.DENEME_SINIRI,
    sahiplenmeYasiSn: ayar.SAHIPLENME_YASI_SN,
    partiBoyutu: KELIMELER.length,
  },
  {
    info: (o, m) => console.log('  [bilgi]', m, JSON.stringify(o)),
    warn: (o, m) => console.log('  [uyarı]', m, JSON.stringify(o)),
    error: (o, m) => console.log('  [hata]', m, JSON.stringify(o)),
  },
);

console.log('\n── Üretim ──');
const t0 = Date.now();
const sonuc = await uretici.partiUret(profil, yuvalar);
console.log('Süre:', Date.now() - t0, 'ms');
console.log('Sonuç:', JSON.stringify(sonuc, null, 2));

const satirlar = await db<
  { kelime: string; durum: string; hash: string | null; sure_ms: number | null; surum: number | null }[]
>`
  SELECT kelime, durum, hash, sure_ms, surum FROM klip
   WHERE profil = ${profil.id} ORDER BY kelime
`;

console.log('\n── Banka ──');
let diskteVar = 0;
for (const s of satirlar) {
  const varMi = s.hash ? await depo.varMi(profil.id, s.hash) : false;
  if (varMi) diskteVar++;
  console.log(
    '  ' + s.kelime.padEnd(14) + s.durum.padEnd(12) +
      String(s.sure_ms ?? '—').padStart(6) + ' ms  sürüm ' + String(s.surum ?? '—').padStart(3) +
      '  disk:' + (varMi ? 'var' : 'YOK') + '  ' + (s.hash ?? '').slice(0, 12),
  );
}
console.log('Diskte bulunan:', diskteVar, '/', satirlar.length);

const surumler = await db<{ profil: string; surum: number }[]>`SELECT profil, surum FROM banka_surum`;
console.log('banka_surum:', JSON.stringify(surumler));

const kotalar = await kotaDurumu(db);
console.log('Kota:', JSON.stringify(kotalar.map((k) => ({ t: k.tiyer, kullanilan: k.kullanilan, bant: k.bant }))));
console.log('Bütçe (bitiş):', JSON.stringify(butce.durum()));

await db.end();

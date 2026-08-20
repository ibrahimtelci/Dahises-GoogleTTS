// tts-merkez giris noktasi.
//
//   pnpm dev    — geliştirme
//   pnpm basla  — normal çalıştırma

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';

import { yapilandirma } from './yapilandirma.ts';
import { gunlukKur } from './gunluk.ts';
import { dbAc } from './veritabani/baglanti.ts';
import { migrasyonlariUygula } from './veritabani/migrasyon.ts';
import { ilkKurulum } from './ilk-kurulum.ts';
import { ButceBekcisi } from './motor/butce.ts';
import { GoogleMotoru } from './motor/google.ts';
import { SahteMotor } from './motor/sahte.ts';
import type { SesMotoru } from './motor/arayuz.ts';
import { KlipDeposu } from './depo/klip-deposu.ts';
import { Uretici } from './uretim/uretici.ts';
import { sunucuKur } from './web/sunucu.ts';
import { ArkaPlanIsleri } from './uretim/arka-plan.ts';

const KOK = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRASYON_DIZINI = resolve(KOK, 'migrasyonlar');
const require = createRequire(import.meta.url);

const ayar = yapilandirma();
const gunluk = gunlukKur(ayar.LOG_SEVIYESI, ayar.ORTAM);

const db = dbAc(ayar.DATABASE_URL);

// ── Şema ──
const migrasyon = await migrasyonlariUygula(db, MIGRASYON_DIZINI, gunluk);
if (migrasyon.uygulanan.length > 0) {
  gunluk.info({ uygulanan: migrasyon.uygulanan }, 'migrasyonlar uygulandı');
}

// ── Depo ve bütçe ──
const bankaDizini = resolve(KOK, ayar.BANKA_DIZINI);
const depo = new KlipDeposu(bankaDizini);
const butce = new ButceBekcisi(
  ButceBekcisi.varsayilanYol(bankaDizini),
  ayar.GOOGLE_KLIP_BUTCESI,
);
await butce.yukle();

// ── Motor ──
// Kimlik yoksa sahte motora düşülür: panel açılır, Google'a hiç gidilmez.
const motor: SesMotoru = ayar.motorKimligiVar
  ? new GoogleMotoru({
      apiAnahtari: ayar.GOOGLE_TTS_API_KEY,
      servisHesabiYolu: ayar.GOOGLE_APPLICATION_CREDENTIALS,
      dilKodu: ayar.DIL_KODU,
      eszamanlilik: ayar.GOOGLE_ESZAMANLILIK,
      saniyedeIstek: ayar.GOOGLE_ISTEK_HIZI_SN,
      butce,
    })
  : new SahteMotor();

if (!ayar.motorKimligiVar) {
  gunluk.warn(
    {},
    'Google kimliği yok — SAHTE motor kullanılıyor. Üretilen ses gerçek değildir.',
  );
}

// ── İlk kurulum ──
const kurulum = await ilkKurulum(db, ayar, { dosyaYolu: resolve(KOK, 'ILK-KURULUM.md') });

if (kurulum.superadminOlusturuldu) {
  // Parola KONSOLA BİR KEZ basılır; loga (pino) yazılmaz.
  console.log('\n' + '='.repeat(72));
  console.log('  İLK KURULUM — superadmin hesabı oluşturuldu');
  console.log('='.repeat(72));
  console.log('  Kullanıcı adı : superadmin');
  console.log('  Parola        : ' + kurulum.parola);
  console.log('');
  console.log('  Bu parola BİR KEZ gösterilir. ILK-KURULUM.md dosyasına da yazıldı.');
  console.log('  İlk girişte parola değişimi zorunludur.');
  console.log('='.repeat(72) + '\n');
}

// ── Üretici ve arka plan işleri ──
const uretici = new Uretici(
  db,
  motor,
  depo,
  {
    kuyrukMs: ayar.KESME_KUYRUK_MS,
    denemeSiniri: ayar.DENEME_SINIRI,
    sahiplenmeYasiSn: ayar.SAHIPLENME_YASI_SN,
    partiBoyutu: ayar.URETIM_PARTI_BOYUTU,
  },
  gunluk,
);

const arkaPlan = new ArkaPlanIsleri(db, uretici, gunluk, {
  supurucuAralikSn: ayar.SUPURUCU_ARALIK_SN,
  bayatPendingDk: ayar.BAYAT_PENDING_DK,
});
arkaPlan.basla();

// ── Sunucu ──
const app = await sunucuKur({ db, motor, depo, butce, uretici, ayar });

await app.register(fastifyStatic, {
  root: dirname(require.resolve('htmx.org/dist/htmx.min.js')),
  prefix: '/statik/',
  index: false,
  list: false,
});

try {
  await app.listen({ port: ayar.PORT, host: ayar.SUNUCU_ADRESI });
  gunluk.info(
    { port: ayar.PORT, adres: ayar.SUNUCU_ADRESI, motor: motor.ad, banka: bankaDizini },
    'tts-merkez açıldı',
  );
  console.log(`\n  tts-merkez  →  http://${ayar.SUNUCU_ADRESI}:${ayar.PORT}\n`);
} catch (hata) {
  gunluk.error({ hata: (hata as Error).message }, 'sunucu açılamadı');
  process.exit(1);
}

// ── Düzgün kapanış ──
for (const sinyal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinyal, () => {
    void (async () => {
      gunluk.info({ sinyal }, 'kapanıyor');
      arkaPlan.durdur();
      await app.close();
      await db.end();
      process.exit(0);
    })();
  });
}

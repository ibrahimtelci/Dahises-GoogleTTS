// Kullanıcı parolası sıfırlama — panele girilemediğinde son çare.
//
//   node betikler/parola-sifirla.mjs                    → superadmin
//   node betikler/parola-sifirla.mjs --kullanici=ahmet
//   node betikler/parola-sifirla.mjs --parola=kendiparolam
//
// Yeni parolayı üretir, argon2id ile hashler, veritabanına yazar ve
// `parola_degistir = true` yapar — kullanıcı ilk girişte kendi parolasını koyar.
//
// Uygulamanın kendi `parolaHashle` fonksiyonunu kullanır; ayar kopyası tutmaz.

import { randomBytes } from 'node:crypto';

const KOK = new URL('..', import.meta.url);
process.loadEnvFile(new URL('.env', KOK).pathname.replace(/^\//, ''));

const { parolaHashle } = await import(new URL('paketler/tts-merkez/src/web/kimlik.ts', KOK).href);
const { createRequire } = await import('node:module');
const require = createRequire(new URL('paketler/tts-merkez/', KOK));
const postgres = require('postgres');

const arg = (ad) => {
  const e = process.argv.find((a) => a.startsWith('--' + ad + '='));
  return e ? e.slice(ad.length + 3) : null;
};

const kullaniciAdi = arg('kullanici') ?? 'superadmin';
const yeniParola = arg('parola') ?? randomBytes(18).toString('base64url');

const db = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const [mevcut] = await db`
  SELECT id, kullanici_adi, rol, aktif FROM kullanici WHERE kullanici_adi = ${kullaniciAdi}
`;

if (!mevcut) {
  const hepsi = await db`SELECT kullanici_adi FROM kullanici ORDER BY id`;
  console.error('\n  "' + kullaniciAdi + '" adlı kullanıcı yok.');
  console.error('  Mevcut kullanıcılar: ' + (hepsi.map((k) => k.kullanici_adi).join(', ') || '(hiç yok)'));
  await db.end();
  process.exit(1);
}

const hash = await parolaHashle(yeniParola);
await db`
  UPDATE kullanici
     SET parola_hash = ${hash}, parola_degistir = true, aktif = true
   WHERE id = ${mevcut.id}
`;

// Denetim gunlugune yaz — kim ne zaman sifirladi izi kalsin.
await db`
  INSERT INTO denetim_gunlugu (kullanici_id, eylem, ayrinti)
  VALUES (${mevcut.id}, 'parola_sifirlandi', ${'betikler/parola-sifirla.mjs ile sıfırlandı'})
`.catch(() => {});   // tablo şeması farklıysa sessiz geç, asıl iş yapıldı

await db.end();

console.log('\n  Parola sıfırlandı.\n');
console.log('    Kullanıcı  ' + mevcut.kullanici_adi + '  (' + mevcut.rol + ')');
console.log('    Parola     ' + yeniParola);
console.log('\n  İlk girişte parola değişimi zorunlu.');
console.log('  Adres: http://127.0.0.1:3000\n');

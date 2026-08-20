// Yük testi — 250 bin satırlık gerçekçi veride panel sorguları ve ses zinciri.
//
//   node betikler/yuk-testi.mjs [--satir=250000] [--koru]
//
// AYRI bir veritabanı (`ttsmerkez_yuk`) kurar, ölçer ve siler. Gerçek `ttsmerkez`
// veritabanına DOKUNMAZ. `--koru` verilirse test veritabanı silinmez (EXPLAIN için).
//
// Google'a hiç gitmez.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const KOK = fileURLToPath(new URL('..', import.meta.url));

// `postgres` workspace paketine kurulu, kokte degil.
const require = createRequire(join(KOK, 'paketler/tts-merkez/'));
const postgres = require('postgres');
{
  const envYolu = join(KOK, '.env');
  if (existsSync(envYolu)) process.loadEnvFile(envYolu);
}

const arg = (ad, vars) => {
  const e = process.argv.find((a) => a.startsWith('--' + ad + '='));
  return e ? e.split('=')[1] : vars;
};
const SATIR = Number(arg('satir', '250000'));
const KORU = process.argv.includes('--koru');
const TEST_DB = 'ttsmerkez_yuk';

const temelUrl = process.env.DATABASE_URL;
if (!temelUrl) throw new Error('DATABASE_URL yok (.env)');
const yonetimUrl = temelUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
const testUrl = temelUrl.replace(/\/[^/?]+(\?|$)/, '/' + TEST_DB + '$1');

const ms = (n) => n.toFixed(1).padStart(9) + ' ms';
const say = (n) => n.toLocaleString('tr-TR');

/** Bir sorguyu N kez koşturup en iyi/ortanca/en kötü süreyi döner. */
async function olc(ad, fn, tur = 5) {
  await fn();                                  // ısınma
  const sureler = [];
  for (let i = 0; i < tur; i++) {
    const t = performance.now();
    await fn();
    sureler.push(performance.now() - t);
  }
  sureler.sort((a, b) => a - b);
  const ortanca = sureler[Math.floor(sureler.length / 2)];
  console.log('  ' + ad.padEnd(52) + ms(ortanca) + '   (en iyi ' + sureler[0].toFixed(0) +
              ', en kötü ' + sureler.at(-1).toFixed(0) + ')');
  return ortanca;
}

// ── Kurulum ──────────────────────────────────────────────────────────────

console.log('\n══ KURULUM ══');
const yonetim = postgres(yonetimUrl, { max: 1, onnotice: () => {} });
await yonetim`DROP DATABASE IF EXISTS ${yonetim(TEST_DB)}`;
await yonetim`CREATE DATABASE ${yonetim(TEST_DB)} TEMPLATE template0
  ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'tr-TR' LOCALE 'C'`;
await yonetim.end();
console.log('  test veritabanı: ' + TEST_DB + '  (gerçek veritabanına dokunulmadı)');

const db = postgres(testUrl, { max: 4, onnotice: () => {} });

const migDizin = join(KOK, 'migrasyonlar');
for (const dosya of readdirSync(migDizin).filter((f) => f.endsWith('.sql')).sort()) {
  await db.unsafe(readFileSync(join(migDizin, dosya), 'utf8'));
}
console.log('  migrasyonlar uygulandı');

// ── Tohumlama ────────────────────────────────────────────────────────────
// Gerçekçi Türkçe kelimeler: hece havuzundan üretilir, böylece ILIKE '%...%'
// aramasının seçiciliği gerçeğe yakın olur. Dağılım Zipf'e yakın: durumların
// çoğu 'ready', küçük bir kuyruk pending/failed.

console.log('\n══ TOHUMLAMA (' + say(SATIR) + ' satır) ══');
let t0 = performance.now();
await db.unsafe(`
  INSERT INTO klip (kelime, profil, durum, hash, sure_ms, surum, kaynak, olusturuldu, son_kullanim)
  SELECT
    h1.h || h2.h || h3.h || i::text AS kelime,
    CASE WHEN i % 8 = 0 THEN 'erkek-1' ELSE 'kadin-1' END,
    CASE WHEN i % 100 < 92 THEN 'ready'
         WHEN i % 100 < 96 THEN 'pending'
         WHEN i % 100 < 98 THEN 'failed'
         ELSE 'engellendi' END,
    CASE WHEN i % 100 < 92 THEN md5(i::text) ELSE NULL END,
    CASE WHEN i % 100 < 92 THEN 400 + (i % 900) ELSE NULL END,
    CASE WHEN i % 100 < 92 THEN (i / 200)::int ELSE NULL END,
    CASE WHEN i % 10 = 0 THEN 'fallback' ELSE 'toplu' END,
    now() - (i % 365) * interval '1 day',
    CASE WHEN i % 100 < 92 THEN now() - (i % 400) * interval '1 day' ELSE NULL END
  FROM generate_series(1, ${SATIR}) i
  CROSS JOIN LATERAL (SELECT (ARRAY['ka','me','yı','öz','şa','gü','ba','de','çe','tu'])[1 + i % 10] AS h) h1
  CROSS JOIN LATERAL (SELECT (ARRAY['ra','le','di','tü','hi','ne','so','va','kı','pe'])[1 + (i/10) % 10] AS h) h2
  CROSS JOIN LATERAL (SELECT (ARRAY['lar','maz','oğlu','kan','soy','giz','taş','dır','sel','han'])[1 + (i/100) % 10] AS h) h3
`);
console.log('  klip satırları        ' + ms(performance.now() - t0));

t0 = performance.now();
await db.unsafe(`
  INSERT INTO klip_kapsam (klip_id, tip, hastane_id)
  SELECT id,
         CASE WHEN id % 100 < 55 THEN 'soyad'
              WHEN id % 100 < 85 THEN 'ad'
              WHEN id % 100 < 93 THEN 'sayi'
              WHEN id % 100 < 97 THEN 'doktor'
              ELSE 'poliklinik' END,
         CASE WHEN id % 100 < 93 THEN 0 ELSE 1 + (id % 22) END
  FROM klip
`);
console.log('  kapsam satırları      ' + ms(performance.now() - t0));

t0 = performance.now();
await db.unsafe('ANALYZE klip; ANALYZE klip_kapsam;');
console.log('  ANALYZE               ' + ms(performance.now() - t0));

const [{ boyut }] = await db`SELECT pg_size_pretty(pg_total_relation_size('klip')) AS boyut`;
const [{ adet }] = await db`SELECT count(*)::text AS adet FROM klip`;
console.log('  toplam: ' + say(Number(adet)) + ' satır, klip tablosu ' + boyut);

// ── Panel sorguları ──────────────────────────────────────────────────────
// kelimeler.ts'teki sorguların birebir aynısı.

const SAYFA = 50;
const sayimSorgusu = (ek = '') => db.unsafe(
  `SELECT count(*)::text AS adet FROM klip k WHERE true ${ek}`);
const listeSorgusu = (ek = '', offset = 0) => db.unsafe(`
  SELECT k.id, k.kelime, k.telaffuz, k.profil, k.durum, k.hash, k.sure_ms, k.surum,
         k.kaynak, k.hata, k.olusturuldu,
         (SELECT string_agg(DISTINCT kk.tip, ', ') FROM klip_kapsam kk WHERE kk.klip_id = k.id) AS tipler
    FROM klip k
   WHERE true ${ek}
   ORDER BY (k.durum = 'ready') ASC, k.olusturuldu DESC, k.id DESC
   LIMIT ${SAYFA} OFFSET ${offset}`);

console.log('\n══ PANEL SORGULARI (kelimeler.ts birebir) ══');
const sonuc = {};
sonuc.sayimFiltresiz = await olc('count(*) — filtresiz (her sayfa yüklemesinde)', () => sayimSorgusu());
sonuc.sayimDurum     = await olc("count(*) — durum='pending' filtresiyle", () => sayimSorgusu("AND k.durum = 'pending'"));
sonuc.liste1         = await olc('liste — 1. sayfa (offset 0)', () => listeSorgusu('', 0));
sonuc.liste100       = await olc('liste — 100. sayfa (offset 5.000)', () => listeSorgusu('', 5000));
sonuc.liste1000      = await olc('liste — 1000. sayfa (offset 50.000)', () => listeSorgusu('', 50000));
sonuc.listeSon       = await olc('liste — son sayfa (offset ' + say(SATIR - SAYFA) + ')', () => listeSorgusu('', SATIR - SAYFA));
sonuc.arama          = await olc("arama — ILIKE '%oğlu%' (trigram)", () => listeSorgusu("AND k.kelime ILIKE '%oğlu%'"));
sonuc.aramaKisa      = await olc("arama — ILIKE '%ka%' (kısa, seçiciliği düşük)", () => listeSorgusu("AND k.kelime ILIKE '%ka%'"));
sonuc.tipFiltre      = await olc("tip filtresi — EXISTS klip_kapsam 'doktor'", () => listeSorgusu("AND EXISTS (SELECT 1 FROM klip_kapsam kk WHERE kk.klip_id = k.id AND kk.tip = 'doktor')"));

console.log('\n══ ÜRETİM HATTI SORGULARI ══');
sonuc.sahiplenme = await olc('sahiplenme — FOR UPDATE SKIP LOCKED, 200 klip', () => db.unsafe(`
  UPDATE klip SET durum = 'uretiliyor', sahiplenildi = now()
  WHERE id IN (SELECT id FROM klip WHERE durum = 'pending' AND sonraki_deneme <= now()
               ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 200)
  RETURNING id`));
sonuc.delta = await olc('delta — manifest mutabakatı (surum > N)', () => db.unsafe(`
  SELECT k.kelime, k.hash, k.sure_ms, k.surum
    FROM klip k JOIN klip_kapsam kk ON kk.klip_id = k.id
   WHERE k.profil = 'kadin-1' AND k.durum = 'ready' AND k.surum > 1000
     AND kk.hastane_id IN (0, 7)
   ORDER BY k.surum LIMIT 1000`));
sonuc.budama = await olc('budama adayları — son_kullanim penceresi', () => db.unsafe(`
  SELECT id FROM klip WHERE durum = 'ready'
    AND son_kullanim < now() - interval '12 months' LIMIT 1000`));

// ── EXPLAIN — yavaş çıkanlar için ────────────────────────────────────────

console.log('\n══ EXPLAIN — en yavaş iki sorgu ══');
for (const [ad, ek, offset] of [['liste, derin offset', '', SATIR - SAYFA], ['count(*) filtresiz', null, null]]) {
  const plan = ek === null
    ? await db.unsafe('EXPLAIN (ANALYZE, BUFFERS, SUMMARY OFF) SELECT count(*) FROM klip k WHERE true')
    : await db.unsafe(`EXPLAIN (ANALYZE, BUFFERS, SUMMARY OFF)
        SELECT k.id FROM klip k WHERE true
        ORDER BY (k.durum = 'ready') ASC, k.olusturuldu DESC, k.id DESC
        LIMIT ${SAYFA} OFFSET ${offset}`);
  console.log('\n  — ' + ad + ':');
  for (const s of plan.slice(0, 6)) console.log('    ' + s['QUERY PLAN']);
}

// ── Temizlik ─────────────────────────────────────────────────────────────

await db.end();
if (!KORU) {
  const y = postgres(yonetimUrl, { max: 1, onnotice: () => {} });
  await y`DROP DATABASE IF EXISTS ${y(TEST_DB)}`;
  await y.end();
  console.log('\n  test veritabanı silindi.');
} else {
  console.log('\n  test veritabanı KORUNDU: ' + TEST_DB);
}

// ── Özet ─────────────────────────────────────────────────────────────────

console.log('\n══ ÖZET ══\n');
const esik = 200;   // panel için kabul edilebilir üst sınır
const satirlar = [
  ['Panel: filtresiz sayım', sonuc.sayimFiltresiz],
  ['Panel: 1. sayfa', sonuc.liste1],
  ['Panel: derin sayfa (offset 50k)', sonuc.liste1000],
  ['Panel: son sayfa', sonuc.listeSon],
  ['Panel: trigram arama', sonuc.arama],
  ['Panel: tip filtresi', sonuc.tipFiltre],
  ['Üretim: sahiplenme', sonuc.sahiplenme],
  ['Üretim: delta', sonuc.delta],
];
for (const [ad, v] of satirlar) {
  console.log('  ' + ad.padEnd(36) + ms(v) + '   ' + (v > esik ? 'YAVAŞ' : 'tamam'));
}
const yavas = satirlar.filter(([, v]) => v > esik);
console.log('\n  ' + (yavas.length === 0
  ? 'Hepsi ' + esik + ' ms eşiğinin altında.'
  : yavas.length + ' sorgu ' + esik + ' ms eşiğini aştı.'));
console.log('');

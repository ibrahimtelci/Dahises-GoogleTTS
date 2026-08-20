// Test yardimcilari: izole sema acar, migrasyonlari orada kostur, sonra dusur.
//
// Ayri veritabani yerine ayri SEMA: migrasyonlar sema adi tasimadigi icin
// search_path yeterli, ve boylece "migrasyonlar temiz veritabaninda bastan
// kosuyor" kapisi her test kosusunda gercekten dogrulanmis olur.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { dbAc, type Db } from '../src/veritabani/baglanti.ts';
import { migrasyonlariUygula } from '../src/veritabani/migrasyon.ts';

export const MIGRASYON_DIZINI = fileURLToPath(new URL('../../../migrasyonlar', import.meta.url));

export const VERITABANI_VAR = Boolean(process.env['DATABASE_URL']);

export type TestOrtami = {
  db: Db;
  sema: string;
  bankaDizini: string;
  kapat: () => Promise<void>;
};

let sayac = 0;

export async function testOrtamiAc(): Promise<TestOrtami> {
  const sema = `test_${process.pid}_${++sayac}`;
  const yonetim = dbAc(process.env['DATABASE_URL'] as string);

  await yonetim.unsafe(`DROP SCHEMA IF EXISTS ${sema} CASCADE`);
  await yonetim.unsafe(`CREATE SCHEMA ${sema}`);
  await yonetim.end();

  const db = dbAc(process.env['DATABASE_URL'] as string, {
    connection: { client_encoding: 'UTF8', search_path: `${sema},public` },
  });

  await migrasyonlariUygula(db, MIGRASYON_DIZINI);

  const bankaDizini = await mkdtemp(join(tmpdir(), 'tts-banka-'));

  return {
    db,
    sema,
    bankaDizini,
    kapat: async () => {
      await db.end();
      const y = dbAc(process.env['DATABASE_URL'] as string);
      await y.unsafe(`DROP SCHEMA IF EXISTS ${sema} CASCADE`);
      await y.end();
      await rm(bankaDizini, { recursive: true, force: true });
    },
  };
}

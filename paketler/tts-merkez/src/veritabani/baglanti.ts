// postgres.js — tagged template ile SQL enjeksiyonu varsayılan olarak kapalı.
// ORM yok (kritik kısıt 6): sorgular ham SQL.

import postgres from 'postgres';

export type Db = ReturnType<typeof postgres>;

export function dbAc(url: string, secenekler: Record<string, unknown> = {}): Db {
  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // Türkçe metin doğru dönsün.
    connection: { client_encoding: 'UTF8' },
    onnotice: () => {},
    ...secenekler,
  });
}

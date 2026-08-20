// Fastify sunucusu — sunucu tarafi render (Eta) + HTMX. Build zinciri yok.

import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifySession from '@fastify/session';
import fastifyView from '@fastify/view';
import { Eta } from 'eta';

import type { ButceBekcisi } from '../motor/butce.ts';
import type { MotorVekili } from '../motor/vekil.ts';
import type { KlipDeposu } from '../depo/klip-deposu.ts';
import type { Yapilandirma } from '../yapilandirma.ts';
import type { Db } from '../veritabani/baglanti.ts';
import type { Uretici } from '../uretim/uretici.ts';
import { yetkisiVar, type Rol } from './kimlik.ts';
import { PgOturumDeposu } from './oturum-deposu.ts';

import { kimlikRotalari } from './rotalar/kimlik.ts';
import { kelimeRotalari } from './rotalar/kelimeler.ts';
import { sablonRotalari } from './rotalar/sablonlar.ts';
import { sesRotalari } from './rotalar/sesler.ts';
import { kotaRotalari } from './rotalar/kota.ts';
import { kullaniciRotalari } from './rotalar/kullanicilar.ts';
import { gunlukRotalari } from './rotalar/gunluk.ts';
import { ayarRotalari } from './rotalar/ayarlar.ts';

export type Baglam = {
  db: Db;
  /**
   * Vekil sarmalayici: ayarlar ekranindan Google kimligi degisince ici
   * degistirilir, referans sabit kalir (bkz. motor/vekil.ts).
   */
  motor: MotorVekili;
  depo: KlipDeposu;
  butce: ButceBekcisi;
  uretici: Uretici;
  ayar: Yapilandirma;
};

export type OturumKullanicisi = { id: number; ad: string; rol: Rol; parolaDegistir: boolean };

declare module 'fastify' {
  interface FastifyInstance {
    baglam: Baglam;
  }
  interface Session {
    kullanici?: OturumKullanicisi;
    bildirim?: { tur: 'basari' | 'hata' | 'uyari'; metin: string };
  }
}

const GORUNUM_DIZINI = fileURLToPath(new URL('./gorunum', import.meta.url));

/** Kullanicinin yetkisi yoksa 403. Salt okuma rotalari icin 'oku'. */
export function yetkiGerek(yetki: string) {
  return async (istek: FastifyRequest, yanit: { code: (n: number) => { send: (v: unknown) => unknown } }) => {
    const k = istek.session.kullanici;
    if (!k || !yetkisiVar(k.rol, yetki)) {
      return yanit.code(403).send({ hata: 'Bu işlem için yetkiniz yok.' });
    }
    return undefined;
  };
}

export async function sunucuKur(baglam: Baglam): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: undefined,
    disableRequestLogging: true,
    trustProxy: false,
    bodyLimit: 8 * 1024 * 1024, // CSV yuklemesi
  });

  app.decorate('baglam', baglam);

  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);
  // Toplu ekleme formu CSV/TXT yukleyebiliyor; alanlar `body` icinde toplanir.
  await app.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 20 },
  });
  await app.register(fastifySession, {
    secret: baglam.ayar.OTURUM_GIZLI_ANAHTARI,
    store: new PgOturumDeposu(baglam.db) as never,
    cookieName: 'ttsmerkez_oturum',
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: baglam.ayar.ORTAM === 'uretim',
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    },
    saveUninitialized: false,
  });

  const eta = new Eta({ views: GORUNUM_DIZINI, cache: baglam.ayar.ORTAM === 'uretim' });
  await app.register(fastifyView, {
    engine: { eta },
    root: GORUNUM_DIZINI,
    templates: GORUNUM_DIZINI,
  });

  // GELISTIRME: giris atlama. Uretimde ASLA calismaz — yapilandirma zaten
  // ORTAM='uretim' iken bayragi reddediyor, burada ikinci duvar var.
  const girisAtla = baglam.ayar.GELISTIRME_GIRIS_ATLA && baglam.ayar.ORTAM !== 'uretim';

  // Ortak gorunum verisi + oturum kontrolu.
  app.addHook('preHandler', async (istek, yanit) => {
    const acikYollar = ['/giris', '/saglik', '/statik'];
    const yol = istek.url.split('?')[0] ?? '';
    const acik = acikYollar.some((a) => yol === a || yol.startsWith(a + '/'));

    // Oturum yoksa superadmin olarak ac. Parola degisimi de atlanir.
    if (girisAtla && !istek.session.kullanici) {
      const satirlar = await baglam.db<
        { id: string; kullanici_adi: string; rol: Rol }[]
      >`SELECT id, kullanici_adi, rol FROM kullanici
         WHERE aktif AND rol = 'superadmin' ORDER BY id LIMIT 1`;
      const k = satirlar[0];
      if (k) {
        istek.session.kullanici = {
          id: Number(k.id),
          ad: k.kullanici_adi,
          rol: k.rol,
          parolaDegistir: false,
        };
      }
    }

    if (!acik && !istek.session.kullanici) {
      if (istek.headers['hx-request']) {
        void yanit.header('HX-Redirect', '/giris');
        return yanit.code(401).send('Oturum gerekli');
      }
      return yanit.redirect('/giris');
    }

    // Parola degistirme zorunluysa baska yere gidilmez.
    if (
      !girisAtla &&
      istek.session.kullanici?.parolaDegistir &&
      !yol.startsWith('/parola') &&
      !yol.startsWith('/cikis') &&
      !acik
    ) {
      return yanit.redirect('/parola');
    }
    return undefined;
  });

  app.setErrorHandler(async (hata: unknown, istek, yanit) => {
    // Hasta verisi loglanmaz: yalniz mesaj ve yol.
    const mesaj = (hata as Error)?.message || 'Beklenmeyen hata';
    if (istek.headers['hx-request']) {
      return yanit.code(500).type('text/html; charset=utf-8').send(
        `<div class="uyari hata">${kacir(mesaj)}</div>`,
      );
    }
    return yanit.code(500).view('hata.eta', {
      baslik: 'Hata',
      mesaj,
      kullanici: istek.session.kullanici ?? null,
      aktif: '',
    });
  });

  await app.register(kimlikRotalari);
  await app.register(kelimeRotalari);
  await app.register(sablonRotalari);
  await app.register(sesRotalari);
  await app.register(kotaRotalari);
  await app.register(kullaniciRotalari);
  await app.register(gunlukRotalari);
  await app.register(ayarRotalari);

  app.get('/', async (_istek, yanit) => yanit.redirect('/kelimeler'));

  return app;
}

/** HTML kacisi — sablon disinda string kurarken. */
export function kacir(metin: unknown): string {
  return String(metin)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Her sayfaya giden ortak veri. */
export function sayfaVerisi(
  istek: FastifyRequest,
  ek: Record<string, unknown> = {},
): Record<string, unknown> {
  const bildirim = istek.session.bildirim ?? null;
  if (bildirim) istek.session.bildirim = undefined;
  return {
    kullanici: istek.session.kullanici ?? null,
    bildirim,
    girisAtlaniyor: istek.server.baglam.ayar.GELISTIRME_GIRIS_ATLA &&
      istek.server.baglam.ayar.ORTAM !== 'uretim',
    ...ek,
  };
}

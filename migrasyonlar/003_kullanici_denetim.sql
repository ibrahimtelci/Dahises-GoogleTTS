-- 003 — Kullanıcılar, oturum deposu, denetim günlüğü (§9F Erişim).
--
-- TOTP ve IP kısıtı bu turda UYGULANMADI; kolonlar yeri hazır dursun diye burada.
-- Sunucuya çıkmadan önce gerekli (§9F) — TODO-BLOKE.md.

CREATE TABLE kullanici (
  id             bigserial PRIMARY KEY,
  kullanici_adi  text COLLATE "tr-TR-x-icu" NOT NULL UNIQUE,
  parola_hash    text NOT NULL,                    -- argon2id
  rol            text NOT NULL,                    -- superadmin | operator | izleyici
  aktif          boolean NOT NULL DEFAULT true,
  parola_degistir boolean NOT NULL DEFAULT false,  -- ilk girişte zorunlu değişim
  totp_sirri     text,                             -- STUB: bu turda kullanılmıyor
  totp_aktif     boolean NOT NULL DEFAULT false,   -- STUB
  ip_kisiti      text[],                           -- STUB: izinli CIDR listesi
  son_giris      timestamptz,
  olusturuldu    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kullanici_rol_gecerli CHECK (rol IN ('superadmin', 'operator', 'izleyici'))
);

-- Oturum deposu PostgreSQL'de — Redis yok (§ teknoloji yığını).
CREATE TABLE oturum (
  sid     text PRIMARY KEY,
  veri    jsonb NOT NULL,
  bitis   timestamptz NOT NULL
);

CREATE INDEX oturum_bitis_ix ON oturum (bitis);

-- Denetim günlüğü: kim, ne zaman, ne yaptı. Hasta verisi girmez.
CREATE TABLE denetim_gunlugu (
  id            bigserial PRIMARY KEY,
  kullanici_id  bigint REFERENCES kullanici(id) ON DELETE SET NULL,
  kullanici_adi text,                       -- kullanıcı silinse de iz kalsın
  eylem         text NOT NULL,              -- klip.yeniden_uret | kelime.engelle | kullanici.ekle ...
  hedef         text,
  ayrinti       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            inet,
  zaman         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX denetim_zaman_ix   ON denetim_gunlugu (zaman DESC);
CREATE INDEX denetim_kullanici_ix ON denetim_gunlugu (kullanici_id, zaman DESC);
CREATE INDEX denetim_eylem_ix   ON denetim_gunlugu (eylem, zaman DESC);

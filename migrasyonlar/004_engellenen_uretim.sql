-- 004 — Engellenecekler listesi (§7.5.2) ve üretim günlüğü (§9F).

CREATE TABLE engellenen (
  id          bigserial PRIMARY KEY,
  kelime      text COLLATE "tr-TR-x-icu" NOT NULL UNIQUE,  -- normalize edilmiş, küçük harf
  sebep       text NOT NULL,        -- maskeli | kisaltilmis | test | latin_disi | elle
  aciklama    text,
  ekleyen     text,
  olusturuldu timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engellenen_sebep_gecerli CHECK (
    sebep IN ('maskeli', 'kisaltilmis', 'test', 'latin_disi', 'elle')
  )
);

-- Üretim günlüğü: ne zaman ne üretildi, hata neydi, kaç karakter gitti.
CREATE TABLE uretim_gunlugu (
  id           bigserial PRIMARY KEY,
  tur          text NOT NULL,          -- tasiyici | tam_cumle | deneme | supurucu | kota
  profil       text,
  tiyer        text,
  klip_sayisi  int  NOT NULL DEFAULT 0,
  karakter     int  NOT NULL DEFAULT 0,
  sure_ms      int,
  basarili     boolean NOT NULL DEFAULT true,
  hata         text,
  ayrinti      jsonb NOT NULL DEFAULT '{}'::jsonb,
  zaman        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX uretim_gunlugu_zaman_ix ON uretim_gunlugu (zaman DESC);
CREATE INDEX uretim_gunlugu_tur_ix   ON uretim_gunlugu (tur, zaman DESC);

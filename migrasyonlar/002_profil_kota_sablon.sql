-- 002 — Ses profilleri, tiyer tanımları, kota sayacı, şablonlar (§6.4, §6.6, §7.4).

-- Tiyer tanımı veriden gelir, koddan değil: aylık kota ve kesme desteği burada.
CREATE TABLE tiyer (
  kod            text PRIMARY KEY,          -- standard | wavenet | chirp3hd
  ad             text NOT NULL,
  aylik_kota     bigint NOT NULL,           -- karakter
  sert_oran      numeric(4,3) NOT NULL DEFAULT 0.90,   -- §6.4: kotanın %90'ı
  uyari_oran     numeric(4,3) NOT NULL DEFAULT 0.70,
  kritik_oran    numeric(4,3) NOT NULL DEFAULT 0.85,
  kesme_destegi  boolean NOT NULL DEFAULT true,
  not_metni      text
);

INSERT INTO tiyer (kod, ad, aylik_kota, kesme_destegi, not_metni) VALUES
  ('standard',  'Standard',    4000000, true,  NULL),
  ('wavenet',   'WaveNet',     1000000, true,  NULL),
  ('chirp3hd',  'Chirp 3 HD',  1000000, false,
   'Kesme yöntemini desteklemiyor: SSML <mark> etiketlerine sıfır zaman damgası dönüyor (§6.6). Seçilemez.');

-- Kota sayacı tiyer bazlı ve dönemseldir; Standard 4M ile WaveNet 1M ayrı havuzlardır.
CREATE TABLE kota (
  tiyer        text        NOT NULL REFERENCES tiyer(kod),
  donem        date        NOT NULL,          -- date_trunc('month', now())
  kullanilan   bigint      NOT NULL DEFAULT 0,
  limit_sert   bigint      NOT NULL,
  limit_toplam bigint      NOT NULL,
  guncellendi  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tiyer, donem),
  CONSTRAINT kota_kullanilan_pozitif CHECK (kullanilan >= 0)
);

-- Ses profili (§6.6). Örnekleme hızı koda gömülmez, buradan okunur.
CREATE TABLE ses_profili (
  id          text PRIMARY KEY,              -- kadin-1 | erkek-1 ...
  motor       text NOT NULL DEFAULT 'google',
  motor_sesi  text NOT NULL,                 -- tr-TR-Standard-A
  tiyer       text NOT NULL REFERENCES tiyer(kod),
  ornek_hizi  int  NOT NULL,
  cinsiyet    text,
  varsayilan  boolean NOT NULL DEFAULT false,
  aktif       boolean NOT NULL DEFAULT true,
  olusturuldu timestamptz NOT NULL DEFAULT now()
);

-- Tek varsayılan profil.
CREATE UNIQUE INDEX ses_profili_tek_varsayilan_ix ON ses_profili ((varsayilan)) WHERE varsayilan;

-- Şablon (cümle kalıbı). ogeler: taşıyıcıdaki yuva sırası, §7.4.
CREATE TABLE sablon (
  id          bigserial PRIMARY KEY,
  ad          text NOT NULL UNIQUE,
  metin       text NOT NULL,                 -- 'sayın {ad} {soyad} lütfen {banko} nolu bankoya geçiniz'
  ogeler      jsonb NOT NULL DEFAULT '[]'::jsonb,
  varsayilan  boolean NOT NULL DEFAULT false,
  olusturuldu timestamptz NOT NULL DEFAULT now(),
  guncellendi timestamptz NOT NULL DEFAULT now()
);

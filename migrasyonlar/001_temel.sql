-- 001 — Klip kayıt defteri çekirdeği (§9A).
--
-- Kelime kolonlarında COLLATE "tr-TR-x-icu": aksi halde lower('İ') beklenen
-- sonucu vermez ve UNIQUE(kelime,profil) Türkçe eşdeğerleri ayrı satır sanar.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Ses verisi: (kelime, profil) başına TEK satır.
CREATE TABLE klip (
  id             bigserial PRIMARY KEY,
  kelime         text COLLATE "tr-TR-x-icu" NOT NULL,  -- normalize edilmiş hali
  telaffuz       text COLLATE "tr-TR-x-icu",           -- TTS'e FİİLEN gönderilen metin; NULL ise kelime
  profil         text        NOT NULL,
  durum          text        NOT NULL,
  hash           text,                                  -- PCM baytlarının sha256'sı; dosya yolu bundan türer
  sure_ms        int,
  surum          int,
  kaynak         text        NOT NULL DEFAULT 'toplu',  -- toplu | fallback | deneme
  deneme         int         NOT NULL DEFAULT 0,
  sonraki_deneme timestamptz NOT NULL DEFAULT now(),    -- üstel geri çekilme (§9A)
  hata           text,
  sahiplenildi   timestamptz,
  son_kullanim   timestamptz,
  olusturuldu    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kelime, profil),
  CONSTRAINT klip_durum_gecerli CHECK (
    durum IN ('pending', 'uretiliyor', 'ready', 'failed', 'engellendi', 'kota_bekliyor')
  ),
  CONSTRAINT klip_kaynak_gecerli CHECK (kaynak IN ('toplu', 'fallback', 'deneme'))
);

CREATE INDEX klip_profil_surum_ix   ON klip (profil, surum)          WHERE durum = 'ready';
CREATE INDEX klip_sahiplenme_ix     ON klip (durum, sahiplenildi)    WHERE durum = 'pending';
CREATE INDEX klip_yeniden_deneme_ix ON klip (durum, sonraki_deneme)  WHERE durum IN ('pending', 'failed');
CREATE INDEX klip_kelime_trgm_ix    ON klip USING gin (kelime gin_trgm_ops);
CREATE INDEX klip_son_kullanim_ix   ON klip (son_kullanim)           WHERE durum = 'ready';

-- Admin tablosunun varsayılan görünümü "çevrilmemişler önce" (§9F) — sayfalama bu indeksi kullanır.
CREATE INDEX klip_liste_ix ON klip (durum, olusturuldu DESC, id DESC);

COMMENT ON COLUMN klip.hash IS
  'Klip dosyası içerik adreslidir, yol kolonu tutulmaz: veri/banka/<profil>/<hash[0:2]>/<hash[2:4]>/<hash>.pcm';
COMMENT ON COLUMN klip.telaffuz IS
  'Yanlış okunan ismi düzeltmenin tek yolu (§9A). NULL ise kelime gönderilir.';

-- Kullanım bağlamı: aynı klip birden çok tipte / hastanede geçebilir.
CREATE TABLE klip_kapsam (
  klip_id     bigint NOT NULL REFERENCES klip(id) ON DELETE CASCADE,
  tip         text   NOT NULL,   -- ad | soyad | sayi | kalip | ton | poliklinik | doktor
  hastane_id  int    NOT NULL DEFAULT 0,   -- 0 = ortak havuz (NULL değil, §9A)
  PRIMARY KEY (klip_id, tip, hastane_id)
);

CREATE INDEX klip_kapsam_hastane_ix ON klip_kapsam (hastane_id);
CREATE INDEX klip_kapsam_tip_ix     ON klip_kapsam (tip);

-- Profil başına monoton artan banka versiyonu.
-- nextval() KULLANILMAZ (§A.2): güvenlik UPDATE'in satır kilidi tutmasından gelir.
CREATE TABLE banka_surum (
  profil text PRIMARY KEY,
  surum  int  NOT NULL DEFAULT 0
);

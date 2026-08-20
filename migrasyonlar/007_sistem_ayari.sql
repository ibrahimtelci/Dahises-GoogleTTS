-- 007 — Calisma aninda degistirilebilen sistem ayarlari.
--
-- Gerekce: Google API anahtari ve varsayilan ses yalniz .env'den okunuyordu;
-- degistirmek icin dosyayi duzenleyip sunucuyu yeniden baslatmak gerekiyordu.
-- Panel kullanicisinin sunucuya erisimi olmayabilir.
--
-- Oncelik: bu tablodaki deger > .env. Tablo bosken .env gecerli kalir, yani
-- mevcut kurulumlar hicbir sey degistirmeden calismaya devam eder.
--
-- SIR SAKLAMA NOTU: google_api_anahtari burada duz metin durur. Veritabani
-- yedegi (pg_dump) bu anahtari icerir — yedekler .gitignore'da ve yedek/
-- dizini disari cikarilmamali. Arayuz anahtari asla tam gostermez, yalniz
-- son 4 karakterini maskeleyerek gosterir.

CREATE TABLE sistem_ayari (
  anahtar     text PRIMARY KEY,
  deger       text,
  guncelleyen bigint REFERENCES kullanici(id) ON DELETE SET NULL,
  guncellendi timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sistem_ayari IS
  'Calisma aninda degistirilebilen ayarlar. .env''i EZER. Bkz. migrasyon 007.';

-- Bilinen anahtarlar (satir yoksa .env gecerli):
--   google_api_anahtari   Google Cloud TTS API anahtari
--   google_servis_hesabi  Service account JSON dosya yolu

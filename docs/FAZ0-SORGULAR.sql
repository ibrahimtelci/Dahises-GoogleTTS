/* =============================================================================
   Faz 0 — Ölçüm sorguları  (SQL Server / T-SQL)
   Tablo: CAGRI

   SESLENDIRME-SERVISI.md §12'deki sorgular PostgreSQL içindi; gerçek sistem
   SQL Server olduğu için hepsi burada yeniden yazıldı.

   Sıra önemli: 1 ve 3 numaralı sorgular banka boyutunu ve maliyeti belirler,
   diğerleri onların üzerine kurulur. Her bölümün başında hangi kararı
   beslediği yazıyor.

   NOT: STRING_SPLIT SQL Server 2016+ gerektirir. Daha eskisinde bölümlerdeki
   token çıkarma için XML tabanlı bir alternatif gerekir (bkz. dosya sonu).
   ============================================================================= */


/* -----------------------------------------------------------------------------
   0. KAPSAM — elimizdeki veri ne kadar güvenilir?
   Besler: §3'teki "bölen tutarsız" uyarısı. Gün sayısı beklenenden azsa
   saatlik ortalamalar şişkin demektir.
   ----------------------------------------------------------------------------- */
SELECT
    COUNT(*)                                        AS toplam_cagri,
    MIN(CAGRI_ZAMANI)                               AS ilk_cagri,
    MAX(CAGRI_ZAMANI)                               AS son_cagri,
    COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date))      AS farkli_gun,
    DATEDIFF(day, MIN(CAGRI_ZAMANI), MAX(CAGRI_ZAMANI)) + 1 AS takvim_gunu,
    COUNT(DISTINCT EKRAN_ID)                        AS ekran_sayisi,
    SUM(CASE WHEN MASKELEME = 1 THEN 1 ELSE 0 END)  AS maskeli_cagri,
    CAST(100.0 * SUM(CASE WHEN MASKELEME = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)
         AS decimal(5,2))                           AS maskeli_yuzde
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -90, GETDATE());
GO


/* -----------------------------------------------------------------------------
   1. MASKELEME — bankayı doğrudan etkiler, önce buna bak.
   MASKELEME=1 olan kayıtlarda ad nasıl görünüyor? "Ahmet Y***" gibiyse o isim
   seslendirilemez; hangi oranda olduğu degrade yolunun ne sıklıkta çalışacağını
   belirler (§4.3).
   ----------------------------------------------------------------------------- */
SELECT TOP 30
    MASKELEME,
    ADI_SOYADI,
    COUNT(*) AS adet
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -30, GETDATE())
  AND MASKELEME = 1
GROUP BY MASKELEME, ADI_SOYADI
ORDER BY adet DESC;
GO

-- Yıldız/nokta içeren adların oranı (maskeleme bayrağı set edilmemiş olabilir)
SELECT
    COUNT(*)                                                       AS toplam,
    SUM(CASE WHEN ADI_SOYADI LIKE '%*%' THEN 1 ELSE 0 END)         AS yildizli,
    SUM(CASE WHEN ADI_SOYADI LIKE '%.%' THEN 1 ELSE 0 END)         AS noktali,
    SUM(CASE WHEN LEN(LTRIM(RTRIM(ADI_SOYADI))) < 5 THEN 1 ELSE 0 END) AS cok_kisa
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -30, GETDATE());
GO


/* -----------------------------------------------------------------------------
   2. TOKEN ÇIKARMA — sonraki tüm sorgular bu geçici tabloyu kullanır.
   ADI_SOYADI tek alan; ad ve soyad ayrı kolonlarda DEĞİL. Boşluktan bölüyoruz.
   Türkçe collation şart: Türkçe olmayan collation'da LOWER('İ') beklenen
   sonucu vermez (§7.5 kural 7).
   ----------------------------------------------------------------------------- */
IF OBJECT_ID('tempdb..#token') IS NOT NULL DROP TABLE #token;

SELECT
    c.CAGRI_ID,
    LOWER(LTRIM(RTRIM(s.value)) COLLATE Turkish_CI_AS) AS token,
    ROW_NUMBER() OVER (PARTITION BY c.CAGRI_ID ORDER BY (SELECT NULL)) AS sira_no_token,
    CAST(c.CAGRI_ZAMANI AS date) AS gun
INTO #token
FROM CAGRI c
CROSS APPLY STRING_SPLIT(
    REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.ADI_SOYADI)), CHAR(9), ' '), CHAR(160), ' '), '  ', ' '),
    ' ') s
WHERE c.CAGRI_ZAMANI >= DATEADD(day, -30, GETDATE())
  AND c.MASKELEME = 0
  AND LTRIM(RTRIM(s.value)) <> '';

CREATE INDEX ix_token ON #token (token);
GO

-- Kaç token, kaç farklı token?
SELECT COUNT(*) AS toplam_token, COUNT(DISTINCT token) AS farkli_token FROM #token;
GO


/* -----------------------------------------------------------------------------
   3. KÜMÜLATİF KAPSAM — BU SORGU BANKA BOYUTUNU BELİRLER.
   Besler: §7.2 (klip sayısı) ve §6.3 (karakter maliyeti).
   Dokümandaki 30.000 soyad rakamı TAHMİNDİR; gerçek cevap burada.

   Okuma biçimi: "ilk N token, çağrılardaki tokenların yüzde kaçını karşılıyor?"
   %97-98'e hangi N'de ulaşıldığı, üretilecek klip sayısıdır.
   ----------------------------------------------------------------------------- */
WITH frekans AS (
    SELECT token, COUNT(*) AS adet
    FROM #token
    GROUP BY token
),
sirali AS (
    SELECT
        token,
        adet,
        ROW_NUMBER() OVER (ORDER BY adet DESC, token)                              AS sira,
        SUM(adet) OVER (ORDER BY adet DESC, token ROWS UNBOUNDED PRECEDING)        AS kumulatif,
        SUM(adet) OVER ()                                                          AS genel_toplam
    FROM frekans
)
SELECT
    sira,
    token,
    adet,
    kumulatif,
    CAST(100.0 * kumulatif / genel_toplam AS decimal(6,3)) AS kumulatif_yuzde
FROM sirali
WHERE sira IN (100, 250, 500, 1000, 2000, 3000, 5000, 7500, 10000,
               15000, 20000, 30000, 40000, 50000, 75000, 100000)
ORDER BY sira;
GO

-- Belirli kapsam eşiklerine kaç token gerekiyor? (yukarıdakinin tersi)
WITH frekans AS (
    SELECT token, COUNT(*) AS adet FROM #token GROUP BY token
),
sirali AS (
    SELECT
        ROW_NUMBER() OVER (ORDER BY adet DESC, token)                       AS sira,
        SUM(adet) OVER (ORDER BY adet DESC, token ROWS UNBOUNDED PRECEDING) AS kumulatif,
        SUM(adet) OVER ()                                                   AS genel_toplam
    FROM frekans
)
SELECT
    hedef.yuzde                       AS hedef_kapsam_yuzde,
    MIN(sirali.sira)                  AS gereken_token_sayisi
FROM sirali
CROSS JOIN (VALUES (90.0), (95.0), (97.0), (98.0), (99.0), (99.5)) AS hedef(yuzde)
WHERE 100.0 * sirali.kumulatif / sirali.genel_toplam >= hedef.yuzde
GROUP BY hedef.yuzde
ORDER BY hedef.yuzde;
GO


/* -----------------------------------------------------------------------------
   4. YENİ TOKEN GELME HIZI — fallback oranını ve büyümeyi projekte eder.
   Besler: §7.3 (yıllık büyüme) ve §9B (fallback yolunun ne sıklıkta çalışacağı).
   İlk 3 haftada hiç görülmeyip son haftada ortaya çıkan token sayısı.
   ----------------------------------------------------------------------------- */
WITH ilk_donem AS (
    SELECT DISTINCT token FROM #token
    WHERE gun <  CAST(DATEADD(day, -7, GETDATE()) AS date)
),
son_donem AS (
    SELECT token, COUNT(*) AS adet FROM #token
    WHERE gun >= CAST(DATEADD(day, -7, GETDATE()) AS date)
    GROUP BY token
)
SELECT
    (SELECT COUNT(*) FROM ilk_donem)                                   AS ilk_3_hafta_farkli_token,
    COUNT(*)                                                           AS son_hafta_farkli_token,
    SUM(CASE WHEN i.token IS NULL THEN 1 ELSE 0 END)                   AS son_hafta_YENI_token,
    SUM(CASE WHEN i.token IS NULL THEN s.adet ELSE 0 END)              AS yeni_tokenli_cagri,
    SUM(s.adet)                                                        AS son_hafta_toplam_token,
    CAST(100.0 * SUM(CASE WHEN i.token IS NULL THEN s.adet ELSE 0 END)
         / NULLIF(SUM(s.adet), 0) AS decimal(6,3))                     AS tahmini_fallback_yuzde
FROM son_donem s
LEFT JOIN ilk_donem i ON i.token = s.token;
GO


/* -----------------------------------------------------------------------------
   5. AD+SOYAD BİRLEŞİK — birleşik klip önerisinin maliyeti.
   Besler: "ad ve soyad tek klip olsun" önerisi.
   Ayrı tutulursa kardinalite token sayısıdır (sorgu 3); birleşik tutulursa
   BURADAKİ sayıdır ve doymaz — her yeni hasta yeni bir klip demektir.
   ----------------------------------------------------------------------------- */
WITH cift AS (
    SELECT DISTINCT LOWER(LTRIM(RTRIM(ADI_SOYADI)) COLLATE Turkish_CI_AS) AS tam_ad
    FROM CAGRI
    WHERE CAGRI_ZAMANI >= DATEADD(day, -30, GETDATE())
      AND MASKELEME = 0
      AND LTRIM(RTRIM(ADI_SOYADI)) <> ''
)
SELECT
    COUNT(*)                                              AS farkli_tam_ad_30gun,
    AVG(CAST(LEN(tam_ad) AS float))                       AS ortalama_karakter,
    COUNT(*) * AVG(CAST(LEN(tam_ad) AS float))            AS tahmini_karakter_30gun,
    COUNT(*) * 12                                         AS kaba_yillik_tahmin_klip
FROM cift;
GO

-- Bir tam adın kaç kez tekrarlandığı (tekrar yoksa önbellek işe yaramaz)
WITH cift AS (
    SELECT LOWER(LTRIM(RTRIM(ADI_SOYADI)) COLLATE Turkish_CI_AS) AS tam_ad, COUNT(*) AS adet
    FROM CAGRI
    WHERE CAGRI_ZAMANI >= DATEADD(day, -30, GETDATE()) AND MASKELEME = 0
    GROUP BY LOWER(LTRIM(RTRIM(ADI_SOYADI)) COLLATE Turkish_CI_AS)
)
SELECT
    COUNT(*)                                          AS farkli_tam_ad,
    SUM(adet)                                         AS toplam_cagri,
    CAST(AVG(CAST(adet AS float)) AS decimal(6,2))    AS ortalama_tekrar,
    SUM(CASE WHEN adet = 1 THEN 1 ELSE 0 END)         AS sadece_bir_kez_gorulen,
    CAST(100.0 * SUM(CASE WHEN adet = 1 THEN 1 ELSE 0 END) / COUNT(*) AS decimal(5,2)) AS tek_seferlik_yuzde
FROM cift;
GO


/* -----------------------------------------------------------------------------
   6. TÜRKÇE ALFABE DIŞI TOKENLAR — normalizasyon kurallarını veriye göre yaz.
   Besler: §7.5 kural 6.
   ----------------------------------------------------------------------------- */
WITH frekans AS (
    SELECT token, COUNT(*) AS adet FROM #token GROUP BY token
)
SELECT TOP 200
    token,
    adet,
    CASE
        WHEN token COLLATE Latin1_General_BIN LIKE '%[qwxQWX]%' THEN 'q/w/x'
        WHEN token LIKE '%[0-9]%'                               THEN 'rakam'
        WHEN token LIKE '%[^a-zçğıöşü ]%' COLLATE Turkish_CI_AS THEN 'diğer/aksanlı'
        ELSE 'bilinmiyor'
    END AS sinif
FROM frekans
WHERE token COLLATE Latin1_General_BIN LIKE '%[qwxQWX]%'
   OR token LIKE '%[0-9]%'
   OR token LIKE '%[^a-zçğıöşü ]%' COLLATE Turkish_CI_AS
ORDER BY adet DESC;
GO

-- Kirli veri: tek harfli, sayısal veya test görünen tokenlar (engellenecekler listesi)
SELECT TOP 100 token, COUNT(*) AS adet
FROM #token
WHERE LEN(token) <= 2
   OR token LIKE '%test%'
   OR token LIKE '%[0-9]%'
GROUP BY token
ORDER BY adet DESC;
GO


/* -----------------------------------------------------------------------------
   7. DOKTOR / SERVİS / TRİAJ — hastane bazlı klipler.
   Besler: §6.3 ve §7.2'deki doktor+poliklinik satırları.
   ----------------------------------------------------------------------------- */
SELECT
    COUNT(DISTINCT DR_ADI)      AS farkli_doktor,
    COUNT(DISTINCT SERVIS_ADI)  AS farkli_servis,
    COUNT(DISTINCT TRIAJ_ADI)   AS farkli_triaj,
    COUNT(DISTINCT CAGRI_TIPI)  AS farkli_cagri_tipi
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -90, GETDATE());
GO

-- Unvan açılımı gerekiyor mu? (§7.5 kural 5 — "Op. Dr." harf harf okunur)
SELECT TOP 100 DR_ADI, COUNT(*) AS adet, LEN(DR_ADI) AS karakter
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -90, GETDATE()) AND DR_ADI IS NOT NULL
GROUP BY DR_ADI
ORDER BY adet DESC;
GO

SELECT TOP 100 SERVIS_ADI, COUNT(*) AS adet
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -90, GETDATE()) AND SERVIS_ADI IS NOT NULL
GROUP BY SERVIS_ADI
ORDER BY adet DESC;
GO


/* -----------------------------------------------------------------------------
   8. BANKO_NO ve SIRA_NO — sayı kliplerinin aralığını belirler.
   Besler: §6.3 dipnotu (bileşen mi, bütün sayı mı).
   Aralık darsa (örn. 1-30) sayıları BÜTÜN üretmek en iyisi: tonlama riski
   ortadan kalkar ve maliyet ihmal edilebilir.
   ----------------------------------------------------------------------------- */
SELECT
    COUNT(DISTINCT BANKO_NO)                                            AS farkli_banko,
    SUM(CASE WHEN TRY_CAST(BANKO_NO AS int) IS NULL AND BANKO_NO IS NOT NULL
             THEN 1 ELSE 0 END)                                         AS sayisal_olmayan_banko,
    MIN(TRY_CAST(BANKO_NO AS int))                                      AS en_kucuk_banko,
    MAX(TRY_CAST(BANKO_NO AS int))                                      AS en_buyuk_banko,
    COUNT(DISTINCT SIRA_NO)                                             AS farkli_sira,
    SUM(CASE WHEN TRY_CAST(SIRA_NO AS int) IS NULL AND SIRA_NO IS NOT NULL
             THEN 1 ELSE 0 END)                                         AS sayisal_olmayan_sira,
    MIN(TRY_CAST(SIRA_NO AS int))                                       AS en_kucuk_sira,
    MAX(TRY_CAST(SIRA_NO AS int))                                       AS en_buyuk_sira
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -90, GETDATE());
GO

-- Sayısal olmayan değerler neye benziyor? ("A-12", "B3" gibi ise şablon değişir)
SELECT TOP 50 BANKO_NO, COUNT(*) AS adet
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -90, GETDATE())
  AND BANKO_NO IS NOT NULL
  AND TRY_CAST(BANKO_NO AS int) IS NULL
GROUP BY BANKO_NO
ORDER BY adet DESC;
GO


/* -----------------------------------------------------------------------------
   9. ÇAĞRI TİPİ DAĞILIMI — kaç farklı şablon gerekiyor?
   Besler: §4.5 (kayıtlı şablonlar) ve Faz 0 madde 4.
   ----------------------------------------------------------------------------- */
SELECT
    CAGRI_TIPI,
    COUNT(*)                                                        AS adet,
    CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5,2))  AS yuzde,
    COUNT(DISTINCT EKRAN_ID)                                        AS ekran_sayisi,
    SUM(CASE WHEN BANKO_NO IS NOT NULL THEN 1 ELSE 0 END)           AS bankolu,
    SUM(CASE WHEN DR_ADI   IS NOT NULL THEN 1 ELSE 0 END)           AS doktorlu,
    SUM(CASE WHEN SERVIS_ADI IS NOT NULL THEN 1 ELSE 0 END)         AS servisli
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -90, GETDATE())
GROUP BY CAGRI_TIPI
ORDER BY adet DESC;
GO


/* -----------------------------------------------------------------------------
   10. SAATLİK YÜK — §3'teki tabloyu doğrular.
   Bölen açıkça yazılıyor; dokümandaki tutarsızlık bu yüzden çıkmıştı.
   ----------------------------------------------------------------------------- */
SELECT
    DATEPART(hour, CAGRI_ZAMANI)                            AS saat,
    COUNT(*)                                                AS toplam_cagri,
    COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date))              AS gun_sayisi,
    CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date)), 0)
         AS decimal(10,1))                                  AS gunluk_ortalama,
    CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date)), 0) / 3600.0
         AS decimal(10,4))                                  AS istek_sn
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -30, GETDATE())
GROUP BY DATEPART(hour, CAGRI_ZAMANI)
ORDER BY saat;
GO

-- En yoğun tek ekranın tepe saati — sistemin gerçek sınırı (§10 "ekran doluluğu")
SELECT TOP 20
    EKRAN_ID,
    DATEPART(hour, CAGRI_ZAMANI)                            AS saat,
    COUNT(*)                                                AS toplam,
    CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date)), 0)
         AS decimal(10,1))                                  AS saatlik_ortalama
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -30, GETDATE())
GROUP BY EKRAN_ID, DATEPART(hour, CAGRI_ZAMANI)
ORDER BY saatlik_ortalama DESC;
GO


/* -----------------------------------------------------------------------------
   EK: STRING_SPLIT yoksa (SQL Server 2016 öncesi) token çıkarma alternatifi
   ----------------------------------------------------------------------------- */
-- IF OBJECT_ID('tempdb..#token') IS NOT NULL DROP TABLE #token;
--
-- ;WITH x AS (
--     SELECT CAGRI_ID,
--            CAST('<t>' + REPLACE(LTRIM(RTRIM(ADI_SOYADI)), ' ', '</t><t>') + '</t>' AS xml) AS parcalar,
--            CAST(CAGRI_ZAMANI AS date) AS gun
--     FROM CAGRI
--     WHERE CAGRI_ZAMANI >= DATEADD(day, -30, GETDATE()) AND MASKELEME = 0
-- )
-- SELECT x.CAGRI_ID,
--        LOWER(LTRIM(RTRIM(p.value('.', 'nvarchar(300)'))) COLLATE Turkish_CI_AS) AS token,
--        x.gun
-- INTO #token
-- FROM x CROSS APPLY parcalar.nodes('/t') AS n(p)
-- WHERE LTRIM(RTRIM(p.value('.', 'nvarchar(300)'))) <> '';

/* =============================================================================
   Faz 0 — TEK SEFERDE çalışan ölçüm betiği  (SQL Server / T-SQL)

   Tamamı tek batch; GO yok. Sonunda TEK bir sonuç tablosu döner:
       bolum | metrik | deger
   Sonucu olduğu gibi kopyalayıp paylaşabilirsiniz.

   Çalıştırma: SSMS'te aç, veritabanını seç, F5.
   Süre: 30 günlük veride tipik olarak birkaç saniye.

   Gereksinim: SQL Server 2016+ (STRING_SPLIT). Yoksa dosya sonundaki nota bakın.
   ============================================================================= */

SET NOCOUNT ON;

DECLARE @gun_ad    int = 30;    -- isim analizinin penceresi
DECLARE @gun_genel int = 90;    -- doktor/servis/banko analizinin penceresi

IF OBJECT_ID('tempdb..#sonuc') IS NOT NULL DROP TABLE #sonuc;
CREATE TABLE #sonuc (
    sira    int IDENTITY(1,1),
    bolum   nvarchar(40),
    metrik  nvarchar(200),
    deger   nvarchar(400)
);

/* -- 0. KAPSAM ------------------------------------------------------------ */
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '0-kapsam', m, d FROM (
    SELECT '01 toplam cagri (' + CAST(@gun_genel AS varchar) + ' gun)' AS m,
           CAST(COUNT(*) AS nvarchar(400)) AS d
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '02 ilk cagri',   CONVERT(nvarchar(30), MIN(CAGRI_ZAMANI), 120) FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '03 son cagri',   CONVERT(nvarchar(30), MAX(CAGRI_ZAMANI), 120) FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '04 farkli gun',  CAST(COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date)) AS nvarchar(400)) FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '05 takvim gunu', CAST(DATEDIFF(day, MIN(CAGRI_ZAMANI), MAX(CAGRI_ZAMANI)) + 1 AS nvarchar(400)) FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '06 farkli ekran',CAST(COUNT(DISTINCT EKRAN_ID) AS nvarchar(400)) FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '07 farkli oda',  CAST(COUNT(DISTINCT ODA_ID) AS nvarchar(400)) FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
) t;

/* -- 1. MASKELEME --------------------------------------------------------- */
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '1-maskeleme', m, d FROM (
    SELECT '01 maskeli cagri' AS m, CAST(SUM(CASE WHEN MASKELEME = 1 THEN 1 ELSE 0 END) AS nvarchar(400)) AS d
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE())
    UNION ALL SELECT '02 maskeli yuzde',
        CAST(CAST(100.0 * SUM(CASE WHEN MASKELEME = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0) AS decimal(6,2)) AS nvarchar(400))
        FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE())
    UNION ALL SELECT '03 yildiz iceren ad',
        CAST(SUM(CASE WHEN ADI_SOYADI LIKE '%*%' THEN 1 ELSE 0 END) AS nvarchar(400))
        FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE())
    UNION ALL SELECT '04 nokta iceren ad',
        CAST(SUM(CASE WHEN ADI_SOYADI LIKE '%.%' THEN 1 ELSE 0 END) AS nvarchar(400))
        FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE())
    UNION ALL SELECT '05 cok kisa ad (<5)',
        CAST(SUM(CASE WHEN LEN(LTRIM(RTRIM(ADI_SOYADI))) < 5 THEN 1 ELSE 0 END) AS nvarchar(400))
        FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE())
) t;

-- Maskeli adlar neye benziyor? (ilk 8 örnek)
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT TOP 8 '1-maskeleme', '06 maskeli ornek', ADI_SOYADI
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE()) AND MASKELEME = 1
GROUP BY ADI_SOYADI
ORDER BY COUNT(*) DESC;

/* -- 2. TOKEN CIKARMA ----------------------------------------------------- */
IF OBJECT_ID('tempdb..#token') IS NOT NULL DROP TABLE #token;

SELECT
    c.CAGRI_ID,
    LOWER(LTRIM(RTRIM(s.value)) COLLATE Turkish_CI_AS) AS token,
    CAST(c.CAGRI_ZAMANI AS date)                       AS gun
INTO #token
FROM CAGRI c
CROSS APPLY STRING_SPLIT(
    REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.ADI_SOYADI)), CHAR(9), ' '), CHAR(160), ' '), '  ', ' '),
    ' ') s
WHERE c.CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE())
  AND c.MASKELEME = 0
  AND LTRIM(RTRIM(s.value)) <> '';

CREATE INDEX ix_token ON #token (token);

IF OBJECT_ID('tempdb..#frekans') IS NOT NULL DROP TABLE #frekans;
SELECT token, COUNT(*) AS adet
INTO #frekans
FROM #token
GROUP BY token;

INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '2-token', m, d FROM (
    SELECT '01 toplam token' AS m, CAST(COUNT(*) AS nvarchar(400)) AS d FROM #token
    UNION ALL SELECT '02 FARKLI token', CAST(COUNT(*) AS nvarchar(400)) FROM #frekans
    UNION ALL SELECT '03 cagri sayisi (maskesiz)', CAST(COUNT(DISTINCT CAGRI_ID) AS nvarchar(400)) FROM #token
    UNION ALL SELECT '04 ad basina ort. token',
        CAST(CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT CAGRI_ID),0) AS decimal(6,3)) AS nvarchar(400)) FROM #token
) t;

/* -- 3. KUMULATIF KAPSAM  << BANKA BOYUTUNU BU BELIRLER >> ---------------- */
IF OBJECT_ID('tempdb..#sirali') IS NOT NULL DROP TABLE #sirali;
SELECT
    token,
    adet,
    ROW_NUMBER() OVER (ORDER BY adet DESC, token)                       AS sira,
    SUM(adet) OVER (ORDER BY adet DESC, token ROWS UNBOUNDED PRECEDING) AS kumulatif,
    SUM(adet) OVER ()                                                   AS genel
INTO #sirali
FROM #frekans;

-- (a) Hedef kapsam icin kac token gerekiyor?  << EN KRITIK SATIRLAR >>
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '3-kapsam', '01 %' + CAST(h.yuzde AS nvarchar(10)) + ' icin gereken token',
       CAST(MIN(s.sira) AS nvarchar(400))
FROM #sirali s
CROSS JOIN (VALUES (CAST(90.0 AS decimal(5,1))), (95.0), (97.0), (98.0), (99.0), (99.5)) AS h(yuzde)
WHERE 100.0 * s.kumulatif / s.genel >= h.yuzde
GROUP BY h.yuzde;

-- (b) Sabit N degerlerinde kapsam yuzdesi
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '3-kapsam', '02 ilk ' + RIGHT('000000' + CAST(s.sira AS nvarchar(10)), 6) + ' token kapsami',
       CAST(CAST(100.0 * s.kumulatif / s.genel AS decimal(6,3)) AS nvarchar(400)) + ' %'
FROM #sirali s
WHERE s.sira IN (100, 500, 1000, 2000, 5000, 10000, 20000, 30000, 50000, 75000, 100000);

-- (c) En sik 15 token (ad havuzunun basi nasil gorunuyor)
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT TOP 15 '3-kapsam', '03 en sik token', token + '  (' + CAST(adet AS nvarchar(20)) + ')'
FROM #frekans ORDER BY adet DESC;

-- (d) Yalnizca 1 kez gorulen token orani (uzun kuyruk ne kadar agir?)
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '3-kapsam', m, d FROM (
    SELECT '04 tek kez gorulen token' AS m, CAST(SUM(CASE WHEN adet = 1 THEN 1 ELSE 0 END) AS nvarchar(400)) AS d FROM #frekans
    UNION ALL SELECT '05 tek kez gorulen yuzde',
        CAST(CAST(100.0 * SUM(CASE WHEN adet = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0) AS decimal(6,2)) AS nvarchar(400)) + ' %'
        FROM #frekans
) t;

/* -- 4. YENI TOKEN GELME HIZI (fallback projeksiyonu) --------------------- */
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '4-yeni-token', m, d FROM (
    SELECT '01 ilk donem farkli token' AS m,
           CAST((SELECT COUNT(DISTINCT token) FROM #token WHERE gun < CAST(DATEADD(day,-7,GETDATE()) AS date)) AS nvarchar(400)) AS d
    UNION ALL SELECT '02 son hafta farkli token',
           CAST((SELECT COUNT(DISTINCT token) FROM #token WHERE gun >= CAST(DATEADD(day,-7,GETDATE()) AS date)) AS nvarchar(400))
    UNION ALL SELECT '03 son hafta YENI token',
           CAST((SELECT COUNT(*) FROM (
                    SELECT DISTINCT token FROM #token WHERE gun >= CAST(DATEADD(day,-7,GETDATE()) AS date)
                    EXCEPT
                    SELECT DISTINCT token FROM #token WHERE gun <  CAST(DATEADD(day,-7,GETDATE()) AS date)
                 ) y) AS nvarchar(400))
    UNION ALL SELECT '04 yeni tokenli token-gecisi (fallback tahmini %)',
           CAST(CAST(100.0 *
                (SELECT COUNT(*) FROM #token t2
                  WHERE t2.gun >= CAST(DATEADD(day,-7,GETDATE()) AS date)
                    AND NOT EXISTS (SELECT 1 FROM #token t3
                                     WHERE t3.token = t2.token
                                       AND t3.gun < CAST(DATEADD(day,-7,GETDATE()) AS date)))
                / NULLIF((SELECT COUNT(*) FROM #token WHERE gun >= CAST(DATEADD(day,-7,GETDATE()) AS date)),0)
                AS decimal(6,3)) AS nvarchar(400)) + ' %'
) t;

/* -- 5. AD+SOYAD BIRLESIK KLIP ONERISININ MALIYETI ------------------------ */
IF OBJECT_ID('tempdb..#tamad') IS NOT NULL DROP TABLE #tamad;
SELECT LOWER(LTRIM(RTRIM(ADI_SOYADI)) COLLATE Turkish_CI_AS) AS tam_ad, COUNT(*) AS adet
INTO #tamad
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE())
  AND MASKELEME = 0
  AND LTRIM(RTRIM(ADI_SOYADI)) <> ''
GROUP BY LOWER(LTRIM(RTRIM(ADI_SOYADI)) COLLATE Turkish_CI_AS);

INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '5-tam-ad', m, d FROM (
    SELECT '01 FARKLI tam ad (' + CAST(@gun_ad AS varchar) + ' gun)' AS m, CAST(COUNT(*) AS nvarchar(400)) AS d FROM #tamad
    UNION ALL SELECT '02 toplam cagri', CAST(SUM(adet) AS nvarchar(400)) FROM #tamad
    UNION ALL SELECT '03 ortalama tekrar', CAST(CAST(AVG(CAST(adet AS float)) AS decimal(6,2)) AS nvarchar(400)) FROM #tamad
    UNION ALL SELECT '04 SADECE BIR KEZ gorulen tam ad', CAST(SUM(CASE WHEN adet = 1 THEN 1 ELSE 0 END) AS nvarchar(400)) FROM #tamad
    UNION ALL SELECT '05 tek seferlik yuzde',
        CAST(CAST(100.0 * SUM(CASE WHEN adet=1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0) AS decimal(6,2)) AS nvarchar(400)) + ' %' FROM #tamad
    UNION ALL SELECT '06 ortalama karakter', CAST(CAST(AVG(CAST(LEN(tam_ad) AS float)) AS decimal(6,2)) AS nvarchar(400)) FROM #tamad
    UNION ALL SELECT '07 kaba yillik farkli tam ad (x12)', CAST(COUNT(*) * 12 AS nvarchar(400)) FROM #tamad
) t;

/* -- 6. TURKCE ALFABE DISI / KIRLI TOKENLAR ------------------------------- */
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '6-normalizasyon', m, d FROM (
    SELECT '01 q/w/x iceren farkli token' AS m,
           CAST(COUNT(*) AS nvarchar(400)) AS d
    FROM #frekans WHERE token COLLATE Latin1_General_BIN LIKE '%[qwx]%'
    UNION ALL SELECT '02 rakam iceren farkli token', CAST(COUNT(*) AS nvarchar(400))
    FROM #frekans WHERE token LIKE '%[0-9]%'
    UNION ALL SELECT '03 tek/iki harfli farkli token', CAST(COUNT(*) AS nvarchar(400))
    FROM #frekans WHERE LEN(token) <= 2
    UNION ALL SELECT '04 turkce disi karakter iceren', CAST(COUNT(*) AS nvarchar(400))
    FROM #frekans WHERE token LIKE '%[^abcçdefgğhıijklmnoöprsştuüvyz]%' COLLATE Turkish_CI_AS
) t;

INSERT INTO #sonuc (bolum, metrik, deger)
SELECT TOP 25 '6-normalizasyon', '05 ornek sorunlu token', token + '  (' + CAST(adet AS nvarchar(20)) + ')'
FROM #frekans
WHERE token COLLATE Latin1_General_BIN LIKE '%[qwx]%'
   OR token LIKE '%[0-9]%'
   OR LEN(token) <= 2
   OR token LIKE '%[^abcçdefgğhıijklmnoöprsştuüvyz]%' COLLATE Turkish_CI_AS
ORDER BY adet DESC;

/* -- 7. DOKTOR / SERVIS / TRIAJ ------------------------------------------- */
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '7-doktor-servis', m, d FROM (
    SELECT '01 farkli doktor' AS m, CAST(COUNT(DISTINCT DR_ADI) AS nvarchar(400)) AS d
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '02 farkli servis', CAST(COUNT(DISTINCT SERVIS_ADI) AS nvarchar(400))
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '03 farkli triaj', CAST(COUNT(DISTINCT TRIAJ_ADI) AS nvarchar(400))
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '04 farkli cagri tipi', CAST(COUNT(DISTINCT CAGRI_TIPI) AS nvarchar(400))
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '05 doktor adi ort. karakter',
        CAST(CAST(AVG(CAST(LEN(DR_ADI) AS float)) AS decimal(6,1)) AS nvarchar(400))
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE()) AND DR_ADI IS NOT NULL
) t;

INSERT INTO #sonuc (bolum, metrik, deger)
SELECT TOP 15 '7-doktor-servis', '06 ornek doktor adi', DR_ADI
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE()) AND DR_ADI IS NOT NULL
GROUP BY DR_ADI ORDER BY COUNT(*) DESC;

INSERT INTO #sonuc (bolum, metrik, deger)
SELECT TOP 20 '7-doktor-servis', '07 ornek servis adi', SERVIS_ADI + '  (' + CAST(COUNT(*) AS nvarchar(20)) + ')'
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE()) AND SERVIS_ADI IS NOT NULL
GROUP BY SERVIS_ADI ORDER BY COUNT(*) DESC;

/* -- 8. BANKO / SIRA ARALIGI (sayi klipleri) ------------------------------ */
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '8-banko-sira', m, d FROM (
    SELECT '01 farkli BANKO_NO' AS m, CAST(COUNT(DISTINCT BANKO_NO) AS nvarchar(400)) AS d
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '02 BANKO en kucuk / en buyuk',
        ISNULL(CAST(MIN(TRY_CAST(BANKO_NO AS int)) AS nvarchar(20)),'-') + ' / ' +
        ISNULL(CAST(MAX(TRY_CAST(BANKO_NO AS int)) AS nvarchar(20)),'-')
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '03 BANKO sayisal OLMAYAN kayit',
        CAST(SUM(CASE WHEN BANKO_NO IS NOT NULL AND TRY_CAST(BANKO_NO AS int) IS NULL THEN 1 ELSE 0 END) AS nvarchar(400))
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '04 farkli SIRA_NO', CAST(COUNT(DISTINCT SIRA_NO) AS nvarchar(400))
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '05 SIRA en kucuk / en buyuk',
        ISNULL(CAST(MIN(TRY_CAST(SIRA_NO AS int)) AS nvarchar(20)),'-') + ' / ' +
        ISNULL(CAST(MAX(TRY_CAST(SIRA_NO AS int)) AS nvarchar(20)),'-')
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
    UNION ALL SELECT '06 SIRA sayisal OLMAYAN kayit',
        CAST(SUM(CASE WHEN SIRA_NO IS NOT NULL AND TRY_CAST(SIRA_NO AS int) IS NULL THEN 1 ELSE 0 END) AS nvarchar(400))
    FROM CAGRI WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
) t;

INSERT INTO #sonuc (bolum, metrik, deger)
SELECT TOP 10 '8-banko-sira', '07 sayisal olmayan BANKO ornegi', BANKO_NO
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
  AND BANKO_NO IS NOT NULL AND TRY_CAST(BANKO_NO AS int) IS NULL
GROUP BY BANKO_NO ORDER BY COUNT(*) DESC;

/* -- 9. CAGRI TIPI DAGILIMI (kac sablon gerekiyor?) ----------------------- */
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT '9-cagri-tipi',
       '01 ' + ISNULL(CAGRI_TIPI, '(bos)'),
       CAST(COUNT(*) AS nvarchar(20)) + ' cagri, %' +
       CAST(CAST(100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS decimal(5,1)) AS nvarchar(10)) +
       ' | banko:' + CAST(SUM(CASE WHEN BANKO_NO IS NOT NULL THEN 1 ELSE 0 END) AS nvarchar(20)) +
       ' dr:'      + CAST(SUM(CASE WHEN DR_ADI IS NOT NULL THEN 1 ELSE 0 END) AS nvarchar(20)) +
       ' servis:'  + CAST(SUM(CASE WHEN SERVIS_ADI IS NOT NULL THEN 1 ELSE 0 END) AS nvarchar(20))
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_genel, GETDATE())
GROUP BY CAGRI_TIPI;

/* -- 10. SAATLIK YUK (bolen acikca yaziliyor) ----------------------------- */
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT 'A-saatlik',
       '01 saat ' + RIGHT('0' + CAST(DATEPART(hour, CAGRI_ZAMANI) AS nvarchar(2)), 2),
       CAST(COUNT(*) AS nvarchar(20)) + ' cagri / ' +
       CAST(COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date)) AS nvarchar(10)) + ' gun = ' +
       CAST(CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date)),0) AS decimal(10,1)) AS nvarchar(20)) +
       ' /gun, ' +
       CAST(CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date)),0) / 3600.0 AS decimal(10,4)) AS nvarchar(20)) +
       ' istek/sn'
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE())
GROUP BY DATEPART(hour, CAGRI_ZAMANI);

/* -- 11. EN YOGUN EKRAN-SAAT (sistemin gercek siniri) --------------------- */
INSERT INTO #sonuc (bolum, metrik, deger)
SELECT TOP 10 'B-yogun-ekran',
       '01 ekran ' + CAST(EKRAN_ID AS nvarchar(20)) + ' saat ' + CAST(DATEPART(hour, CAGRI_ZAMANI) AS nvarchar(2)),
       CAST(CAST(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date)),0) AS decimal(10,1)) AS nvarchar(20)) + ' cagri/saat'
FROM CAGRI
WHERE CAGRI_ZAMANI >= DATEADD(day, -@gun_ad, GETDATE())
GROUP BY EKRAN_ID, DATEPART(hour, CAGRI_ZAMANI)
ORDER BY COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT CAST(CAGRI_ZAMANI AS date)),0) DESC;

/* -- SONUC --------------------------------------------------------------- */
SELECT bolum, metrik, deger
FROM #sonuc
ORDER BY bolum, metrik, sira;

/* =============================================================================
   STRING_SPLIT yoksa (SQL Server 2016 oncesi): yukaridaki "2. TOKEN CIKARMA"
   blogundaki SELECT ... INTO #token sorgusunu su sekilde degistirin:

   ;WITH x AS (
       SELECT CAGRI_ID,
              CAST('<t>' + REPLACE(LTRIM(RTRIM(ADI_SOYADI)), ' ', '</t><t>') + '</t>' AS xml) AS p,
              CAST(CAGRI_ZAMANI AS date) AS gun
       FROM CAGRI
       WHERE CAGRI_ZAMANI >= DATEADD(day, -30, GETDATE()) AND MASKELEME = 0
   )
   SELECT x.CAGRI_ID,
          LOWER(LTRIM(RTRIM(n.p.value('.', 'nvarchar(300)'))) COLLATE Turkish_CI_AS) AS token,
          x.gun
   INTO #token
   FROM x CROSS APPLY x.p.nodes('/t') AS n(p)
   WHERE LTRIM(RTRIM(n.p.value('.', 'nvarchar(300)'))) <> '';
   ============================================================================= */

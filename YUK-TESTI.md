# Yük testi sonuçları

**Tarih:** 2026-08-20 · **Makine:** Windows 11, Node 24.11.1, PostgreSQL 18.4 (yerel)

`RAPOR.md`'de "koşulmadı" diye işaretlenen iki boşluk kapatıldı: 250 bin satırlık veritabanı
yükü ve ses zinciri başarımı. İkisi de tekrar koşturulabilir betik olarak duruyor.

```bash
node betikler/yuk-testi.mjs --satir=250000    # veritabanı (ayrı test DB kurar, siler)
node betikler/yuk-testi-ses.mjs               # ses zinciri (saf CPU)
```

---

## 1. Veritabanı — 250.000 klip

Ayrı bir `ttsmerkez_yuk` veritabanı kurulup gerçekçi dağılımla dolduruldu (%92 `ready`,
%4 `pending`, hece havuzundan üretilmiş Türkçe kelimeler), sonra silindi. Gerçek
veritabanına dokunulmadı.

Tablo boyutu: **88 MB** (250.000 klip + 250.000 kapsam satırı).

### Panel sorguları — `kelimeler.ts` birebir

| Sorgu | Ortanca | Durum |
|---|---|---|
| `count(*)` — filtresiz | 107 ms | tamam |
| `count(*)` — durum filtresiyle | 4 ms | tamam |
| Liste — 1. sayfa | 116 ms | tamam |
| Liste — 100. sayfa (offset 5.000) | 157 ms | tamam |
| **Liste — 1000. sayfa (offset 50.000)** | **516 ms** | **YAVAŞ** |
| **Liste — son sayfa (offset 249.950)** | **1.062 ms** | **YAVAŞ** |
| Arama — `ILIKE '%oğlu%'` (trigram) | 39 ms | tamam |
| Arama — `ILIKE '%ka%'` (seçiciliği düşük) | 117 ms | tamam |
| Tip filtresi — `EXISTS klip_kapsam` | 62 ms | tamam |

### Üretim hattı sorguları

| Sorgu | Ortanca |
|---|---|
| Sahiplenme — `FOR UPDATE SKIP LOCKED`, 200 klip | 28 ms |
| Delta — manifest mutabakatı | 4 ms |
| Budama adayları — `son_kullanim` penceresi | 2 ms |

Üretim hattının tamamı hızlı; indeksler doğru kurulmuş.

### Bulunan darboğaz ve düzeltmesi

`EXPLAIN` sebebi net söyledi:

```
Sort  (actual time=249..287 rows=250000)
  Sort Key: ((durum = 'ready')), olusturuldu DESC, id DESC
  Sort Method: external merge  Disk: 8336kB
```

Panel "çevrilmemişler önce" görünümü için `ORDER BY (durum = 'ready') ASC, ...` kullanıyor.
Mevcut `klip_liste_ix (durum, olusturuldu DESC, id DESC)` bu **ifadeye** uymuyor — kolonun
kendisi değil, `(durum = 'ready')` boolean ifadesi sıralanıyor. Planlayıcı indeksi
kullanamayıp her sayfa için 250 bin satırı **diskte** sıralıyordu.

Çözüm: ifade indeksi (`migrasyonlar/006_liste_ifade_indeksi.sql`).

| Offset | Önce | Sonra | Kazanç |
|---|---|---|---|
| 5.000 | 110 ms | **3 ms** | 39 kat |
| 50.000 | 310 ms | **24 ms** | 13 kat |
| 249.950 | 549 ms | **124 ms** | 4,4 kat |

Plan `Sort (external merge Disk)` yerine `Index Scan`'e döndü. İndeks maliyeti **~10 MB**,
oluşturma süresi 550 ms.

> **Kalan borç:** son sayfa hâlâ 124 ms, çünkü `OFFSET 249.950` indeks içinde 250 bin girdi
> yürümek zorunda — bu OFFSET sayfalamasının doğasında var. Anahtar tabanlı (keyset)
> sayfalama bunu da çözer ama arayüz değişikliği ister ve son sayfa pratikte ziyaret
> edilmiyor. `TODO-BLOKE.md`'ye yazıldı.

---

## 2. Ses zinciri

Bu kod hastane servisine (`ses-bankasi`) taşınacak ve **istek yolunda** çalışacak olan da bu.
Ölçülen tepe salvo: 1 saniyede 9 istek (§3).

Test anonsu: 5 parça, 3,85 sn ham ses.

| İşlem | Ortanca | p99 | En kötü |
|---|---|---|---|
| Birleştirme (45 ms crossfade) | 5,21 ms | 14,5 ms | 17,8 ms |
| WAV başlığı | 0,17 ms | 1,5 ms | 3,5 ms |
| **TAM İSTEK** | **4,73 ms** | **14,0 ms** | 14,9 ms |
| Şablon parçalama | 0,18 ms | 0,6 ms | 1,2 ms |
| Normalizasyon (tek token) | 0,016 ms | 0,07 ms | 0,46 ms |
| XML kaçışı | 0,002 ms | 0,005 ms | 0,33 ms |
| Taşıyıcı SSML kurma | 0,006 ms | 0,05 ms | 0,46 ms |
| Damgalardan dilimleme | 0,004 ms | 0,05 ms | 0,49 ms |

### Salvo dayanıklılığı

| Salvo | İşlem süresi | Tek çekirdeğin |
|---|---|---|
| **9 istek/sn** (ölçülen tepe) | 44 ms | **%4,4'ü** |
| 20 istek/sn | 106 ms | %10,6'sı |
| 50 istek/sn | 253 ms | %25,3'ü |
| 100 istek/sn | 515 ms | %51,5'i |

**Teorik tavan: 189 istek/sn** (tek çekirdek, sürekli yük). Ölçülen tepeye karşı **21 kat pay**.

### Doküman düzeltmesi

| | Doküman §10 (önce) | Ölçülen |
|---|---|---|
| İstek başına | ~1 ms | **4,73 ms** |
| Teorik tavan | 500–1.000 istek/sn | **189 istek/sn** |

Fark, birleştirmenin her klibi PCM→Float32→PCM çevirmesinden geliyor. Saf kopyalama
bölgelerini Int16 üzerinde yapıp float matematiğini yalnız dikiş bölgelerine uygulamak
bunu ~1 ms'e indirebilir.

**Ama optimize etmeye gerek yok:** 21 kat pay zaten var, ve p99 bile 14 ms. Doküman §10
ölçülen rakamlarla güncellendi.

---

## 3. Koşulmayanlar

Dürüstlük gereği:

- **HTTP katmanı yük altında ölçülmedi** — Fastify + Eta şablon render'ı, oturum doğrulama,
  eşzamanlı tarayıcı istekleri. Panel üç kişi tarafından kullanılacağı için öncelik verilmedi.
- **Eşzamanlı üretim** — birden fazla işçi aynı kuyruğa yüklendiğinde `SKIP LOCKED`
  davranışı testlerde doğrulandı ama yük altında ölçülmedi. Tek process olduğu için
  şimdilik konusuz.
- **Disk G/Ç** — klip yazma/okuma (içerik adresli depo) ölçülmedi. Yük testi veritabanı
  satırları üretti, gerçek PCM dosyası yazmadı.
- **PostgreSQL ayarları varsayılan** — `shared_buffers`, `work_mem` vb. hiç ayarlanmadı.
  Derin sayfa sıralaması `work_mem` yetersizliğinden diske düşüyordu; indeks bunu zaten
  gereksiz kıldı ama üretim sunucusunda ayarlar gözden geçirilmeli.

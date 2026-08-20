# DahiSES — Hastane Anons Seslendirme Sistemi

22 hastanenin çağrı ekranları için Türkçe anons seslendirmesi. Çalışma anında metinden
sese çevirme **yapmaz**; kelime dağarcığı önceden seslendirilip diske yazılır ("ses bankası"),
anons anında yalnızca ham PCM parçaları birleştirilir.

**Durum:** Mimari kararlar verildi ve gerçek veriyle doğrulandı. Prototip tamamlandı, ana
risk kapandı. Merkez servisi (`tts-merkez`) yazım aşamasında. Hastane servisi henüz başlamadı.

---

## Neden banka, neden runtime TTS değil

Ölçülen veriyle (bkz. [§2](docs/SESLENDIRME-SERVISI.md)):

| | Runtime TTS (Google) | Banka + birleştirme |
|---|---|---|
| İstek başına süre | 130–2500 ms | **~2 ms** |
| Aylık TTS maliyeti | ~$2.800 (22 hastane) | **$0** — ücretsiz kotanın içinde |
| İnternet kesintisi | Anons durur | Banka yerelde, anons devam eder |
| Google'a giden veri | **Her hastanın adı** | Bağlamsız tek kelime |

Son satır maliyetten daha belirleyici olabilir: KVKK açısından hasta adının hastane ağından
çıkmaması mimarinin şeklini belirledi.

---

## Mimari

```
┌─────────────┐  HTTP/WS   ┌──────────────────┐  Socket.IO   ┌──────────────┐
│ Anons       │───────────▶│  ses-bankasi     │─────────────▶│  tts-merkez  │
│ ekranları   │◀───────────│  (hastane içi)   │◀─────────────│  (dış sunucu)│
└─────────────┘  ses (WAV) │  ×22             │  token/push  └──────┬───────┘
                           └──────────────────┘                     ▼
                                                             ┌──────────────┐
                                                             │ Google Cloud │
                                                             │ TTS          │
                                                             └──────────────┘
```

| Servis | Nerede | İşi | Google erişimi |
|---|---|---|---|
| **`tts-merkez`** | Tek dış sunucu | Klip üretimi, banka dağıtımı, yönetim paneli | Var — tek nokta |
| **`ses-bankasi`** | Her hastanede (×22) | Metin al → klipleri birleştir → ses dön | **Yok** |

Hasta adı hastane ağından çıkmaz. Merkeze giden tek şey bağlamsız token (tek kelime) ve
sayısal telemetri.

---

## Ölçülmüş bulgular

Bu proje tahminle değil ölçümle ilerledi. Gerçek çağrı logu (22.905 çağrı) ve prototip
dinleme testlerinden çıkanlar:

**Üretim yöntemi — en kritik bulgu.** Kelimeleri tek tek seslendirip birleştirmek **kopuk
duyuluyor**. TTS yalıtılmış kelimeyi bitmiş bir cümle sayıyor, sonuna düşen tonlama koyuyor;
altı mini-cümle yan yana gelince cümle değil liste çıkıyor. Ayar turu (boşluk, hız, crossfade,
noktalama, kısa şablon) bunu kurtaramadı.

Çözüm: parça **taşıyıcı cümle içinde** ürettirilip SSML `<mark>` zaman damgalarıyla oradan
kesiliyor. Kesilen parça cümle ortası tonlaması taşıyor. Sonuç aslına çok yakın.

**Diğerleri:**

| Bulgu | Değer |
|---|---|
| Tepe yük | 0,87 istek/sn (tepe salvo 9 istek/sn) |
| Birleştirme ayarı | 0 ms boşluk, 45 ms crossfade — es koymak sesi bozuyor |
| Banka büyümesi | Heaps β=0,69 — doymuyor; 1. yıl ~247.000 klip / 13,6 GB |
| Türkçe sesler | 40 adet, **hepsi 24 kHz**; Neural2/Studio yok |
| Chirp 3 HD | **Kullanılamaz** — SSML işaretine zaman damgası döndürmüyor |
| Ücretsiz kota | Standard 4M/ay, WaveNet 1M/ay — ayrı havuzlar |
| Normalizasyon | Alfabe dışı token yalnız %0,14 — marjinal |

---

## Depo düzeni

```
docs/
  SESLENDIRME-SERVISI.md   Ana mimari doküman — kararlar, ölçümler, gerekçeler
  AGENT-MERKEZ.md          Merkez servisi görev tanımı (şu anki tur)
  AGENT-PROMPT.md          Hastane tarafı görev tanımı (sonraki tur)
  FAZ0-TEK-SORGU.sql       Ölçüm sorguları, tek sonuç tablosu (SQL Server)
  FAZ0-SORGULAR.sql        Aynısı, bölüm bölüm

prototip/                  Ses kalitesi prototipi — soruyu cevaplayan kod
paketler/                  Servis paketleri (tts-merkez yazılıyor)
migrasyonlar/              PostgreSQL şema migrasyonları
arac/                      PostgreSQL başlat/durdur/durum betikleri
veri/                      Üretilen klipler (depoya girmez)
```

---

## Başlangıç

**Gereksinimler:** Node 18+ (24 önerilir), pnpm, PostgreSQL 18.

### 1. Veritabanı

PostgreSQL `tr-TR` ICU locale ile kurulmalı — Türkçe `lower()` ve sıralama buna bağlı:

```sql
CREATE DATABASE ttsmerkez TEMPLATE template0 ENCODING 'UTF8'
  LOCALE_PROVIDER icu ICU_LOCALE 'tr-TR' LOCALE 'C';
```

Doğrulama: `lower('İSTANBUL' COLLATE "tr-TR-x-icu")` → `istanbul`

Yardımcı betikler (Windows):

```powershell
arac\pg-baslat.cmd    # idempotent, zaten çalışıyorsa dokunmaz
arac\pg-durum.cmd
arac\pg-durdur.cmd
```

### 2. Yapılandırma

`.env` dosyası oluşturun (depoya girmez):

```ini
DATABASE_URL=postgresql://kullanici:parola@127.0.0.1:5432/ttsmerkez
GOOGLE_TTS_API_KEY=AIza...
BANKA_DIZINI=./veri/banka
BANKA_ORNEKLEME_HIZI=24000
PORT=3000
```

Google TTS anahtarı: Cloud Console → proje → **Cloud Text-to-Speech API**'yi etkinleştir →
Credentials → API key. Anahtarı yalnız bu API'ye kısıtlayın.

> **`v1beta1` uç noktası gereklidir.** SSML `<mark>` zaman damgaları (`enableTimePointing`)
> `v1`'de yok ve üretim yöntemi buna bağlı.

### 3. Prototipi çalıştırın

Ses kalitesini kendi kulağınızla doğrulamak için:

```powershell
cd prototip
node kendini-test.js                    # 38 test, Google gerekmez
node sesler.js                          # mevcut Türkçe sesler
node kesme.js --ses=tr-TR-Standard-A    # kabul edilen üretim yöntemi
node ses-secimi.mjs                     # 5 sesi yan yana karşılaştır
```

Ayrıntı: [prototip/README.md](prototip/README.md)

---

## Maliyet

Ölçülen büyümeyle, tek hastane tek profil:

| Ay | Üretilen karakter | Standard (4M/ay) | WaveNet (1M/ay) |
|---|---|---|---|
| 1 | 2,3M | $0 | ~$5 |
| 2 | 1,4M | $0 | ~$2 |
| 3 | 1,2M | $0 | ~$1 |
| 6+ | <1M | $0 | $0 |

Başlangıç bankası aya yayılırsa her iki tiyerde de **$0** — kota aylık yenilenir.

Kota koruması üç katmanlı ve tiyer bazlı: %70 uyarı, %85 toplu üretim durur, %90 tüm Google
çağrıları durur.

---

## Yol haritası

- [x] Mimari doküman ve ölçümler
- [x] Prototip — ses kalitesi sorusu kapandı
- [x] PostgreSQL şeması tasarımı
- [ ] `tts-merkez` çekirdeği ve yönetim paneli *(yazılıyor)*
- [ ] `ses-bankasi` — hastane servisi
- [ ] Socket.IO dağıtım kanalı, manifest mutabakatı, budama
- [ ] Pilot: bir hastane, 2 hafta
- [ ] Yaygınlaştırma: 22 hastane

### Açık maddeler

1. **Google ToS teyidi** — TTS çıktısını kalıcı saklayıp tekrar tekrar çalmanın sözleşmeye
   uygunluğu hukuk tarafında doğrulanmalı. İzin yoksa banka mimarisi geçersiz kalır; B planı
   Amazon Polly (açıkça izin veriyor, Türkçe neural sesi var).
2. **90 günlük ölçüm** — `docs/FAZ0-TEK-SORGU.sql` gerçek veride koşturulmalı. Disk ve maliyet
   tabloları tek günlük logdan uzatılmış β=0,69 eğrisine dayanıyor.
3. **Ses seçimi** — hangi Standard/WaveNet sesi kullanılacak, dinleyerek karara bağlanacak.

---

## Dokümantasyon

Ana referans: **[docs/SESLENDIRME-SERVISI.md](docs/SESLENDIRME-SERVISI.md)** — API sözleşmesi,
şema, üretim yöntemi, kota politikası, KVKK, kaynak gereksinimi ve her kararın gerekçesi.
"Ölçülen" ibareli her rakamın kaynağı dokümanın sonundaki tabloda.

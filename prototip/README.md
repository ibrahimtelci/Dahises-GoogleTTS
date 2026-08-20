# Prototip — Parça Birleştirme Ses Kalitesi Testi

> ## ✅ SONUÇ — soru cevaplandı
>
> **Yalıtılmış sentez REDDEDİLDİ, taşıyıcı cümleden kesme KABUL EDİLDİ.**
>
> | Yöntem | Sonuç |
> |---|---|
> | Kelimeleri tek tek seslendirip birleştirmek | **Kopuk.** Ayar turu (boşluk/hız/crossfade/virgül/kısa şablon) kurtaramadı |
> | Taşıyıcı cümle içinde ürettirip SSML `<mark>` ile kesmek | **Aslına çok yakın** |
>
> Kök sebep: TTS tek başına verilen kelimeyi *bitmiş bir cümle* sayıyor — sonuna düşen
> tonlama koyuyor, perdeyi sıfırlıyor. Altı mini-cümle yan yana gelince cümle değil liste
> çıkıyor. Süreyi eşitlemek düzeltmiyor, çünkü sorun süre değil **perde konturu**.
>
> Kabul edilen ayarlar: **0 ms boşluk, 45 ms crossfade**, sıfır geçiş hizalama açık,
> kesilen parçaya sessizlik kırpma **yok**, sonuna 50 ms kuyruk payı.
>
> Diğer ölçümler:
> - 40 tr-TR sesi, **hepsi 24.000 Hz**. Neural2/Studio Türkçede yok.
> - **Chirp 3 HD kullanılamaz** — SSML işaretlerine sıfır zaman damgası dönüyor.
> - `enableTimePointing` yalnız **`v1beta1`**'de var, `v1` reddediyor.
> - WSOLA (ısıtılmış): 0.8x ~42 ms, 1.2x ~29 ms → 0.8x 30 ms kapısını aşıyor.
> - Sessizlik kırpma olmasa 6 parçalık cümleye **1,26 sn** boş süre eklenirdi.
>
> Hepsi `SESLENDIRME-SERVISI.md` §6.6, §7.5 ve §7.6'ya işlendi.
>
> **Açık kalan tek şey:** hangi sesin kullanılacağı. `cikti/ses-secimi/` dosyalarını dinle.

Bu prototip **tek bir soruyu** cevaplamak için yazıldı:

> Ses bankasından parça parça birleştirilen Türkçe anons cümlesi, hastane hoparlöründe
> kabul edilebilir mi?

Cevap "hayır" olsaydı `SESLENDIRME-SERVISI.md`'deki mimarinin tamamı değişecekti. Bu yüzden
Faz 0'ın diğer sorularının önüne alındı.

Test edilen şablon:

```
sayın {ad} {soyad} lütfen {banko} nolu bankoya geçiniz
```

Parçalanışı (§7.4 — kelime kelime değil, anlamlı öbek düzeyinde):

```
["sayın"] + [{ad}] + [{soyad}] + ["lütfen"] + [{banko}] + ["nolu bankoya geçiniz"]
   sabit      klip      klip       sabit        sayı            sabit
```

## Betikler

| Betik | Ne yapar |
|---|---|
| `kendini-test.js` | DSP zinciri doğrulaması, 38 test, **Google gerekmez** |
| `sesler.js` | `listVoices` — hangi sesler var, hangi tiyerde, örnekleme hızı |
| `prob-isaret.js` | SSML `<mark>` zaman damgası desteği var mı (v1 / v1beta1) |
| `prob-tiyer.mjs` | Hangi tiyerler damga döndürüyor (Chirp elemesi buradan çıktı) |
| `uret.js` | **Eski yöntem** — yalıtılmış klip üretimi (reddedildi, karşılaştırma için duruyor) |
| `birlestir.js` | Eski yöntemle cümle kurar, dinleme varyantları yazar |
| `ayar.js` | Eski yöntemi kurtarma denemesi — 7 ayar düzeni (başarısız) |
| **`kesme.js`** | **Kabul edilen yöntem** — taşıyıcı cümleden kesme, çapraz doğrulamalı |
| `tiyer-karsilastir.mjs` | Standard vs WaveNet, aynı cümle yan yana |
| `ses-secimi.mjs` | 5 Standard sesi yan yana — **ses seçimi için** |

`kesme.js` taşıyıcıları önbelleğe alır; ayar turları ek Google maliyeti getirmez.

```powershell
node kesme.js --ses=tr-TR-Standard-A
node kesme.js --ses=tr-TR-Wavenet-D
node ses-secimi.mjs
```

## Kurulum

Bağımlılık yok. `npm install` gerekmez — Node 18+ yeterli (yerleşik `fetch` kullanılıyor).

Tek gereken bir Google Cloud kimliği. İki yoldan biri:

**A) API anahtarı (basit, prototip için önerilen)**

1. Google Cloud Console → yeni proje
2. APIs & Services → **Cloud Text-to-Speech API**'yi etkinleştir
3. Credentials → Create credentials → **API key**
4. Anahtarı kısıtla: sadece Text-to-Speech API

```powershell
$env:GOOGLE_TTS_API_KEY = "AIza..."
```

**B) Service account (kurumsal)**

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\yol\anahtar.json"
```

> Faturalandırma hesabı bağlı olmalı, ama **ücret oluşmaz**: prototipin tamamı birkaç bin
> karakter harcar — Standard'ın aylık 4.000.000 ücretsiz kotasının binde biri bile değil.
> (WaveNet kotası 1M'dir, 4M değil — §6.3.) `src/google.js` içinde 8.000 karakterlik sert
> bir tavan var; aşılırsa istek gönderilmez.

## Çalıştırma

```powershell
node kendini-test.js                      # DSP zinciri (Google gerekmez, 38 test)
node sesler.js                            # hangi sesler var, örnekleme hızı
node kesme.js --ses=tr-TR-Standard-A      # KABUL EDİLEN yöntem
node ses-secimi.mjs                       # 5 Standard sesini yan yana koy
```

`kesme.js` taşıyıcı cümleleri `cikti/kesme/<ses>/onbellek/` altında önbelleğe alır — aynı
sesle tekrar koşmak Google'a gitmez, ayar denemeleri bedavadır.

Reddedilen yöntemi yeniden üretmek isterseniz (karşılaştırma için):

```powershell
node uret.js                              # planı göster, Google'a gitmez
node uret.js --calistir --ses=tr-TR-Standard-A
node birlestir.js
node ayar.js                              # 7 kurtarma denemesi
```

## Ne dinlenecek

**Karar verilecek tek şey kaldı: hangi ses.**

| Klasör / dosya | Ne var |
|---|---|
| `cikti/ses-secimi/TUMU-birlesik.wav` | 5 Standard sesi, sistemin gerçekte üreteceği kesme-birleştirme hâliyle arka arkaya (A→C→D kadın, B→E erkek) |
| `cikti/ses-secimi/TUMU-referans.wav` | Aynı 5 ses, doğal tam cümle — ham kalite karşılaştırması |
| `cikti/ses-secimi/tr-TR-Standard-*.wav` | Tek ses: önce doğal cümle, 0,8 sn ara, sonra birleştirilmiş hâli |
| `cikti/tiyer-karsilastirma/` | Standard vs WaveNet, aynı cümle yan yana |

İki ayrı şeye bak: sesi beğeniyor musun, **ve** aynı dosya içinde doğal hâlle birleştirilmiş
hâl arasındaki farkı duyuyor musun. Bir ses güzel olup birleştirmede kötü tutabilir.

### Arşiv — kapanmış karşılaştırmalar

Bunlar karar için değil, kaydı için duruyor:

| Klasör | Ne gösteriyor |
|---|---|
| `cikti/ornekler/00-ab-*` | **Reddedilen yöntem.** Yalıtılmış sentezin referanstan ne kadar uzak düştüğü |
| `cikti/ornekler/03b-islenmemis` | Sessizlik kırpma olmasaydı ne olurdu (1,26 sn fazla) |
| `cikti/ayar/ab-K*` | Reddedilen yöntemi kurtarma denemeleri — hiçbiri yetmedi |
| `cikti/kesme/*/dogrulama-*` | **Kabul edilen yöntem**, üç farklı çapraz cümlede |

> `cikti/kesme/` altındaki çapraz cümlelerde her parça **başka bir taşıyıcıdan** gelir ve
> kurulan cümle hiç bütün olarak üretilmemiştir. Parçaları bir cümleden kesip aynı cümleyi
> yeniden kurmak hiçbir şey kanıtlamaz — dürüst test budur.

## Dosyalar

```
src/google.js    Google TTS REST istemcisi (API key veya service account) + karakter tavanı
src/ses.js       PCM işleme: kırpma, normalize, birleştirme, crossfade, WSOLA, perde
src/sablon.js    Normalizasyon (§7.5), sayı→metin, şablon parçalama
src/veri.js      Test verisi: 5 cümle, 15 yabancı isim
src/dosya.js     Klip anahtarı → dosya adı
sesler.js        Faz 0 madde 9 — listVoices
kesme.js         KABUL EDİLEN yöntem — taşıyıcı cümleden kesme
uret.js          Eski yöntem: mini banka üretici (varsayılan: kuru çalışma)
birlestir.js     Eski yöntemle cümle kurar, dinleme varyantlarını yazar
ayar.js          Eski yöntemi kurtarma denemesi (başarısız)
prob-isaret.js   SSML mark desteği sınaması
prob-tiyer.mjs   Tiyer bazlı mark desteği (Chirp elemesi)
ses-secimi.mjs   5 Standard sesini yan yana koyar
kendini-test.js  DSP zinciri doğrulaması (Google gerekmez)
```

## Ölçülenler

`node kendini-test.js` çıktısından, bu makinede (Node 24, 24 kHz, 4 sn ses):

| İşlem | Süre | Doküman beklentisi | Durum |
|---|---|---|---|
| WSOLA 1.2x | ~29 ms | §7.1.1: 5–20 ms, kapı 30 ms | sınırda |
| WSOLA 0.8x | ~40 ms | §7.1.1: 5–20 ms, kapı 30 ms | **kapıyı aştı** |
| 6 klip birleştirme | ~2,3 ms | §10: ~1 ms | prototip fazlası (bkz. not) |

**WSOLA notu:** 0.8x ölçülen değer §7.1.1'in koyduğu 30 ms kapısını aşıyor. Üç seçenek var:
(a) arama penceresini kaba-ince iki aşamaya böl (~4 kat hızlanma beklenir), (b) WASM'a taşı,
(c) `rate` seçeneğini varsayılan kapalı tut ve `bakedRate` profiline yönlendir (§4.4).
Karar, `06-hiz-*` örnekleri dinlendikten sonra verilmeli — artefakt zaten kabul edilemezse
optimizasyon tartışması gereksiz.

**Birleştirme notu:** 2,3 ms, dokümanın öngördüğü ~1 ms'in üstünde çünkü bu prototip her
klibi PCM→Float32→PCM çeviriyor. Üretimde saf kopyalama Int16 üzerinde yapılır, float
matematiği yalnızca dikiş bölgelerine uygulanır. Yine de 2,3 ms bile ölçülen tepe yükte
(1,46 istek/sn) tek çekirdeğin binde üçü.

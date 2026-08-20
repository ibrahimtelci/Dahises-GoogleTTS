# Seslendirme Servisi — Proje Brifingi

> **Bağımsız bir servis projesidir.** Anons ekranları, HBYS ve çağrı sistemi bu servisin
> *istemcisidir* — servisin onlardan haberi yoktur. Servis metin alır, ses döner.
>
> Kod yazmadan önce **Faz 0** (§12) sorularını netleştir. Varsayım üretme, sor.

---

## 1. İki Ayrı Servis

Bu brifing **iki bağımsız servisi** tanımlar:

| | `ses-bankasi` | `tts-merkez` |
|---|---|---|
| Nerede | Her hastanenin kendi sunucusunda (×22) | Tek dış sunucu |
| İşi | Metin al → banka kliplerini birleştir → ses dön | Google TTS ile klip üret, dağıt |
| Google erişimi | **Yok** | Var (tek nokta) |
| Hasta verisi | Görür, dışarı çıkarmaz | Görmez (yalnız bağlamsız token) |
| Bağlantı | Dışarı **Socket.IO client** açar | Socket.IO **server** |

Anons ekranları, HBYS ve çağrı sistemi `ses-bankasi`'nın *istemcisidir* — servisin onlardan
haberi yoktur.

```
┌─────────────┐  HTTP/WS   ┌──────────────────┐  Socket.IO   ┌──────────────┐
│ Anons       │───────────▶│  ses-bankasi     │─────────────▶│  tts-merkez  │
│ ekranları   │◀───────────│  (hastane içi)   │◀─────────────│  (dış sunucu)│
└─────────────┘  ses (WAV) │  ×22             │  token/push  └──────┬───────┘
                           └──────────────────┘                     │
┌─────────────┐                     ▲                               ▼
│ HBYS / çağrı│─────────────────────┘                        ┌──────────────┐
│ sistemi     │      (aynı API)                              │ Google Cloud │
└─────────────┘                                              │ TTS          │
                                                             └──────────────┘
```

**`ses-bankasi`'nın sorumluluğu:** Şablonlu Türkçe metni, düşük gecikmeyle, tutarlı bir sesle
sese çevirmek.

**Sorumluluğu DEĞİL:** kuyruk yönetimi, çalma sırası, TTL, öncelik, hasta takibi, ekran
durumu. Bunlar istemcinin (mevcut çağrı sistemi) işidir ve orada zaten çalışıyor — dokunulmayacak.

Servis **yeniden kullanılabilir** olmalı: yarın bir kiosk, mobil uygulama veya sıra matik
cihazı aynı API'yi çağırabilmeli. Bu yüzden istemciye dair hiçbir varsayım kodda yer almaz.

---

## 2. Temel Karar: Runtime'da TTS Yok

**Bu projenin merkezî fikri budur. Başka her şey bundan türüyor.**

Anons cümleleri yüksek oranda şablonlu; değişkenlerin hepsi sınırlı kümeler:

- Hasta adı (`ADI_SOYADI`, tokenlara bölünür)
- Hedef ifadesi (`Yeşil Alan 4`, `Göz Polikliniği 12` — ölçülen 229 farklı değer)
- Doktor adı (unvanlı), sıra numarası (ölçülen aralık 1–1214)
- Sabit kalıplar: "sayın", "lütfen", "geçiniz", "içeri giriniz"

Dolayısıyla kelime dağarcığı seslendirilip diske yazılır ("ses bankası"), çalışma anında
yalnızca **ham PCM birleştirme** yapılır.

> İsim havuzu tam olarak "kapalı" bir küme değildir — ölçülen Heaps üsteli β=0,69, yani
> dağarcık yavaş büyümeye devam eder (§7.2). Ama dağılım çok diktir: **ilk 2.000 token
> çağrıların %84'ünü** karşılar. Kuyruk fallback ile çözülür (§9B), banka budama ile
> sabitlenir (§7.3).

| | Runtime TTS (Google) | Banka + birleştirme |
|---|---|---|
| İstek başına süre | 130 ms – 2500 ms | **~2 ms** |
| **Aylık TTS maliyeti** | **~$2.800** (22 hastane, ölçülen hacimle) | **$0** — kotanın içinde |
| İnternet kesintisi | **Anons durur** | Banka yerelde, anons devam eder |
| Google'a giden veri | **Her hastanın adı** | Bağlamsız token, tek kelime |
| Ölçek riski | Çağrı arttıkça maliyet artar | Sabit |

Maliyet hesabı ölçülen veriden: 19.504 anons/gün × ~55 karakter × 22 hastane ≈ 700M
karakter/ay; Standard'ın 4M ücretsiz kotası düşülüp $4/1M ile çarpılınca **~$2.800/ay**.
Banka modelinde bu, tek seferlik bir üretim maliyetine dönüşüyor ve ücretsiz kotanın içinde
kalıyor (§6.3).

> GPU gerekmiyor — ne runtime'da ne bankada. Kendi kendine barındırılan TTS motorları (Piper,
> Coqui vb.) §6.1'de lisans nedeniyle zaten elendi; karşılaştırma Google API'si üzerinden.
>
> **KVKK boyutu maliyetten daha belirleyici olabilir:** runtime modelde her hastanın adı
> hastane ağının dışına, Google'a çıkar. Banka modelinde çıkan tek şey bağlamsız kelimedir
> (§11).

---

## 3. Ölçülmüş Yük

**Kaynak: gerçek çağrı logu, 2026-08-17, tek hastane, tam gün.** Bu bölümdeki her sayı
ölçümdür; önceki sürümdeki tahminler (5.269 çağrı/saat, 1,46 istek/sn) gerçeğin üstündeydi
ve dokümanın kendi "bölen tutarsızlığı" uyarısı haklı çıktı.

| Metrik | Ölçülen |
|---|---|
| Günlük tekil çağrı | **19.504** |
| Ekran gösterimi (aynı çağrı × kaç ekran) | 27.805 → **çağrı başına 1,43 ekran** |
| Tepe saat | 09:00 → **3.118 çağrı/saat** |
| **Tepe saat ortalaması** | **0,87 çağrı/saniye** |
| Farklı ekran | 54 |
| Yoğun aralık | 08:00–16:00 (12:00'de keskin öğle düşüşü) |

```
00 ▏109      08 ████████████████████ 1.568     16 ████████ 630
01 ▏ 80      09 ███████████████████████████████████████ 3.118    17 ▏118
02 ▏           10 █████████████████████████████████████ 2.997    18 ▏184
03 ▏           11 ██████████████████████████████ 2.434            19 ▏106
04 ▏           12 ████ 300  ← öğle                                20 ▏115
05 ▏           13 █████████████████████████████ 2.310             21 ▏158
06 ▏           14 ████████████████████████████████ 2.532          22 ▏126
07 ▏           15 █████████████████████████████ 2.321             23 ▏144
```

Gece 01:00–07:00 trafik ~sıfır → **banka senkronizasyonu için ideal pencere**.

### Tepe salvolar — asıl önemli olan

Saatlik ortalama yanıltıcıdır; sistemin sınırını anlık yoğunlaşma belirler:

| Kayan pencere | En çok tekil çağrı | Hız |
|---|---|---|
| 1 saniye | **9 ekran gösterimi** (7 tekil çağrı) | 9 istek/sn |
| 2 saniye | 13 gösterim | 6,5 istek/sn |
| 10 saniye | 33 gösterim | 3,3 istek/sn |
| 60 saniye | 84 çağrı | 1,4 istek/sn |

En kötü an **1 saniyede 9 istek**. Birleştirme istek başına ~2 ms sürdüğüne göre bu 18 ms'lik
iş demek; servis kalan 982 ms'yi boş bekler. Teorik tavan ~500–1.000 istek/sn (§10).

### Ekran doluluğu ve çalma kuyruğu

| Metrik | Ölçülen |
|---|---|
| En yoğun ekran, tepe saat | 253 anons/saat → **hoparlör doluluğu %31,6** |
| Ardışık anons çifti (gün boyu) | 27.751 |
| **5 sn'den kısa aralıkla gelen** | **3 — yani %0,01** |
| 10 sn'den kısa aralıkla gelen | 10.100 (%36) |

Anons ~4,5 saniye sürüyor. Bütün gün boyunca yalnız **3 kez** bir anons bitmeden ikincisi
geldi. Ekran düzeyinde çalma kuyruğu pratikte oluşmuyor.

### Aynı isme eşzamanlı erişim

Aynı saniyede aynı token 14.982 kez birden fazla istendi, en yüksek eşzamanlılık 4. **Bu bir
çekişme değil, avantajdır:** klip salt-okunur bir tampon, aynı anda kaç istek okursa okusun
kilit yok. Sık istenen klip hep sıcak kalır.

Bu sayının çoğu farklı hasta değil, aynı çağrının birden fazla ekranda gösterilmesidir
(1,43 ekran/çağrı). Burada `callId` idempotency (§4.8) gerçek iş yapar: ikinci ve üçüncü
ekran aynı `callId` ile geldiğinde ses yeniden kurulmaz, önbellekten döner — birleştirme
yükünün ~%30'u böyle elenir.

> Ölçüm tek hastanenin tek gününden. 22 hastanenin toplamı ve seslendirmesi açık ekran
> oranı hâlâ ölçülmedi (bkz. §12). Ama büyüklük mertebesi nettir: servis, tavanının
> binde ikisinde çalışacak.

---

## 4. API

Taşıma: **HTTP** (basit istemciler) ve **WebSocket** (kalıcı bağlantılı ekranlar).
İkisi de aynı payload şemasını kullanır.

### 4.1 `POST /v1/speak` — seslendirme isteği

```jsonc
{
  "callId": "9f2c-4a11-...",        // idempotency anahtarı, zorunlu
  "template": "hasta_cagri",         // kayıtlı şablon adı
  "params": {
    "adSoyad": "Mehmet Karabulut",   // TEK alan — HBYS'de de tek alan (aşağıya bak)
    "hedef": "Yeşil Alan 4",         // bütün olarak gelir, parçalanmaz (aşağıya bak)
    "doktor": "Uzm.Dr. Ayşe Yılmaz",
    "sira": 145
  },
  "voice": {
    "profile": "kadin-1",            // opsiyonel, varsayılan sunucu ayarı
    "rate": 1.0,                     // 0.5–2.0, runtime uygulanır
    "pitch": 0,                      // -6 .. +6 yarım ton, runtime uygulanır
    "volume": 0                      // -10 .. +10 dB
  },
  "format": "wav",                   // wav | pcm | opus
  "prefixTone": "ding"               // opsiyonel dikkat tonu | null
}
```

**`adSoyad` tek alandır — ad ve soyad ayrı değil.** Kaynak sistemde (`CAGRI.ADI_SOYADI`,
`nvarchar(300)`) tek kolon olarak duruyor. Servis boşluktan böler ve **son token = soyad,
öncekiler = ad** kuralını uygular ("Ayşe Nur Karabulut" → ad: "Ayşe Nur", soyad: "Karabulut").
Bu ayrım önemlidir çünkü taşıyıcı cümlede ad ve soyad farklı tonlama yuvalarında üretilir
(§7.5).

**`hedef` bütün bir ifadedir, sayıya ayrılmaz.** Gerçek veride hedef ayrı bir "banko no"
alanı değil, tek bir metin: `Yeşil Alan 4`, `Göz Polikliniği 12`, `Masa 3`, `ERİŞKİN USG 2`.
Ölçülen: **229 farklı değer** (tek hastane, 90 gün).

Bunlar bankada **kuyruk cümlesiyle birlikte tek klip** olarak tutulur:
`"Yeşil Alan 4'e geçiniz"` → tek parça, tek klip. Sebep Türkçe ek uyumu: yönelme eki sona
göre değişiyor ("Masa 3'e", "Masa 2'ye", "dörde", "ona"). Sayıyı ayrı klip yapıp ek eklemeye
çalışmak hem dikiş hem tonlama hem de ek kuralı problemi doğurur. 229 klip × ~25 karakter
≈ 6.000 karakter — maliyeti sıfıra yakın, üç problemi birden çözer.

> Yeni bir hedef eklendiğinde (yeni poliklinik, yeni masa) tek klip üretilir. Bu, fallback
> yolunun en sık çalışacağı yer **değildir**; hedef kümesi hastanenin fiziksel yapısıyla
> sınırlı ve yılda birkaç kez değişir.

**`sampleRate` istekte yok — bilinçli.** Banka tek bir doğal örnekleme hızında saklanır
(seçilen Google sesinin hızı) ve runtime'da yeniden örnekleme yapılmaz: hem CPU maliyeti
hem kalite kaybı, hem de tüm §10 hesabını bozar. İstemci hızı `GET /v1/voices`'tan öğrenir.
İleride WAN istemcileri için düşük hız gerekirse ayrı ve ölçülmüş bir özellik olarak eklenir.

**`prefixTone` bankadan gelir.** Dikkat tonları (`ding`, `dingdong`, `gong`) banka içinde
`tip = 'ton'` olan normal kliplerdir — Google TTS ile değil, üretim aşamasında hazır ses
dosyalarından bankaya alınırlar (§7.2). Birleştirmede ilk parça olarak eklenirler, kalan
akış aynıdır. `null` gönderilirse ton eklenmez. Geçersiz bir ton adı `404` döner.

Şablon yerine serbest parça listesi de gönderilebilir:

```jsonc
{
  "callId": "...",
  "segments": [
    { "type": "phrase", "value": "sayın" },
    { "type": "name",   "value": "Mehmet" },
    { "type": "name",   "value": "Karabulut" },
    { "type": "phrase", "value": "Yeşil Alan 4'e geçiniz" }
  ]
}
```

### 4.2 Başarılı yanıt

**Varsayılan (binary):** `200 OK`, `Content-Type: audio/wav`

| Header | Anlam |
|---|---|
| `X-Call-Id` | istekteki `callId` |
| `X-Duration-Ms` | ses süresi |
| `X-Cache` | `hit` \| `local` \| `partial` (aşağıda) |
| `X-Bank-Version` | **istekte kullanılan profilin** banka versiyonu (versiyon profil bazındadır, §4.6) |
| `X-Fallback-Tokens` | bankada olmayıp merkezden çekilen tokenlar (virgüllü) |
| `X-Elapsed-Ms` | servis tarafı toplam süre |

**`X-Cache` değerleri:**

| Değer | Anlamı | `X-Fallback-Tokens` |
|---|---|---|
| `hit` | Aynı `callId` 60 sn içinde tekrar geldi, önceki yanıt aynen döndü (§4.8) | boş |
| `local` | Tüm parçalar yerel bankadan karşılandı — normal ve beklenen durum | boş |
| `partial` | En az bir parça bankada yoktu, merkezden çekildi | çekilen kelimeler |

`partial` yanıtlar `X-Elapsed-Ms` değerini 400–700 ms'ye çıkarır. Sürekli `partial` görüyorsan
banka kapsamı zayıf demektir — merkezdeki fallback günlüğüne (§9F) bak.

**JSON isteniyorsa:** `Accept: application/json`

```jsonc
{
  "callId": "9f2c-4a11-...",
  "durationMs": 4180,
  "sampleRate": 24000,
  "format": "wav",
  "audio": "UklGRi...",              // base64
  "cache": "partial",
  "profile": "kadin-1",              // çözümlenen profil
  "bankVersion": 412,                // O PROFİLİN versiyonu (§4.6 profil bazında tutar)
  "fallbackTokens": ["karabulut"],
  "elapsedMs": 340
}
```

### 4.3 Hata ve degrade davranışı

**İki farklı durum var, karıştırılmamalı:**

#### Gerçek hatalar — ses üretilemiyor

| Kod | Durum | İstemci ne yapmalı |
|---|---|---|
| `400` | Şablon/parametre hatalı | Logla, tekrar deneme |
| `404` | Bilinmeyen şablon, ses profili veya `prefixTone` adı | Logla, tekrar deneme |
| `503` | Banka yüklenmedi / servis hazır değil | Kısa backoff ile tekrar dene |

#### Kısmi başarı — ses üretildi ama eksik

Bir veya birkaç parça çözülemedi (merkez zaman aşımı, kota dolu, Latin dışı alfabe), ama
**kalan parçalarla anlamlı bir anons kuruldu**. Bu durumda servis `200 OK` döner ve
`degraded: true` ile işaretler:

```jsonc
{
  "callId": "...",
  "degraded": true,
  "omitted": ["soyad"],
  "reason": "central_timeout",       // central_timeout | quota_exceeded | unpronounceable
  "durationMs": 2600,
  "audio": "UklGRi...",
  "message": "Soyad seslendirilemedi, sıra numarasıyla anons üretildi."
}
```

Binary yanıtta aynı bilgi header'larda: `X-Degraded: true`, `X-Omitted: soyad`,
`X-Degrade-Reason: central_timeout`.

**Neden `200`?** Ekranın sessiz kalmaması esastır. Kısmi anons, hiç anons olmamasından
iyidir. `4xx/5xx` dönseydi istemcilerin çoğu yanıtı atıp sessiz kalırdı. `degraded` alanı
sinyal olarak yeterli; istemci isterse loglar, ama sesi çalar.

**Hiçbir parça çözülemezse** (örn. tüm şablon tek bir bilinmeyen tokendan ibaret) `422`
döner ve ses gövdesi olmaz — bu gerçek hatadır, kısmi başarı değil.

### 4.4 `GET /v1/voices` — mevcut ses profilleri

```jsonc
{
  "default": "kadin-1",
  "profiles": [
    { "id": "kadin-1", "gender": "female", "engineVoice": "tr-TR-Wavenet-D",
      "sampleRate": 24000, "bankVersion": 412, "loaded": true },
    { "id": "erkek-1", "gender": "male",   "engineVoice": "tr-TR-Wavenet-B",
      "sampleRate": 24000, "bankVersion": 412, "loaded": true },
    { "id": "kadin-yavas", "gender": "female", "engineVoice": "tr-TR-Wavenet-D",
      "bakedRate": 0.9, "sampleRate": 24000, "bankVersion": 409, "loaded": false }
  ]
}
```

> **`bakedRate` neden var?** Hız normalde runtime'da bedava uygulanır (§5.1) ve varsayılan
> yol budur. `bakedRate` yalnızca **kalıcı ve uç bir hız tercihi** için bir kaçış kapısıdır:
> WSOLA time-stretch 0.85x altında veya 1.3x üstünde duyulur artefakt üretebilir. Bir hastane
> kalıcı olarak belirgin yavaş anons istiyorsa, SSML `<prosody rate>` ile **üretim anında**
> gömmek daha temiz çıkar.
>
> Bedeli: tam bir banka varyantı (+13,6 GB disk 1. yıl sonunda, +~2,4M karakter — §6.3, §7.2).
> **Varsayılan olarak kullanma.** Önce runtime `rate` ile dene; prototipte artefakt kabul
> edilemez bulunursa bu yola git.

### 4.5 `GET /v1/templates` — kayıtlı şablonlar

```jsonc
{
  "templates": [
    { "id": "hasta_cagri",
      "pattern": "sayın {adSoyad} lütfen {hedef}",
      "params": ["adSoyad", "hedef"] },
    { "id": "sira_cagri",
      "pattern": "{sira} numaralı sıra, lütfen {hedef}",
      "params": ["sira", "hedef"] }
  ]
}
```

### 4.6 `GET /v1/health`

```jsonc
{
  "status": "ok",                    // ok | degraded | starting
  "bankVersions": {                  // profil bazında — tek skaler değil
    "kadin-1": 412,
    "erkek-1": 409
  },
  "loadedProfiles": ["kadin-1", "erkek-1"],
  "clipsInMemory": 71306,            // yüklü profillerin toplamı
  "memoryMb": 2560,
  "centralReachable": true,
  "uptimeSec": 918341
}
```

> Versiyon **profil bazındadır** (`banka_surum` tablosu profil başına satır tutar). Profiller
> bağımsız üretildiği için versiyonları ayrışır; tek skaler `bankVersion` alanı iki farklı
> durumu temsil edemez. `/v1/voices` ve `manifest:sync` da profil bazında çalışır.

### 4.7 WebSocket — `WS /v1/stream`

Kalıcı bağlantılı ekranlar için. Aynı payload, mesaj çerçevesiyle:

```jsonc
→ { "type": "speak", "callId": "...", "template": "...", "params": {...} }
← { "type": "audio", "callId": "...", "durationMs": 4180, "cache": "hit" }
← <binary frame: WAV>
```

HTTP el sıkışma maliyetini ortadan kaldırır (~0,3–0,8 ms/istek). 100 ekranın kalıcı
bağlantısı ~6 MB RAM.

### 4.8 Idempotency

`callId` zorunlu. Servis son **60 saniyede** gördüğü `callId`'leri tutar; aynısı gelirse
yeni ses üretmeden **aynı yanıtı** döner (`X-Cache: hit`).

> Bu, mevcut sistemdeki çağrı-üretim dedup'ından farklı bir katmandır. Oradaki kontrol
> "bekleyen çağrı varsa ikincisini oluşturma"dır; burada korunan şey ağ hatası/timeout
> sonrası **aynı çağrının iki kez iletilmesi**dir.

---

## 5. Ses Seçenekleri

Ön-üretilmiş banka mimarisinde her seçenek ya **runtime'da uygulanır** (bedava) ya da
**bankayı çoğaltır** (pahalı). Ayrım net olmalı.

### 5.1 Runtime'da uygulananlar — bedava

| Seçenek | Aralık | Yöntem | CPU |
|---|---|---|---|
| `rate` (hız) | 0.5 – 2.0 | WSOLA time-stretch | ~3–8 ms |
| `pitch` (tonlama) | -6 .. +6 yarım ton | phase vocoder | ~5–10 ms |
| `volume` | -10 .. +10 dB | kazanç çarpanı | <0,1 ms |

Ölçülen tepe yük 0,87 istek/sn olduğu için 10 ms'lik DSP bile **tek çekirdeğin %1'i**
demek. Bu seçenekler istek başına serbestçe verilebilir; banka çoğalmaz.

> ⚠️ Basit yeniden örnekleme (`resample`) hızı değiştirirken perdeyi de değiştirir
> ("chipmunk" etkisi) — kabul edilemez. **WSOLA/SOLA** gibi bir time-stretch algoritması
> kullanılmalı. Prototipte 0.8x ve 1.2x çıktıyı dinleyip artefakt seviyesini doğrula.

### 5.2 Bankayı çoğaltanlar — bilinçli seçim

| Seçenek | Neden runtime'da yapılamaz |
|---|---|
| **Ses kimliği** (erkek/kadın, hangi TTS sesi) | Farklı ses = farklı kayıt, sentez gerekir |
| **Baked prozodi** (SSML ile üretilmiş özel tonlama) | Üretim anında gömülür |

Her ses kimliği ayrı bir **banka varyantı**dır:

```
banka/
  kadin-1/     (tr-TR-Standard-A)   ~13,6 GB   (1. yıl, budama açık)
  erkek-1/     (tr-TR-Standard-B)   ~13,6 GB
```

**Kural: profil sayısını sınırlı tut.** Önerilen başlangıç: bir kadın, bir erkek profili.

- Karakter maliyeti profil başına ilk ay ~2,3M, sonra ayda 0,8–1,4M (§6.3)
- Disk profil başına ~13,6 GB (12 aylık budama penceresiyle sabit, §7.3)
- **RAM'e etkisi yok** — banka diskten okunur, sayfa önbelleği yönetir (§10)

`loaded: false` olan profiller diskte durur, RAM'e alınmaz. Bir hastane yalnızca kadın sesi
kullanıyorsa erkek bankası yüklenmez.

### 5.3 Konfigürasyon hiyerarşisi

```
istek.voice.*  >  ekran ayarı  >  hastane varsayılanı  >  servis varsayılanı
```

İstemci hiçbir şey göndermezse servis varsayılanı kullanılır. Böylece mevcut ekranlar hiç
değişmeden çalışmaya devam eder, isteyen ekran kendi tercihini geçebilir.

---

## 6. Ses Motoru

### 6.1 Lisans durumu — kritik

22 hastaneye hizmet = **ticari kullanım**.

| Model | Lisans | Ticari |
|---|---|---|
| **Google Cloud TTS** ← seçilen | Ticari API | ✅ |
| Piper | MIT | ✅ (kullanılmıyor) |
| Coqui XTTS-v2 | CPML | ❌ |
| F5-TTS | CC-BY-NC-4.0 | ❌ |
| facebook/mms-tts-tur | CC-BY-NC-4.0 | ❌ |
| Kokoro | Apache 2.0 | ✅ ama Türkçe yok |

### 6.2 Karar: yalnızca Google Cloud TTS

Yerel fallback motoru (Piper vb.) **yok**. Gerekçe:
- Tek ses → cümle ortasında ses değişimi problemi ortadan kalkar
- Yerel serviste ONNX runtime, model dosyası, ek bağımlılık yok
- "Geçici klibi sonra değiştir" mantığı gerekmez

### 6.3 Maliyet

**Ölçüme dayanır.** Önceki sürümdeki "35.650 klip / 540.000 karakter, tek seferlik" hesabı
iki yerden yanlıştı: (a) kelime dağarcığının doyduğunu varsayıyordu, (b) klip başına ~7
karakter sayıyordu. Gerçek üretim yöntemi taşıyıcı cümleden kesme (§7.5) olduğu için
**token başına ~52 karakter** gider, ve dağarcık doymaz.

#### Ölçülen büyüme

Gerçek çağrı logundan (22.905 çağrı, 50.396 token) uydurulan Heaps eğrisi: **β = 0,69**.
Bu "yavaş doyuyor" demek — sıfıra hiç gitmiyor.

| Süre | %97 kapsam için klip | O ay yeni klip | O ay karakter |
|---|---|---|---|
| 1. ay | 44.300 | 44.300 | **2,3M** |
| 2. ay | 71.600 | 27.200 | 1,4M |
| 3. ay | 94.700 | 23.100 | 1,2M |
| 6. ay | 152.900 | 18.700 | 971K |
| 12. ay | 246.800 | 14.800 | 771K |
| 24. ay | 398.500 | 12.000 | 623K |

Buna hastane bazlı sabitler eklenir (tek seferlik, ~57.500 karakter): sayılar 1–1500
(~1.500 klip), 229 hedef ifadesi, ~400 doktor adı, kalıplar.

#### Kota — tiyer başına ayrı

**Her tiyerin kendi aylık ücretsiz kotası var, birbirinden bağımsızdır.** Kota her ay
yenilenir, devretmez.

| Tiyer | Aylık ücretsiz | Aşımda | tr-TR'de ses |
|---|---|---|---|
| **Standard** | **4M karakter** | $4 / 1M | 5 (3K + 2E) |
| **WaveNet** | 1M karakter | $4 / 1M | 5 (3K + 2E) |
| Chirp 3 HD | 1M karakter | $30 / 1M | 30 — **ama kullanılamaz, §6.6** |
| Neural2 / Studio | — | — | **Türkçede yok** |

> Önceki sürüm "4M (Standard/WaveNet)" diyordu; 4M yalnız **Standard**'a ait, WaveNet 1M.

#### Sonuç

| Tiyer | 1. ay | 2. ay | 3. ay | Sonrası | **Toplam** |
|---|---|---|---|---|---|
| **Standard** (4M) | $0 | $0 | $0 | $0 | **$0** |
| WaveNet (1M) | ~$5 | ~$2 | ~$1 | $0 | **~$8** |

22 hastanenin ortak havuzu için (paylaşım nedeniyle tek hastanenin ~3 katı) Standard'da
yalnız ilk ay ~$12 çıkabilir, sonrası sıfır.

Başlangıç bankası aya yayılırsa her iki tiyerde de **$0** — kota aylık yenilendiği için
acele etmenin bir faydası yok, pilot süreci zaten üç ay (§13).

### 6.4 Kota Koruması — sert durdurma

**Hedef: harcamanın kontrol altında ve öngörülebilir olması.**

> **Politika değişikliği.** Önceki sürüm "hiçbir koşulda ücret ödenmemesi" diyordu. Bu kural,
> ölçümler karşısında zarar veriyordu: on dolarlık bir kararı mimari kısıta çeviriyor ve
> kota paylaşmak için çoklu hesap gibi riskli yollar aramaya itiyordu (§6.5). Yerine:
>
> **İlk üç ay için $10 üst sınır, sonrasında $0 hedefi.**
>
> Ölçülen rakamlarla Standard'da zaten $0 çıkıyor (§6.3); bu tavan yalnız WaveNet tercih
> edilirse veya bir tahmin sapması olursa devreye girer.

Üç katman gerekir; tek başına hiçbiri yeterli değildir.

#### Katman 1 — Uygulama içi sayaç (birincil, tek güvenilir durdurucu)

Her Google TTS çağrısından **önce** atomik sayaç kontrolü. Sayaç **tiyer bazlıdır** —
Standard'ın 4M'i ile WaveNet'in 1M'i ayrı havuzlardır, tek sayaçla izlenemez:

```sql
UPDATE kota
SET kullanilan = kullanilan + $1
WHERE tiyer = $2                                  -- 'standard' | 'wavenet'
  AND donem = date_trunc('month', now())
  AND kullanilan + $1 <= limit_sert
RETURNING kullanilan, limit_sert;
```

Satır dönmezse **çağrı yapılmaz**. `RETURNING` ile atomik olduğu için eşzamanlı isteklerde
yarış durumu oluşmaz.

Eşikler tiyerin kendi kotasının yüzdesi olarak tanımlanır:

| Eşik | Standard (4M) | WaveNet (1M) | Davranış |
|---|---|---|---|
| Uyarı %70 | 2,8M | 700K | Admin panelinde sarı bant + e-posta |
| Kritik %85 | 3,4M | 850K | Kırmızı bant + e-posta + yeni **toplu** üretim durur |
| Sert limit %90 | **3,6M** | **900K** | **O tiyerdeki tüm Google çağrıları durur** |

> Sert limiti kotanın tamamı değil **%90'ı** yap. Google boşlukları, noktalama ve SSML
> etiketlerini de sayar (kesme yönteminde etiketler karakterin yarısını oluşturur, §7.5);
> ayrıca hesabın yenilenme anı ile senin ay hesabın arasında saat farkı olabilir.

Kota dolduğunda `token:request` ack'i `{ status: 'quota_exceeded' }` döner, hastane
degrade yanıt üretir (§4.3). **Sistem çalışmaya devam eder** — sadece o ay yeni kelime
öğrenilmez. Banka zaten %97+ kapsıyor.

#### Katman 2 — Google Cloud API kotası

Konsolda **APIs & Services → Text-to-Speech API → Quotas** altından dakikalık/günlük
karakter kotası tanımla. Uygulama sayacın bir hata yaparsa bu ikinci duvar tutar.

#### Katman 3 — Bütçe alarmı + otomatik billing kapatma

> ⚠️ **Bütçe alarmları harcamayı DURDURMAZ, sadece haber verir.** Bu, Google Cloud'un en çok
> yanlış anlaşılan noktasıdır.

Gerçekten durdurmak için: Budget → Pub/Sub bildirimi → Cloud Function →
`projects.updateBillingInfo` ile **billing hesabını projeden ayır**. Nükleer seçenek; ayrılınca
API tamamen durur ve elle geri bağlanması gerekir. Son çare olarak kur, günlük mekanizma
olarak değil.

Önerilen bütçe: **$1 uyarı, $5 otomatik kapatma**. Katman 1 çalışıyorsa buraya hiç gelinmez.

### 6.5 Birden fazla Google hesabı — YAPILAMAZ

Kota dolduğunda ikinci bir hesaba geçmek **Google Cloud Kullanım Şartları'na aykırıdır.**

<cite index="123-1">Şartların ilgili maddesi, müşterinin hizmetlere "ücret ödemekten kaçınma
amacıyla" erişmesini yasaklıyor ve buna açıkça tek bir hesap gibi davranmak üzere birden
fazla hesap veya proje oluşturmayı, ya da hizmete özgü kullanım limitlerini veya kotalarını
aşmayı dahil ediyor.</cite> <cite index="121-1">Google'ın şartları ücretsiz katmanı veya
ücretsiz deneme programını suistimal etmek amacıyla birden fazla hesap açmayı yasaklıyor.</cite>

Yaptırım hesap askıya alma olabilir — 22 hastanenin ses altyapısı bu riske atılmaz.

**Farklı kişilerin hesaplarını toplamak da aynı kapsamdadır.** "Birkaç arkadaş kendi Google
hesabıyla klip üretsin, sonra tek çatıda birleştirelim" fikri, hesapların gerçek ve ayrı
kişilere ait olması nedeniyle farklı görünür ama değildir: çıktı tek bir ticari üründe
birleşiyor, amaç açıkça kotayı aşmak, ve hesaplar fiilen tek hesap gibi kullanılıyor. Risk
hem katılan kişilerin hesaplarına hem projeye yayılır.

**Ayrıca ihtiyaç da yok.** Ölçülen rakamlarla (§6.3) en yoğun ay 2,3M karakter, Standard'ın
4M aylık kotasının %58'i — başlangıç bankası dahil her şey ücretsiz kotanın içinde.
WaveNet seçilse toplam ~$8. Koordinasyon zahmeti, sürüm karmaşası ve hesap riski, sekiz
dolarlık bir tasarruf için alınmaz.

Gerçekten daha fazla kapasite gerekirse üç meşru yol var:
1. **Üretimi zamana yay** — kota her ay yenilenir. Pilot süreci zaten üç ay.
2. **Ödeme yap** — Standard/WaveNet aşımı $4/1M. Bir profilin tamamı ~$8 eder.
3. **İkinci sağlayıcı** — Amazon Polly'nin ayrı bir ücretsiz katmanı var ve Türkçe neural
   sesi mevcut. Farklı şirket olduğu için bu ToS ihlali değildir. Ama **farklı ses** demektir;
   ancak ayrı bir profil olarak kullanılabilir, aynı bankada karıştırılamaz.

> İşi dağıtmak isteniyorsa meşru yolu var: tek proje, tek faturalandırma hesabı, üretim
> betiği paylaşılan bir servis hesabıyla koşturulur. İş bölünür, kota bölünmez. Gerçi
> üretim tamamen otomatik bir betiktir; dağıtılacak bir emek yoktur.

### 6.6 Ses seçimi ve örnekleme hızı

**Ölçüldü** (`listVoices({ languageCode: 'tr-TR' })`, 2026-08): **40 Türkçe ses.**

| Tiyer | Ses | Kadın / Erkek | Örnekleme hızı | Kesme yöntemi |
|---|---|---|---|---|
| Chirp 3 HD | 30 | 15 / 15 | 24.000 Hz | ❌ **çalışmıyor** |
| Standard | 5 | 3 / 2 | 24.000 Hz | ✅ |
| WaveNet | 5 | 3 / 2 | 24.000 Hz | ✅ |
| Neural2 / Studio | — | — | — | Türkçede **yok** |

Üç ölçüm sonucu:

**1. Hepsi 24.000 Hz.** Önceki sürüm `tr-TR-Standard-A` için 22.050 Hz diyordu — yanlış.
Bütün tiyerler aynı doğal hızda üretiyor, dolayısıyla **banka formatı tiyer seçiminden
bağımsızdır**: 24.000 Hz mono 16-bit PCM. Sonradan tiyer değiştirmek yalnız yeniden üretim
maliyeti demek, mimaride hiçbir şey değişmez.

**2. Neural2 ve Studio Türkçede yok.** Önceki sürüm bunları seçenek olarak sayıyordu.

**3. Chirp 3 HD bu mimaride kullanılamaz.** Ses üretiyor ama **SSML `<mark>` etiketlerine
sıfır zaman damgası döndürüyor** — işaretleri sessizce yok sayıyor. Kesme yöntemi (§7.5)
zaman damgasına bağlı olduğu için Türkçedeki 30 Chirp sesi devre dışıdır. Muhtemelen en
doğal kuşak olması sonucu değiştirmiyor: parçayı kesemiyoruz.

**Tiyer tercihi Standard ile WaveNet arasındadır.** Kalite farkı kulakla karara bağlanır
(prototipteki `cikti/ses-secimi/` karşılaştırması). Kota açısından Standard belirgin
avantajlı: aynı $4/1M aşım fiyatına **4 kat ücretsiz kota**.

#### Motor ve ses, yapılandırmadan gelir

Ses ve motor **koda gömülmez**, merkezdeki profil tanımından okunur:

```jsonc
{
  "id": "kadin-1",
  "motor": "google",                 // google | polly | ...
  "motorSesi": "tr-TR-Standard-A",
  "tiyer": "standard",               // kota sayacı hangi havuzdan düşecek (§6.4)
  "ornekHizi": 24000,
  "varsayilan": true
}
```

Üç kural:

- **Motor bir arayüzün arkasında durur** — `sentezle(metin, profil) → PCM`. Google'a özgü
  hiçbir şey bu arayüzün dışına sızmaz; yarın Polly'ye geçmek tek dosya değiştirir.
- **Ses değiştirmek = yeni banka varyantı.** Aynı bankada iki ses karışamaz. Admin arayüzü
  (§9F) profil eklerken bunu net söyler ve tahmini karakter maliyetini onay öncesi gösterir.
- **`tiyer` alanı zorunludur** çünkü kota sayacı tiyer bazlıdır (§6.4).

> ⚠️ **Doğrulanacak:** Google Cloud TTS çıktısını kalıcı saklayıp tekrar tekrar çalmanın
> sözleşme şartlarına uygunluğu hukuk tarafında teyit edilmeli. Sorun çıkarsa **Amazon
> Polly** açıkça izin veriyor ve Türkçe neural sesi var — doğrudan alternatif.

### 6.7 Dil: `tr-TR` sabit

Cloud TTS'te **otomatik dil tespiti yoktur** (o özellik Speech-to-Text tarafındadır).
Her istekte `languageCode` ve `name` açıkça verilir.

**Ve istenmez.** Yabancı isimler için Arapça/Rusça sese geçmek üç sebeple yanlış:
1. Tek kelimede dil tespiti güvenilmez ("Ali" hem Türkçe hem Arapça)
2. Cümle ortasında ses değişir
3. Hasta Türkçe telaffuz bekliyor — Türkiye'de bir hastanedeyiz

---

## 7. Ses Bankası

### 7.1 Format

- **Mono, 16-bit signed LE, ham PCM** (başlıksız), örnekleme hızı seçilen sesin doğal hızı
- Tek tip format → birleştirme decode/encode gerektirmez, saf byte kopyalama
- Format dönüşümü, normalizasyon, sessizlik kırpma **offline üretimde** yapılır

> ⚠️ Runtime'da **asla** `ffmpeg` subprocess çağırma. Process spawn maliyeti tek başına
> 30–80 ms; sunucuyu boğar. Tüm işlem in-process buffer manipülasyonu olmalı.
>
> **Bu kural subprocess'e karşıdır, bağımlılığa karşı değil.** In-process çalışan bir WASM
> modülü veya native addon (FLAC decoder, DSP çekirdeği) yasak değildir — process spawn
> yoktur, çağrı maliyeti mikrosaniye seviyesindedir. Yasak olan, her istekte bir dış program
> başlatmaktır.

### 7.1.1 FLAC ve WSOLA — bağımlılık kararı

Bu iki parça "harici process yok" kuralıyla gerilim yaratıyor gibi görünür; ayrıntı önemli:

**FLAC decode — istek yolunda değil.** Merkez klipleri FLAC olarak gönderir (§9C), hastane
alır almaz PCM'e açıp diske yazar. Bu **senkron yolunda** olur: gecelik delta, ilk kurulum
indirmesi, `token:push`. Anons üretiminde hiç çalışmaz. Dolayısıyla saf JS veya WASM bir
decoder (`libflac.js` vb.) yeterlidir — hız kritik değil, klip başına birkaç ms kabul edilir.

**WSOLA — istek yolunda, ama TypeScript'te yazılabilir.** Algoritma özünde çapraz korelasyon
aramalı overlap-add'dir. 4 saniyelik 24 kHz mono ses için saf TypeScript uygulaması ~5–20 ms
sürer. Ölçülen 0,87 istek/sn yükünde bu tek çekirdeğin %2'si — bütçe içinde.

> **Prototipte ölçüldü:** 4 sn / 24 kHz ses için saf TypeScript WSOLA, ısıtılmış ölçümde
> 0.8x'te ~42 ms, 1.2x'te ~29 ms. **0.8x kapıyı aşıyor.** Ancak kesme yöntemine geçilince
> `rate` varsayılanı 1.0 oldu (§7.6) ve time-stretch istek yolunda artık çalışmıyor —
> yalnız istemci açıkça `rate` gönderirse devreye giriyor. Karar: varsayılan kapalı,
> gerekirse kaba-ince arama optimizasyonu veya WASM.

> **Prototip kapısı:** Aşama 1'de WSOLA'nın gerçek süresini ölç. 30 ms'i aşarsa iki seçenek
> var: (a) WASM'a taşı, (b) `rate` seçeneğini varsayılan olarak kapat ve `bakedRate` profiline
> yönlendir (§4.4). Kararı ölçüm versin, tahmin değil.

### 7.2 Boyut ve büyüme — ölçülmüş

> **Önceki sürüm yanlıştı.** "35.650 klip / 1,2 GB, yılda ~80 MB büyüme" rakamları, kelime
> dağarcığının hızla doyduğu varsayımına dayanıyordu. Gerçek veriyle ölçülen Heaps üsteli
> **β = 0,69** — dağarcık yavaş doyuyor ve sıfıra hiç gitmiyor.

**Sabit içerik** (bir kez üretilir, hastaneye özgü):

| İçerik | Klip | Boyut |
|---|---|---|
| Sayılar 1–1500, bütün klip | ~1.500 | ~75 MB |
| Hedef ifadeleri ("Yeşil Alan 4'e geçiniz") | 229 | ~13 MB |
| Doktor adları | ~400 | ~29 MB |
| Kalıp öbekler | ~10 | <1 MB |
| Dikkat tonları (ding, dingdong, gong) | 3 | <1 MB |
| **Sabit toplam** | **~2.140** | **~120 MB** |

**İsim tokenları** (sürekli büyür):

| Süre | Klip | Boyut |
|---|---|---|
| 1. ay | ~44.300 | 2,4 GB |
| 3. ay | ~94.700 | 5,2 GB |
| 6. ay | ~152.900 | 8,4 GB |
| **12. ay** | **~246.800** | **13,6 GB** |
| 24. ay | ~398.500 | 21,9 GB |
| 36. ay | ~527.300 | 29,0 GB |

Klip başına ~55 KB (bir isim ~1,1 sn, 24 kHz 16-bit mono = 48 KB/sn).

> Bu tablo tek günlük logdan uydurulmuş eğriye dayanır. Yön güvenilir, kesin sayı değil.
> Gerçek rakam için `CAGRI` tablosunda 90 günlük sorgu gerekir — [FAZ0-TEK-SORGU.sql](FAZ0-TEK-SORGU.sql).
> β 0,60 çıkarsa bu tablo belirgin küçülür.

Ad ve soyad **ayrı klip** olarak tutulur — bkz. §7.2.1.

### 7.2.1 Neden ad+soyad birleşik değil

"Ad ve soyad tek klip olsun, ad↔soyad dikişi kalksın" fikri makul görünür ve dikişi doğru
yerden hedefler. **Ölçüm reddediyor.**

Gerçek veride (3 gün, 22.905 çağrı):

| | Ayrı token | Birleşik tam ad |
|---|---|---|
| Farklı klip | **5.558** | 8.263 |
| **Yalnız 1 kez görülen** | %21 (trafiğin %2,3'ü) | **%33,8** |
| Neye bağlı | Türkiye'nin isim havuzu | Hasta sayısı |
| Doyma | yavaş ama var | **hiç yok** |
| 22 hastanede paylaşım | yüksek — isimler ulusal | **sıfıra yakın** — çift kişiye özel |

Üç günde üretilen kliplerin **üçte biri bir daha hiç çalınmayacaktı**, ve bu oran zamanla
kötüleşir: tekrar edenler havuzda birikir, yeni gelenler hep tekil olur. Fark bugün 1,5 kat,
bir yılda 20–30 kat.

En ağır bedel paylaşımın kaybı: 22 hastanenin ortak öğrenme havuzu (§9) **yalnız ayrı token
modelinde** çalışır. Tam ad çiftleri neredeyse kişiye özel olduğu için hastaneler arası
paylaşım sıfıra yaklaşır ve merkez mimarisinin ana faydası ortadan kalkar.

Dikiş problemi zaten başka türlü çözüldü: §7.5'teki taşıyıcı cümleden kesme yöntemi.

### 7.3 Budama — bankayı sabitleyen mekanizma

§7.2'deki tablo hastane diskinin sınırsız büyüdüğünü gösteriyor. Çözüm, hastanede
**kullanılmayan klipleri silmek**:

- Belirlenen pencerede (varsayılan **12 ay**) hiç çalınmamış klip diskten silinir
- **Yalnız ses verisi silinir**, dizin kaydı (kelime, hash, "merkezde var" bilgisi) kalır
- Merkez hiçbir şey silmez — tek makine, disk ucuz

Böylece hastane bankası kümülatif değil **aktif** dağarcığı tutar ve sabitlenir:

| Pencere | Sabit klip | Disk | Diriliş sıklığı |
|---|---|---|---|
| 6 ay | ~153.000 | 8,4 GB | daha sık |
| **12 ay (varsayılan)** | **~247.000** | **13,6 GB** | daha seyrek |

**Diriliş maliyeti düşüktür.** Budanmış bir klip tekrar gerektiğinde merkez onu **zaten
üretmiştir** — Google'a gidilmez, yalnız diskten okunup gönderilir:

| Yol | Gecikme |
|---|---|
| Hiç görülmemiş kelime → Google TTS | 400–700 ms |
| **Budanmış klip → merkezden geri** | **~60–150 ms** |

Dökümü: gidiş-dönüş 20–50 ms (Socket.IO zaten açık), veritabanı araması ~1 ms, diskten
okuma 1–5 ms, ~26 KB FLAC aktarımı 5–25 ms, çözme ~5 ms.

Sıklığı düşüktür: klip ancak 12 aydır hiç çalınmadıysa silinir, yani yalnız kuyruk budanır.
Ölçülen veride tek kez görülen tokenlar dağarcığın %21'i ama **trafiğin yalnız %2,3'ü**.
Tahmini etki: anonsların **%1–2'si**, her biri ~100 ms ek gecikme — `socket.timeout(2000)`
emniyet kemeri altında (§9C).

> Diski gerçekten dar olan hastanelerde pencere 6 aya indirilebilir; 5 GB tasarruf karşılığı
> diriliş oranı yaklaşık iki katına çıkar.

### 7.3.1 Ön-ısıtma (opsiyonel)

Kaynak sistemde `KAYIT_ZAMANI` ve `CAGRI_ZAMANI` ayrı alanlar — hasta kaydedildiği an ile
çağrıldığı an. Aradaki fark hastanın kuyrukta beklediği süredir.

İstemci kayıt anında servise "bu isim birazdan lazım olacak" ipucu gönderirse, eksik veya
budanmış klip çağrıdan çok önce hazırlanır ve gecikme **tamamen** ortadan kalkar. Bu, §2'deki
"kuyruk mantığı servisin işi değil" sınırını bozmaz: servis yalnız bir ısıtma isteği alır,
kuyruk yönetmez, sıra tutmaz.

Faydası ölçülmelidir: `AVG(DATEDIFF(second, KAYIT_ZAMANI, CAGRI_ZAMANI))` birkaç dakika
çıkıyorsa bedava bir kazançtır.

### 7.4 Parçalama düzeni

Kelime kelime **değil**, anlamlı öbek olarak üret. Daha az dikiş, daha doğal tonlama.

Ölçülen veriye göre gerçek şablon:

```
["sayın"] + ["{ad}"] + ["{soyad}"] + ["lütfen"] + ["{hedef}'e geçiniz"]
```

`{hedef}` bütün bir ifadedir ve kuyruk cümlesiyle birlikte **tek klip** tutulur (§4.1):
`"Yeşil Alan 4'e geçiniz"`. Türkçe yönelme eki sona göre değiştiği için sayıyı ayırmak
hem dikiş hem ek kuralı problemi doğurur; 229 hedefin tamamını bütün üretmek üçünü birden
çözer ve ~6.000 karakter tutar.

### 7.5 Üretim yöntemi — taşıyıcı cümleden kesme

**Bu bölüm prototip sonucuyla tümden değişti.** Önceki sürüm kelimeleri tek tek
seslendirmeyi öngörüyordu. **Dinleme testi bunu reddetti.**

#### Neden yalıtılmış sentez çalışmıyor

TTS "Mehmet"i tek başına sentezlerken onu **bitmiş bir cümle** sayar: sonuna düşen tonlama,
son hece uzatması, sonda hafif çatlak ses koyar ve baştaki perdeyi sıfırlar. Altı tane böyle
mini-cümle yan yana gelince ortaya cümle değil **liste** çıkar.

Prototipte ölçülen: birleştirilmiş cümleler referanstan tutarlı biçimde **%22–30 uzun**.
Bunun 200 ms'i eklenen boşluklar, kalan ~800 ms'i yalıtılmış kelimenin daha yavaş okunması.

Ayar turu bunu kurtaramadı — boşluğu sıfırlamak, %15–25 hızlandırmak, crossfade'i uzatmak,
öbekleri virgülle üretmek, "sayın"/"lütfen" atıp dikiş sayısını azaltmak denendi. Süre
referansla birebir eşitlendiğinde bile ses kopuk kaldı: sorun **süre değil perde konturu**.

#### Çözüm: parçayı cümle içinde ürettir, oradan kes

Klip tek başına değil, **tam bir taşıyıcı cümlenin içinde** üretilir ve SSML `<mark>`
zaman damgalarıyla oradan kesilir. Kesilen parça cümle ortası tonlamasını taşır: sonu
düşmez, perdesi doğru yerde başlar.

```xml
<speak><mark name="m0"/>sayın <mark name="m1"/>Mehmet <mark name="m2"/>Karabulut
<mark name="m3"/>lütfen <mark name="m4"/>Yeşil Alan dörde geçiniz.</speak>
```

Yanıt zaman damgalarını döndürür; ardışık iki damga arası bir kliptir.

**Uygulama kuralları:**

1. **`v1beta1` uç noktası zorunlu.** `enableTimePointing: ['SSML_MARK']` alanı `v1`'de yok
   (`400 Unknown name "enableTimePointing"`). Adres:
   `https://texttospeech.googleapis.com/v1beta1/text:synthesize`
2. **İşaretler farklı konumlarda olmalı.** Bitişik iki işaret (aralarında kelime olmadan)
   Google tarafından tek damgaya indirgenir. Her öğeden **önce** bir işaret koy, bitişi bir
   sonrakinin işaretinden al.
3. **Kesilen parçaya sessizlik kırpma UYGULAMA.** Parçanın sınırları zaten doğal; kırpma
   sessiz ünsüzleri ("Öztürk"teki k, "Ayşe"deki e) yer.
4. **Sonuna 50 ms pay bırak.** Damga kelimenin *metin* sınırını verir; son ünsüzün bırakılışı
   o noktadan sonra biter. Pay verilmezse kelime sonları kesik duyulur. Bu pay birleştirmede
   crossfade ile eritilir (§7.6), tekrar duyulmaz.
5. **Ad ve soyad farklı tonlama yuvalarındadır.** Taşıyıcıda hangisinin nerede olduğu
   bilinmeli: son token = soyad, öncekiler = ad (§4.1).
6. **Chirp 3 HD ile çalışmaz** — işaretlere sıfır damga döner (§6.6).
7. **XML kaçışı ZORUNLU.** Kelime doğrudan SSML'e gömülüyor; içinde `&`, `<`, `>`, `"`, `'`
   geçen bir kayıt ya isteği bozar ya da işaret yapısını sabote eder — ve tüm kesme mantığı
   işaretlere bağlıdır. Kaçış **tek bir yerde**, taşıyıcı kurucusunun içinde yapılmalı;
   çağıranların hatırlamasına bırakılmamalı. Test edilecek girdiler: `O'Brien`, `Smith & Sons`,
   `<test>`, `"tırnak"`.
8. **Klip yazımı atomik olmalı.** Sıra: geçici dosyaya yaz → `fsync` → **`rename`** → sonra
   veritabanına `ready`. Ters sırada veya rename'siz yapılırsa çökme anında veritabanı
   var olmayan ya da yarım bir dosyayı gösterir. `rename` aynı dosya sistemi içinde atomiktir.
9. **Google çağrılarında hız sınırı ve geri çekilme.** Toplu üretim on binlerce klip demek;
   sınırsız paralel istek 429 yağmuru üretir. Eşzamanlılık 5–10 ile sınırlanır, 429/5xx'te
   üstel geri çekilme uygulanır ve `klip.sonraki_deneme` ileri atılır (§9A).

**Doğrulama kuralı:** parçaları bir cümleden kesip *aynı* cümleyi yeniden kurmak hiçbir şey
kanıtlamaz. Kalite ancak **çapraz** kurulumla ölçülür: her parça başka bir taşıyıcıdan gelmeli
ve sonuç hiç üretilmemiş bir cümle olmalı.

**Maliyet etkisi:** token başına ~7 karakter yerine **~52 karakter** (taşıyıcı cümle metni +
SSML etiketleri; bir taşıyıcı hem ad hem soyad verdiği için bölüşülür). §6.3 bu rakamla
hesaplanmıştır.

### 7.5.1 Üretim kalitesi kuralları

1. **Seviye normalizasyonu** — tüm klipler aynı RMS/peak seviyesinde.
2. **Sayı normalizasyonu** — TTS'e "145" değil "yüz kırk beş".
3. **Unvan açılımı** — gerçek veride doktor adları `Uzm.Dr. EDA BİRGÜL`,
   `Dr.Öğr.Üyesi GÜLSÜM ÇEBİ`, `Prof.Dr. OĞUZ ŞÜKRÜ POYANLI` biçiminde geliyor. Kısaltmalar
   açık metne çevrilmeli ("Uzman Doktor", "Doktor Öğretim Üyesi"), yoksa harf harf okunur.
4. **Türkçe alfabe dışı karakterler** — kural seti dursun ama **etkisi marjinal**: ölçülen
   veride q/w/x içeren yalnız 2 token, alfabe dışı karakterli toplam 8 token (**%0,14**).

   | Girdi | Çıktı | | Girdi | Çıktı |
   |---|---|---|---|---|
   | w | v | | ñ | n |
   | q | k | | ß | s |
   | x | ks | | - | boşluk |
   | é, è, ê | e | | | |

   **Latin dışı alfabe** (Kiril, Arap harfleri) tespit edilirse isim yerine sıra numarası
   anons edilir (degrade yanıt, §4.3).
5. **Türkçe collation** — kaynak SQL Server olduğu için `COLLATE Turkish_CI_AS`;
   PostgreSQL tarafında `lower(ad COLLATE "tr-TR-x-icu")`. Aksi halde `LOWER('İ')` beklenen
   sonucu vermez.
6. **Token bazlı bölme** — birleşik adlar ("Ayşe Nur") boşluktan bölünür, her kelime ayrı
   klip. Kardinalite bu sayede patlamaz (§7.2.1).

### 7.5.2 Seslendirilmeyecekler — engellenecekler listesi

Kaynak veride seslendirilemeyecek kayıtlar var; bunlar bankaya hiç girmemeli ve degrade
yola düşmeli (§4.3):

| Kaynak | Örnek | Nasıl tespit edilir |
|---|---|---|
| **Maskelenmiş adlar** | `CAGRI.MASKELEME = 1` | Şemada bayrak var; ayrıca `*` içeren adlar |
| **Kısaltılmış adlar** | `a.hayri`, `b.aymaz`, `h.` | Nokta içeren veya 1–2 harfli token |
| Test/çöp kayıt | `TEST`, `***` | Admin listesi |
| Latin dışı alfabe | Kiril, Arapça, Çince | Karakter aralığı kontrolü |

`MASKELEME` bayrağı kaynak şemada bulunuyor ve önceki doküman sürümünde hiç ele
alınmamıştı. Maskeleme oranı yüksekse bankanın taşıması gereken isim sayısı da düşer —
`FAZ0-TEK-SORGU.sql` bunu ölçer.
6. **Türkçe alfabe dışı karakterler** — sorun dil değil, karakter. Türkçe TTS `q`, `w`, `x`
   ve aksanlı harflerde tökezler:

   | Girdi | Çıktı | | Girdi | Çıktı |
   |---|---|---|---|---|
   | w | v | | ñ | n |
   | q | k | | ß | s |
   | x | ks | | - | boşluk |
   | é, è, ê | e | | | |

   "Wagner" → "Vagner". **Latin dışı alfabe** (Kiril, Arap harfleri) tespit edilirse isim
   yerine sıra numarası anons edilir (degrade yanıt, §4.3) — ekran adı zaten gösteriyor.
   İsmi katletmektense okumamak daha iyi.
7. **Türkçe collation** — PostgreSQL'de `LOWER('İ')` beklenen sonucu vermez.
   `lower(ad COLLATE "tr-TR-x-icu")` kullan.
8. **Token bazlı bölme** — birleşik adlar ("Ayşe Nur", "Mehmet Ali") tek klip olarak
   tutulursa kardinalite patlar. Boşluktan böl, her kelime ayrı klip.

### 7.6 Birleştirme kalitesi (runtime)

**Prototipte ölçülen ayarlar. Önceki sürümdeki "30–50 ms sessizlik" yanlış çıktı.**

| Parametre | Değer | Gerekçe |
|---|---|---|
| **Kelimeler arası boşluk** | **0 ms** | Es koymak sesi bozuyor. Gerçek konuşmada öbek içi kelimeler arasında sessizlik yoktur. |
| **Crossfade** | **45 ms** | §7.5'teki 50 ms kuyruk payını eritir ve dikişi yumuşatır. |
| **Sıfır geçiş hizalama** | açık | Dikişte "tık" sesini önler. |

Denenen ve **elenen** düzenler (hepsi kopukluk veya bozulma üretti):

- Her dikişte eşit 40 ms es
- Yalnız isimden sonra 120 / 160 / 200 ms es ("doğal öbekleme" hipotezi)
- İsimden sonra es + ad/soyad arası hafif es
- 45 ms'ten uzun crossfade (kelimeler birbirine karışıyor)

> **Es koyulacaksa kuyruk payı önce kırpılmalı.** Pay, bir sonraki kelimenin başlangıcını
> içerir; kırpılmadan es eklenirse "kelimenin ilk 35 ms'i → es → kelime baştan" diye
> kekeleme duyulur. Son ünsüzün bırakılışı için 15 ms bırakmak yeterlidir. Prototipte bu
> hata bir tur kaybettirdi.

**Hız (`rate`) varsayılanı 1.0.** Kesme yöntemine geçildikten sonra birleştirilmiş cümlenin
süresi referansla neredeyse birebir aynı (ölçüm: 3,59–3,76 sn karşı 3,60–3,74 sn). Yalıtılmış
sentezdeki %25–30 uzama ortadan kalktığı için hızlandırmaya gerek kalmadı.

---

## 8. Dağıtım Mimarisi

**Merkez ağır ve seyrek işi, hastane hafif ve sık işi yapar.**

```
┌──────────────────────────────────────┐
│  MERKEZ                              │
│  • Token kayıt defteri (PostgreSQL)  │
│  • Google TTS çağrıları              │
│  • Banka üretimi + manifest          │
│  • 22 hastanenin telemetri paneli    │
└───────────────┬──────────────────────┘
                │ kalıcı WS (hastaneden açılır)
    ┌───────────┼───────────┬─────────────┐
    ▼           ▼           ▼             ▼
┌────────┐ ┌────────┐ ┌────────┐    ┌─────────┐
│Hastane1│ │Hastane2│ │Hastane3│ ...│Hastane22│
└───┬────┘ └────────┘ └────────┘    └─────────┘
    │ LAN, ~1 ms
    ▼
 ekranlar / kiosklar / HBYS
```

### Neden merkezi tek sunucu değil

| Sorun | Etki |
|---|---|
| Tek arıza noktası | Sunucu/hat düşerse 22 hastanenin anonsu birden susar |
| Trafik | 220.000+ × ~172 KB ≈ 22 GB/gün çıkış |
| Gecikme | LAN'da 1 ms olan iş, internette 30–80 ms |
| KVKK | Merkezi modelde hasta adı hastane dışına çıkar |

Yerel modelde hasta bilgisi **hastane ağından ayrılmaz**. Merkeze giden: bağlamsız token
istekleri ve sayaç telemetrisi. Tam anons metni **asla**.

---

## 9. Bileşenler

### A. Klip Kayıt Defteri (`tts-merkez`)

22 hastanenin ortak öğrenme havuzu.

**Ses verisi ile kullanım bağlamı ayrı tablolarda.** Sebep: aynı kelime birden fazla
hastanede ve birden fazla tipte geçebilir, ama **sesi aynıdır**. "Yıldız" hem soyad hem
poliklinik adı olabilir; "Op. Dr. Ahmet Kaya" iki farklı hastanede çalışabilir. Ses verisini
tekrarlamak hem israf hem de tutarsızlık kaynağı olur.

```sql
-- Ses verisi: (kelime, profil) başına TEK satır
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- admin arayüzünde kelime araması için

CREATE TABLE klip (
  id             bigserial PRIMARY KEY,
  kelime         text        NOT NULL,         -- normalize edilmiş hali
  telaffuz       text,                         -- TTS'e FİİLEN gönderilen metin (aşağıya bak)
  profil         text        NOT NULL,         -- kadin-1 | erkek-1 ...
  durum          text        NOT NULL,         -- pending | uretiliyor | ready | failed
                                               -- | engellendi | kota_bekliyor
  hash           text,                         -- PCM baytlarının sha256'sı; dosya yolu bundan türer
  sure_ms        int,
  surum          int,                          -- ready olduğu andaki bankVersion
  deneme         int         NOT NULL DEFAULT 0,
  sonraki_deneme timestamptz NOT NULL DEFAULT now(),   -- üstel geri çekilme (aşağıya bak)
  hata           text,
  sahiplenildi   timestamptz,                  -- pending sahiplenme anı
  son_kullanim   timestamptz,                  -- budama penceresi için (§7.3)
  olusturuldu    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kelime, profil)
);

CREATE INDEX ON klip (profil, surum) WHERE durum = 'ready';
CREATE INDEX ON klip (durum, sahiplenildi) WHERE durum = 'pending';
CREATE INDEX ON klip (durum, sonraki_deneme) WHERE durum IN ('pending', 'failed');
CREATE INDEX ON klip USING gin (kelime gin_trgm_ops);   -- admin arama
CREATE INDEX ON klip (son_kullanim) WHERE durum = 'ready';

-- Klip dosyası içerik adresli saklanır, yol kolonu tutulmaz:
--   veri/banka/<profil>/<hash[0:2]>/<hash[2:4]>/<hash>.pcm
-- Tek dizinde yüz binlerce dosya dosya sistemini boğar; parçalı dizin bunu çözer
-- ve aynı içerik iki kez saklanmaz.

-- Kullanım bağlamı: aynı klip birden çok tipte / hastanede geçebilir
CREATE TABLE klip_kapsam (
  klip_id     bigint NOT NULL REFERENCES klip(id) ON DELETE CASCADE,
  tip         text   NOT NULL,     -- ad | soyad | sayi | kalip | ton | poliklinik | doktor
  hastane_id  int    NOT NULL DEFAULT 0,   -- 0 = ortak havuz (tüm hastaneler)
  PRIMARY KEY (klip_id, tip, hastane_id)
);

CREATE INDEX ON klip_kapsam (hastane_id);

-- Profil başına monoton artan banka versiyonu
CREATE TABLE banka_surum (
  profil text PRIMARY KEY,
  surum  int  NOT NULL DEFAULT 0
);
```

**`telaffuz` — yanlış okunan ismi düzeltmenin tek yolu.** Normalizasyon (§7.5.1) çoğu
durumu çözer ama yüz binlerce isimde onlarca vakada yanılır: Türkçe TTS'in tökezlediği ama
kuralların yakalamadığı adlar. Bu kolon olmadan admin arayüzündeki "yeniden üret" düğmesi
**aynı yanlış sesi** üretir, çünkü üretim deterministiktir.

Varsayılanı `NULL`'dur; `NULL` ise `kelime` gönderilir. Admin bir klibi dinleyip
"bunu şöyle yaz" diyebilir, yeniden üretim `telaffuz` alanını kullanır. Değişiklik denetim
günlüğüne yazılır.

**`sonraki_deneme` — geri çekilme.** Google 429 veya 5xx döndürdüğünde aynı klip sıkı
döngüde tekrar denenmemeli. Başarısızlıkta `sonraki_deneme = now() + interval` üstel olarak
uzatılır (örn. 1 dk → 5 dk → 30 dk), sahiplenme sorgusu `sonraki_deneme <= now()` filtresi
kullanır. Bu kolon olmadan tek bir kalıcı hata kotayı ve API limitini yakar.

> `hastane_id = 0` konvansiyonu bilinçli: PostgreSQL'de birincil anahtar kolonu `NULL`
> olamaz, ve `NULL` ile `UNIQUE` karşılaştırması beklenmedik davranır. `0` = "ortak havuz"
> sabiti kullan, `NULL` değil.

**Push hedeflemesi** `klip_kapsam` üzerinden:

```sql
-- Bu klip kimlere gidecek?
SELECT DISTINCT hastane_id FROM klip_kapsam WHERE klip_id = $1;
-- 0 dönerse → io.to('tum-hastaneler'), aksi halde ilgili room'lar
```

### A.2 Versiyonlama

`surum`, manifest mutabakatının (§9C) birimidir. Bir klip `ready` olduğunda:

```sql
BEGIN;
UPDATE banka_surum SET surum = surum + 1 WHERE profil = $1 RETURNING surum;
UPDATE klip SET durum = 'ready', surum = $2, pcm_path = $3, flac_path = $4,
                hash = $5, sure_ms = $6, hata = NULL, deneme = 0
 WHERE id = $7;
COMMIT;
```

> **`deneme = 0` zorunlu.** Sıfırlanmazsa iki kez başarısız olup üçüncüde üretilen bir klip
> `deneme = 3` ile kalır; ileride yeniden üretim gerektiğinde sahiplenme `WHERE`'indeki
> `deneme < 3` koşulu o satırı kalıcı olarak kilitler ve klip bir daha hiç üretilemez.

> ⚠️ **`nextval()` / sequence KULLANMA.** Buradaki güvenlik `UPDATE banka_surum`'un
> transaction boyunca **satır kilidi tutmasından** gelir: versiyon alma sırası ile commit
> sırası aynı olur. Sequence'e çevirirsen numara alma sırası commit sırasından ayrışır ve
> sessiz klip kaybı başlar — hastane 11'i görüp senkron olur, 10 numaralı klip sonra commit
> eder ve delta sorgusunda (`surum > 11`) bir daha asla görünmez. Bu bir "optimizasyon"
> değil, veri kaybıdır.

**Yan etki: profil başına üretim serileşir.** Aynı kilit, aynı profildeki eşzamanlı klip
üretimlerini sıraya sokar. Canlı fallback'te sorun değil (günde birkaç yüz istek), ama
**45.000 kliplik ilk toplu üretimde darboğazdır** — her klip için ayrı transaction alma.

Toplu üretim **partiler hâlinde** commit edilir: N klip üret, tek transaction'da tek versiyon
artışıyla hepsini `ready` yap.

```sql
BEGIN;
UPDATE banka_surum SET surum = surum + 1 WHERE profil = $1 RETURNING surum;
UPDATE klip SET durum = 'ready', surum = $2, ...
 WHERE id = ANY($3::bigint[]);
COMMIT;
```

Parti boyutu 200–1.000 arası makul. Aynı `surum` değerini paylaşan klipler delta sorgusunda
birlikte gelir — bu istenen davranıştır, mutabakat hâlâ doğru çalışır.

Delta sorgusu tek satır:

```sql
SELECT k.kelime, k.hash, k.sure_ms, k.surum
  FROM klip k
  JOIN klip_kapsam kk ON kk.klip_id = k.id
 WHERE k.profil = $1 AND k.durum = 'ready' AND k.surum > $2
   AND kk.hastane_id IN (0, $3)
 ORDER BY k.surum;
```

Hastane `bankVersion`'ını bildirir, merkez farkı döner. `surum` monoton arttığı için
kaçırılan hiçbir klip atlanmaz.

### B. Eksik Token Akışı

```
Hastane → merkez: "karabulut / kadin-1 yok"
merkez → klip tablosuna bak
  ├─ ready   → klibi dön (~50 ms)
  ├─ pending → üretimi bekle, sonucu paylaş
  └─ yok     → Google TTS (~300 ms) → 'ready' yaz
                → isteyen hastaneye dön
                → diğer 21 hastaneye push
```

**Gecikme bütçesi:** en kötü senaryo ≈ **400–700 ms**. Anons zaten ekran kuyruğunda
beklediği için kullanıcı fark etmez.

**Kapsam yazımı — her istekte, klip zaten varsa bile.** Sahiplenme `INSERT`'inden bağımsız
olarak `klip_kapsam` satırı **her `token:request`'te** yazılır. Sebep: mevcut bir kelime yeni
bir hastanede ilk kez geçtiğinde kapsamı genişlemelidir. Bu adım atlanırsa klip hiçbir
hastaneye push edilmez ve delta sorgusundaki `JOIN` onu hiç döndürmez — fallback'le öğrenilen
her kelime tek seferlik kalır.

```sql
-- klip_id'yi al (yeni sahiplenildiyse INSERT'ten, aksi halde SELECT ile)
INSERT INTO klip_kapsam (klip_id, tip, hastane_id)
VALUES ($1, $2, $3)
ON CONFLICT (klip_id, tip, hastane_id) DO NOTHING;
```

`hastane_id` kuralı — `token:request` payload'ındaki `tip` belirler:

| `tip` | `hastane_id` |
|---|---|
| `ad`, `soyad`, `sayi`, `kalip`, `ton` | **`0`** (ortak havuz, 22 hastaneye push) |
| `doktor`, `poliklinik` | **istekteki `hastaneId`** (yalnız o hastaneye) |

> Bu kural tek noktada, paylaşılan protokol paketinde bir fonksiyon olarak yaşamalı
> (`kapsamHastaneId(tip, hastaneId)`), toplu üretim ve fallback yolunda ayrı ayrı
> yazılmamalı. İki yolun ayrışması bu hatanın kaynağıydı.

**Kapsam genişlerse `surum` de artmalı.** Kapsam satırı yazmak tek başına yetmez: klip zaten
`ready` ve eski bir `surum` taşıyorsa, delta sorgusu (`k.surum > $2`) onu yeni kapsanan
hastaneye **hiçbir zaman** döndürmez.

Örnek: "Op. Dr. Ahmet Kaya" klibi `surum = 50`, kapsam `{HST-03}`. HST-11 aynı kelimeyi ilk kez
ister, kapsam `{HST-03, HST-11}` olur ama `surum` 50 kalır. HST-11'in `bankVersion`'ı 400
olduğu için klip onun delta'sında hiç görünmez.

Normal akışta bu fark edilmez — HST-11 klibi ack yanıtında alır. Ama ack 1.500 ms'de
`{ status: 'pending' }` dönerse veya HST-11 o anda kopuksa, klip ona **ne push ile ne manifest
ile** ulaşır. Bu, §9C'deki "push optimizasyon, manifest doğruluk kaynağı" ilkesini kırar.

Bu yüzden kapsam gerçekten genişlediğinde (yani `INSERT` bir satır yazdığında) klip yeni bir
versiyona taşınır:

```sql
BEGIN;
INSERT INTO klip_kapsam (klip_id, tip, hastane_id)
VALUES ($1, $2, $3)
ON CONFLICT (klip_id, tip, hastane_id) DO NOTHING
RETURNING klip_id;
-- Satır döndüyse (kapsam gerçekten genişledi) ve klip zaten 'ready' ise:
UPDATE banka_surum SET surum = surum + 1 WHERE profil = $4 RETURNING surum;
UPDATE klip SET surum = $5 WHERE id = $1 AND durum = 'ready';
COMMIT;
```

`ON CONFLICT DO NOTHING` satır döndürmezse kapsam zaten vardı → versiyon artırma, gereksiz
delta yaratma. Yeni sahiplenilen (henüz `pending`) klipler için de artırma; onların versiyonu
`ready` olurken zaten atanır (§A.2).

> Klip diğer hastanelerin delta'sında yeniden görünür — bu israf değil: delta `hash` taşır,
> ellerinde aynı hash varsa indirmeyi atlarlar. Fazladan giden şey birkaç yüz baytlık
> manifest satırıdır.

**Single-flight + kurtarma.** İki hastane aynı klibi aynı anda isterse Google'a iki istek
gitmemeli. Ama merkez üretim sırasında çökerse satır sonsuza dek `pending` kalmamalı —
tek `INSERT ... ON CONFLICT DO NOTHING` bu tuzağa düşer. Doğrusu **sahiplenme** mantığı:

```sql
INSERT INTO klip (kelime, profil, durum, sahiplenildi, deneme)
VALUES ($1, $2, 'pending', now(), 1)
ON CONFLICT (kelime, profil) DO UPDATE
   SET durum = 'pending',
       sahiplenildi = now(),
       deneme = klip.deneme + 1
 WHERE klip.durum = 'failed'  AND klip.deneme < 3
    OR klip.durum = 'pending' AND klip.sahiplenildi < now() - interval '60 seconds'
RETURNING id, deneme;
```

- **Satır döndü** → üretimi sen sahiplendin, Google'a git
- **Satır dönmedi** → mevcut durumu oku:

```sql
SELECT durum, deneme, pcm_path, sure_ms FROM klip WHERE kelime = $1 AND profil = $2;
```

| Durum | Davranış |
|---|---|
| `ready` | Klibi dön |
| `pending` (taze, <60 sn) | Poll ile bekle — **en fazla 1.500 ms**, sonra `{ status: 'pending' }` dön |
| `failed`, `deneme >= 3` | `{ status: 'failed' }` dön — hastane degrade üretsin |
| `engellendi` | `{ status: 'blocked' }` dön (admin listesi, örn. "TEST", "\*\*\*") |

> **Poll sınırı hastane timeout'una bağlı.** Hastane tarafında `socket.timeout(2000)` var
> (§9C); merkez 1.500 ms'de kesip yanıt dönmezse hastane zaten vazgeçmiş olur ve merkez
> kimsenin beklemediği bir isteği tutmaya devam eder. İki sayı birlikte ayarlanmalı:
> **merkez poll sınırı < hastane timeout'u**, arada en az 500 ms ağ payı.
>
> `{ status: 'pending' }` alan hastane degrade yanıt üretir (§4.3). Klip arka planda
> tamamlanır ve `token:push` ile zaten gelir — kayıp yok, sadece o anki anonsta eksik.

**Sahiplenme yaşı 60 saniye.** Google TTS çağrısı normalde ~300 ms; 60 sn hem çökme
kurtarmasına yeter hem de canlı üretimi yanlışlıkla çalmaz.

**Deneme sınırı 3.** Bir kelime üç kez üretilemiyorsa (geçersiz karakter, kota, kalıcı hata)
sürekli yeniden denemek kotayı yakar. Admin arayüzünden elle sıfırlanabilir.

**Süpürücü job.** Her 5 dakikada bir bayat `pending` satırlarını `failed`'a çevir ve
admin panelinde göster — sessizce takılı kalan bir üretim, fark edilmeyen bir üretimdir:

```sql
UPDATE klip SET durum = 'failed', hata = 'sahiplenme zaman aşımı'
 WHERE durum = 'pending' AND sahiplenildi < now() - interval '5 minutes';
```

> ⚠️ **KARAR BEKLİYOR:** Merkez/internet ulaşılamadığında davranış. Bir timeout (örn. 2 sn)
> tanımlanmak zorunda, yoksa merkez yavaşladığında istemci kilitlenir. Öneri: timeout
> sonrası **degrade yanıt** (§4.3) — isim atlanır, anons sıra numarasıyla çalar, token
> kuyruğa yazılır ve merkez erişilebilir olunca çekilir.

### C. Socket.IO Kanalı (`ses-bankasi` ↔ `tts-merkez`)

Bağlantıyı **hastane açar**. Hastane sunucuları NAT/firewall arkasında olduğu için merkez
içeri istek atamaz — bu yüzden `ses-bankasi` Socket.IO **client**, `tts-merkez` **server**.

Socket.IO'nun bu senaryoda kazandırdıkları: yerleşik yeniden bağlanma (exponential backoff),
ack callback'leriyle istek/yanıt semantiği, binary (`Buffer`) desteği, room/namespace ile
hedefli yayın.

#### Bağlantı ve kimlik

```javascript
// ses-bankasi (hastane)
const socket = io('wss://tts.f4r.example', {
  auth: { hastaneId: 'HST-07', token: process.env.MERKEZ_TOKEN },
  transports: ['websocket'],        // polling'e düşme, gereksiz
  reconnection: true,
  reconnectionDelayMax: 30000
});
```

```javascript
// tts-merkez
io.use(async (socket, next) => {
  const { hastaneId, token } = socket.handshake.auth;
  if (!await dogrula(hastaneId, token)) return next(new Error('unauthorized'));
  socket.data.hastaneId = hastaneId;
  socket.join(`hastane:${hastaneId}`);
  socket.join('tum-hastaneler');
  next();
});
```

Room yapısı push hedeflemesini çözer:
- Ortak tokenlar (ad, soyad, sayı, kalıp) → `io.to('tum-hastaneler')`
- Doktor/poliklinik klipleri → `io.to('hastane:HST-07')`

#### Olay sözleşmesi

**Hastane → merkez** (ack callback'li):

| Olay | Payload | Ack yanıtı |
|---|---|---|
| `token:request` | `{ kelime, profil, tip, hastaneId }` | beş durumdan biri, aşağıda |
| `manifest:sync` | `{ profil, bankVersion }` | `{ profil, bankVersion, delta: [{kelime, tip, hash, sureMs, surum, url}], tam: false }` |
| `telemetry` | `{ istek, fallbackOrani, p99Ms, uptime, bankVersions: { profil: surum } }` | `{ ok: true }` |

**`token:request` ack durumları — beşi de sözleşmenin parçası** (§9B):

| `status` | Ek alanlar | Hastane ne yapar |
|---|---|---|
| `ready` | `audio: Buffer, sureMs, surum` | Bankaya yaz, anonsta kullan |
| `pending` | — | Merkez 1.500 ms'de yetişemedi; degrade üret, klip `token:push` veya delta ile gelir |
| `failed` | `reason, deneme` | Degrade üret; `deneme >= 3` ise bu kelime bir daha istenmez |
| `blocked` | — | Kelime admin tarafından engellenmiş (örn. "TEST", "\*\*\*"); degrade üret, **bir daha isteme** |
| `quota_exceeded` | `donem` | Aylık kota doldu (§6.4); degrade üret, `donem` bitene kadar bu profilde yeni token isteme |

> `blocked` ve `quota_exceeded` hastane tarafında **negatif önbelleğe** alınmalı — aksi halde
> aynı kelime her anonsta merkeze sorulur ve 1,5 sn'lik gecikme her seferinde ödenir.

**Delta öğesinde `tip` ve `surum` neden var:** `tip` olmadan hastane yerel kapsamı doğru
yazamaz (ton mu, soyad mı, doktor mu), `surum` olmadan kendi `bankVersion`'ını nereye kadar
ilerleteceğini bilemez. `sureMs` birleştirmede süre hesabı için gerekir, `hash` ise elde olanı
atlamak için.

**Merkez → hastane** (fire-and-forget):

| Olay | Payload | Anlam |
|---|---|---|
| `token:push` | `{ kelime, profil, tip, audio: Buffer, sureMs, bankVersion }` | Yeni klip, bankaya yaz |
| `bank:invalidate` | `{ profil, bankVersion, sebep }` | Manifest mutabakatı tetikle |
| `config:update` | `{ varsayilanProfil, timeoutMs, ... }` | Merkezden ayar itme |

#### Timeout — zorunlu

```javascript
socket.timeout(2000).emit('token:request', payload, (err, yanit) => {
  if (err) return degradeYanitUret();   // §4.3
  bankayaYaz(yanit);
});
```

`socket.timeout()` olmadan merkez yavaşladığında istemci süresiz bekler ve ekran kilitlenir.

#### Bağlantı kopması

```javascript
socket.on('disconnect', () => bankaYerelModaGec());
socket.on('connect', () => socket.emit('manifest:sync', { profil, bankVersion }));
```

Kopukken servis **tam çalışır** — banka RAM'de, sadece eksik token çözülemez (degrade yanıt).
Bağlanınca ilk iş manifest mutabakatı: kaçırılan push'lar burada yakalanır.

> ⚠️ Socket.IO'nun `connection_state_recovery` özelliği kısa kopmalarda kaçan olayları geri
> oynatır ama **garanti değildir**. Push'u optimizasyon, manifest'i doğruluk kaynağı say.
> İkisi de olmalı.

#### Payload boyutu — kritik ayrım

| Ne | Nasıl |
|---|---|
| Tek klip (~30–50 KB) | Socket.IO binary event ✅ |
| Gecelik delta (birkaç MB) | Socket.IO ✅ |
| **İlk banka indirmesi (~7 GB FLAC)** | **HTTPS indirme ❌ Socket.IO değil** |

İlk kurulumda 7 GB'ı Socket.IO üzerinden akıtmak yanlış: devam ettirilemez, ilerleme
takibi zor, tek kopmada baştan başlar. Doğru yol: `manifest:sync` ack'inde **imzalı indirme
URL'leri** dönsün, hastane bunları HTTPS ile (resumable, `Range` destekli) çeksin.
Socket.IO yalnızca *sinyalleşme* katmanı olsun.

#### Transfer formatı ≠ saklama formatı

Banka diskte ham PCM olarak durur (birleştirme için gerekli), ama **hat üzerinde ham PCM
göndermek israf**. Merkez klipleri FLAC (kayıpsız, ~%50 küçük) olarak göndersin, hastane
alır almaz PCM'e açıp diske yazsın. Bu, ilk banka indirmesini ~600 MB'a düşürür.

> Socket.IO'nun `perMessageDeflate` ayarını **ham PCM için açma** — sıkışmaz, sadece CPU yakar.
> FLAC gönderiyorsan zaten sıkıştırılmış, yine gereksiz. Kapalı tut.

#### Ölçek

22 hastane × 1 kalıcı bağlantı = **22 socket**. Merkez için hiçbir yük değil; tek Node
process fazlasıyla yeter. Merkezin gerçek yükü Google TTS çağrıları ve klip depolama,
socket sayısı değil.

### D. Banka Üretici (`tts-merkez`)

```
HBYS'den doktor listesi + hedef ifadeleri (SERVIS_ADI) çek
  → 1 aylık ad/soyad frekans verisini yükle (FAZ0-TEK-SORGU.sql)
  → normalizasyondan geçir, engellenecekleri ayıkla (§7.5.1, §7.5.2)
  → mevcut klip tablosuyla karşılaştır
  → eksikleri TAŞIYICI CÜMLEYE yerleştir, SSML <mark> ile işaretle
  → v1beta1 text:synthesize + enableTimePointing
  → zaman damgalarından parçaları kes (§7.5), 50 ms kuyruk payı bırak
  → seviye normalize et  [sessizlik KIRPMA — kesilmiş parçaya uygulanmaz]
  → klip + klip_kapsam'a yaz, banka_surum artır (parti halinde, §A.2)
```

**Taşıyıcı cümleye yerleştirme kuralı:** her taşıyıcı bir ad ve bir soyad taşır; sabit
öbekler ("sayın", "lütfen") her taşıyıcıda tekrar üretilir ama yalnız bir kez saklanır.
İki token bir cümleyi paylaştığı için karakter maliyeti token başına ~52'ye bölünür (§6.3).

**Toplu üretimde kota tavanı beklenir.** Kota dolduğunda üretim durur, kalan tokenlar
`kota_bekliyor` durumunda bırakılır ve ertesi ay kota yenilenince devam edilir (§6.4).

### E. Seslendirme Servisi (`ses-bankasi`)

```
Açılışta: banka dizinini yükle (kelime → dosya yolu, hash) — SES VERİSİ YÜKLENMEZ
          merkeze Socket.IO bağlantısı aç, manifest:sync gönder
İstek:  şablon + parametreleri parçalara ayır
   → adSoyad'ı tokenlara böl (son token = soyad), normalizasyon uygula
   → klipleri diskten oku (sayfa önbelleği sıcak olanları RAM'de tutar, §10)
   → eksik token varsa merkeze sor (§B), socket.timeout(2000)
   → 0 ms boşluk + 45 ms crossfade + sıfır geçiş ile birleştir (§7.6)
   → rate / pitch / volume istenmişse uygula (§5.1) — varsayılan 1.0, işlem yok
   → istenen formata çevir (wav | pcm | opus)
   → dön
Arka planda: son kullanım zamanını güncelle (budama için, §7.3)
             12 aylık pencereyi geçen kliplerin sesini sil, dizin kaydını koru
```

### F. Admin Arayüzü (`tts-merkez`)

Merkezde çalışan web arayüzü. Kelime veritabanını elle yönetmek, üretim durumunu izlemek ve
kotayı takip etmek için.

#### Kelime veritabanı

Tek ekran, filtrelenebilir tablo. Her satır bir `(kelime, profil)` çifti:

| Kelime | Tip | Profil | Durum | Süre | Kaynak | İşlem |
|---|---|---|---|---|---|---|
| karabulut | soyad | kadin-1 | ✅ hazır | 720 ms | fallback | ▶ dinle · ↻ yeniden üret |
| karabulut | soyad | erkek-1 | ⏳ bekliyor | — | fallback | ▶ üret |
| dahiliye polikliniğine | poliklinik | kadin-1 | ✅ hazır | 1.240 ms | toplu | ▶ dinle |
| wagner | soyad | kadin-1 | ⚠️ normalize | 690 ms | fallback | ⓘ "vagner" olarak üretildi |
| \*\*\* | soyad | — | ⛔ engellendi | — | fallback | ↺ engeli kaldır |

**Durumlar:** `bekliyor` · `üretiliyor` · `hazır` · `hatalı` · `engellendi` · `kota_bekliyor`

**Filtreler:** durum, profil, tip, hastane, tarih aralığı, kaynak (toplu / fallback).
Varsayılan görünüm: **çevrilmemişler önce**.

#### Toplu ekleme

- Metin kutusuna satır satır yapıştırma
- CSV/TXT yükleme (`kelime,tip` veya sadece `kelime`)
- Ekleme öncesi **önizleme**: kaç yeni, kaç zaten var, normalizasyon sonrası hali ne olacak,
  toplam kaç karakter tüketecek, kota sonrası ne kalacak
- Onay verilince kuyruğa girer, arka planda üretilir

> Bu ekran normalizasyonu (§7.5) **ekleme anında** göstermeli. "Wagner" yazan kullanıcı,
> bankaya "vagner" olarak gireceğini onaydan önce görsün.

#### Kota paneli

```
WaveNet — Ağustos 2026
████████░░░░░░░░░░░░░░░░  1.082.400 / 3.600.000   (%30)
Kalan: 2.517.600 karakter · Sıfırlanma: 1 Eylül

Chirp 3 HD    ░░░░░░░░░░  0 / 900.000   (%0)
```

Eşiğe yaklaşınca sarı/kırmızı bant. Kota dolduğunda üretim butonları kilitlenir ve neden
kilitli olduğu yazar.

#### Fallback günlüğü

Runtime'da bankada bulunamayan kelimelerin listesi — **hangi hastanede, kaç kez, ne zaman**.
Bu ekran iki işe yarar:

1. Bankanın nerede zayıf olduğunu gösterir (belirli bir tip sürekli eksik çıkıyorsa toplu
   ekleme gerekir)
2. Kirli veriyi ortaya çıkarır ("TEST", "***", tek harfli tokenlar) → engellenecekler listesi

#### Dağıtım durumu

22 hastanenin canlı tablosu: bağlı mı, hangi `bankVersion`'da, son heartbeat, fallback oranı,
p99 gecikme. Bir hastane geri kalmışsa buradan elle `bank:invalidate` tetiklenebilir.

#### Ses profilleri

Profil ekleme/çıkarma ve profil tanımının (§6.6) düzenlenmesi: **motor**, **motor sesi**,
**tiyer**, örnekleme hızı, hangi hastanelerde yüklü olduğu.

- Ses listesi `listVoices` ile canlı çekilmeli, elle yazılmamalı
- **Kesme yöntemini desteklemeyen sesler işaretlenmeli.** Chirp 3 HD aileleri SSML `<mark>`
  zaman damgası döndürmüyor (§6.6); arayüz bunları seçilebilir göstermemeli veya net uyarı
  vermeli
- Tiyer seçimi kota sayacını belirler (§6.4) — Standard 4M, WaveNet 1M

Yeni profil eklemek **tüm bankanın o profil için yeniden üretilmesi** demektir — ekran bunu
net söylemeli ve tahmini karakter maliyetini, hangi aya sığacağını, kota durumunu onay öncesi
göstermeli.

#### Budama durumu

Her hastane için: banka boyutu, aktif klip sayısı, son budama zamanı, budanmış klip sayısı,
**diriliş oranı** (budanmış olup tekrar istenen klipler). Diriliş oranı beklenenin üstündeyse
(§7.3'e göre anonsların %1–2'si) pencere uzatılmalı.

Buradan elle budama tetiklenebilir ve hastane bazlı pencere (varsayılan 12 ay) değiştirilebilir.

#### Erişim

Arayüz dışarıya açık bir sunucuda çalışıyor. Minimum: kullanıcı adı/parola + TOTP, IP
kısıtlaması, tüm işlemler için denetim günlüğü (kim ne zaman ne üretti/sildi/engelledi).

### G. Telemetri

Günlük küçük paket: istek sayısı, fallback oranı, **profil başına** `bankVersions`, uptime,
p99 gecikme, profil kullanım dağılımı.

> ⚠️ Sadece sayaç. **Anons metni merkeze gitmez.** (Eksik token isteği istisnadır —
> orada da yalnızca tek kelime gider, hasta kaydı değil.)

### Yan fayda: merkez bir öğrenme sistemi

22 hastane ortak havuza beslediği için yeni token gelme hızı tek hastaneninkinden ~22 kat
çabuk doyar. Yeni bir hastane eklendiğinde **sıfırdan başlamaz** — mevcut havuzun tamamıyla
doğar. 23. hastanenin fallback oranı ilk gün bile %1'in altında olur.

---

## 10. Kaynak Gereksinimi

### İstek başına

Ortalama anons: ~6 parça, ~4 sn ses = ~190 KB PCM buffer.

| İşlem | CPU |
|---|---|
| 6 buffer concat | ~30 µs |
| Crossfade (6 dikiş) | ~10 µs |
| rate/pitch (istenmişse) | ~3–10 ms |
| Format dönüşümü (WAV başlığı) | ~1 µs |
| HTTP request/response overhead | ~0,3–0,8 ms |
| **Toplam (DSP'siz)** | **~1 ms** |
| **Toplam (DSP'li)** | **~10 ms** |

### Ölçülmüş tepe yükte (0,87 istek/sn ortalama, 9 istek/sn salvo)

| Kaynak | Kullanım |
|---|---|
| CPU (DSP'siz) | **tek çekirdeğin %0,2'si** |
| CPU (her istekte DSP) | **tek çekirdeğin %2'si** |
| CPU, 1 sn'lik 9 istekli salvoda | 18 ms — kalan 982 ms boş |
| RAM (banka) | **yok — bkz. aşağıdaki not** |
| RAM (Node heap + geçici buffer) | ~150 MB |
| RAM (sıcak klip önbelleği, işletim sistemi) | ne kadar boş varsa |
| RAM (~100 WS bağlantısı) | ~6 MB |
| Ağ çıkışı | ~170 KB/sn (~1,4 Mbit/sn) |

Servisin teorik tavanı ~500–1.000 istek/sn. Ölçülen tepe salvo bunun **yüzde biri**.

> **Banka RAM'e yüklenmez — bu karar değişti.** Önceki sürüm açılışta 1,2 GB'lık bankayı
> belleğe almayı öngörüyordu. Ölçülen banka boyutu 13,6–29 GB (§7.2); bu artık mümkün değil,
> ama zaten gerekli de değil:
>
> - Klip diskten okuma ~50–100 µs; istek başına 5 parça = ~500 µs, 1 ms bütçesinin içinde
> - Erişim dağılımı çok dik (ilk 1.000 token trafiğin %70'i) — işletim sisteminin **sayfa
>   önbelleği** sıcak klipleri kendiliğinden bellekte tutar, üstelik kullanım değiştikçe
>   kendini ayarlar
> - Açılışta 13 GB yükleme beklemesi ortadan kalkar; servis anında hazır olur
>
> Yani RAM, elle yönetilen bir banka yerine işletim sistemine bırakılır. Bu, servisin
> **mevcut HBYS sunucusuna kurulabilmesini** de mümkün kılar (Faz 0 madde 12).

### Ekran doluluğu

Ölçülen (§3): en yoğun ekran tepe saatte 253 anons/saat → ~4,5 sn'lik anonsta hoparlör
doluluğu **%31,6**. Gün boyu yalnız 3 kez bir anons bitmeden ikincisi geldi.

**Ekran başına tavan:** 4,5 sn'lik anonsta ~800 çağrı/saat. Ölçülen tepe bunun üçte biri.
Doyma yaşanırsa çözüm sunucu değil, anons metnini kısaltmak.

### Önerilen donanım (hastane)

| | Değer |
|---|---|
| RAM | **4 GB** (2 GB da yeter; fazlası sayfa önbelleğine yarar) |
| CPU | 1–2 vCPU |
| Disk | **50 GB** — budama açıkken 12 aylık pencere ~13,6 GB (§7.3) |
| GPU | Yok |
| İnternet | Merkeze çıkış erişimi (eksik token akışı) |

> **İkinci profil eklenirse disk ikiye katlanır** (~27 GB), RAM'e etkisi olmaz. Başlangıçta
> tek profil önerilir (§5.2) — ikincisi sonradan tek üretim koşusuyla eklenebilir.

### `tts-merkez` donanımı (dış sunucu, ×1)

Merkez bankayı **RAM'e almaz** — diskten okur ve gönderir. Yükü klip üretimi ve dağıtım.

| Kaynak | Değer | Not |
|---|---|---|
| RAM | **4 GB** | PostgreSQL + Node + admin arayüzü |
| CPU | **2 vCPU** | Google TTS çağrıları I/O-bound |
| Disk | **250 GB** | aşağıdaki döküme göre, 3 yıllık |
| Socket | 22 kalıcı bağlantı | önemsiz |

**Merkez hiçbir klibi silmez** — budama yalnız hastane tarafındadır (§7.3). Merkez, 22
hastanenin birleşik havuzunu kalıcı tutar; bir hastanede budanan klip buradan geri gelir.

**Disk dökümü (tek profil, 3 yıl sonunda):**

| Kalem | Boyut |
|---|---|
| Birleşik isim havuzu PCM (22 hastane, ~%40 örtüşme varsayımıyla) | ~130 GB |
| Hastane bazlı klipler (doktor, hedef ifadeleri) × 22 | ~1 GB |
| FLAC kopyaları (dağıtım için, ~%50) | ~65 GB |
| PostgreSQL | ~2 GB |
| OS + uygulama + log | ~20 GB |
| **Toplam** | **~220 GB** → 250 GB al |

> Bu rakam §7.2'deki büyüme eğrisine dayanır ve **en belirsiz tahmindir**: 22 hastanenin
> isim havuzları ne kadar örtüşüyor bilinmiyor. Örtüşme yüksekse (soyadlar ulusal olduğu
> için beklenen budur) rakam belirgin düşer. Nesne depolama (S3 vb.) kullanmak, diski
> önceden boyutlandırma zorunluluğunu kaldırır ve bu belirsizliği önemsizleştirir —
> **merkez için önerilen yol budur.**
>
> İki profil her şeyi ikiye katlar. Tek profille başlamak burada da geçerli (§5.2).

**Bant genişliği:**

| Olay | Trafik |
|---|---|
| Yeni hastanenin ilk indirmesi (1. yıl bankası, FLAC) | **~7 GB, tek seferlik** |
| İlk kurulum dalgası (22 hastane) | **~150 GB, tek seferlik** |
| Gecelik delta (22 × birkaç MB) | ~200 MB/gün |
| Canlı `token:request` / `token:push` | ~5 MB/gün |

İlk dalga tek seferlik ama büyük — **hastaneleri aynı gece başlatma.** Kurulum sırasını
kademelendir (gecede 2-3 hastane) veya bant genişliği sınırı koy. Trafik kotalı bir VPS
kullanıyorsan bu rakamı sözleşmenle karşılaştır.

> Alternatif: yeni hastane **boş bankayla** açılıp fallback ile organik dolabilir. İlk
> günlerde degrade oranı yüksek olur ama birkaç haftada oturur ve 150 GB'lık dalga hiç
> oluşmaz. Pilot sonrası yaygınlaştırmada bu yol değerlendirilmeli.

### Yapılmayacaklar

- ❌ **Cluster / çoklu Node process** — CPU'da 100 kat baş boş var. Cluster, durumu process'ler
  arasında böler (Redis bağımlılığı) ve bankayı her process'te kopyalar. Kazanç sıfır.
- ❌ **Redis / harici state store** — **hem hastane hem merkez için.**

  Hastane tarafında gerekçe basit: tek process, paylaşılan durum yok.

  Merkez tarafında soru daha ciddidir, çünkü orada gerçek bir iş kuyruğu var (on binlerce
  klip, yeniden deneme, eşzamanlılık sınırı, ilerleme). Yine de cevap hayır:

  1. **Kuyruk zaten `klip` tablosu.** Bir klibin üretim durumu, o klibin kendisidir; işi
     Redis'e taşımak iki ayrı doğruluk kaynağı yaratır. `FOR UPDATE SKIP LOCKED` aynı
     sahiplenme semantiğini sıfır ek altyapıyla verir:

     ```sql
     UPDATE klip SET durum = 'uretiliyor', sahiplenildi = now()
     WHERE id IN (
       SELECT id FROM klip
        WHERE durum = 'pending' AND sonraki_deneme <= now()
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 8
     ) RETURNING *;
     ```
  2. **Kota sayacı Redis'te olamaz.** §6.4 onu "tek güvenilir durdurucu" ilan ediyor; atomik
     *ve kalıcı* olmak zorunda. Redis'e taşımak, sistemde asla yanlış olmaması gereken tek
     sayıyı zayıflatır.
  3. **İkinci durumlu servis** kurulacak, izlenecek, yedeklenecek. Üç kişinin kullandığı bir
     panel için arıza yüzeyi iki katına çıkar.

  BullMQ'nun hazır verdiklerinin karşılığı: eşzamanlılık `LIMIT`, yeniden deneme `deneme`,
  geri çekilme `sonraki_deneme`, dead-letter `deneme >= 3`, ilerleme `GROUP BY durum`,
  takılan iş `sahiplenildi` süpürücüsü, hız sınırı süreç içi token bucket.

  **Fikri değiştirecek koşul:** birden fazla üretici süreç/makine aynı kuyruğa yüklenirse.
  Tek process I/O-bound Google çağrıları için yeterli olduğu sürece gerekmez.
- ❌ **LAN'da Opus/MP3 kodlama** — trafik sorun değil, kodlama CPU'yu 10 kat artırır.
  (`format: "opus"` API'de var, WAN üzerinden çağıran istemciler için.)

### Dayanıklılık (cluster yerine)

- `systemd`: `Restart=always`, `RestartSec=1`
- Global `uncaughtException` / `unhandledRejection` → logla, temiz kapat, systemd kaldırsın
- `/v1/health` + merkeze heartbeat
- İstemci tarafında 1–2 anonsluk yerel tampon → servis 3–5 sn düşse bile fark edilmez
- Merkez erişilemezse **eski bankayla çalışmaya devam** — anons asla durmaz

---

## 11. KVKK / Güvenlik

- Hasta adı hastane ağından çıkmaz; tam anons metni hiçbir yere gönderilmez
- Merkeze giden tek şey bağlamsız token (tek kelime) ve sayaç telemetrisi
- Google'a giden: jenerik ad/soyad havuzu, doktor ve poliklinik adları — hangi hastanın
  hangi doktora gittiği bilgisi **hiç** gitmez
- **Üretilen anonsları arşivleme.** Gerekiyorsa 7–30 günlük dönen arşiv + otomatik silme.
  Hasta adı içeren ses kaydı kişisel sağlık verisidir, süresiz saklanamaz.
  (Ham PCM arşivi yılda ~640 GB/hastane eder — saklamamak için bir sebep daha.)
- API kimlik doğrulaması: hastane içi ağda bile token/mTLS. Servis "herkese açık" olmamalı.

---

## 12. Faz 0 — Kod Yazmadan Önce

**Sorguların hepsi yeniden yazıldı.** Kaynak sistem **SQL Server**'dır, PostgreSQL değil;
önceki sürümdeki sorguların hiçbiri çalışmaz. Yerine iki dosya:

- [FAZ0-TEK-SORGU.sql](FAZ0-TEK-SORGU.sql) — hepsi tek batch, **tek sonuç tablosu** döner
- [FAZ0-SORGULAR.sql](FAZ0-SORGULAR.sql) — bölüm bölüm, ayrıntılı inceleme için

### Kaynak şema — doğrulandı

`CAGRI` tablosunun önceki varsayımlarla çatıştığı noktalar:

| Alan | Doküman ne sanıyordu | Gerçek |
|---|---|---|
| `ADI_SOYADI` | ad ve soyad ayrı kolonlar | **tek** `nvarchar(300)` alan (§4.1) |
| `BANKO_NO`, `SIRA_NO` | `int` | `nvarchar(300)` — sayısal olmayan değer olabilir |
| hedef | ayrı "masa/banko no" alanı | tek bileşik metin: `Yeşil Alan 4` (§4.1) |
| `MASKELEME` | dokümanda yok | `bit` — maskeli adlar seslendirilemez (§7.5.2) |
| `CAGRI_TIPI` | dokümanda yok | şablon sayısını belirler |
| `KAYIT_ZAMANI` | dokümanda yok | ön-ısıtma için kullanılabilir (§7.3.1) |

### Cevaplananlar

| # | Soru | Durum |
|---|---|---|
| 9 | **Mevcut Türkçe sesler** | ✅ **Cevaplandı** — 40 ses, hepsi 24 kHz, Neural2/Studio yok, Chirp 3 HD kesme yöntemiyle çalışmıyor (§6.6) |
| 7 | **Ad/soyad frekans dağılımı** | 🟡 **Kısmen** — 4 günlük logdan β=0,69 ölçüldü (§7.2). 90 günlük sorgu ile doğrulanmalı |
| 6 | **En yoğun ekranın yükü** | ✅ **Ölçüldü** — 253 anons/saat, hoparlör doluluğu %31,6 (§3) |
| 8 | **Türkçe alfabe dışı oran** | ✅ **Ölçüldü** — %0,14, marjinal (§7.5.1) |
| 11 | **Kaç ses profili** | 🟡 Tek profille başlanması öneriliyor; ses seçimi dinleme testine bırakıldı |

### Hâlâ cevaplanmamış

1. **🔴 Google ToS — çıktının kalıcı saklanması.** *Bu listenin 1. maddesi olmalı.* Google
   Cloud TTS çıktısını diske yazıp aylarca tekrar tekrar çalmanın sözleşmeye uygunluğu hukuk
   tarafında teyit edilmeli. **İzin yoksa banka mimarisinin tamamı geçersizdir** ve
   dokümandaki hiçbir hesap anlam taşımaz. Sorun çıkarsa Amazon Polly açıkça izin veriyor ve
   Türkçe neural sesi var (§6.6).

2. **🔴 Gerçek banka boyutu — 90 günlük sorgu.** `FAZ0-TEK-SORGU.sql`'in "3-kapsam" bölümü.
   §7.2, §7.3 ve §6.3'teki bütün tablolar tek günlük logdan uzatılmış β=0,69 eğrisine
   dayanıyor. β 0,60 çıkarsa disk ve maliyet tabloları belirgin küçülür.

3. **🔴 KARAR: merkez ulaşılamadığında davranış** — timeout süresi ve degrade davranışı (§9B).

4. **Mevcut çağrı akışı** — servise isteği kim atacak? HBYS mi, ekran mı, aracı servis mi?

5. **İstemci tipi** — ekranlar tarayıcı tabanlı mı, yerel uygulama mı? (WS mi HTTP mi
   varsayılan olacak.)

6. **Anons metni tam şablonları** — `CAGRI_TIPI` başına birebir cümle kalıpları. Hastaneye
   göre değişiyor mu? (`FAZ0-TEK-SORGU.sql` bölüm 9 dağılımı verir.)

7. **Servise ulaşan gerçek çağrı sayısı** — ölçülen 19.504/gün tüm ekranların toplamı.
   Seslendirmesi açık ekranların oranı `EKRAN` tablosundan çıkarılmalı.

8. **Maskeleme oranı** — `MASKELEME = 1` yüzdesi. Yüksekse bankanın taşıması gereken isim
   sayısı düşer (`FAZ0-TEK-SORGU.sql` bölüm 1).

9. **Ön-ısıtma penceresi** — `AVG(DATEDIFF(second, KAYIT_ZAMANI, CAGRI_ZAMANI))`. Birkaç
   dakikaysa §7.3.1 bedava kazanç.

10. **Yerel donanım** — mevcut HBYS sunucusuna mı kurulacak, ayrı makine mi? (RAM ihtiyacı
    düştüğü için artık daha kolay — §10.)

11. **Dağıtım şekli** — Docker mı, systemd + binary mi? Hastane BT'sinin müdahalesi
    bekleniyor mu?

12. **Ses tercihi** — Standard mı WaveNet mi, hangi ses? Prototipteki `cikti/ses-secimi/`
    karşılaştırması dinlenerek karara bağlanacak (§6.6).

## 13. Uygulama Sırası

**0. ✅ Prototip — tamamlandı.** `prototip/` klasöründe. Ses kalitesi sorusu cevaplandı:
yalıtılmış sentez reddedildi, taşıyıcı cümleden kesme yöntemi kabul edildi (§7.5). Birleştirme
ayarları ölçüldü (§7.6). Ses tiyerleri ve SSML desteği ölçüldü (§6.6). Kalan: hangi Standard
sesinin kullanılacağının dinleyerek seçilmesi.

1. **🔴 Google ToS teyidi** — hukuk. Kod yazmayı beklemez, paralel yürür ama **pilot öncesi
   kapanmalı** (§12).
2. **🔴 Faz 0 ölçümü** — `FAZ0-TEK-SORGU.sql`'i 90 günlük veride koştur. Banka boyutu,
   maskeleme oranı, şablon sayısı, ön-ısıtma penceresi buradan gelir.
3. **`ses-bankasi` API iskeleti** — `/v1/speak`, `/v1/voices`, `/v1/health`, sabit mini
   bankayla, merkez bağlantısı olmadan. Ses çekirdeği prototipten alınır.
4. **`tts-merkez` çekirdeği** — `klip` + `klip_kapsam` + `banka_surum` + `kota` şeması,
   **taşıyıcı cümleli üretici** (v1beta1, SSML mark), sahiplenmeli single-flight, tiyer bazlı
   kota sayacı
5. **Socket.IO kanalı** — `token:request` ack akışı, timeout, degrade yolu; sonra
   `token:push` ve `manifest:sync`
6. **Banka üretici** — tam sürüm, incremental, profil bazında; HTTPS toplu indirme
7. **Budama** — 12 aylık pencere, dizin kaydını koruyarak silme, diriliş yolu (§7.3)
8. **Yük testi** — 20 istek/sn (ölçülen tepe salvonun 2 katı), p99 ölç (50 ms altı beklenir);
   ayrıca merkez kopukken degrade yolunu ve budanmış klip dirilişini test et
9. **Pilot** — bir hastanede tam kurulum, 2 hafta
10. **Yaygınlaştırma** — 22 hastane, kademeli (gecede 2-3 hastane, §10)

---

## 14. Teknoloji Yığını

### `ses-bankasi` (hastane, ×22)

- **Node.js + TypeScript**
- HTTP + WebSocket sunucu (istemciler için)
- **socket.io-client** (merkeze giden kalıcı bağlantı)
- Ses işleme: in-process buffer manipülasyonu + WSOLA time-stretch (TypeScript, §7.1.1)
- **FLAC decoder** (saf JS veya WASM, örn. `libflac.js`) — yalnızca senkron yolunda
- Yerel depolama: dosya sistemi (PCM klipler) + küçük SQLite/JSON manifest
- **Google SDK YOK** — Google erişimi tek noktada, merkezde

### `tts-merkez` (dış sunucu, ×1)

- **Node.js + TypeScript**
- **socket.io** (server), room bazlı hedefleme
- **PostgreSQL** (klip kayıt defteri, manifest, telemetri) — **raw SQL, ORM yok**
- **Google Cloud TTS SDK** (tek ses motoru, tek erişim noktası)
- HTTPS statik sunum (imzalı URL ile toplu banka indirmesi)
- **FLAC encoder** (dağıtım kopyaları için — üretim yolunda, hız kritik değil)
- Nesne depolama veya disk (klip arşivi, profil başına)

### Ortak

- **Runtime'da harici process yok** — ffmpeg subprocess çağrısı yasak (§7.1)

---

## Özet Karar Tablosu

| Konu | Karar |
|---|---|
| Proje sınırı | İki bağımsız servis: `ses-bankasi` (hastane ×22) + `tts-merkez` (dış ×1) |
| Ekranlar / HBYS | Yalnızca `ses-bankasi`'nın istemcisi |
| Merkez haberleşme | **Socket.IO** — bağlantıyı hastane açar (NAT dostu) |
| İlk banka indirmesi | HTTPS (resumable), Socket.IO değil |
| Hat formatı | FLAC (kayıpsız); diskte PCM olarak saklanır |
| Google erişimi | Yalnızca `tts-merkez` — hastanede Google SDK yok |
| GPU | Gerekmiyor |
| Runtime TTS | Yok — sadece banka birleştirme |
| TTS motoru | Google Cloud TTS; motor ve ses **yapılandırmadan** gelir, arayüz arkasında (§6.6) |
| **Üretim yöntemi** | **Taşıyıcı cümleden kesme** — SSML `<mark>` + `v1beta1`. Yalıtılmış sentez dinleme testinden geçmedi (§7.5) |
| **Birleştirme** | **0 ms boşluk, 45 ms crossfade**, sıfır geçiş hizalama. Es koymak sesi bozuyor (§7.6) |
| Tiyer | Standard veya WaveNet. **Chirp 3 HD kullanılamaz** — SSML işaretlerine damga dönmüyor |
| Örnekleme hızı | **24.000 Hz** — 40 tr-TR sesinin tamamı aynı |
| Kota politikası | **İlk 3 ay $10 tavan, sonrası $0 hedefi.** Tiyer bazlı sayaç, %90'da sert durdurma |
| TTS maliyeti | **Standard'da $0**, WaveNet'te toplam ~$8 (§6.3) |
| Çoklu Google hesabı | **Yapılmayacak** — farklı kişilerin hesaplarını toplamak dahil (§6.5) |
| Ad + soyad | **Ayrı klip** — birleşik model ölçümle reddedildi (%33,8 tek seferlik, §7.2.1) |
| Sayılar | **1–1500 bütün klip** — bileşen birleştirme kaldırıldı (ölçülen `SIRA_NO` en fazla 1.214) |
| Hedef ifadesi | **Kuyrukla birlikte tek klip** ("Yeşil Alan 4'e geçiniz") — 229 adet, Türkçe ek sorununu çözer |
| Banka boyutu | 1. yıl ~247.000 klip / **13,6 GB** (β=0,69, doymuyor) |
| **Budama** | 12 aydır çalınmayan klip silinir → banka **13,6 GB'da sabitlenir** (§7.3) |
| Diriliş gecikmesi | ~60–150 ms (merkez zaten üretmiş, Google'a gidilmez) |
| Banka RAM'de mi | **Hayır** — diskten okunur, işletim sistemi sayfa önbelleği yeter (§10) |
| Admin arayüzü | Merkezde: kelime DB, toplu ekleme, kota paneli, fallback günlüğü, profil yönetimi |
| Dil | `tr-TR` sabit, otomatik dil tespiti yok |
| Hız / tonlama / ses seviyesi | **Runtime'da**, istek başına serbest. Varsayılan `rate` 1.0 |
| Erkek/kadın ses | **Banka varyantı** — tek profille başla, ikincisi sonradan |
| Eksik token | Hastane → merkez → (yoksa) Google → 22 hastaneye push |
| Hata davranışı | Degrade yanıt — servis her zaman ses döner |
| Idempotency | `callId`, 60 sn pencere — çağrı başına 1,43 ekran olduğu için yükün %30'unu eler |
| Donanım (hastane) | **4 GB RAM**, 1–2 vCPU, 50 GB disk |
| Donanım (merkez) | 4 GB RAM, 2 vCPU, 250 GB disk veya nesne depolama |
| **Ölçülmüş tepe yük** | **0,87 çağrı/sn ortalama, 9 istek/sn salvo** → CPU %0,2 |
| Ekran doluluğu | En yoğun ekran %31,6; gün boyu 3 çakışma |
| Cluster | Gereksiz |
| Kuyruk mantığı | Servisin işi değil — istemcide kalır |
| Ses formatı | 24 kHz mono 16-bit PCM |
| Kaynak sistem | **SQL Server** — Faz 0 sorguları T-SQL olarak yeniden yazıldı |

---

## Ölçüm Kaynakları

Bu dokümandaki "ölçülen" ibareli her rakamın kaynağı:

| Kaynak | Kapsam | Neyi belirledi |
|---|---|---|
| `CAGRI` çağrı logu, 2026-08-15 → 08-18 | 22.905 tekil çağrı, 50.396 token | §3 yük, §7.2 büyüme (β=0,69), §7.2.1 tam ad, §7.5.1 normalizasyon, `SIRA_NO` aralığı, 229 hedef ifadesi |
| `listVoices({ languageCode: 'tr-TR' })` | 40 ses | §6.6 tiyer, örnekleme hızı |
| SSML `<mark>` sınaması | 4 ses, 2 API sürümü | §6.6 Chirp elenmesi, §7.5 `v1beta1` zorunluluğu |
| `prototip/` dinleme testleri | 48 klip + 4 taşıyıcı cümle | §7.5 üretim yöntemi, §7.6 birleştirme ayarları |
| `prototip/kendini-test.js` | 38 birim test | DSP zinciri doğrulaması |

> ⚠️ **En zayıf halka:** §7.2'deki büyüme eğrisi tek günlük logdan uzatıldı. Yön güvenilir,
> kesin sayı değil. `FAZ0-TEK-SORGU.sql` 90 günlük veride koşturulunca §6.3, §7.2 ve §10'daki
> disk/maliyet tabloları gerçek rakamlarla değiştirilmeli.

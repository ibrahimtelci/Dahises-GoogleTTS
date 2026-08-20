# Otonom Uygulama Görevi — Hastane Seslendirme Sistemi

> ## ⚠️ BU PROMPT ŞU AN KULLANILMIYOR
>
> Proje aşamalara bölündü. **Şu anki tur için [AGENT-MERKEZ.md](AGENT-MERKEZ.md) kullanılır** —
> yalnız `tts-merkez` çekirdeği ve yönetim arayüzü.
>
> Bu dosya, hastane tarafı (`ses-bankasi`), Socket.IO dağıtım kanalı, budama ve HBYS
> entegrasyonu yazılırken kullanılacak. O tura kadar referans olarak durur.

Bu görev **üç rol** ile yürütülecek. Rolleri sen (baş ajan) üstleniyorsun; her rol için ayrı
bir bağlam ve sorumluluk seti var. Rolleri karıştırma, ama aralarındaki iletişimi sen yönet.

**Referans doküman:** `SESLENDIRME-SERVISI.md` — mimari, API sözleşmesi, kararlar ve
gerekçeler orada. Kod yazmadan önce **tamamını oku**. Doküman ile bu prompt çelişirse
bu prompt kazanır ve çelişkiyi nihai rapora yaz.

---

## Çalışma Modu: Otonom

**Proje sahibi bilgisayar başında değil. Soru sorma. Karar ver, gerekçelendir, ilerle.**

- Belirsizlik geldiğinde durma. En savunulabilir kararı ver, `KARARLAR.md`'ye yaz, devam et.
- "Bunu nasıl isterdiniz?" diye sorma. Sen seç.
- Onay bekleme. İş bitene kadar çalış.
- Bloke olduğunu düşündüğün her noktada, bloke olmayan bir varsayımla ilerlemenin bir yolu
  vardır — onu bul. Gerçekten yolu yoksa o parçayı `stub` bırak, `TODO-BLOKE.md`'ye yaz,
  diğer parçalara geç.

**İstisna — sadece şu dört durumda dur ve sor:**
1. Bir işlem gerçek para harcayacaksa (Google kotası aşımı, ücretli kaynak açma)
2. Üretim verisi silinecek veya geri döndürülemez bir dış işlem yapılacaksa
3. Kimlik bilgisi / kredensiyal gerekiyorsa ve elinde yoksa (bunları `.env.example` ile
   stub'la ve devam et — durma)
4. **Toplu banka üretimi çalıştırılacaksa.** Google'a giden her çağrı aylık kotadan yer;
   ilk ay üretimi ~2,3M karakter = Standard kotasının %58'i (§6.3) ve **geri alınamaz**.
   Geliştirme boyunca Google'a giden toplam çağrı **50 klibi geçmeyecek**; toplu üretici
   kodu yazılır ve testlerde sahte adaptörle koşturulur, gerçek çalıştırma proje sahibinin
   onayına bırakılır.

Bunun dışında **her karar senindir**.

---

## Roller

### 🧭 Rol 1 — Baş Mühendis (orkestratör)

**Yetki:** Tam. Mimari kararlar, arayüz sözleşmeleri, kod standardı, iş sırası, kalite kapısı.

**Sorumluluklar:**
- İki servisin **arasındaki sözleşmeyi** önce sen yaz ve dondur (`packages/protokol/`).
  Uygulayıcılar bu sözleşmeye göre paralel çalışır.
- Her uygulayıcının çıktısını **incele**. Sözleşmeye uymayan, dokümandaki bir kararı ihlal
  eden veya §"Yasaklar" listesine giren kodu reddet ve düzelttir.
- Servisler arası her değişiklikte **iki tarafı da güncelle**. Tek taraflı sözleşme değişimi
  yasak.
- Entegrasyon testlerini sen yaz — iki servisi birlikte koşturan testler senin işin.
- `KARARLAR.md` dosyasını sen tut.

**İlk işin:** Dokümanı oku, monorepo iskeletini kur, protokol paketini yaz, sonra iki
uygulayıcıyı başlat.

---

### 🔵 Rol 2 — Uygulayıcı A: `tts-merkez` (dış sunucu)

**Kapsam:** `packages/tts-merkez/`

- Google Cloud TTS entegrasyonu (**tek erişim noktası — hastanede Google SDK olmayacak**)
- PostgreSQL token kayıt defteri, single-flight üretim kilidi
- Kota takibi ve **sert durdurma** (dokümandaki 3 katman)
- Socket.IO **server** — room bazlı push, ack'li istek/yanıt
- Banka üretici (toplu + incremental)
- Manifest / `bankVersion` yönetimi, imzalı HTTPS indirme URL'leri
- Admin arayüzü: kelime veritabanı, toplu ekleme + önizleme, kota paneli, fallback günlüğü,
  dağıtım durumu, profil yönetimi

**Bilmediğin şey:** Hastane tarafının iç yapısı. Sadece protokol paketini bilirsin.

---

### 🟢 Rol 3 — Uygulayıcı B: `ses-bankasi` (hastane, ×22)

**Kapsam:** `packages/ses-bankasi/`

- HTTP + WebSocket API: `/v1/speak`, `/v1/voices`, `/v1/templates`, `/v1/health`
- Banka **dizin** yükleyici (kelime → dosya yolu + hash). Ses verisi RAM'e ALINMAZ; klip
  istek anında diskten okunur (§10)
- Budama: 12 aylık pencere, ses silinir dizin kaydı korunur (§7.3)
- PCM birleştirme: sessizlik + crossfade + sıfır geçiş hizalama
- WSOLA time-stretch (`rate`), pitch shift, gain
- Format çıkışı: `wav` | `pcm` | `opus`
- Socket.IO **client** — merkeze bağlan, eksik token iste (`socket.timeout`), push'ları işle
- Degrade yanıt mantığı
- `callId` idempotency (60 sn pencere)

**Bilmediğin şey:** Google TTS. Bu servis Google'ı hiç tanımaz. Eksik token gelince
merkeze sorar, o kadar.

---

## Kritik Kısıtlar — İhlal Edilemez

Bunlar müzakere edilebilir değil. Kod bunlardan birini ihlal ediyorsa Baş Mühendis reddeder.

1. **Runtime'da TTS yok.** Çalışma anında sentez yapılmaz. Sadece banka kliplerinin
   birleştirilmesi.
2. **Üretim TAŞIYICI CÜMLEDEN KESME ile yapılır.** Klip tek başına sentezlenmez — tam cümle
   içinde üretilip SSML `<mark>` zaman damgalarıyla kesilir (§7.5). Bu prototipte ölçülmüş
   bir karardır: yalıtılmış sentez dinleme testinden geçmedi. `v1beta1` uç noktası zorunlu;
   Chirp 3 HD sesleri kullanılamaz.
3. **Runtime'da harici process yok.** `ffmpeg`, `sox` vb. subprocess çağrısı yasak. Tüm ses
   işleme in-process buffer manipülasyonu. *(Bu kural subprocess'e karşıdır, bağımlılığa
   karşı değil — in-process WASM/native modül serbesttir. Bkz. §7.1.1.)*
4. **Hastanede Google SDK yok.** `@google-cloud/*` bağımlılığı `ses-bankasi`'nda
   bulunmayacak.
5. **Hasta verisi hastaneden çıkmaz.** Merkeze giden: tek kelimelik bağlamsız token istekleri
   ve sayısal telemetri. Tam anons metni, hasta kaydı, `callId` ile ilişkilendirilmiş veri
   asla gitmez.
6. **Kota sayacı TİYER BAZLI ve sert.** Standard 4M, WaveNet 1M — ayrı havuzlar, tek
   sayaçla izlenemez. Her tiyerde kotanın %90'ında durdurulur (Standard 3,6M / WaveNet 900K).
   Atomik SQL ile, çağrıdan önce. Bütçe tavanı: ilk 3 ay $10, sonrası $0 hedefi.
7. **Tek Google hesabı.** Çoklu hesap/proje rotasyonu GCP ToS ihlalidir — **farklı
   kişilerin hesaplarını toplamak dahil** (§6.5). Kodda yeri yok.
8. **ORM yok.** Raw SQL. Merkez PostgreSQL kullanır; **kaynak HBYS SQL Server'dır** ve
   ondan yalnız okunur (Faz 0 sorguları T-SQL).
9. **Kuyruk mantığı bu projede değil.** TTL, öncelik, çalma sırası, dedup — hepsi istemcinin
   işi. Bu servislere girmeyecek.
10. **Servis her zaman ses döner.** Kısmi başarıda `200 + degraded: true`. Ekran susmamalı.
11. **`socket.timeout()` zorunlu.** Merkeze giden her ack'li istekte. Timeout'suz bekleme yok.
12. **Banka RAM'e yüklenmez.** Diskten okunur; sıcak klipleri işletim sisteminin sayfa
    önbelleği tutar (§10). Ölçülen banka 13,6 GB — belleğe sığmaz, gerek de yok.

---

## Karar Verme Rehberi

Belirsizlikte şu sırayla karar ver:

1. **Dokümanda cevabı var mı?** Varsa uygula.
2. **Kritik kısıtlardan biri yönlendiriyor mu?** Öyleyse ona uy.
3. **İki seçenek arasında kaldıysan** şu önceliklere göre seç:
   - Hastane tarafında **basitlik** > esneklik (22 yerde çalışacak, bakımı zor)
   - **Sessiz kalmamak** > mükemmel ses (degrade her zaman kabul edilebilir)
   - **Az bağımlılık** > hazır kütüphane (hastane paketi küçük kalmalı)
   - **Geri alınabilir** > geri alınamaz (silme yerine işaretle, sabit yerine ayar)
4. Kararı `KARARLAR.md`'ye yaz: ne seçtin, neden, hangi alternatifi eledin, geri almak
   ne kadar maliyetli.

**Faz 0'daki cevapsız sorular için de aynı kural.** HBYS şeması yoksa makul bir şema varsay,
adaptör arkasına al, `KARARLAR.md`'ye yaz. Durma.

**Ama iki soru varsayımla geçilemez — koda sabit gömme, yapılandırmaya al:**

- **Örnekleme hızı** (Faz 0 madde 9, `listVoices`). Banka formatı seçilen sesin doğal hızıyla
  birebir aynı olmak zorunda (§6.6). Yanlış varsayım tüm bankayı geçersiz kılar ve yeniden
  üretim gerektirir. `24000` sayısını hiçbir yere yazma; `BANKA_ORNEKLEME_HIZI` yapılandırmadan
  gelsin, banka manifestinde saklansın, açılışta yüklenen kliplerle uyuşmazsa servis
  `503` ile başlasın.
- **Banka kapasitesi** (Faz 0 madde 7). Ölçülen büyüme β=0,69 ile 1. yılda ~247.000 klip
  (§7.2), ama bu tek günlük logdan uzatılmış bir tahmindir. Kod hiçbir yerde bu sayıya bağlı
  olmasın — dizin, arama ve budama klip sayısından bağımsız çalışsın ve **yüz binlerce klip
  ölçeğinde** test edilsin.

Bu ikisi için `TODO-BLOKE.md`'ye birer madde yaz: gerçek değer gelince nereye yazılacak.

---

## Yapılacaklar (sıra önerisi, bağlayıcı değil)

**Baş Mühendis sırayı değiştirebilir, ama gerekçesini yazar.**

### Aşama 0 — Temel
- Monorepo iskeleti (pnpm workspace), TypeScript strict, lint, test altyapısı
- `packages/protokol/` — paylaşılan tipler, Socket.IO olay sözleşmesi, hata kodları, Zod şemaları,
  **`kapsamHastaneId(tip, hastaneId)` kuralı** (§9B — toplu ve fallback yolu aynı fonksiyonu
  kullanmak zorunda, ayrışması veri kaybına yol açar)
- `docker-compose.yml` — PostgreSQL + iki servis, geliştirme için

### Aşama 1 — Ses çekirdeği  ✅ PROTOTİPTE TAMAMLANDI

**Bu aşamanın araştırma kısmı bitti.** `prototip/` klasöründe çalışan kod ve ölçüm var;
sıfırdan yazma, oradan devral ve TypeScript'e taşı.

Prototipten gelen ve **tartışmaya kapalı** olan kararlar:

| Karar | Değer | Kaynak |
|---|---|---|
| Üretim yöntemi | Taşıyıcı cümleden kesme, SSML `<mark>`, `v1beta1` | §7.5 |
| Kesilen parçaya sessizlik kırpma | **UYGULANMAZ** — sessiz ünsüzleri yer | §7.5 |
| Kuyruk payı | 50 ms, crossfade'de eritilir | §7.5 |
| Birleştirme | **0 ms boşluk, 45 ms crossfade**, sıfır geçiş açık | §7.6 |
| `rate` varsayılanı | **1.0** — kesme yöntemi süreyi zaten referansa getirdi | §7.6 |
| Sayılar | 1–1500 **bütün klip**, bileşen birleştirme yok | §7.4 |
| Hedef ifadesi | Kuyrukla birlikte tek klip | §4.1 |
| Chirp 3 HD | **Kullanılamaz** — SSML işaretine damga dönmüyor | §6.6 |

Yapılacaklar:

- Prototipteki `src/ses.js` ve `src/sablon.js`'i TypeScript'e taşı, testleriyle birlikte
  (`kendini-test.js` 38 test — hepsi geçmeye devam etmeli)
- Kesme mantığını (`kesme.js`) üretim koduna al: taşıyıcı kurma, damga eşleme, dilimleme
- **Es koyulacaksa kuyruk payını önce kırp** — prototipte bu hata bir tur kaybettirdi
  (`kelimenin ilk 35 ms'i → es → kelime baştan` diye kekeleme duyulur)
- WSOLA: ölçülen 0.8x'te ~42 ms, 30 ms kapısını aşıyor. `rate` varsayılan 1.0 olduğu için
  istek yolunda çalışmıyor; **varsayılan kapalı** bırak, istemci açıkça isterse devreye girsin

**Yeni dinleme testi gerekmez** — ses kalitesi sorusu kapandı. Yalnız ses **seçimi** açık
(hangi Standard/WaveNet sesi); o proje sahibinin kararı, `prototip/cikti/ses-secimi/`
dosyalarını dinleyerek verecek. Sen yapılandırmadan okunacak şekilde yaz, sabit gömme.

### Aşama 2 — `tts-merkez` çekirdeği
- Şema + migrasyonlar: `klip` / `klip_kapsam` / `banka_surum` / `kota` tabloları
- Google TTS adaptörü (arayüz arkasında — Polly'ye geçiş mümkün kalsın)
- Sahiplenmeli single-flight + bayat `pending` süpürücü, kota sayacı, sert durdurma
- Normalizasyon katmanı (Türkçe alfabe dışı karakterler, unvan açılımı, sayı→metin)

### Aşama 3 — `ses-bankasi` çekirdeği
- Banka yükleyici, şablon motoru, `/v1/speak`
- Diğer uçlar, idempotency, degrade yolu

### Aşama 4 — Socket.IO kanalı
- Handshake auth, room'lar, `token:request` ack akışı, timeout, `token:push`
- `manifest:sync` mutabakatı, yeniden bağlanma
- HTTPS toplu indirme (resumable)

### Aşama 5 — Admin arayüzü
- Dokümandaki §9F'deki tüm ekranlar

### Aşama 6 — Entegrasyon ve doğrulama
- İki servisi birlikte koşturan uçtan uca testler
- **Yük testi:** 10 istek/sn (gerçek tepenin ~7 katı), p99 ölç
- **Kaos testi:** merkez kapalıyken, kota doluyken, banka eksikken davranış
- `README` + kurulum + `systemd` unit + `.env.example`

---

## Kalite Kapısı

Aşama bitmiş sayılmaz, şunlar olmadan:

- [ ] TypeScript strict, `any` yok (kaçınılmazsa gerekçeli `// @ts-expect-error`)
- [ ] Birim testler geçiyor, kritik yollarda kapsam var
- [ ] Hata yolları test edilmiş (mutlu yol yetmez)
- [ ] Kritik kısıtların hiçbiri ihlal edilmemiş
- [ ] Yapılandırma `.env` ile, kodda sabit yok
- [ ] Loglar yapılandırılmış (JSON), hasta verisi loglanmıyor
- [ ] `KARARLAR.md` güncel

---

## Çıktılar

Kod dışında şu üç dosya:

### `KARARLAR.md`
Verdiğin her önemli karar. Format:

```markdown
## [K-012] Banka manifest formatı JSON yerine SQLite
**Rol:** Uygulayıcı A
**Karar:** Manifest tek dosya SQLite olarak tutulacak.
**Neden:** 45.000 satırda JSON parse açılışta ~800 ms sürüyor; SQLite'ta indeksli sorgu
  ~5 ms. Delta hesabı da SQL ile tek sorgu.
**Elenen alternatif:** JSON + bellek içi Map — basit ama açılış süresi ve delta hesabı zayıf.
**Geri alma maliyeti:** Düşük — manifest arayüzü soyutlandı, 1 dosya değişir.
**Güven:** Yüksek
```

### `TODO-BLOKE.md`
İlerleyemediğin ve stub bıraktığın yerler. Her biri için: ne eksik, neyi varsaydın, gerçek
bilgi gelince nereyi değiştirmek gerekiyor.

### `RAPOR.md` — nihai rapor
İş bitince yaz. Proje sahibi bunu okuyacak. Yapısı:

1. **Ne yapıldı** — çalışan sistemin özeti, nasıl çalıştırılır
2. **Doğrulananlar** — hangi testler koştu, yük testi sonuçları, p99 rakamları
3. **Verdiğim kritik kararlar** — `KARARLAR.md`'den en önemli 5-10 tanesi, kısa gerekçeyle
4. **Senin görüşünü istediğim konular** — burası **en önemli bölüm**. Her madde şu formatta:

```markdown
### Şablon metinleri hastane bazlı özelleştirilebilir olmalı mı?

**Ne yaptım:** Tek global şablon seti kurdum, hastane bazlı override yok.
**Neden:** Mevcut sistemde hastaneye özel anons kalıbı olduğuna dair bir kanıt görmedim,
  ve global set kodu belirgin şekilde basitleştiriyor.
**Riski:** Bir hastane farklı kalıp isterse şablon motoruna hastane boyutu eklemek gerekir
  (~yarım gün iş, geriye dönük uyumlu).
**Sana sorum:** 22 hastanenin anons kalıpları gerçekten aynı mı? Farklıysa bunu şimdi
  eklemek sonra eklemekten ucuz.
**Benim önerim:** Şimdilik böyle bıraksak, pilot hastanede doğrulasak.
```

5. **Bilinen eksikler** — `TODO-BLOKE.md` özeti
6. **Sonraki adımlar** — sırasıyla ne yapılmalı

---

## Rapor Tonu

Nihai raporda:
- **Kesin konuş.** "Belki", "sanırım", "olabilir" yerine ne yaptığını ve neden yaptığını yaz.
- **Kendi kararlarını savun ama sabit fikirli olma.** Zayıf gördüğün kendi kararını zayıf
  olarak işaretle.
- **Abartma.** Test edilmemiş bir şeye "çalışıyor" deme. Yük testi koşmadıysan "koşmadım" yaz.
- **Kısa tut.** Rapor 3 sayfayı geçmesin; detay `KARARLAR.md`'de.

---

## Başla

1. `SESLENDIRME-SERVISI.md`'yi baştan sona oku
2. Baş Mühendis rolüyle iskeleti ve protokol paketini kur
3. Aşama 1'den itibaren ilerle
4. **Bitene kadar durma**
5. `RAPOR.md` yazıp bitir

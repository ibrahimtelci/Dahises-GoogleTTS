# Görev — `tts-merkez` Çekirdeği ve Yönetim Arayüzü

Bu görev **yalnız merkez servisini** kapsar. Hastane tarafı (`ses-bankasi`), Socket.IO
dağıtım kanalı ve HBYS entegrasyonu **bu turda yazılmayacak** — sonraki turun konusu.

**Referans doküman:** `docs/SESLENDIRME-SERVISI.md`. Mimari, ölçümler ve gerekçeler orada.
Kod yazmadan önce en az §4, §6, §7, §9A, §9A.2, §9F bölümlerini oku.

> **Öncelik sırası:** Teknik kararlarda **doküman kazanır** — oradaki rakamlar ölçümle
> doğrulanmıştır. Bu prompt yalnızca **kapsam, süreç ve çıktı biçiminde** kazanır. Çelişki
> görürsen dokümanı uygula ve çelişkiyi `KARARLAR.md`'ye yaz.

---

## Amaç

Proje sahibi bu arayüzden şunları yapabilmeli:

1. **Kelime ve metin yükleyip banka oluşturmak** — yapıştırarak veya CSV ile
2. **Şablon (cümle kalıbı) tanımlamak**
3. **Ses profili seçmek ve denemek** — tiyer + alt ses seçip test metnini dinlemek
4. **Kota takip etmek** — tiyer bazlı, sert durdurma ile
5. **Kullanıcı yönetmek** — ilk kurulumda superadmin, sonra kullanıcı ekleme/çıkarma

Sistem çalışır durumda teslim edilmeli: `pnpm dev` ile açılıp tarayıcıdan kullanılabilmeli.

---

## Ortam — hazır, kurma

| Bileşen | Durum |
|---|---|
| Node | v24.11.1 ✓ |
| pnpm | 11.2.2 ✓ |
| PostgreSQL | **18.4 çalışıyor**, `127.0.0.1:5432`, veritabanı `ttsmerkez` ✓ |
| Google TTS anahtarı | `.env` içinde ✓ |
| Docker | **yok** — docker-compose yazma, gerek de yok |

Bağlantı bilgileri proje kökündeki **`.env`** dosyasında. Onu oku, yeniden üretme, içindeki
değerleri koda gömme.

Veritabanı `LOCALE_PROVIDER icu ICU_LOCALE 'tr-TR'` ile oluşturuldu. Türkçe sıralama ve
`lower()` doğrulandı:

```sql
lower('İSTANBUL' COLLATE "tr-TR-x-icu") = 'istanbul'   -- ✓
```

**Kelime kolonlarında `COLLATE "tr-TR-x-icu"` kullan** (§7.5.1 kural 5).

> PostgreSQL'i durdurup başlatma komutları `.env` başındaki yorumda. Sunucu kapanmışsa
> yeniden başlat, yeniden `initdb` yapma.

---

## Kritik Kısıtlar — İhlal Edilemez

1. **Üretim taşıyıcı cümleden kesme ile yapılır** (§7.5). Klip tek başına sentezlenmez.
   `v1beta1` uç noktası + `enableTimePointing: ['SSML_MARK']`. Bu ölçülmüş bir karardır.
2. **Kesilen parçaya sessizlik kırpma UYGULANMAZ**, sonuna 50 ms kuyruk payı bırakılır.
3. **Birleştirme: 0 ms boşluk, 45 ms crossfade**, sıfır geçiş hizalama açık (§7.6).
4. **Chirp 3 HD seçilemez** — SSML işaretine damga döndürmüyor. Arayüzde listelenirse
   "kesme desteklemiyor" diye işaretlenmeli ve seçilemez olmalı (§6.6).
5. **Kota sayacı tiyer bazlı ve sert.** Standard 4M, WaveNet 1M — ayrı havuzlar. Her tiyerde
   kotanın %90'ında Google çağrıları durur. Atomik SQL, çağrıdan **önce** (§6.4).
6. **ORM yok.** Raw SQL. Migrasyonlar numaralı `.sql` dosyaları.
7. **Runtime'da harici process yok** — `ffmpeg`/`sox` subprocess yasak. Ses işleme
   in-process. (WASM/native modül serbest, subprocess değil.)
8. **Hasta verisi loglanmaz.** Loglar yapılandırılmış (JSON), isim içermez.
9. **Yapılandırma `.env`'den**, kodda sabit yok. Özellikle `24000` sayısını hiçbir yere gömme.
10. **XML kaçışı tek noktada zorunlu.** Kelime doğrudan SSML'e giriyor; `&`, `<`, `>`, `"`, `'`
    kaçırılmazsa istek bozulur veya işaret yapısı sabote olur — tüm kesme mantığı işaretlere
    bağlı. Kaçış taşıyıcı kurucusunun **içinde** olsun, çağıranın hatırlamasına bırakma.
    Test girdileri: `O'Brien`, `Smith & Sons`, `<test>`, `"tırnak"` (§7.5 kural 7).
11. **Klip yazımı atomik.** Geçici dosya → `fsync` → `rename` → sonra DB `ready`. Ters sırada
    çökme, veritabanında var olmayan dosyaya işaret bırakır (§7.5 kural 8).
12. **Redis yok.** Kuyruk `klip` tablosunda, `FOR UPDATE SKIP LOCKED` ile. Gerekçe §10'da —
    okumadan "kuyruk için Redis lazım" deme.

### Google çağrıları — sert bütçe

**Geliştirme boyunca Google'a giden toplam çağrı 50 klibi geçmeyecek.**

- Kod yaz, testlerde **sahte adaptör** kullan
- Gerçek çağrı yalnız: ses denemesi ekranını doğrularken (birkaç cümle) ve tek bir küçük
  toplu üretim denemesinde (≤30 klip)
- Toplu üretimi **tam listeyle çalıştırma** — proje sahibinin onayına bırak
- Adaptörde bir sayaç tut, aşılırsa istek gönderme (prototipteki `src/google.js` gibi)

---

## Prototipten devral — sıfırdan yazma

`prototip/` klasöründe çalışan ve ölçülmüş kod var. TypeScript'e taşı:

| Dosya | Ne var |
|---|---|
| `prototip/src/ses.js` | PCM işleme: WAV, kırpma, normalize, birleştirme, crossfade, WSOLA, perde |
| `prototip/src/sablon.js` | Normalizasyon (§7.5.1), sayı→metin, şablon parçalama |
| `prototip/src/google.js` | REST istemcisi, API key + service account, karakter tavanı |
| `prototip/kesme.js` | **Taşıyıcı cümle kurma, damga eşleme, dilimleme** — çekirdek mantık |
| `prototip/kendini-test.js` | 38 test — hepsi taşındıktan sonra da geçmeli |

**Bilinen tuzak:** kuyruk payı bir sonraki kelimenin başlangıcını içerir. Araya es koyulacaksa
pay **önce kırpılmalı**, yoksa "kelimenin ilk 35 ms'i → es → kelime baştan" diye kekeleme
duyulur. Prototipte bu hata bir tur kaybettirdi.

---

## Teknoloji Yığını — karar verildi

Bunlar tartışılmış kararlardır; değiştireceksen `KARARLAR.md`'ye gerekçe yaz.

| Katman | Seçim | Neden |
|---|---|---|
| HTTP | **Fastify** | TS tipleri gerçek, şema doğrulama yerleşik, plugin modeli temiz |
| DB sürücüsü | **postgres.js** (`postgres`) | Tagged template ile enjeksiyon varsayılan kapalı. Ham SQL — "ORM yok" kuralını bozmaz |
| Migrasyon | **Kütüphane yok** | Numaralı `.sql` + kısa koşucu, uygulananlar tabloda |
| Doğrulama | **Zod** (`fastify-type-provider-zod`) | Route şemaları ve domain doğrulaması |
| Parola | **@node-rs/argon2** | Hazır Windows binary'si var; saf `argon2` derleme derdi çıkarır |
| Oturum | `@fastify/cookie` + `@fastify/session`, store PostgreSQL | Redis'e gerek yok |
| Log | **pino** | JSON. **Redaction listesi zorunlu** — hasta adı asla loglanmaz |
| Test | **node:test** (yerleşik) | Bağımlılık azaltma önceliğiyle uyumlu |
| Arayüz | **Fastify + Eta şablon + HTMX** | Panel özünde tablo/form/buton; 250 bin satır zaten sunucu tarafı sayfalama istiyor. Build zinciri yok, tek deployable |
| Ses çalma | Düz `<audio>`, WAV | PCM'e 44 baytlık başlık ekle, tarayıcı çalar |

**Klip depolama — içerik adresli, parçalı dizin:**

```
veri/banka/<profil>/<hash[0:2]>/<hash[2:4]>/<hash>.pcm
```

`hash` = PCM baytlarının sha256'sı. Tek dizinde yüz binlerce dosya dosya sistemini boğar;
parçalama bunu çözer, aynı içerik iki kez saklanmaz, yol kolonu tutmaya gerek kalmaz.
(Hastaneye dağıtım için paketli tek blob üretmek **sonraki turun** işi, şimdi yapma.)

---

## Yapılacaklar

### Aşama 1 — Temel ve şema

- pnpm workspace, TypeScript strict, lint, test altyapısı (vitest veya node:test)
- `migrasyonlar/001_*.sql` … : `klip`, `klip_kapsam`, `banka_surum`, `kota`, `sablon`,
  `ses_profili`, `kullanici`, `denetim_gunlugu`, `engellenen`
  - Şema §9A'da. `hastane_id` kolonu **kalsın** (ileride lazım), şimdilik hep `0`
  - `pg_trgm` eklentisi + §9A'daki indekslerin hepsi. 250 bin satırlık tabloyu filtresiz
    sorgulayan tek bir ekran bile olmayacak — **sunucu tarafı sayfalama zorunlu**
  - `klip.telaffuz` ve `klip.sonraki_deneme` kolonlarını atlama; ikisi de §9A'da gerekçeli
- Migrasyon koşturucu: sırayla uygula, uygulananları tabloda tut
- `.env`'den yapılandırma okuma + doğrulama (eksikse anlaşılır hata)

### Aşama 2 — Ses çekirdeği (prototipten port)

- PCM işleme, birleştirme, normalizasyon, sayı→metin
- Taşıyıcı cümle kurma + SSML mark + dilimleme
- Google adaptörü **arayüz arkasında** (`SesMotoru` arayüzü — Polly'ye geçiş mümkün kalsın)
- Sahte adaptör (testler için, sinüs üretir)
- Testler: prototipteki 38 test + kesme mantığı için yenileri

### Aşama 3 — Üretim hattı

- Kuyruk: `pending` → `uretiliyor` → `ready` / `failed` / `engellendi` / `kota_bekliyor`
- Sahiplenmeli single-flight + bayat `pending` süpürücü (§9B)
- Tiyer bazlı kota sayacı, %70/%85/%90 eşikleri (§6.4)
- Parti halinde `banka_surum` artışı (§A.2) — **`nextval()` KULLANMA**, gerekçesi §A.2'de
- **Google hız sınırı:** eşzamanlılık 5–10, token bucket; 429/5xx'te üstel geri çekilme
  ve `sonraki_deneme` ileri atma (1 dk → 5 dk → 30 dk)
- Klipleri içerik adresli yaz (yukarıdaki düzen), atomik: temp → fsync → rename → DB

### Aşama 4 — Web arayüzü

Türkçe. Ekranlar:

**a) Kelime veritabanı** — filtrelenebilir tablo (durum, tip, profil, kaynak, tarih).
Varsayılan görünüm: çevrilmemişler önce. Satır işlemleri: dinle, yeniden üret, engelle.

**b) Toplu ekleme** — metin kutusuna yapıştırma + CSV yükleme. **Onay öncesi önizleme:**
kaç yeni, kaç zaten var, normalizasyon sonrası hâli ne olacak, kaç karakter tüketecek,
kota sonrası ne kalacak. "Wagner" yazan kullanıcı bankaya "vagner" gireceğini onaydan önce
görmeli.

**c) Şablonlar** — cümle kalıbı tanımlama (`sayın {adSoyad} lütfen {hedef}`), değişken
listesi, taşıyıcı cümlede hangi öğenin hangi yuvada olduğu.

**d) Ses profilleri ve DENEME** — bu ekran özellikle istendi, ayrıntı aşağıda.

**e) Kota paneli** — tiyer bazlı çubuk, kalan karakter, sıfırlanma tarihi, eşik bantları.
Kota dolduğunda üretim butonları kilitlenir ve **neden kilitli olduğu yazar**.

**f) Kullanıcı yönetimi** — liste, ekleme, parola sıfırlama, pasifleştirme, rol.

**g) Fallback/üretim günlüğü** — ne zaman ne üretildi, hatalar, engellenenler.

### Aşama 5 — Kullanıcılar ve güvenlik

- İlk açılışta kullanıcı yoksa **superadmin oluştur**, parolayı üret ve **konsola bir kez
  bas** + `ILK-KURULUM.md` dosyasına yaz. Sabit varsayılan parola **kullanma**.
- Parola: argon2id. Oturum: httpOnly + sameSite çerez.
- Roller: `superadmin` (her şey + kullanıcı yönetimi), `operator` (üretim + kelime yönetimi),
  `izleyici` (yalnız okuma).
- **Denetim günlüğü**: kim, ne zaman, ne üretti/sildi/engelledi/ayar değiştirdi.
- TOTP ve IP kısıtı **bu turda yok** ama şema ve arayüz yeri hazır olsun (§9F'de sunucuya
  çıkmadan önce gerekli deniyor). `TODO-BLOKE.md`'ye yaz.

### Aşama 6 — İşletme

- **Yedekleme:** günlük `pg_dump` + banka dizini için basit bir arşiv betiği. Ses yeniden
  üretilebilir ama **kelime listesi ve hangi klibin var olduğu** yeri doldurulamaz.
- **`/saglik` ucu:** veritabanı erişimi, banka dizini yazılabilirliği, kota durumu,
  üretim kuyruğu sayıları (`GROUP BY durum`).
- **Altın dosya testleri:** sabit girdi → bayt-birebir çıktı. Ses birleştirme kodu
  değiştiğinde çıktının sessizce değişmediğini bu yakalar.
- Log rotasyonu, `.env.example`, `README`.

---

## Ses Denemesi Ekranı — ayrıntı

Bu ekran proje sahibinin ses seçimini yapacağı yer. Prototipteki A/B karşılaştırmasının
kalıcı hâli.

**Girdiler:**
- Tiyer seçimi: Standard | WaveNet *(Chirp 3 HD listelenir ama seçilemez, sebebi yazar)*
- Alt ses seçimi: o tiyerdeki sesler, `listVoices` ile **canlı çekilir**, elle yazılmaz.
  Cinsiyet ve örnekleme hızı gösterilir.
- Test metni: serbest metin **veya** kayıtlı bir şablon + örnek değerler

**Çıktı — iki ses, yan yana, ayrı ayrı çalınabilir:**

| | Nasıl üretilir |
|---|---|
| **Gerçek** | Cümlenin tamamı tek seferde sentezlenir |
| **Birleştirilmiş** | Parçalar taşıyıcı cümleden kesilir, sonra birleştirilir (§7.5, §7.6) |

**Dürüstlük kuralı — atlanmayacak:** parçalar tek bir taşıyıcıdan kesilip aynı cümle yeniden
kurulursa sonuç yapay olarak kusursuz çıkar ve hiçbir şey kanıtlamaz. Birleştirilmiş sürüm
**çapraz** kurulmalı: her parça **farklı** bir taşıyıcı cümleden gelmeli. Bankada zaten varsa
bankadaki klip kullanılır; yoksa parça için ayrı bir taşıyıcı üretilir.

Ekranda ayrıca gösterilmeli: her iki sürümün süresi, harcanan karakter, hangi parçanın
hangi kaynaktan geldiği (bankadan mı, yeni taşıyıcıdan mı).

**Maliyet uyarısı:** bu ekran Google'a gerçek istek atar. Her denemenin karakter maliyeti
onay öncesi gösterilmeli ve kota sayacına işlenmelidir.

---

## Kalite Kapısı

Aşama bitmiş sayılmaz, şunlar olmadan:

- [ ] TypeScript strict, `any` yok (kaçınılmazsa gerekçeli)
- [ ] Testler geçiyor; prototipin 38 testi dahil
- [ ] Hata yolları test edilmiş (kota dolu, Google hatası, geçersiz SSML, bayat pending)
- [ ] Kritik kısıtların hiçbiri ihlal edilmemiş
- [ ] Migrasyonlar temiz veritabanında baştan koşuyor
- [ ] `pnpm dev` ile açılıyor, tarayıcıdan giriş yapılabiliyor
- [ ] Google çağrı sayacı 50'yi geçmemiş

---

## Çalışma Modu

**Proje sahibi bilgisayar başında değil. Soru sorup bekleme — karar ver, yaz, devam et.**

Karar gerektiren noktalarda:

1. Dokümanda cevabı varsa uygula
2. Yoksa **en savunulabilir seçeneği uygula ve devam et** — geri alınabilir şekilde
   (arayüz arkasında, yapılandırmadan)
3. `KARARLAR-BEKLEYEN.md`'ye numaralı seçeneklerle yaz (format aşağıda)
4. Durma

**Yalnız şu üç durumda dur:**
1. 50 klip Google bütçesi aşılacaksa
2. Geri döndürülemez bir dış işlem gerekiyorsa (veri silme, ücretli kaynak açma)
3. `.env`'de olmayan bir kimlik bilgisi gerekiyorsa — `.env.example`'a stub'la ve devam et

### `KARARLAR-BEKLEYEN.md` formatı

```markdown
## [B-003] Admin arayüzü teknoloji seçimi
**Aşama:** 4 · **Geri alma maliyeti:** Orta (~1 gün)
**Ne yaptım:** (A) ile devam ettim.

- [ ] A — React + Vite  ← ÖNERİM: bileşen ekosistemi geniş, tablo/filtre bileşenleri hazır
- [ ] B — Sunucu tarafı render (HTMX): bağımlılık az, SPA yükü yok, ama tablo etkileşimi zayıf
- [ ] C — Sonra karar ver, şimdilik yalnız JSON API'yi bitir
```

Proje sahibi kutuları işaretleyecek, sonraki koşuda uygulanacak.

---

## Çıktılar

Kod dışında:

- **`ILK-KURULUM.md`** — superadmin parolası, nasıl açılır, PostgreSQL nasıl başlatılır
- **`KARARLAR.md`** — verdiğin kararlar: ne, neden, hangi alternatif elendi, geri alma maliyeti
- **`KARARLAR-BEKLEYEN.md`** — proje sahibinin işaretlemesi gereken seçenekler
- **`TODO-BLOKE.md`** — stub bıraktığın yerler, ne eksik, gerçek bilgi gelince nereyi değiştir
- **`RAPOR.md`** — 3 sayfayı geçmesin:
  1. Ne yapıldı, nasıl çalıştırılır
  2. **Doğrulananlar** — hangi testler koştu, ne ölçüldü. Koşmadıysan "koşmadım" yaz
  3. En önemli 5-10 karar
  4. Proje sahibinin görüşünü istediğin konular
  5. Bilinen eksikler
  6. Sonraki adım önerisi

**Rapor tonu:** Kesin konuş. Test edilmemiş bir şeye "çalışıyor" deme. Yük testi koşmadıysan
koşmadığını yaz. Zayıf gördüğün kendi kararını zayıf işaretle.

---

## Başla

1. `docs/SESLENDIRME-SERVISI.md` §4, §6, §7, §9A, §9A.2, §9F oku
2. `prototip/` klasörünü incele — özellikle `kesme.js`
3. `.env`'i oku, PostgreSQL bağlantısını doğrula
4. Aşama 1'den başla, bitene kadar dur
5. `RAPOR.md` yazıp bitir

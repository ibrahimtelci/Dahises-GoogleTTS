# Bloke ve eksik bırakılanlar

Stub bıraktığım yerler, ne eksik, gerçek bilgi gelince nereyi değiştirmeli.

---

## Sunucuya çıkmadan önce ZORUNLU

Arayüz dışarıya açık bir sunucuda çalışacak (§9F). Aşağıdakiler olmadan açılmamalı.

### 1. TOTP (iki aşamalı doğrulama) — şema hazır, kod yok

- **Nerede:** `kullanici.totp_sirri`, `kullanici.totp_aktif` kolonları var, hep `NULL`/`false`.
  Kullanıcı ekranında "kapalı (bu turda yok)" yazıyor.
- **Ne gerekiyor:** TOTP üretimi/doğrulaması (`otpauth` gibi bir paket veya
  `node:crypto` ile HMAC-SHA1 tabanlı ~60 satır), giriş akışına ikinci adım,
  QR kodu gösterimi, yedek kod üretimi.
- **Değişecek dosyalar:** `src/web/kimlik.ts`, `src/web/rotalar/kimlik.ts`,
  `src/web/gorunum/giris.eta`, yeni bir `gorunum/totp.eta`.

### 2. IP kısıtlaması — şema hazır, kod yok

- **Nerede:** `kullanici.ip_kisiti text[]` kolonu var, hep `NULL`.
- **Ne gerekiyor:** CIDR eşleştirme, `preHandler` kancasında kontrol. Ters vekil
  arkasındaysa `trustProxy` açılmalı (`src/web/sunucu.ts` içinde şu an `false`).
- **Dikkat:** `trustProxy` yanlış açılırsa istemci IP'si taklit edilebilir; yalnız
  bilinen vekil adresleri güvenilir sayılmalı.

### 3. CSRF jetonu

- **Şu anki durum:** Koruma yalnız `sameSite: 'strict'` çerezine dayanıyor. Bu modern
  tarayıcılarda pratikte etkili ama **tek katman**.
- **Ne gerekiyor:** `@fastify/csrf-protection` veya form başına gizli jeton.
- **Değişecek dosyalar:** `src/web/sunucu.ts` (eklenti), bütün `gorunum/*.eta`
  formlarına gizli alan, HTMX istekleri için `hx-headers`.
- **Karar kaydı:** `KARARLAR.md` [K-11], zayıf işaretlendi.

### 4. HTTPS ve `secure` çerez

- `ORTAM=uretim` yapıldığında çerez `secure: true` oluyor — yani **HTTPS olmadan giriş
  çalışmaz**. Ters vekil (nginx/Caddy) veya Fastify'a sertifika gerekli.

---

## Yapılmayan işletme parçaları

### 5. Log rotasyonu — YAPILMADI

- **Şu anki durum:** pino stdout'a yazıyor. Dosyaya yazma ve döndürme yok.
- **Neden:** Windows'ta rotasyon süreç dışı bir iştir; yarım bir çözüm (uygulama içi
  boyut kontrolü) yeniden başlatmalarda dosya kilidi sorunları çıkarır.
- **Öneri:** Servis olarak NSSM ile kurup stdout'u yönlendirmek ve NSSM'in kendi
  rotasyonunu kullanmak; veya `pino-roll` transport eklemek.
- **Değişecek dosya:** `src/gunluk.ts` (transport tanımı), `.env` (`LOG_DOSYASI`).

### 6. E-posta uyarısı — YAPILMADI

- §6.4 kota eşiklerinde (%70 sarı, %85 kırmızı) e-posta istiyor. Arayüzde bantlar var,
  e-posta yok. SMTP bilgisi `.env`'de yok — kimlik bilgisi gerektirdiği için stub bile
  bırakılmadı.
- **Gerekli:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_KULLANICI`, `SMTP_PAROLA`, `UYARI_EPOSTA`.
- **Değişecek yer:** `src/uretim/arka-plan.ts` içinde eşik kontrolü + yeni `src/uyari.ts`.

### 7. Google Cloud tarafı korumalar (Katman 2 ve 3) — YAPILMADI

Uygulama içi sayaç (Katman 1) çalışıyor ve test edildi. Konsol tarafındakiler **elle**
kurulmalı, kodla kurulamaz:

- **Katman 2:** Konsolda APIs & Services → Text-to-Speech API → Quotas altından
  dakikalık/günlük karakter kotası tanımlanmalı.
- **Katman 3:** Budget → Pub/Sub → Cloud Function → `projects.updateBillingInfo`.
  Önerilen: $1 uyarı, $5 otomatik kapatma. Bütçe alarmları tek başına harcamayı
  **durdurmaz**, sadece haber verir (§6.4).

---

## Kapsam dışı bırakılanlar (sonraki tur)

Bunlar eksik değil, **bu turun kapsamı değil** — ama şema ve arayüz yeri hazır:

### 8. `hastane_id` her yerde `0`

- `klip_kapsam.hastane_id` kolonu var ve `kapsamHastaneId(tip, hastaneId)` kuralı
  tek noktada yazılı ve test edilmiş (doktor/poliklinik → hastaneye özel, diğerleri →
  ortak havuz). Ama arayüzde hastane seçimi yalnız toplu ekleme formunda var ve
  varsayılanı `0`.
- **Gerçek bilgi gelince:** hastane listesi bir tabloya alınmalı (`hastane`), toplu
  ekleme ve filtreler oradan beslenmeli.

### 9. Socket.IO dağıtım kanalı yok

- Delta sorgusu (`src/uretim/surum.ts` → `delta()`) yazıldı ve test edildi, ama onu
  çağıran bir kanal yok. Kapsam genişleyince sürüm artırma da yazıldı ve test edildi.
- **Sonraki turda:** `tts-merkez` Socket.IO **server**, `ses-bankasi` **client**
  (hastaneler NAT arkasında, §9C).

### 10. Budama ve dağıtım durumu ekranları

- `klip.son_kullanim` kolonu ve indeksi var, ama hiçbir şey yazmıyor — yazacak olan
  hastane servisi. Bkz. `KARARLAR-BEKLEYEN.md` [B-008].

### 11. FLAC

- §9C merkezin hastaneye FLAC gönderdiğini söylüyor. Bu turda kanal olmadığı için
  FLAC kodlama/çözme hiç yazılmadı. Banka ham PCM olarak duruyor (§7.1).

---

## Küçük borçlar

### 12. Deneme sesleri ve önizlemeler süreç belleğinde

- `src/web/rotalar/sesler.ts` ve `kelimeler.ts` içinde `Map` ile tutuluyor, 30–60
  dakika sonra temizleniyor. Tek süreçte sorun değil; **birden fazla süreç
  çalıştırılırsa** onay jetonu başka sürece düşebilir ve "önizleme süresi doldu" hatası
  verir.
- **Çözüm:** jetonu veritabanına almak (kısa ömürlü tablo) veya sticky session.

### 13. CSV yükleme — YAPILDI

- `@fastify/multipart` eklendi; yüklenen dosya ile yapıştırılan metin aynı ayrıştırıcıdan
  geçiyor (`govdeyiDuzlestir` tek noktada iki gövde biçimini düzlüyor). Gerçek istekle
  doğrulandı: CSV'den iki kelime + kutuya yapıştırılan bir kelime birlikte önizlendi ve
  kuyruğa girdi.
- Sınır: tek dosya, 8 MB.

### 14. `klip.son_kullanim` ve `kaynak='fallback'` hiç yazılmıyor

- İkisi de hastane trafiğiyle dolacak kolonlar. Şu an yalnız `toplu` ve `deneme`
  kaynakları üretiliyor. Arayüzdeki "kaynak" filtresi çalışıyor ama fallback seçeneği
  bu turda hep boş döner.

---

## [T-YUK] Keyset sayfalama — son sayfalar hâlâ yavaş

**Ne eksik:** Panel listesi `LIMIT/OFFSET` kullanıyor. `006_liste_ifade_indeksi.sql`
derin sayfaları 549 ms'den 124 ms'ye indirdi ama `OFFSET 249.950` hâlâ indeks içinde
250 bin girdi yürümek zorunda — bu OFFSET sayfalamasının doğasında var.

**Ne varsaydım:** Son sayfalar pratikte ziyaret edilmiyor; kullanıcı filtreleyip
arıyor, 5.000. sayfaya gitmiyor. 124 ms kabul edilebilir.

**Gerçek ihtiyaç doğarsa nereyi değiştir:** `paketler/tts-merkez/src/web/rotalar/kelimeler.ts`
— `OFFSET` yerine anahtar tabanlı (keyset) sayfalama:
`WHERE ((durum='ready'), olusturuldu, id) < (son_satirin_degerleri)`. Arayüzde
"sonraki/önceki" bağlantıları sayfa numarası yerine imleç taşımalı. Ölçüm ve gerekçe:
`YUK-TESTI.md`.

---

## [T-INT16] Ses birleştirme 2,4 kat optimize edilebilir

**Ne eksik:** `birlestir()` her klibi PCM→Float32→PCM çeviriyor. Ölçülen istek başına
süre 4,73 ms; dokümanın §10'da öngördüğü ~1 ms değil.

**Ne varsaydım:** Optimize etmeye gerek yok. Ölçülen tepe salvo 9 istek/sn ve teorik
tavan 189 istek/sn — **21 kat pay** var, p99 bile 14 ms.

**Gerçek ihtiyaç doğarsa nereyi değiştir:** `paketler/tts-merkez/src/ses/pcm.ts` —
saf kopyalama bölgelerini Int16 üzerinde yap, float matematiğini yalnız crossfade
dikişlerine uygula. Altın dosya testleri çıktının bayt-birebir aynı kaldığını doğrular.

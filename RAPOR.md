# Rapor — `tts-merkez` çekirdeği ve yönetim arayüzü

**Tarih:** 2026-08-20 · **Kapsam:** yalnız merkez servisi (hastane tarafı, Socket.IO,
HBYS bu turda yok)

---

## 1. Ne yapıldı, nasıl çalıştırılır

Altı aşamanın tamamı yazıldı ve sistem çalışır durumda. 5.083 satır TypeScript
(strict, `any` yok), 16 Eta şablonu, 1.181 satır test, 5 migrasyon.

```bash
pnpm install
pnpm migrasyon        # şemayı kur (idempotent)
pnpm dev              # http://127.0.0.1:3000
```

İlk açılışta superadmin üretilir, parola konsola bir kez basılır ve `ILK-KURULUM.md`
dosyasına yazılır. İlk girişte parola değişimi zorunlu.

**Build adımı yok:** Node 24 TypeScript'i doğrudan çalıştırıyor (`KARARLAR.md` [K-01]).

Ekranlar: kelime veritabanı (filtre + sunucu tarafı sayfalama), toplu ekleme
(önizleme + CSV), şablonlar, ses profilleri ve deneme, kota paneli, kullanıcı yönetimi,
üretim/denetim günlüğü, `/saglik`.

---

## 2. Doğrulananlar

### Gerçek Google'a karşı koşturuldu

| Ne | Sonuç |
|---|---|
| `listVoices(tr-TR)` | **40 ses** — 30 Chirp3 HD, 5 Standard, 5 WaveNet. Hepsi **24000 Hz**. §6.6 birebir doğrulandı. |
| `v1beta1` + `enableTimePointing` | 6 işaretin **6'sı da damga döndü**, hiçbir parça boş çıkmadı. Kesme yöntemi çalışıyor. |
| XML kaçışı gerçek istekte | `O&apos;Brien` kabul edildi, işaret yapısı bozulmadı. |
| Uçtan uca toplu üretim | 3 taşıyıcıdan 9 klip: hepsi `ready`, hepsi diskte, **tek sürüm artışı** (parti doğru). |
| Arka plan üretim döngüsü | Kuyruğa eklenen 3 kelimeyi kendiliğinden üretti. |
| A/B ses denemesi | İki sürüm üretildi, `veri/deneme/` altında dinlenebilir. |

**Ölçülen A/B süre farkı** (gerçek cümle 3.991 ms):

- **Şablon yolu: −51 ms (%−1,3)** — §7.6'nın "süre neredeyse birebir aynı" iddiası
  doğrulandı (doküman: 3,59–3,76 sn karşı 3,60–3,74 sn).
- Serbest metin yolu: **+406 ms (%+10,2)** — cümleyi kelime kelime böldüğü için §7.4'ün
  "anlamlı öbek" kuralını ihlal ediyor. Bkz. `KARARLAR-BEKLEYEN.md` [B-004].

**Google harcaması: 28 klip / 16 çağrı / 2.971 karakter.** 50 klip bütçesinin altında,
22 klip kaldı. Sayaç `veri/google-butce.json` içinde, süreç yeniden başlayınca sıfırlanmıyor.

### Testler — 123 test, hepsi geçiyor

Prototipin **38 testinin tamamı taşındı ve geçiyor**; üstüne 85 yeni test. Google'a
hiç gitmiyorlar (sahte adaptör).

Kapsanan hata yolları: kota dolu · Google 429 (geçici) · damgasız yanıt (Chirp 3 HD
davranışı) · bayat `pending` · takılı `uretiliyor` · deneme sınırı · geri çekilme
penceresi · bütçe reddi · tehlikeli karakterli kelime.

Ayrıca doğrulandı: Türkçe collation (`İSTANBUL` ile `istanbul` tek satır olur),
migrasyonların temiz şemada baştan koşması, `banka_surum` için sequence
tanımlanmadığı (§A.2), `deneme = 0` sıfırlaması, kapsam genişleyince sürüm artışı,
single-flight, içerik adresli depo (aynı içerik iki kez saklanmıyor).

**Altın dosya testleri** eklendi: birleştirme, normalizasyon, WAV başlığı, kırpma,
SSML üretimi ve uçtan uca kesme zinciri bayt-birebir sabitlendi.

### Tarayıcıdan doğrulandı

Oturumsuz erişim `/giris`'e yönleniyor · yanlış parola 401 · doğru giriş sonrası
parola değişimi zorunlu · yedi ekranın hepsi 200 dönüyor · toplu ekleme önizlemesi
(`Wagner → vagner` normalize rozetiyle, `Uzm.Dr.` açılarak, `a.hayri`/`***`/Kiril
engellenerek) · CSV yükleme + yapıştırma birlikte · onay sonrası kuyruğa giriş ·
`/saglik` yeşil.

**Yedekleme betiği gerçekten koşturuldu** (`pg_dump` + banka arşivi + eski yedek temizliği).

### Koşulmayanlar — açıkça

- **Yük testi koşmadım.** §10'daki 0,87 istek/sn ve 9 istek/sn salvo rakamları
  denenmedi. Bu turda istek yolu (hastane servisi) zaten yok.
- **250 bin satırlık tabloyla sayfalama denenmedi.** Tabloda 12 klip var. İndeksler
  §9A'daki gibi kuruldu ve sorgular filtresiz tam tarama yapmıyor, ama **gerçek veriyle
  ölçülmedi**.
- **Kalite kulakla değerlendirilmedi.** Bunu ancak proje sahibi yapabilir:
  `veri/deneme/sablon-gercek.wav` ile `veri/deneme/sablon-birlesik.wav`.
- **WaveNet hiç denenmedi.** Yalnız `tr-TR-Standard-A` ile üretim yapıldı.
- **Çoklu süreç denenmedi.** Deneme sesleri ve onay jetonları süreç belleğinde
  (`TODO-BLOKE.md` 12).
- **`pg_restore` ile geri yükleme denenmedi** — yalnız `pg_dump` koşturuldu.

---

## 3. En önemli kararlar

1. **[K-02] Bütçe sayacı saklanan klibi sayar**, üretilen her dilimi değil; ayrıca
   çağrı sayısına da 50 tavanı kondu. Kısıtın en gevşek yorumu — **zayıf işaretledim**,
   ikinci tavan boşluğu kapatıyor. `KARARLAR-BEKLEYEN.md` [B-002].
2. **[K-03] Kelime yalnız kendi tonlama sınıfındaki yuvaya konur.** İlk yazdığım sürüm
   boş yuvayı doldurmak için soyadı "sayı" yuvasına koyuyordu; §7.5 kural 5 buna
   izin vermiyor. Karakter maliyeti ~%50 arttı, kalite için kabul edildi.
3. **[K-07] Kota çağrıdan önce düşülür ama başarısız çağrıda iade edilir.** Doküman
   iadeden söz etmiyor; iade olmadan sayaç harcanmamış karakteri kalıcı olarak yer.
4. **[K-09] Dokümanda çelişki bulundu:** §A.2'deki örnek SQL `pcm_path`/`flac_path`
   güncelliyor, §9A ise içerik adresli saklamayı ve yol kolonu tutulmadığını söylüyor.
   İçerik adresli düzen uygulandı.
5. **[K-10] `uretiliyor` durumu da süpürülüyor.** §9B'deki süpürücü yalnız `pending`
   filtreliyordu; üretim sırasında çöken süreç satırı sonsuza dek `uretiliyor` bırakırdı.
6. **[K-05/K-06] `O'Brien` artık engellenmiyor.** Prototipten gelen alfabe kontrolü
   apostrofu reddediyordu; §7.5 kural 7 ise `O'Brien`'i test girdisi sayıyor.
   Ayrıca yeni `okunamaz` engel sebebi eklendi (ayrıştırma artığı ile Kiril isim
   aynı kovaya giriyordu).
7. **[K-01] Build zinciri yok** — Node 24 tip soymayı doğrudan çalıştırıyor.
8. **[K-11] CSRF için ayrı jeton yok**, yalnız `sameSite: strict`. **Zayıf işaretledim;
   sunucuya çıkmadan önce eklenmeli.**
9. **[K-12] Başarım testinin kapısı 20 ms'e gevşetildi** — ölçüm makine yüküne aşırı
   duyarlı (aynı kod boşta 2,1 ms, yüklüyken 4,9 ms).
10. **[K-08] `nextval()` kullanılmadı** ve bu bir testle sabitlendi: şemada
    `banka_surum` için sequence tanımlanmadığı doğrulanıyor.

---

## 4. Görüşünüzü istediğim konular

`KARARLAR-BEKLEYEN.md` içinde 8 madde var, kutuları işaretlemeniz yeterli. En önemli üçü:

- **[B-001] Standard mı WaveNet mi?** Kodun veremeyeceği tek karar — kulakla verilecek.
  Geri alma maliyeti en yüksek olan da bu (banka baştan üretilir).
- **[B-003] Taşıyıcı paketleme:** kalite mi karakter tasarrufu mu? Şu an kalite seçili.
  (C) seçeneği ikisini birden verebilir: her tip için ayrı yuvası olan daha uzun bir
  taşıyıcı cümle.
- **[B-005] Üretim döngüsü otomatik mi kalsın?** Şu an 30 saniyede bir kendiliğinden
  üretiyor. İki bağımsız duvar (kota + bütçe) koruyor ama sürpriz istemiyorsanız (B).

---

## 5. Bilinen eksikler

Tamamı `TODO-BLOKE.md` içinde. Özet:

**Sunucuya çıkmadan önce zorunlu:** TOTP (şema hazır, kod yok) · IP kısıtı (şema hazır,
kod yok) · CSRF jetonu · HTTPS.

**Yapılmayan işletme parçaları:** log rotasyonu (Windows'ta süreç dışı iş, yarım çözüm
zarar verirdi) · kota eşiği e-posta uyarısı (SMTP bilgisi `.env`'de yok) · Google Cloud
konsolundaki Katman 2 ve 3 korumaları (elle kurulmalı, kodla kurulamaz).

**Kapsam dışı (sonraki tur):** `hastane_id` her yerde `0` · Socket.IO kanalı yok
(delta sorgusu yazıldı ve test edildi ama çağıran yok) · budama ve dağıtım ekranları ·
FLAC.

**Küçük borç:** deneme sesleri ve onay jetonları süreç belleğinde — çoklu süreçte
"önizleme süresi doldu" hatası verir.

---

## 6. Sonraki adım önerisi

**Sırayla:**

1. **Sesi dinleyin ve [B-001]'i karara bağlayın.** Bundan sonraki her şey bu seçime
   bağlı; sonra değiştirmek bankanın tamamını yeniden ürettirir. `veri/deneme/` altındaki
   dört dosya hazır. WaveNet'i de duymak isterseniz ses profili ekleyip denemeyi
   tekrarlayın (~4 çağrı, bütçede 22 klip var).

2. **`KARARLAR-BEKLEYEN.md` kutularını işaretleyin.** Sekiz maddenin hepsi bir
   dakikalık okuma.

3. **Güvenlik borcunu kapatın** (TOTP + IP + CSRF). Arayüz dışarıya açık bir sunucuda
   çalışacak; bunlar olmadan açılmamalı. Tahmini yarım gün.

4. **Sonraki tur: hastane servisi ve Socket.IO kanalı.** Merkez tarafındaki karşılığı
   (delta sorgusu, kapsam kuralı, sürüm artışı) yazıldı ve test edildi — kanal
   bağlandığında çalışması beklenir, ama **kanal olmadan uçtan uca doğrulanamadı**.

5. **Toplu üretimi tam listeyle çalıştırmadan önce** karakter maliyetini toplu ekleme
   önizlemesinden görün. İlk ay ~2,3M karakter bekleniyor (§6.3), Standard'ın 3,6M sert
   limitinin altında — ama bu tahmin tek günlük logdan uydurulmuş bir eğriye dayanıyor,
   ölçüm değil.

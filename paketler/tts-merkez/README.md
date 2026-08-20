# tts-merkez

22 hastaneye hizmet veren seslendirme sisteminin **merkez servisi**: kelime bankası kayıt
defteri, üretim hattı ve yönetim arayüzü.

Hastane tarafı (`ses-bankasi`), Socket.IO dağıtım kanalı ve HBYS entegrasyonu **bu turda
yok** — sonraki turun konusu. Şema ve kapsam kuralları o tur için hazır (`hastane_id`
kolonu var, şimdilik hep `0`).

Mimari, ölçümler ve gerekçeler: [`docs/SESLENDIRME-SERVISI.md`](docs/SESLENDIRME-SERVISI.md).

---

## Hızlı başlangıç

```bash
pnpm install
cp .env.example .env      # değerleri doldurun
pnpm migrasyon            # şemayı kur (idempotent)
pnpm dev                  # http://127.0.0.1:3000
```

İlk açılışta superadmin hesabı üretilir; parola konsola bir kez basılır ve
`ILK-KURULUM.md` dosyasına yazılır.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `pnpm dev` | Geliştirme sunucusu (dosya değişince yeniden başlar) |
| `pnpm basla` | Normal çalıştırma |
| `pnpm test` | Tüm testler (Google'a gitmez, sahte adaptör kullanır) |
| `pnpm tipler` | `tsc --noEmit`, strict |
| `pnpm lint` | ESLint |
| `pnpm migrasyon` | Migrasyonları uygula |

Build adımı yoktur: Node 24 TypeScript'i doğrudan çalıştırır (tip soyma).

## Çekirdek fikir — taşıyıcı cümleden kesme

Klip **tek başına sentezlenmez**. TTS "Mehmet"i yalnız üretirken onu bitmiş bir cümle
sayar: sonuna düşen tonlama, son hece uzatması, sonda çatlak ses koyar. Altı tane böyle
mini-cümle yan yana gelince ortaya cümle değil liste çıkar.

Bunun yerine parça tam bir cümlenin içinde ürettirilir ve SSML `<mark>` zaman
damgalarıyla oradan kesilir:

```xml
<speak><mark name="m0"/>sayın <mark name="m1"/>Mehmet <mark name="m2"/>Karabulut
<mark name="m3"/>lütfen <mark name="m4"/>üç <mark name="m5"/>nolu bankoya geçiniz.</speak>
```

Kesilen parça cümle ortası tonlamasını taşır. Ayrıntı: §7.5.

**Bu yöntem `v1beta1` uç noktası gerektirir**; `enableTimePointing` alanı `v1`'de yoktur.

## Dizin düzeni

```
migrasyonlar/            numaralı .sql — kütüphane yok, sırayla uygulanır
betikler/                yedekleme, Google doğrulama, küçük toplu deneme
paketler/tts-merkez/
  src/
    ses/                 pcm.ts (DSP) · metin.ts (normalizasyon) · kesme.ts (ÇEKİRDEK)
    motor/               arayuz.ts · google.ts · sahte.ts · butce.ts · hiz-sinirlayici.ts
    depo/                klip-deposu.ts — içerik adresli, atomik yazım
    uretim/              kuyruk · kota · surum · planlayici · uretici · arka-plan
    deneme/              capraz.ts — A/B ses denemesi (çapraz kurulum)
    web/                 sunucu.ts · rotalar/ · gorunum/ (Eta) · kimlik.ts
    veritabani/          baglanti.ts (postgres.js) · migrasyon.ts
  test/
veri/banka/<profil>/<hash[0:2]>/<hash[2:4]>/<hash>.pcm
```

## İhlal edilmemesi gereken kurallar

Bunlar tercih değil, ölçümle veya olay sonrası varılmış kararlardır:

1. **Üretim taşıyıcı cümleden kesme ile yapılır.** Klip tek başına sentezlenmez.
2. **Kesilen parçaya sessizlik kırpma UYGULANMAZ**; sonuna 50 ms kuyruk payı bırakılır.
3. **Birleştirme: 0 ms boşluk, 45 ms crossfade**, sıfır geçiş hizalama açık.
4. **Chirp 3 HD seçilemez** — SSML işaretine sıfır damga döndürüyor (ölçüldü).
5. **Kota sayacı tiyer bazlı ve sert**, çağrıdan *önce*, atomik SQL. Standard 4M,
   WaveNet 1M ayrı havuzlar; %90'da tüm çağrılar durur.
6. **ORM yok.** Ham SQL, numaralı `.sql` migrasyonlar.
7. **Runtime'da harici process yok** — `ffmpeg`/`sox` subprocess yasak. Ses işleme
   in-process.
8. **Hasta verisi loglanmaz.** Log JSON, redaction listesi zorunlu.
9. **Yapılandırma `.env`'den**; kodda sabit yok (örnekleme hızı dahil).
10. **XML kaçışı tek noktada** — taşıyıcı kurucusunun içinde, çağıranın hatırlamasına
    bırakılmadan. Kelime doğrudan SSML'e giriyor ve tüm kesme mantığı işaretlere bağlı.
11. **Klip yazımı atomik**: geçici dosya → `fsync` → `rename` → *sonra* DB `ready`.
12. **Redis yok.** Kuyruk `klip` tablosunda, `FOR UPDATE SKIP LOCKED` ile.

`banka_surum` artışında **`nextval()` kullanmayın** — gerekçesi §A.2'de; bu bir
optimizasyon değil, sessiz veri kaybıdır.

## Google maliyet koruması

İki bağımsız duvar:

- **Aylık kota** (§6.4): tiyer bazlı, atomik, çağrıdan önce. `kota` tablosu.
- **Geliştirme bütçesi**: `GOOGLE_KLIP_BUTCESI` (varsayılan 50 klip). Sayaç
  `veri/google-butce.json` dosyasında; süreç yeniden başlayınca sıfırlanmaz.

Testler Google'a hiç gitmez: `SahteMotor` sinüs üretir ve gerçekçi zaman damgaları döner.

## Sağlık ve yedekleme

```bash
curl http://127.0.0.1:3000/saglik
powershell -ExecutionPolicy Bypass -File betikler\yedekle.ps1
```

Ses yeniden üretilebilir; **kelime listesi ve hangi klibin var olduğu bilgisi yeri
doldurulamaz**. Veritabanı yedeği banka dizininden daha kritiktir.

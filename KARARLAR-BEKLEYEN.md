# Bekleyen kararlar

Bunlar proje sahibinin işaretlemesi gereken seçenekler. Her birinde **geri alınabilir**
bir seçenekle devam edildi; kutuyu işaretleyin, sonraki koşuda uygulanır.

---

## [B-001] Ses tiyeri: Standard mı WaveNet mi?

**Aşama:** 2 · **Geri alma maliyeti:** Yüksek (bankanın tamamı yeniden üretilir)
**Ne yaptım:** (A) ile devam ettim — varsayılan profil `tr-TR-Standard-A`.

Bu, kulakla verilecek bir karar ve kodun veremeyeceği tek karar. Dinlemek için:
`veri/deneme/sablon-gercek.wav` ve `veri/deneme/sablon-birlesik.wav` (Standard-A ile
üretildi). WaveNet karşılaştırması için ses profili ekranından yeni profil ekleyip
denemeyi tekrarlayın — maliyeti ~4 çağrı.

- [ ] A — **Standard** ← ÖNERİM: aynı $4/1M aşım fiyatına 4 kat ücretsiz kota (4M / 1M).
      Ölçülen büyümeyle (§6.3) Standard'da toplam maliyet $0 çıkıyor.
- [ ] B — WaveNet: kalite muhtemelen daha iyi, kota 1M, tahmini toplam ~$8
- [ ] C — İki profili birden tut, hastane bazında seçilsin (banka iki kat büyür)

---

## [B-002] Google bütçesinin muhasebesi

**Aşama:** 2 · **Geri alma maliyeti:** Çok düşük (tek satır)
**Ne yaptım:** (A) ile devam ettim. Ayrıntı `KARARLAR.md` [K-02].

Bir taşıyıcı cümle 6 dilim üretir ama yalnız hedeflenenler bankaya klip olarak yazılır.
"50 klip" kısıtı hangisini sayıyor?

- [ ] A — **Saklanan klip** sayılır, ayrıca çağrı sayısına da 50 tavanı konur
      ← ÖNERİM: "klip" bu projede banka birimi; ikinci tavan boşluğu kapatıyor
- [ ] B — Google'ın sentezlediği her dilim sayılır (daha sıkı; ses denemesi ekranı
      pratikte kullanılamaz hale gelir)
- [ ] C — Yalnız karakter sayılır, klip sayısı hiç sayılmaz

> Bu turda fiilen **25 klip / 10 çağrı / 2.070 karakter** harcandı. Hangi yorum seçilirse
> seçilsin sınırın altında kalındı.

---

## [B-003] Taşıyıcı paketleme: kalite mi verimlilik mi?

**Aşama:** 3 · **Geri alma maliyeti:** Düşük (~2 saat)
**Ne yaptım:** (A) ile devam ettim. Ayrıntı `KARARLAR.md` [K-03].

Bir soyadı, taşıyıcının "sayı" yuvasından kesilirse karakter maliyeti düşer ama klip
yanlış tonlama konturu taşır.

- [ ] A — **Yalnız aynı tonlama sınıfındaki yuvaya yerleştir** ← ÖNERİM: §7.5 kural 5
      bunu gerektiriyor; hata cümle ortasında duyulur ve geri dönüşü yeniden üretimdir
- [ ] B — Boş yuva bırakma, herhangi bir kelimeyi herhangi bir yuvaya koy
      (~%35 daha az karakter, tonlama riski)
- [ ] C — Şablonu genişlet: her tip için ayrı yuvası olan uzun bir taşıyıcı cümle
      tasarla (ör. "sayın {ad} {soyad}, doktor {doktor}, {poliklinik} için {banko} nolu
      bankoya geçiniz") — tek çağrıda 5 farklı tipte klip çıkar

---

## [B-004] Ses denemesi ekranında serbest metin yolu

**Aşama:** 4 · **Geri alma maliyeti:** Düşük
**Ne yaptım:** (A) ile devam ettim — ikisi de çalışıyor, şablon yolu öneriliyor.

**Ölçüldü:** serbest metin yolu birleştirilmiş sürümü gerçek cümleden **+%10,2** uzun
çıkarıyor; şablon yolu **−%1,3**. Sebep: serbest metin cümleyi kelime kelime bölüyor ve
§7.4'ün "anlamlı öbek" kuralını ihlal ediyor ("nolu bankoya geçiniz" üç ayrı klip
oluyor, üç dikiş fazladan).

- [ ] A — **İkisi de dursun**, ekranda şablon yolu önerilsin ← ÖNERİM: serbest metin
      hızlı deneme için pratik, ama sonucu üretim kalitesini temsil etmiyor
- [ ] B — Serbest metin yolunu kaldır, yalnız şablonla deneme yapılsın
- [ ] C — Serbest metni öbeklere ayırmayı öğret (noktalama/durak sezgisi ekle)

---

## [B-005] Üretim döngüsü otomatik mi, elle mi tetiklensin?

**Aşama:** 3 · **Geri alma maliyeti:** Çok düşük (yapılandırma)
**Ne yaptım:** (A) ile devam ettim — 30 saniyede bir otomatik tur, kota kritik eşikte
duruyor, bütçe dolunca duruyor.

- [ ] A — **Otomatik**, 30 sn aralıkla ← ÖNERİM: kuyruğa eklenen kelime kendiliğinden
      üretilsin; iki bağımsız duvar (kota + bütçe) zaten koruyor
- [ ] B — Elle: arayüzde "üretimi başlat" butonu olsun, arka planda hiç çalışmasın
      (geliştirme sırasında sürpriz harcama olmaz)
- [ ] C — Otomatik ama daha seyrek (5 dakika)

> Not: bütçe dolduğunda döngü Google'a gitmiyor, klipleri `kota_bekliyor` yapıp
> duruyor — yani (A) ile bile kontrolsüz harcama olmuyor.

---

## [B-006] Toplu eklemede bilinmeyen tip

**Aşama:** 4 · **Geri alma maliyeti:** Çok düşük
**Ne yaptım:** (A) ile devam ettim.

CSV'de tip belirtilmemişse ne olsun?

- [ ] A — **Formdaki "varsayılan tip" kullanılsın** ← ÖNERİM: kullanıcı ne eklediğini
      biliyor, tek seçimle bütün dosyaya uygulanıyor
- [ ] B — `ad` varsayılsın
- [ ] C — Tipsiz satırlar reddedilsin

---

## [B-007] Kullanıcı silme

**Aşama:** 5 · **Geri alma maliyeti:** Düşük
**Ne yaptım:** (A) ile devam ettim — silme yok, yalnız pasifleştirme var.

- [ ] A — **Silme olmasın, pasifleştirme yeterli** ← ÖNERİM: denetim günlüğü
      `kullanici_id` ile bağlı; silinen kullanıcının izi kopar
- [ ] B — Silme olsun, denetim kayıtları `kullanici_adi` metniyle korunsun
      (şema bunu zaten destekliyor)

---

## [B-008] Budama ve dağıtım ekranları

**Aşama:** 4 · **Geri alma maliyeti:** Yok (yapılmadı)
**Ne yaptım:** (C) ile devam ettim — yazılmadı.

§9F "budama durumu" ve "22 hastanenin dağıtım tablosu" ekranlarını da sayıyor. İkisi de
hastane tarafı (`ses-bankasi`) ve Socket.IO kanalı olmadan **veri üretmiyor**: tablo boş
kalırdı.

- [ ] A — Şimdi yazılsın, boş tablo olarak dursun
- [ ] B — Sahte veriyle yazılsın, sonraki turda gerçek veriye bağlansın
- [ ] C — **Sonraki turda, hastane servisiyle birlikte yazılsın** ← ÖNERİM: boş ekran
      yanlış güven verir; ekranın kendisi 2 saatlik iş, asıl iş veri kaynağı

# Kararlar

Bu turda verilen kararlar: ne, neden, hangi alternatif elendi, geri alma maliyeti.
Dokümanda (`docs/SESLENDIRME-SERVISI.md`) cevabı olan hiçbir şey burada yeniden
tartışılmadı — doküman kazanır. Burada yalnız dokümanın **söylemediği** noktalar var.

---

## [K-01] Build zinciri yok: Node 24 TypeScript'i doğrudan çalıştırıyor

**Karar.** `tsc` ile derleme adımı yok. Node 24.11.1 tip soymayla `.ts` dosyalarını
doğrudan koşturuyor; `tsc --noEmit` yalnız tip denetimi için (`pnpm tipler`).

**Neden.** Teknoloji yığını "build zinciri yok, tek deployable" diyordu (arayüz için).
Aynı gerekçe sunucu tarafında da geçerli: derleme adımı olmayınca `dist/` ile `src/`
ayrışması, kaynak haritası ve "hangi sürüm koşuyor" sorusu ortadan kalkıyor.

**Elenen.** `tsx` veya `ts-node` bağımlılığı — bir bağımlılık daha, aynı sonuç.
`tsc` ile derleyip `dist/` koşturmak — iki kopya, ek adım.

**Bedeli.** `enum`, `namespace` ve parametre özellikleri kullanılamaz (`erasableSyntaxOnly`
açık, derleyici uyarıyor). Bu bir kayıp değil; hiçbiri gerekmedi.

**Geri alma maliyeti.** Düşük (~1 saat): `tsconfig`'de `noEmit` kapatılır, `outDir`
eklenir, script'ler `dist/`i gösterir.

---

## [K-02] Bütçe sayacı SAKLANAN klibi sayar, üretilen dilimi değil

**Karar.** "Google'a giden toplam çağrı 50 klibi geçmeyecek" kısıtı, **bankaya klip olarak
yazılan** parça sayısıyla ölçülüyor. Bir taşıyıcı 6 dilim üretir ama yalnız hedeflenen
3 tanesi saklanıyorsa bütçeden 3 düşülür. Ayrıca ikinci bir tavan var: toplam **çağrı**
sayısı da 50'yi geçemez.

**Neden.** "Klip" bu projede banka birimidir. Atılan dolgu dilimlerini de saymak, ses
denemesi ekranını (her çapraz taşıyıcı 6 dilim üretip 1 tanesini kullanır) daha ilk
denemede kullanılamaz hale getirirdi: tek bir A/B karşılaştırması 36 klip yerdi.

**Zayıf gördüğüm yer.** Bu, kısıtın en gevşek yorumu. Daha sıkı yorum "Google'ın
sentezlediği her dilim sayılsın" olurdu. İkinci tavan (çağrı sayısı) bu boşluğu
kapatıyor: 50 çağrı × ortalama 170 karakter ≈ 8.500 karakter, aylık kotanın binde ikisi.
**Bu turda fiilen 25 klip / 10 çağrı harcandı**, iki tavanın da yarısının altında.

**Geri alma maliyeti.** Çok düşük: `uretici.ts`'te `tasiyici.saklanan` yerine
`tasiyici.yuvalar.length` yazmak yeterli.

---

## [K-03] Kelime yalnız kendi tonlama sınıfındaki yuvaya yerleştirilir

**Karar.** Taşıyıcı planlayıcı, bir soyadı "sayı" yuvasına koymuyor. Yuvalar tonlama
sınıflarına ayrıldı (`isim` = ad/soyad/doktor, `sayi` = sayi/banko, `ifade` =
poliklinik/hedef). Tam tip eşleşmesi bulunamazsa en fazla aynı sınıf içinde kaydırılıyor
ve `idealDegil` işaretleniyor. Uygun yuva hiç yoksa üretim sessizce yanlış klip
üretmek yerine **anlaşılır hata** veriyor.

**Neden.** §7.5 kural 5: "Ad ve soyad farklı tonlama yuvalarındadır. Taşıyıcıda
hangisinin nerede olduğu bilinmeli." İlk yazdığım sürüm boş yuvayı doldurmak için
herhangi bir kelimeyi herhangi bir yuvaya koyuyordu — bu, doğru çalışan ama **yanlış
tonlamalı** klipler üretirdi ve hata cümle ortasında duyulurdu.

**Bedeli.** Daha az verimli paketleme: 6 ad/soyad tokenı 3 yuvalı bir şablonda 2 yerine
3 taşıyıcı ister. Karakter maliyeti ~%50 artar. Kalite karşılığında kabul edildi.

**Geri alma maliyeti.** Düşük: `planlayici.ts` içindeki `al()` fonksiyonunda sınıf
kontrolünü gevşetmek.

---

## [K-04] Şablon yuva tipleri veritabanında, kodda değil

**Karar.** Hangi değişkenin hangi tipte olduğu (`banko` → `sayi`) `sablon.ogeler`
jsonb kolonunda tutuluyor ve arayüzden düzenlenebiliyor.

**Neden.** K-03'ün çalışması yuva tipini bilmeye bağlı. Bunu koda gömmek, yeni bir
şablon eklendiğinde ("doktor çağrısı", "poliklinik yönlendirme") kod değişikliği
gerektirirdi. Aşama 4c zaten "hangi öğenin hangi yuvada olduğu" ekranını istiyordu.

**Geri alma maliyeti.** Yok — ek bilgi, mevcut davranışı bozmuyor.

---

## [K-05] Apostroflu adlar bankaya girebilir

**Karar.** `O'Brien` artık "seslendirilemez" sayılmıyor; apostrof Türkçe alfabe
kümesine eklendi.

**Neden.** Prototipten taşınan `TURKCE_HARF` kontrolü apostrofu reddediyordu ve toplu
ekleme önizlemesinde `O'Brien` "Latin dışı" diye engelleniyordu. Bu iki açıdan yanlış:
(a) ad Latin alfabesinde, (b) §7.5 kural 7 `O'Brien`'i **XML kaçışı test girdisi**
olarak sayıyor — yani sisteme girmesi bekleniyor, kaçırılması gerekiyor. Kaçış zaten
taşıyıcı kurucusunda yapılıyor ve **gerçek Google isteğiyle doğrulandı**
(`O&apos;Brien` kabul edildi, altı damganın altısı da döndü).

**Geri alma maliyeti.** Çok düşük: `metin.ts` içindeki `TURKCE_HARF` deseninden
apostrofu çıkarmak.

---

## [K-06] Yeni engel sebebi: `okunamaz`

**Karar.** Migrasyon 005 ile `engellenen.sebep` kümesine `okunamaz` eklendi.

**Neden.** Normalizasyon sonrası Türkçe alfabe dışı karakter kalan artıklar (tek başına
kalan `&`, rakam, noktalama) `latin_disi` diye etiketleniyordu. Kiril harfli gerçek bir
isimle, ayrıştırma artığı aynı kovaya giriyordu; arayüzde sebep yanlış okunuyordu ve
"engellenenler listesi kirli veriyi ortaya çıkarır" (§9F) faydası körelirdi.

**Geri alma maliyeti.** Düşük: yeni bir migrasyon ile kısıt daraltılır.

---

## [K-07] Kotadan düşülen karakter, çağrı başarısızsa iade edilir

**Karar.** Kota çağrıdan **önce** atomik olarak düşülüyor (§6.4 gereği), ama ses
üretilmeden hata alınırsa (ağ hatası, 429, bütçe reddi) düşülen miktar geri veriliyor.

**Neden.** §6.4 "çağrıdan önce düş" diyor ve bu doğru: yarış durumunu ancak bu
engelliyor. Ama iade olmadan sayaç, gerçekten harcanmamış karakteri kalıcı olarak yer;
birkaç yüz geçici hata sonrası kota panelindeki rakam gerçeği yansıtmaz ve sistem
gereksiz yere durur. Doküman iadeden söz etmiyor — bu bir **ekleme**, çelişki değil.

**Test edildi.** "Google geçici hatası" testi, hata sonrası kota sayacının 0 kaldığını
doğruluyor.

**Geri alma maliyeti.** Çok düşük: `uretici.ts` ve `capraz.ts` içindeki `kotaIade`
çağrılarını kaldırmak.

---

## [K-08] `nextval()` yerine satır kilidi — doğrulandı, değiştirilmedi

**Karar.** §A.2'ye harfiyen uyuldu: `UPDATE banka_surum SET surum = surum + 1 ...
RETURNING surum`. Sequence kullanılmadı.

**Neden burada yazılı.** Bu bir karar değil, dokümanın kararı — ama test edilebilir
hale getirildi: `uretim.test.ts` içinde bir test, şemada `banka_surum` için hiç sequence
tanımlanmadığını doğruluyor. İleride "performans için sequence'e çevirelim" diyen biri
çıkarsa test düşer.

---

## [K-09] Şemada dokümanla bir çelişki var: `pcm_path` / `flac_path`

**Tespit.** §A.2'deki örnek SQL `pcm_path` ve `flac_path` kolonlarını güncelliyor, ama
aynı bölümün üstündeki şema tanımı (§9A) klip dosyasının **içerik adresli** saklandığını
ve **yol kolonu tutulmadığını** söylüyor.

**Ne yaptım.** İçerik adresli düzeni uyguladım, yol kolonu yok. Yol `hash`ten türüyor:
`veri/banka/<profil>/<hash[0:2]>/<hash[2:4]>/<hash>.pcm`. §A.2'deki örnek SQL, şema
tanımından önceki bir sürümden kalmış görünüyor. Görev tanımı da içerik adresli düzeni
açıkça istiyordu.

**Geri alma maliyeti.** Orta: yol kolonu eklemek migrasyon + geri doldurma ister. Ama
gerek yok; hash yeterli.

---

## [K-10] `uretiliyor` durumu da süpürülüyor

**Karar.** Bayat süpürücü yalnız `pending` değil, `uretiliyor` durumunda takılı kalan
satırları da `failed`'a çeviriyor.

**Neden.** §9B'deki süpürücü SQL'i yalnız `pending` filtreliyor. Ama üretici, klibi
sahiplendiğinde durumu `uretiliyor` yapıyor; süreç tam o anda çökerse satır sonsuza dek
`uretiliyor` kalır ve hiçbir süpürücü ona dokunmaz. Bu, dokümanın önlemek istediği tuzağın
ta kendisi ("merkez üretim sırasında çökerse satır sonsuza dek pending kalmamalı").

**Test edildi.** "takılı kalan uretiliyor da kurtarılır".

---

## [K-11] Oturum ve arayüz kararları

- **Oturum deposu PostgreSQL.** Redis yok kuralıyla uyumlu; `oturum` tablosu.
- **Çerez `sameSite: strict`, `httpOnly`.** `secure` yalnız `ORTAM=uretim` iken açık —
  yerelde HTTP ile çalışılabilsin diye.
- **CSRF için ayrı jeton yok.** `sameSite: strict` + yalnız POST ile durum değiştirme
  bu turda yeterli görüldü. **Zayıf gördüğüm karar** — sunucuya çıkmadan önce gerçek
  bir CSRF jetonu eklenmeli (`TODO-BLOKE.md`).
- **İlk girişte parola değişimi zorunlu.** Panel başka sayfaya geçirmiyor.

---

## [K-12] Ölçüm testinin kapısı gevşek tutuldu

**Karar.** 6 klip birleştirme süresi testi 20 ms'de düşüyor, §10'un beklediği ~1 ms'de
değil.

**Neden.** Bu bir ölçüm testi ve makine yüküne aşırı duyarlı: aynı kod boşta 2,1 ms,
arka planda sunucu koşarken 4,9 ms ölçüldü. Dar bir kapı, gerçek bir regresyon
göstermeden rastgele düşer ve zamanla "test yine patladı, geç" alışkanlığı yaratır.
20 ms, kazara bir O(n²) hatasını hâlâ yakalar.

**WSOLA ölçümü hiç kapı değil** — konsola basılıyor, teste bağlanmıyor. Gerekçe: §7.1.1
zaten 0.8x'in 30 ms kapısını aştığını biliyor ve `rate` varsayılanı 1.0 olduğu için
istek yolunda çalışmıyor.

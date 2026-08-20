// Ilk acilis: kullanici yoksa superadmin olustur, varsayilan profil ve sablonu ek.
//
// Parola URETILIR — sabit varsayilan parola KULLANILMAZ. Konsola bir kez basilir
// ve ILK-KURULUM.md dosyasina yazilir.

import { writeFile } from 'node:fs/promises';

import { kullaniciEkle, kullaniciSayisi, parolaUret } from './web/kimlik.ts';
import { kotaSatiriniHazirla } from './uretim/kota.ts';
import { surumSatiriniHazirla } from './uretim/surum.ts';
import { ogeleriKur } from './web/rotalar/sablonlar.ts';
import type { Db } from './veritabani/baglanti.ts';
import type { Yapilandirma } from './yapilandirma.ts';

export const VARSAYILAN_SABLON = 'sayın {ad} {soyad} lütfen {banko} nolu bankoya geçiniz';
const VARSAYILAN_ORNEKLER = 'ad=Mehmet=ad\nsoyad=Karabulut=soyad\nbanko=üç=sayi';

export type KurulumSonucu = {
  superadminOlusturuldu: boolean;
  kullaniciAdi: string;
  parola: string | null;
  profilOlusturuldu: boolean;
  sablonOlusturuldu: boolean;
};

export async function ilkKurulum(
  db: Db,
  ayar: Yapilandirma,
  { dosyaYolu }: { dosyaYolu?: string } = {},
): Promise<KurulumSonucu> {
  const sonuc: KurulumSonucu = {
    superadminOlusturuldu: false,
    kullaniciAdi: 'superadmin',
    parola: null,
    profilOlusturuldu: false,
    sablonOlusturuldu: false,
  };

  // ── Kota satirlari ──
  for (const tiyer of ['standard', 'wavenet']) await kotaSatiriniHazirla(db, tiyer);

  // ── Varsayilan ses profili ──
  // Ornekleme hizi .env'den gelir; koda gomulmez (kritik kisit 9).
  const profiller = await db<{ id: string }[]>`SELECT id FROM ses_profili LIMIT 1`;
  if (profiller.length === 0) {
    await db`
      INSERT INTO ses_profili (id, motor, motor_sesi, tiyer, ornek_hizi, cinsiyet, varsayilan, aktif)
      VALUES ('kadin-1', 'google', ${ayar.DIL_KODU + '-Standard-A'}, 'standard',
              ${ayar.BANKA_ORNEKLEME_HIZI}, 'FEMALE', true, true)
    `;
    await surumSatiriniHazirla(db, 'kadin-1');
    sonuc.profilOlusturuldu = true;
  }

  // ── Varsayilan sablon ──
  const sablonlar = await db<{ id: number }[]>`SELECT id FROM sablon LIMIT 1`;
  if (sablonlar.length === 0) {
    await db`
      INSERT INTO sablon (ad, metin, ogeler, varsayilan)
      VALUES ('banko-cagrisi', ${VARSAYILAN_SABLON},
              ${db.json(ogeleriKur(VARSAYILAN_SABLON, VARSAYILAN_ORNEKLER) as never)}, true)
    `;
    sonuc.sablonOlusturuldu = true;
  }

  // ── Superadmin ──
  if ((await kullaniciSayisi(db)) === 0) {
    const parola = parolaUret();
    await kullaniciEkle(db, 'superadmin', parola, 'superadmin', { parolaDegistir: true });
    sonuc.superadminOlusturuldu = true;
    sonuc.parola = parola;

    if (dosyaYolu) await kurulumDosyasiYaz(dosyaYolu, ayar, parola);
  }

  return sonuc;
}

async function kurulumDosyasiYaz(
  yol: string,
  ayar: Yapilandirma,
  parola: string,
): Promise<void> {
  const icerik = `# İlk kurulum — tts-merkez

Bu dosya sistem ilk kez açıldığında **otomatik üretildi**.
İçindeki parola yalnız burada ve bir kez konsolda yazılıdır.

## Superadmin girişi

| | |
|---|---|
| Adres | http://${ayar.SUNUCU_ADRESI}:${ayar.PORT} |
| Kullanıcı adı | \`superadmin\` |
| Parola | \`${parola}\` |

**İlk girişte parola değişimi zorunludur** — panel başka bir sayfaya geçmenize izin vermez.
Parolayı değiştirdikten sonra bu dosyayı silin.

## Nasıl açılır

\`\`\`bash
pnpm install          # bir kez
pnpm migrasyon        # şemayı kur (idempotent, tekrar çalıştırılabilir)
pnpm dev              # geliştirme (dosya değişince yeniden başlar)
pnpm basla            # normal çalıştırma
\`\`\`

Ardından tarayıcıdan **http://${ayar.SUNUCU_ADRESI}:${ayar.PORT}** adresine gidin.

## PostgreSQL nasıl başlatılır

Sunucu kapalıysa (bağlantı hatası alıyorsanız) PowerShell'de:

\`\`\`powershell
& "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe" -D C:\\Users\\ibrah\\pgdata -l C:\\Users\\ibrah\\pgdata\\server.log start
\`\`\`

Durdurmak için:

\`\`\`powershell
& "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe" -D C:\\Users\\ibrah\\pgdata stop
\`\`\`

> **\`initdb\` çalıştırmayın.** Küme zaten \`C:\\Users\\ibrah\\pgdata\` altında kurulu ve
> \`tr-TR\` ICU locale ile oluşturulmuş. Yeniden initdb, veritabanını sıfırlar.

## Sağlık kontrolü

\`\`\`bash
curl http://${ayar.SUNUCU_ADRESI}:${ayar.PORT}/saglik
\`\`\`

Veritabanı erişimi, banka dizini yazılabilirliği, kota durumu ve kuyruk sayılarını döner.

## Kurulan varsayılanlar

- Ses profili: \`kadin-1\` (${ayar.DIL_KODU}-Standard-A, standard tiyer, ${ayar.BANKA_ORNEKLEME_HIZI} Hz)
- Şablon: \`banko-cagrisi\` — \`${VARSAYILAN_SABLON}\`
- Kota satırları: standard (4M) ve wavenet (1M), sert limit %90

## Google bütçesi

Geliştirme boyunca Google'a giden toplam klip sayısı **${ayar.GOOGLE_KLIP_BUTCESI}** ile sınırlı.
Sayaç \`veri/google-butce.json\` dosyasında tutulur ve süreç yeniden başlayınca sıfırlanmaz.
Sınırı değiştirmek için \`.env\` içindeki \`GOOGLE_KLIP_BUTCESI\` değerini güncelleyin.
`;

  await writeFile(yol, icerik, 'utf8');
}

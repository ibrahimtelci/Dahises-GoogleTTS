// Yapılandırma yalnız .env'den okunur; kodda sabit yoktur (kritik kısıt 9).
// Özellikle örnekleme hızı (24000) hiçbir yere gömülmez — buradan veya profil
// tanımından gelir.

import { z } from 'zod';

const sema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL gerekli'),
  GOOGLE_TTS_API_KEY: z.string().min(1).optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
  BANKA_DIZINI: z.string().min(1, 'BANKA_DIZINI gerekli'),
  BANKA_ORNEKLEME_HIZI: z.coerce.number().int().positive(),
  PORT: z.coerce.number().int().positive().default(3000),
  SUNUCU_ADRESI: z.string().default('127.0.0.1'),
  OTURUM_GIZLI_ANAHTARI: z.string().min(32, 'OTURUM_GIZLI_ANAHTARI en az 32 karakter olmalı'),

  // Google bütçe koruması — geliştirme boyunca sert sınır.
  GOOGLE_KLIP_BUTCESI: z.coerce.number().int().nonnegative().default(50),
  GOOGLE_ESZAMANLILIK: z.coerce.number().int().positive().max(10).default(5),
  GOOGLE_ISTEK_HIZI_SN: z.coerce.number().positive().default(5),

  // Üretim hattı
  URETIM_PARTI_BOYUTU: z.coerce.number().int().positive().default(200),
  SAHIPLENME_YASI_SN: z.coerce.number().int().positive().default(60),
  SUPURUCU_ARALIK_SN: z.coerce.number().int().positive().default(300),
  BAYAT_PENDING_DK: z.coerce.number().int().positive().default(5),
  DENEME_SINIRI: z.coerce.number().int().positive().default(3),

  // Ses birleştirme (§7.6) — ölçülmüş değerler, yapılandırmadan gelir
  BIRLESTIRME_BOSLUK_MS: z.coerce.number().int().nonnegative().default(0),
  BIRLESTIRME_CROSSFADE_MS: z.coerce.number().int().nonnegative().default(45),
  KESME_KUYRUK_MS: z.coerce.number().int().nonnegative().default(50),

  DIL_KODU: z.string().default('tr-TR'),
  LOG_SEVIYESI: z.string().default('info'),
  ORTAM: z.enum(['gelistirme', 'uretim', 'test']).default('gelistirme'),
});

export type Yapilandirma = z.infer<typeof sema> & { motorKimligiVar: boolean };

let onbellek: Yapilandirma | null = null;

export function yapilandirmaOku(kaynak: NodeJS.ProcessEnv = process.env): Yapilandirma {
  const sonuc = sema.safeParse(kaynak);
  if (!sonuc.success) {
    const satirlar = sonuc.error.issues.map((s) => `  - ${s.path.join('.')}: ${s.message}`);
    throw new Error(
      'Yapılandırma eksik veya geçersiz (.env dosyasına bak):\n' + satirlar.join('\n'),
    );
  }
  const veri = sonuc.data;
  return {
    ...veri,
    motorKimligiVar: Boolean(veri.GOOGLE_TTS_API_KEY ?? veri.GOOGLE_APPLICATION_CREDENTIALS),
  };
}

/** Süreç boyunca tek örnek. */
export function yapilandirma(): Yapilandirma {
  onbellek ??= yapilandirmaOku();
  return onbellek;
}

/** Testler için — okunmuş yapılandırmayı sıfırlar. */
export function yapilandirmaSifirla(): void {
  onbellek = null;
}

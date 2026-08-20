// Yapılandırılmış JSON log (pino). Hasta verisi loglanmaz (kritik kısıt 8):
// redaction listesi zorunlu ve kelime alanları da maskelenir.

import { pino } from 'pino';

/**
 * Maskelenecek alanlar. `kelime`, `ad`, `soyad`, `adSoyad`, `metin` hasta adı
 * taşıyabilir — üretim logunda hiçbiri görünmez.
 */
export const GIZLENECEK = [
  'ad', 'soyad', 'adSoyad', 'hastaAdi', 'kelime', 'metin', 'telaffuz', 'ssml',
  'parola', 'parolaHash', 'apiAnahtari', 'authorization', 'cookie',
  '*.ad', '*.soyad', '*.adSoyad', '*.kelime', '*.metin', '*.telaffuz', '*.parola',
  'req.headers.cookie', 'req.headers.authorization',
  'req.body.parola', 'req.body.yeniParola', 'req.body.kelimeler', 'req.body.metin',
];

export function gunlukKur(seviye: string, ortam: string) {
  return pino({
    level: seviye,
    redact: { paths: GIZLENECEK, censor: '[gizli]' },
    base: { servis: 'tts-merkez' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(ortam === 'gelistirme'
      ? {}
      : {}),
  });
}

export type Gunluk = ReturnType<typeof gunlukKur>;

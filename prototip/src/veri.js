// Prototip test verisi. Kasıtlı olarak küçük — 50 klip sınırının altında kalır.

export const SABLON = 'sayın {ad} {soyad} lütfen {banko} nolu bankoya geçiniz';

/** Dinlenecek beş cümle. Sonuncusu çok basamaklı sayıyı sınamak için. */
export const CUMLELER = [
  { ad: 'Mehmet', soyad: 'Karabulut', banko: 3 },
  { ad: 'Ayşe', soyad: 'Yılmaz', banko: 12 },
  { ad: 'Hüseyin', soyad: 'Öztürk', banko: 7 },
  { ad: 'Mustafa', soyad: 'Çelik', banko: 1 },
  { ad: 'Elif', soyad: 'Şahin', banko: 145 },
];

/**
 * Yabancı kökenli isimler (§13 madde 2 — 15-20 isim).
 * `ham` alanı normalizasyondan geçmemiş hâli; birkaçını A/B için ayrıca üretiyoruz.
 */
export const YABANCI_ISIMLER = [
  { ham: 'Wagner', abTesti: true },
  { ham: 'Quentin', abTesti: true },
  { ham: 'Xavier', abTesti: true },
  { ham: 'Michelle' },
  { ham: 'Jackson' },
  { ham: 'Smith' },
  { ham: 'François' },
  { ham: 'Vladimir' },
  { ham: 'Svetlana' },
  { ham: 'Dmitri' },
  { ham: 'Natalya' },
  { ham: 'Abdulrahman' },
  { ham: 'Khalid' },
  { ham: 'Yousef' },
  { ham: 'Mahmoud' },
];

/** Latin dışı alfabe — bunlar seslendirilmemeli, degrade yola düşmeli. */
export const LATIN_DISI_ORNEKLER = ['Владимир', 'محمود', '李明'];

export const SES_VARSAYILAN = 'tr-TR-Wavenet-D';   // kadın; sesler.js ile doğrula
export const ORNEK_HIZI_VARSAYILAN = 24000;         // sesler.js gerçek değeri söyler

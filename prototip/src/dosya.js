// Klip anahtarını dosya adına çevirir.
// Anahtarlarda iki nokta var (soyad:yilmaz) ve Windows dosya adlarında geçersiz.

export function dosyaAdi(anahtar) {
  return anahtar.replace(/:/g, '__').replace(/\s+/g, '-') + '.pcm';
}

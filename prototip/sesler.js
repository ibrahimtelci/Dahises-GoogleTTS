// Faz 0 madde 9 — hangi Türkçe sesler var, hangi tiyerde, doğal örnekleme hızı ne?
// Banka formatı seçilen sesin doğal hızıyla birebir aynı olmak zorunda (§6.6).
//
// Kullanım:  node sesler.js

import { sesleriListele } from './src/google.js';

const TIYER = (ad) => {
  if (ad.includes('Chirp3-HD') || ad.includes('Chirp-HD')) return 'Chirp 3 HD';
  if (ad.includes('Studio')) return 'Studio';
  if (ad.includes('Neural2')) return 'Neural2';
  if (ad.includes('Wavenet')) return 'WaveNet';
  if (ad.includes('Standard')) return 'Standard';
  return 'diğer';
};

let sesler;
try {
  sesler = await sesleriListele('tr-TR');
} catch (hata) {
  console.error('\n' + hata.message + '\n');
  process.exit(1);
}

if (sesler.length === 0) {
  console.log('tr-TR için ses bulunamadı.');
  process.exit(1);
}

const gruplar = new Map();
for (const ses of sesler) {
  const tiyer = TIYER(ses.name);
  if (!gruplar.has(tiyer)) gruplar.set(tiyer, []);
  gruplar.get(tiyer).push(ses);
}

console.log('\ntr-TR sesleri (' + sesler.length + ' adet)\n');

for (const [tiyer, liste] of gruplar) {
  console.log('── ' + tiyer + ' ' + '─'.repeat(Math.max(0, 50 - tiyer.length)));
  for (const ses of liste.sort((a, b) => a.name.localeCompare(b.name))) {
    const cinsiyet = (ses.ssmlGender ?? '?').padEnd(7);
    const hiz = String(ses.naturalSampleRateHertz ?? '?').padStart(6);
    console.log('  ' + ses.name.padEnd(28) + cinsiyet + hiz + ' Hz');
  }
  console.log('');
}

const hizlar = [...new Set(sesler.map((s) => s.naturalSampleRateHertz))];
console.log('Doğal örnekleme hızları: ' + hizlar.join(', ') + ' Hz');
console.log('Kadın: ' + sesler.filter((s) => s.ssmlGender === 'FEMALE').length +
            '  Erkek: ' + sesler.filter((s) => s.ssmlGender === 'MALE').length);
console.log('\nBANKA_ORNEKLEME_HIZI olarak seçtiğin sesin hızını kullan (§6.6).');

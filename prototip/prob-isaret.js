// Sınama: Google TTS, SSML <mark> etiketleri için zaman damgası döndürüyor mu?
//
// Döndürüyorsa parçaları tam cümle içinde ürettirip tam yerinden kesebiliriz —
// klip cümle ortası tonlamasını taşır, yalıtılmış sentezin "bitmiş cümle" etkisi kalkar.
//
//   node prob-isaret.js

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

{
  const envYolu = fileURLToPath(new URL('./.env', import.meta.url));
  if (existsSync(envYolu)) process.loadEnvFile(envYolu);
}

const ANAHTAR = process.env.GOOGLE_TTS_API_KEY;
if (!ANAHTAR) {
  console.error('GOOGLE_TTS_API_KEY yok.');
  process.exit(1);
}

const SSML = '<speak>sayın <mark name="ad_bas"/>Mehmet<mark name="ad_son"/> ' +
             '<mark name="soyad_bas"/>Karabulut<mark name="soyad_son"/> lütfen ' +
             '<mark name="sayi_bas"/>üç<mark name="sayi_son"/> nolu bankoya geçiniz.</speak>';

const govde = {
  input: { ssml: SSML },
  voice: { languageCode: 'tr-TR', name: 'tr-TR-Standard-A' },
  audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 },
  enableTimePointing: ['SSML_MARK'],
};

for (const surum of ['v1beta1', 'v1']) {
  const url = 'https://texttospeech.googleapis.com/' + surum +
              '/text:synthesize?key=' + encodeURIComponent(ANAHTAR);
  process.stdout.write('\n── ' + surum + ' ──\n');

  const yanit = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(govde),
  });

  if (!yanit.ok) {
    console.log('  HTTP ' + yanit.status + ': ' + (await yanit.text()).slice(0, 300));
    continue;
  }

  const veri = await yanit.json();
  const damgalar = veri.timepoints ?? [];

  console.log('  ses geldi: ' + (veri.audioContent ? 'evet' : 'hayır'));
  console.log('  zaman damgası sayısı: ' + damgalar.length);
  for (const d of damgalar) {
    console.log('    ' + String(d.markName).padEnd(12) + Number(d.timeSeconds).toFixed(3) + ' sn');
  }
  if (damgalar.length === 0) {
    console.log('  (SSML kabul edildi ama damga dönmedi — bu sürümde desteklenmiyor olabilir)');
  }
}

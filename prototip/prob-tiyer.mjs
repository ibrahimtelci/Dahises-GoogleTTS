// Hangi tiyerler SSML <mark> zaman damgasi destekliyor?
// Kesme yontemi buna bagli; desteklemeyen tiyer bu mimaride kullanilamaz.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
{
  const p = fileURLToPath(new URL('./.env', import.meta.url));
  if (existsSync(p)) process.loadEnvFile(p);
}
const ANAHTAR = process.env.GOOGLE_TTS_API_KEY;

const SSML = '<speak><mark name="m0"/>sayın <mark name="m1"/>Mehmet <mark name="m2"/>Karabulut '
           + '<mark name="m3"/>lütfen <mark name="m4"/>üç <mark name="m5"/>nolu bankoya geçiniz.</speak>';

const SESLER = [
  ['Standard',   'tr-TR-Standard-A'],
  ['WaveNet',    'tr-TR-Wavenet-D'],
  ['Chirp 3 HD', 'tr-TR-Chirp3-HD-Achernar'],
  ['Chirp 3 HD', 'tr-TR-Chirp3-HD-Kore'],
];

for (const [tiyer, ses] of SESLER) {
  const yanit = await fetch(
    'https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=' + encodeURIComponent(ANAHTAR),
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { ssml: SSML },
        voice: { languageCode: 'tr-TR', name: ses },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 },
        enableTimePointing: ['SSML_MARK'],
      }) });

  process.stdout.write('  ' + tiyer.padEnd(12) + ses.padEnd(28));
  if (!yanit.ok) {
    const m = await yanit.text();
    const kisa = (JSON.parse(m).error?.message ?? m).slice(0, 90);
    console.log('HATA ' + yanit.status + ' — ' + kisa);
    continue;
  }
  const v = await yanit.json();
  const d = v.timepoints ?? [];
  console.log('ses:' + (v.audioContent ? 'var' : 'yok') + '  damga:' + d.length +
              (d.length >= 5 ? '  → KESME MÜMKÜN' : '  → kesme YAPILAMAZ'));
}

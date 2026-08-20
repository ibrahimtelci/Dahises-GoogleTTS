// Google Cloud TTS — REST üzerinden, sıfır npm bağımlılığı (Node 18+ yerleşik fetch).
//
// İki kimlik yolu desteklenir:
//   GOOGLE_TTS_API_KEY            → basit, prototip için yeterli
//   GOOGLE_APPLICATION_CREDENTIALS → service account JSON yolu (kurumsal)

import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// prototip/.env varsa otomatik yükle — kimliği kabuğa her seferinde export etmeye gerek kalmasın.
// Dosya .gitignore'da; anahtar depoya girmez.
{
  const envYolu = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(envYolu)) process.loadEnvFile(envYolu);
}

const UC = 'https://texttospeech.googleapis.com/v1';

// Kota koruması: bu prototip hiçbir koşulda bu kadar karakterden fazlasını göndermez.
const KARAKTER_TAVANI = 8000;
let harcananKarakter = 0;

export function harcanan() {
  return harcananKarakter;
}

function b64url(x) {
  return Buffer.from(x).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let tokenOnbellek = null;

async function servisHesabiTokeni(anahtarYolu) {
  if (tokenOnbellek && tokenOnbellek.bitis > Date.now() + 60_000) return tokenOnbellek.token;

  const anahtar = JSON.parse(readFileSync(anahtarYolu, 'utf8'));
  const simdi = Math.floor(Date.now() / 1000);
  const baslik = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const iddia = b64url(JSON.stringify({
    iss: anahtar.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: simdi + 3600,
    iat: simdi,
  }));
  const imza = b64url(createSign('RSA-SHA256').update(baslik + '.' + iddia).sign(anahtar.private_key));

  const yanit = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: baslik + '.' + iddia + '.' + imza,
    }),
  });
  if (!yanit.ok) throw new Error('OAuth başarısız: ' + yanit.status + ' ' + await yanit.text());

  const veri = await yanit.json();
  tokenOnbellek = { token: veri.access_token, bitis: Date.now() + veri.expires_in * 1000 };
  return tokenOnbellek.token;
}

async function istek(yol, govde) {
  const apiAnahtari = process.env.GOOGLE_TTS_API_KEY;
  const servisHesabi = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  let url = UC + yol;
  const basliklar = { 'content-type': 'application/json' };

  if (apiAnahtari) {
    url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(apiAnahtari);
  } else if (servisHesabi) {
    basliklar.authorization = 'Bearer ' + await servisHesabiTokeni(servisHesabi);
  } else {
    throw new Error(
      'Kimlik yok. GOOGLE_TTS_API_KEY veya GOOGLE_APPLICATION_CREDENTIALS ayarla.\n' +
      'Ayrıntı için prototip/README.md'
    );
  }

  const yanit = await fetch(url, {
    method: govde ? 'POST' : 'GET',
    headers: basliklar,
    body: govde ? JSON.stringify(govde) : undefined,
  });

  if (!yanit.ok) {
    const metin = await yanit.text();
    throw new Error('Google TTS hatası ' + yanit.status + ': ' + metin);
  }
  return yanit.json();
}

// Faz 0 madde 9 — hangi Türkçe sesler var, doğal örnekleme hızları ne?
export async function sesleriListele(dil = 'tr-TR') {
  const veri = await istek('/voices?languageCode=' + encodeURIComponent(dil));
  return veri.voices ?? [];
}

// LINEAR16 yanıtı RIFF başlıklı gelir; ham PCM'e indir.
function riffPcmCikar(tampon) {
  if (tampon.length < 12 || tampon.toString('ascii', 0, 4) !== 'RIFF') return tampon;
  let konum = 12;
  while (konum + 8 <= tampon.length) {
    const parcaAdi = tampon.toString('ascii', konum, konum + 4);
    const parcaBoyu = tampon.readUInt32LE(konum + 4);
    if (parcaAdi === 'data') return tampon.subarray(konum + 8, konum + 8 + parcaBoyu);
    konum += 8 + parcaBoyu + (parcaBoyu % 2);
  }
  return tampon;
}

/**
 * Tek bir metni seslendirir, ham PCM (mono 16-bit LE) döner.
 * @param {string} metin
 * @param {{ses: string, ornekHizi: number, hiz?: number}} secenekler
 */
export async function sentezle(metin, { ses, ornekHizi, hiz }) {
  if (harcananKarakter + metin.length > KARAKTER_TAVANI) {
    throw new Error(
      'Karakter tavanı aşılacaktı (' + KARAKTER_TAVANI + '). ' +
      'Harcanan: ' + harcananKarakter + ', istenen: ' + metin.length + '. ' +
      'Bu prototipin kasıtlı bir güvenlik sınırıdır — toplu üretim için değil.'
    );
  }
  harcananKarakter += metin.length;

  const veri = await istek('/text:synthesize', {
    input: { text: metin },
    voice: { languageCode: 'tr-TR', name: ses },
    audioConfig: {
      audioEncoding: 'LINEAR16',
      sampleRateHertz: ornekHizi,
      ...(hiz ? { speakingRate: hiz } : {}),
    },
  });

  return riffPcmCikar(Buffer.from(veri.audioContent, 'base64'));
}

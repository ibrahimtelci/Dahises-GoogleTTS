// Standard vs WaveNet: ayni cumle, ayni ayar, arka arkaya tek dosyada.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { wavYaz, pcmUzunlukSn } from './src/ses.js';

const HIZ = 24000;
const HEDEF = join('cikti', 'tiyer-karsilastirma');
mkdirSync(HEDEF, { recursive: true });

const wavPcm = (yol) => readFileSync(yol).subarray(44);
const sessizlik = (sn) => Buffer.alloc(Math.round(HIZ * sn) * 2);

const CUMLELER = ['ayse-ozturk-bir', 'mehmet-yilmaz-yedi', 'huseyin-celik-on-iki'];
const A = 'tr-TR-Standard-A';
const B = 'tr-TR-Wavenet-D';

console.log('\n  cumle                      Standard   WaveNet');
for (const c of CUMLELER) {
  const a = wavPcm(join('cikti', 'kesme', A, 'K1-es-yok__' + c + '.wav'));
  const b = wavPcm(join('cikti', 'kesme', B, 'K1-es-yok__' + c + '.wav'));

  writeFileSync(join(HEDEF, 'standard-vs-wavenet__' + c + '.wav'),
    wavYaz(Buffer.concat([a, sessizlik(0.9), b]), HIZ));

  console.log('  ' + c.padEnd(26) +
    pcmUzunlukSn(a, HIZ).toFixed(2) + ' sn'.padEnd(6) + '   ' +
    pcmUzunlukSn(b, HIZ).toFixed(2) + ' sn');
}

// Referanslar da yan yana: her tiyerin GERCEK tam cumlesi (kesme degil)
for (const c of CUMLELER.slice(0, 1)) {
  const a = readFileSync(join('cikti', 'kesme', A, 'onbellek', 'referans-' + c + '.pcm'));
  const b = readFileSync(join('cikti', 'kesme', B, 'onbellek', 'referans-' + c + '.pcm'));
  writeFileSync(join(HEDEF, 'REFERANS-standard-vs-wavenet.wav'),
    wavYaz(Buffer.concat([a, sessizlik(0.9), b]), HIZ));
}

console.log('\n  ONCE Standard, 0,9 sn ara, SONRA WaveNet');
console.log('  ' + HEDEF + '\n');

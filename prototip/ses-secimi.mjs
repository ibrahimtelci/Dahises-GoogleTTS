// Standard tiyerindeki bes sesi yan yana koyar: hem dogal tam cumle, hem kesme-birlestirme.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { wavYaz, pcmUzunlukSn } from './src/ses.js';

const HIZ = 24000;
const HEDEF = join('cikti', 'ses-secimi');
mkdirSync(HEDEF, { recursive: true });

const SESLER = [
  ['tr-TR-Standard-A', 'kadin'],
  ['tr-TR-Standard-C', 'kadin'],
  ['tr-TR-Standard-D', 'kadin'],
  ['tr-TR-Standard-B', 'erkek'],
  ['tr-TR-Standard-E', 'erkek'],
];
const CUMLE = 'ayse-ozturk-bir';   // "sayin Ayse Ozturk lutfen bir nolu bankoya geciniz"

const sessizlik = (sn) => Buffer.alloc(Math.round(HIZ * sn) * 2);
const wavPcm = (y) => readFileSync(y).subarray(44);

const referanslar = [];
const birlesikler = [];

console.log('\n  ses                  cinsiyet   referans   birlesik');
console.log('  ' + '-'.repeat(56));

for (const [ses, cinsiyet] of SESLER) {
  const refYol = join('cikti', 'kesme', ses, 'onbellek', 'referans-' + CUMLE + '.pcm');
  const birYol = join('cikti', 'kesme', ses, 'K1-es-yok__' + CUMLE + '.wav');
  if (!existsSync(refYol) || !existsSync(birYol)) { console.log('  ' + ses + ' EKSIK'); continue; }

  const ref = readFileSync(refYol);
  const bir = wavPcm(birYol);

  // Tek ses, tek dosya: once dogal cumle, sonra kesme-birlestirme
  writeFileSync(join(HEDEF, ses + '.wav'),
    wavYaz(Buffer.concat([ref, sessizlik(0.8), bir]), HIZ));

  referanslar.push(ref, sessizlik(1.2));
  birlesikler.push(bir, sessizlik(1.2));

  console.log('  ' + ses.padEnd(21) + cinsiyet.padEnd(11) +
    pcmUzunlukSn(ref, HIZ).toFixed(2) + ' sn    ' + pcmUzunlukSn(bir, HIZ).toFixed(2) + ' sn');
}

writeFileSync(join(HEDEF, 'TUMU-referans.wav'), wavYaz(Buffer.concat(referanslar), HIZ));
writeFileSync(join(HEDEF, 'TUMU-birlesik.wav'), wavYaz(Buffer.concat(birlesikler), HIZ));

console.log('\n  sira: A(K) -> C(K) -> D(K) -> B(E) -> E(E)');
console.log('  ' + HEDEF + '\n');

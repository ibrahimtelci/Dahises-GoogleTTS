// Google'a karsi TEK SEFERLIK dogrulama — butce bekcisinin altinda calisir.
//
//   node --env-file=.env betikler/google-dogrula.ts
//
// 1. listVoices (UCRETSIZ, ses uretmez): kac Turkce ses var, ornekleme hizlari,
//    Chirp 3 HD isaretlenmis mi
// 2. TEK tasiyici cumle: v1beta1 + enableTimePointing gercekten damga donuyor mu
//
// Ikinci adim butceden dusulur. Betik butce yetmezse istek gondermez.

import { resolve } from 'node:path';

import { yapilandirma } from '../paketler/tts-merkez/src/yapilandirma.ts';
import { ButceBekcisi } from '../paketler/tts-merkez/src/motor/butce.ts';
import { GoogleMotoru, kesmeDestekliyorMu } from '../paketler/tts-merkez/src/motor/google.ts';
import type { SesProfili } from '../paketler/tts-merkez/src/motor/arayuz.ts';
import { parcalariKes, tasiyiciKur } from '../paketler/tts-merkez/src/ses/kesme.ts';
import { pcmUzunlukMs, pcmUzunlukSn } from '../paketler/tts-merkez/src/ses/pcm.ts';

const ayar = yapilandirma();
const bankaDizini = resolve(process.cwd(), ayar.BANKA_DIZINI);
const butce = new ButceBekcisi(ButceBekcisi.varsayilanYol(bankaDizini), ayar.GOOGLE_KLIP_BUTCESI);
await butce.yukle();

console.log('Bütçe (başlangıç):', JSON.stringify(butce.durum()));

const motor = new GoogleMotoru({
  apiAnahtari: ayar.GOOGLE_TTS_API_KEY,
  servisHesabiYolu: ayar.GOOGLE_APPLICATION_CREDENTIALS,
  dilKodu: ayar.DIL_KODU,
  eszamanlilik: ayar.GOOGLE_ESZAMANLILIK,
  saniyedeIstek: ayar.GOOGLE_ISTEK_HIZI_SN,
  butce,
});

// ── 1. Ses listesi — ucretsiz ──────────────────────────────────────────────
console.log('\n── listVoices(' + ayar.DIL_KODU + ') ──');
const sesler = await motor.sesleriListele(ayar.DIL_KODU);
console.log('Toplam ses:', sesler.length);

const tiyerSayilari = new Map<string, number>();
const hizlar = new Set<number>();
for (const s of sesler) {
  tiyerSayilari.set(s.tiyer, (tiyerSayilari.get(s.tiyer) ?? 0) + 1);
  hizlar.add(s.dogalOrnekHizi);
}
console.log('Tiyer dağılımı:', Object.fromEntries(tiyerSayilari));
console.log('Görülen örnekleme hızları:', [...hizlar].join(', '));
console.log(
  'Kesme desteklemeyen (Chirp 3 HD):',
  sesler.filter((s) => !s.kesmeDestegi).length,
);
console.log(
  'Kesme destekleyen örnekler:',
  sesler.filter((s) => s.kesmeDestegi).map((s) => s.ad).slice(0, 6).join(', '),
);

// ── 2. Tek taşıyıcı cümle — damga doğrulaması ─────────────────────────────
const YUVALAR = [
  { yuva: 'kalip:sayın', metin: 'sayın' },
  { yuva: 'ad', metin: 'Mehmet' },
  { yuva: 'soyad', metin: "O'Brien" }, // XML kaçışı gerçek istekte de sınansın
  { yuva: 'kalip:lütfen', metin: 'lütfen' },
  { yuva: 'sayi', metin: 'üç' },
  { yuva: 'kalip:nolu bankoya geçiniz', metin: 'nolu bankoya geçiniz' },
];

const sesAdi = ayar.DIL_KODU + '-Standard-A';
const profil: SesProfili = {
  id: 'dogrulama',
  motor: 'google',
  motorSesi: sesAdi,
  tiyer: 'standard',
  ornekHizi: ayar.BANKA_ORNEKLEME_HIZI,
};

console.log('\n── Taşıyıcı cümle (v1beta1 + enableTimePointing) ──');
console.log('Ses:', sesAdi, '· kesme desteği:', kesmeDestekliyorMu(sesAdi));

const { ssml, yuvalar, karakter } = tasiyiciKur(YUVALAR);
console.log('SSML:', ssml);
console.log('Karakter (Google sayar):', karakter);

if (!(await butce.yeterMi(YUVALAR.length))) {
  console.log('\nBÜTÇE YETMİYOR — istek gönderilmedi.');
  process.exit(0);
}

const yanit = await motor.ssmlSentezle(ssml, profil, YUVALAR.length);

console.log('\nPCM:', yanit.pcm.length, 'bayt ·', pcmUzunlukSn(yanit.pcm, profil.ornekHizi).toFixed(2), 'sn');
console.log('Dönen damga sayısı:', yanit.damgalar.length, '(beklenen ' + YUVALAR.length + ')');
console.log('Damgalar:', JSON.stringify(yanit.damgalar));

const parcalar = parcalariKes(yanit.pcm, yanit.damgalar, yuvalar, {
  hiz: profil.ornekHizi,
  kuyrukMs: ayar.KESME_KUYRUK_MS,
});

console.log('\nKesilen parçalar:');
for (const p of parcalar) {
  console.log(
    '  ' + p.yuva.padEnd(28) + String(p.metin).padEnd(22) +
      String(pcmUzunlukMs(p.pcm, profil.ornekHizi)).padStart(5) + ' ms' +
      '   [' + p.baslangicMs + '–' + p.bitisMs + ']',
  );
}

const sifirParca = parcalar.filter((p) => p.pcm.length === 0);
console.log('\nBoş çıkan parça:', sifirParca.length);
console.log('Bütçe (bitiş):', JSON.stringify(butce.durum()));
console.log(
  '\nSONUÇ: ' +
    (yanit.damgalar.length === YUVALAR.length && sifirParca.length === 0
      ? 'TAMAM — v1beta1 damgaları geldi, kesme çalışıyor.'
      : 'SORUN — damga sayısı veya parça boyu beklenenden farklı.'),
);

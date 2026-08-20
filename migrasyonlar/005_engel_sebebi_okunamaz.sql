-- 005 — Engel sebeplerine 'okunamaz' eklendi.
--
-- Gerekce: normalizasyon sonrasi Turkce alfabe disi karakter kalan tokenlar
-- (tek basina '&', rakam, noktalama artigi) 'latin_disi' diye etiketleniyordu.
-- Bu yaniltici: Kiril/Arap harfi iceren kayitla, ayristirma artigi olan kayit
-- ayni kovaya giriyordu ve arayuzde sebep yanlis okunuyordu.

ALTER TABLE engellenen DROP CONSTRAINT engellenen_sebep_gecerli;

ALTER TABLE engellenen ADD CONSTRAINT engellenen_sebep_gecerli CHECK (
  sebep IN ('maskeli', 'kisaltilmis', 'test', 'latin_disi', 'okunamaz', 'elle')
);

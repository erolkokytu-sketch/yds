# Handoff status

Updated: 2026-09-27

## Current task

Recoverable full-exam collection is complete. Player/PWA/UI was not changed.

## Ready full packs

- 2013 YDS İlkbahar İngilizce — 80/80 — `private-exam-packs/2013-yds-ilkbahar-ingilizce.ydspack`
- 2006 ÖSYS YDS İngilizce — 100/100 — `private-exam-packs/2006-osys-yds-ingilizce.ydspack`
- 2007 ÖSYS YDS İngilizce — 100/100 — `private-exam-packs/2007-osys-yds-ingilizce.ydspack`
- 2008 ÖSYS YDS İngilizce — 100/100 — `private-exam-packs/2008-osys-yds-ingilizce.ydspack`
- 2009 ÖSYS YDS İngilizce — 100/100 — `private-exam-packs/2009-osys-yds-ingilizce.ydspack`
- Akın Dil 2022 YDS Deneme 1 — 80/80 — `private-exam-packs/akin-dil-2022-yds-deneme-1.ydspack`
- Ankara Dil Nisan 2021 YDS Denemesi — 80/80 — `private-exam-packs/ankara-dil-2021-nisan-yds-denemesi.ydspack`

Send list: `private-exam-packs/READY_TO_SEND.txt`

## Unresolved

- 2013 YDS Sonbahar — OCR_REQUIRED. Selectable text missing on most question pages (14/80 stems, 0 options). Do not invent text.
- 2014–2026 public 10% releases — excluded, not full exams.

## Parser / schema changes

- Schema year minimum is 2006. 2013 remains valid. Years before 2006 fail.
- `A.` abbreviations are not option markers. Real options stay `A)`.
- Full-width rows whose gutter gap is word spacing are not split into the opposite column.
- Lone booklet letters are not appended to options.

2006 and 2007 still emit page-boundary-split warnings. Those joins were checked and are not contamination. They were finalized with `--reviewed`. Critical errors were not overridden.

## Tests

162 passed, 0 failed. Lint PASS. Typecheck PASS. Production build PASS.

## Next exact command

Do not start another feature. Send the app link and the files listed in `private-exam-packs/READY_TO_SEND.txt`.

## Last safe git commit

See `git log -1` after the legacy-exam checkpoint.

## Uncommitted source files

None after the checkpoint commit. Real PDFs and `.ydspack` files stay ignored. Nested `yds/` must not be added.

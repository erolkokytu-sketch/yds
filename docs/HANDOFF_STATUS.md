# Handoff status

Updated: 2026-09-27

## Current task

Full exam batch. Parser was not rewritten. Three generic extraction fixes were applied after concrete batch failures. Player/PWA/UI was not changed.

## Exams processed

Full 80/100 candidates only. 2014–2026 public 10% releases were not treated as full exams.

| Exam | Status | Questions | Answers | Reason |
|---|---|---:|---:|---|
| 2013 YDS İlkbahar İngilizce | PACKED | 80 | 80 | Existing pack; re-extraction matches |
| 2013 YDS Sonbahar İngilizce | REVIEW_REQUIRED | 14 | 0 | Selectable text missing on most question pages |
| 2006 ÖSYS YDS İngilizce | REVIEW_REQUIRED | 100 | 100 | Schema year minimum 2013; Q3/Q97/Q98 option warnings |
| 2007 ÖSYS YDS İngilizce | REVIEW_REQUIRED | 100 | 100 | Schema year minimum 2013; Q3/Q81/Q98 option warnings |
| 2008 ÖSYS YDS İngilizce | REVIEW_REQUIRED | 100 | 100 | Schema year minimum 2013; Q3 option E length outlier |
| 2009 ÖSYS YDS İngilizce | REVIEW_REQUIRED | 100 | 100 | Schema year minimum 2013; Q3 option E length outlier |
| Akın Dil 2022 YDS Deneme 1 | PACKED | 80 | 80 | `private-exam-packs/akin-dil-2022-yds-deneme-1.ydspack` |
| Ankara Dil Nisan 2021 YDS Denemesi | PACKED | 80 | 80 | `private-exam-packs/ankara-dil-2021-nisan-yds-denemesi.ydspack` |

PACKED: 3. REVIEW_REQUIRED: 5. FAILED: 0. AMBIGUOUS / MISSING KEY among full exams: 0.

## Parser changes

- Decimal quantities such as `2.3` are not question starts.
- Passage headings may wrap across a few instruction lines.
- Ordinal centuries such as `15. yüzyıl` are not column-crossover contamination.
- A line built from repeated margin fragments is removed.

## Tests

159 passed, 0 failed. Lint PASS. Typecheck PASS. Production build PASS.

Representative 2013 İlkbahar re-extraction matches the existing pack. SoruLab v2 packs validate.

## Next exact command

Do not start another feature. Manual device import of:

- `private-exam-packs/2013-yds-ilkbahar-ingilizce.ydspack`
- `private-exam-packs/akin-dil-2022-yds-deneme-1.ydspack`
- `private-exam-packs/ankara-dil-2021-nisan-yds-denemesi.ydspack`

## Last safe git commit

See `git log -1` after the full-exam checkpoint. Previous checkpoint was `82e5000`.

## Uncommitted source files

None after the checkpoint commit. `YDS_Arsivi/`, `private-exam-packs/`, and `work/` stay ignored. Nested `yds/` is an unrelated untracked directory and must not be added.

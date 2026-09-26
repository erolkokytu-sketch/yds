# YDS English exam research

Status: `VERIFIED_FOR_PHASE_1`
Research/access date: 2026-09-26
Scope: ÖSYM YDS English paper exams and their public official materials. e-YDS is noted only where it establishes a format or duration change.

## Executive findings

- YDS was introduced in 2013 under the regulation published in Official Gazette no. 28518. ÖSYM stated that YDS replaced its other general foreign-language proficiency exams such as KPDS and ÜDS from 2013 onward.
- The English paper exam is a five-option, 80-question multiple-choice test. Wrong answers do not reduce the score.
- The 2013–2016 English papers examined use the same stable 80-question section layout documented below.
- Duration is not historically constant: 2013 through the 2016 spring paper used 150 minutes. ÖSYM extended YDS/e-YDS to 180 minutes effective from the 16 July 2016 e-YDS and 4 September 2016 paper YDS. Current packs must therefore store a verified per-exam duration; the app must not hard-code 180 minutes.
- ÖSYM publicly released complete English question/answer PDFs for 2013 spring and autumn. From 2014 onward, the public PDFs found in the official archive expose only 10% of the questions/answers (the document may still show the 80-question skeleton). They are not complete importable exams.
- Recent ÖSYM announcements state that registered candidates may see all questions in AİS for a limited period (typically 10 days), while the public receives 10%. Questions remain copyrighted by ÖSYM. No official content should ship in the public application shell without permission.

## Establishment and historical changes

1. ÖSYM's [4 January 2013 announcement](https://www.osym.gov.tr/TR%2C624/basin-duyurusu-2013-yabanci-dil-bilgisi-seviye-belirleme-sinavi-4-ocak-2013.html) says the governing regulation was published that day and the first YDS was planned for 7 April 2013. It also says KPDS/ÜDS-style separate exams would no longer be held by ÖSYM.
2. The official [2013 spring English PDF](https://dokuman.osym.gov.tr/web/eskidosyalar/2434.pdf) states 80 questions, 150 minutes, one correct option per question, and scoring by correct answers only.
3. The official [2013 autumn English PDF](https://dokuman.osym.gov.tr/web/eskidosyalar/2453.pdf) states the same rules.
4. The official [2014 spring English PDF](https://dokuman.osym.gov.tr/pdfdokuman/2014/YDS/YDS_2014_NISAN_INGILIZCE.pdf) and [2015 spring English PDF](https://dokuman.osym.gov.tr/pdfdokuman/2015/YDS/ILKBAHAR/KITAP/2015_1_INGILIZCE.pdf) also state 80 questions and 150 minutes.
5. A 28 June 2016 [Anadolu Agency report quoting the ÖSYM decision](https://www.aa.com.tr/tr/egitim/yds-sinavinin-suresi-uzatildi/598879) records the change from 150 to 180 minutes without changing the 80 questions. This is corroborated by ÖSYM's pre-change [e-YDS 2016/5 announcement](https://www.osym.gov.tr/TR%2C10236/e-yds-20165-basvurulari-28042016.html) (150 minutes), the official 4 September 2016 paper in the source inventory, and ÖSYM's post-change [e-YDS 2017/8 announcement](https://www.osym.gov.tr/eyds-20178-basvurulari) (180 minutes).
6. ÖSYM added third paper administrations in 2018 and 2019 (`YDS/3`). The official archive identifies both public English PDFs as 10% releases. The current archive otherwise groups paper administrations as `YDS/1` and `YDS/2`; 2025 additionally has a separately named English administration.

## Verified English question structure

The ranges below are present in both the 2013 full English paper and the official 2025 English public PDF, showing that the top-level section layout remained stable across those endpoints.

| Questions | Count | Type | Data-model consequence |
|---|---:|---|---|
| 1–6 | 6 | Vocabulary / expression in one sentence | Standalone question |
| 7–16 | 10 | Grammar, connectors, prepositions, paired expressions | Standalone question |
| 17–21 | 5 | Cloze passage 1 | One shared passage, five linked questions |
| 22–26 | 5 | Cloze passage 2 | One shared passage, five linked questions |
| 27–36 | 10 | Sentence completion | Standalone question |
| 37–42 | 6 | English↔Turkish translation | Direction metadata is required |
| 43–62 | 20 | Reading comprehension | Five shared passages, four linked questions each |
| 63–67 | 5 | Dialogue completion | Structured dialogue content is useful |
| 68–71 | 4 | Restatement / closest meaning | Standalone question |
| 72–75 | 4 | Paragraph completion | Standalone passage question |
| 76–80 | 5 | Irrelevant sentence in a paragraph | Sentence labels/order must be preserved |
| **Total** | **80** |  | Five choices (A–E) per normal question |

The source PDFs support a shared-content model: cloze and reading-comprehension passages must be stored once and referenced by multiple questions. PDF visual order must not be treated as semantic order without validation because two-column layouts can interleave extracted text.

## Scoring

Verified rules from the official 2013/2014/2015 English paper instructions:

- A question has one correct answer.
- Multiple marks for one question count as wrong.
- Evaluation uses the number of correct answers; wrong answers are ignored (no negative marking).
- The official result is on a 0–100 scale. For an ordinary, non-cancelled 80-question paper this implies `correct × 100 / 80`, i.e. `correct × 1.25`.

Implementation constraint: do not assume the last formula when ÖSYM has cancelled a question or issued a revised key. A pack may expose a numeric score only when it contains a versioned, verified scoring rule and a verified final answer key. Otherwise show correct/wrong/blank counts and mark the score unavailable.

The governing regulation also defines public-service language bands, but they are not required for the exam player. If later displayed, the exact current consolidated regulation must be re-checked rather than inferred from third-party summaries.

## Public availability and copyright

- The official 2013 publication pages provide full books and answer keys: [spring](https://www.osym.gov.tr/2013yds-ilkbahar-donemi-soru-kitapciklari-ve-yanitlari) and [autumn](https://www.osym.gov.tr/2013yds-sonbahar-donemi-soru-kitapciklari-ve-yanitlari).
- ÖSYM's 2013 publication notice explicitly reserves copyright and prohibits copying, reproducing, publishing, or using the questions without written permission.
- The [2025 English notice](https://www.osym.gov.tr/2025ydsingilizce-temel-soru-kitapcigi-ve-cevap-anahtari-yayimlandi) says the public release is 10%, full access for candidates is time-limited in AİS, and the questions are protected works owned by ÖSYM.
- Therefore, “publicly downloadable from ÖSYM” is not equivalent to “licensed for republication in this app.” The repository must contain no official question text. Importing a user's local material remains a private user action; the tool must retain provenance and must never relabel an unverified source as official.

## Consequences for later phases

- `durationMinutes` is mandatory and provenance-backed; reject `UNKNOWN` for a ready exam.
- `questionCount` is mandatory; an official English paper normally expects 80, but this is a validation expectation, not a universal schema constant.
- Each normal question requires exactly five unique choices A–E and one verified answer for a scoreable pack.
- Shared passages need stable IDs and ordered question references.
- Source metadata needs `publisher`, publication page/PDF URLs, access date, release scope (`full`, `public-10-percent`, `candidate-limited`, `private-user-source`), verification status, and answer-key revision information.
- Official identity and content completeness are separate flags. A public 10% ÖSYM PDF is official but is not a complete exam pack.
- Packs generated from AI-authored material must be labelled `AI Deneme`; AI may not manufacture missing official text or answers.

## Known unknowns / deferred verification

- Exact duration was not independently read from every partial public PDF in the inventory. Rows therefore use the verified policy period: 150 through 2016 spring and 180 from 2016 autumn onward.
- The exact consolidated wording of every scoring edge case (especially cancelled questions) will be re-checked against the guide belonging to a specific imported exam before a scoring rule is marked verified.
- AİS candidate-only full books are not treated as public downloadable sources and were not accessed.
- e-YDS question banks are outside the current paper-exam source inventory.

## Primary source index

- [ÖSYM: YDS establishment announcement](https://www.osym.gov.tr/TR%2C624/basin-duyurusu-2013-yabanci-dil-bilgisi-seviye-belirleme-sinavi-4-ocak-2013.html)
- [ÖSYM: 2013 spring full English paper](https://dokuman.osym.gov.tr/web/eskidosyalar/2434.pdf)
- [ÖSYM: 2013 autumn full English paper](https://dokuman.osym.gov.tr/web/eskidosyalar/2453.pdf)
- [ÖSYM: historical spring question archive](https://www.osym.gov.tr/SinavGrubu/Menu/860)
- [ÖSYM: historical autumn question archive](https://www.osym.gov.tr/SinavGrubu/Menu/863)
- [ÖSYM: YDS/1 question archive](https://www.osym.gov.tr/SinavGrubu/Menu/848)
- [ÖSYM: YDS/2 question archive](https://www.osym.gov.tr/SinavGrubu/Menu/851)
- [ÖSYM: YDS/3 question archive](https://www.osym.gov.tr/SinavGrubu/Menu/854)
- [ÖSYM: 2025 English public paper](https://dokuman.osym.gov.tr/pdfdokuman/2025/YDS-INGILIZCE/yds_ing_kitapcik05072025.pdf)

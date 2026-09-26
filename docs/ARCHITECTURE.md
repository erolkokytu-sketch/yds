# YDS Player architecture

Status: `PHASE_8_PDF_PREPARATION_BASELINE`

## Constraints and boundaries

- The product is a local-first PWA with no backend.
- Exam playback has no runtime AI, API, account, or network dependency.
- Official question text is not bundled. Development and tests use original dummy content.
- Exam content is immutable after import; user state lives only in an Exam Session.
- v1 is text-only UTF-8. Rich media or structured inline formatting requires a later schema version.

## YDS Player PWA

The future player reads validated Exam Packs from IndexedDB, creates a separate Exam Session, and renders questions in the pack's declared order. It never edits the pack. Navigation, answer selection, flags, timer transitions, completion, and result calculation update the session transactionally.

Main runtime boundaries:

1. `ExamPackRepository`: immutable validated content.
2. `ExamSessionRepository`: mutable user progress.
3. `TimerService`: pure timestamp-based calculations and state transitions.
4. `ScoringService`: reads one answer key; returns `score: null` when scoring metadata is unverified.
5. `BackupService`: portable, versioned export/import.

## Exam Pack format

[`exam-pack.schema.json`](../schemas/exam-pack.schema.json) is JSON Schema Draft 2020-12. v1 contains identity, administration metadata, provenance, duration, scoring metadata, normalized shared content, ordered groups/questions, and one answer key.

Research-driven decisions:

- `durationMinutes` belongs to each pack because paper YDS changed from 150 to 180 minutes in 2016.
- Every question has exactly five choices, A–E.
- `contentBlocks` stores passages/dialogues once; questions reference them by ID.
- `questionGroups` records cloze/reading sets without duplicating shared text.
- Translation direction is optional question metadata.
- Type is controlled but does not affect scoring: `vocabulary`, `grammar`, `cloze`, `sentence_completion`, `translation`, `reading_comprehension`, `dialogue_completion`, `closest_meaning`, `paragraph_completion`, `irrelevant_sentence`, or `other`.
- Partial official releases remain `official` with `source.completeness: partial`; completeness and authenticity are independent.
- Practice packs cannot imply official status. They use `kind: practice` and need no ÖSYM publisher or URL.

Arrays define display order. Explicit question numbers and group/content `order` values preserve source numbering and permit partial packs with non-contiguous question numbers.

## Answer model

Two approaches were considered:

- Answer inside each question: simpler rendering, but mixes public question content with privileged scoring data and complicates key revision.
- Separate answer key: easier to replace/review atomically and easier for the importer to compare with question IDs.

v1 uses exactly one `answerKey.answers` map as the source of truth. Questions contain no correct answer. Validation requires one A–E answer per question, rejects orphan answers, and records key revision/status. A verified key also needs `verifiedAt`.

## Exam Pack import/export

The browser importer is a boundary process, not part of playback:

1. accept a user-selected `.ydspack` (or development `.json`) up to 10 MB;
2. decode strict UTF-8 and parse JSON without executing content;
3. reject unsupported schema versions;
4. run the same JSON Schema and semantic validator used by the CLI;
5. calculate a canonical SHA-256 fingerprint and check ID duplicates/conflicts;
6. show metadata preview;
7. write the immutable pack atomically only after confirmation.

It never fills missing questions/answers, promotes completeness, or infers official identity.
Import failures produce concise diagnostics and no partial record. Object keys are recursively
sorted for fingerprinting; array order remains significant because it defines exam display order.
Filename and installation time are excluded. Export emits only the canonical Exam Pack as
human-readable JSON and never includes sessions, user answers, results, flags, or timers.

## IndexedDB persistence

The implemented database is `yds-study`, version 2, with two stores:

| Store | Key | Content |
|---|---|---|
| `examSessions` | session `id` | Active and terminal attempt snapshots |
| `examPacks` | exam `id` | Immutable installed pack plus `installedAt` and fingerprint |

The v1→v2 upgrade only creates `examPacks`; it does not clear or rewrite `examSessions`, so
active sessions and completed results survive. Session IDs remain independent from exam IDs.

`SessionRepository` and `ExamPackRepository` are the IndexedDB boundaries. Session writes are queued in invocation order;
rapid answer, navigation, flag, pause, resume, and expiration transitions therefore cannot
overwrite a newer snapshot with an older one. Each record adds `storageVersion: 1` and
`updatedAt` to the JSON-serializable session. Unsupported versions and schema-invalid records
are logged and ignored without blocking the app.

Startup has explicit loading, ready, and recoverable error states. Before rendering an exam,
the app loads the latest session for that exam and validates `currentQuestionId` against the
current pack. A running session derives remaining time from its persisted `expectedEndAt`; if
it expired while the app was closed, startup transitions it to `EXPIRED` and writes that state
back. A paused session restores `remainingMsWhenPaused` unchanged. Home shows the active
session state and question with a `Devam Et` action.

Completed attempts remain in the same `examSessions` store under their unique session IDs.
This keeps database version 1 and avoids a destructive migration: active lookup accepts only
`RUNNING`/`PAUSED`, while completed-attempt lookup accepts only `COMPLETED`/`EXPIRED`.
Starting a retake inserts a new session and never overwrites the terminal attempt. Active
sessions take precedence over the latest completed result during hydration.

Home hydrates a library composed of built-in packs plus installed packs. Every Player, timer,
result, review, retake, and persistence path receives the selected `ExamPack`; imported exams
have no special Player implementation. `session.examId` resolves against this library. Deletion
is intentionally absent, so an installed pack cannot become orphaned through the UI.

## Exam Session model

[`exam-session.schema.json`](../schemas/exam-session.schema.json) is separate from Exam Pack. A session references `examId` and `examPackSchemaVersion` and owns:

- current question ID (resolved against the pack at render time);
- selected answers and flagged question IDs;
- lifecycle state and timestamps;
- timer state;
- completion result.

The pack forbids session fields through `additionalProperties: false`; the session likewise cannot contain questions or an answer key. Completed results are snapshots so later UI reads do not silently recalculate historical results against a different pack.

## Completion and results

Manual completion cancels pending auto-advance, freezes the timer, calculates a result, sets
`COMPLETED`, records `completedAt` and `completionReason: manual`, and persists the terminal
snapshot before showing results. Expiration follows the same path with `EXPIRED` and
`completionReason: expired`. Startup also finalizes a legacy Phase 5 session that expired while
closed; finalization is idempotent, so it cannot create duplicate attempts or results.

`calculateExamResult(exam, session)` is pure and reads correct choices only from the Exam
Pack's canonical answer key. A missing user answer is blank, and flags never affect scoring.
Every result enforces:

```text
correct + incorrect + blank = totalQuestions
answered = correct + incorrect
```

A numeric score is included only when both scoring metadata and the final answer key are
verified. `scaled-correct-count` uses the pack's declared maximum score; otherwise score is
`null` and the UI omits it. The sample practice fixture has explicitly verified test scoring.

## Review mode

Review is a separate read-only route. It has no timer, answer, flag, pause, resume, or
auto-advance actions. Each question renders the user's answer and canonical correct answer with
text labels in addition to visual states. Filters for all, incorrect, blank, correct, and flagged
questions change only local UI state; Previous/Next moves only within the filtered set.

## Timer state model

The implemented `expected-end-v1` timer is timestamp-based and JSON-serializable. Its fields have one source-of-truth role each:

| Field | Role |
|---|---|
| session `startedAt` | Immutable audit timestamp for the first start |
| `durationMs` | Immutable duration copied from Exam Pack minutes |
| `expectedEndAt` | Active only while `RUNNING` |
| `pausedAt` | Audit timestamp active only while `PAUSED` |
| `remainingMsWhenPaused` | Frozen remaining time active while `PAUSED`; zero when expired |

The legacy accumulated-time timer shape remains readable in the v1 session schema for backward compatibility, but new sessions use `expected-end-v1`.

Running:

```text
remaining = clamp(expectedEndAt - now, 0, durationMs)
```

Paused:

```text
remaining = remainingMsWhenPaused
```

Resume:

```text
expectedEndAt = now + remainingMsWhenPaused
remainingMsWhenPaused = null
```

Expiration:

```text
remaining <= 0 → EXPIRED, displayed as 00:00:00
```

| From | Event | To | Atomic state change |
|---|---|---|---|
| `NOT_STARTED` | start | `RUNNING` | set session `startedAt`; set `expectedEndAt = now + durationMs` |
| `RUNNING` | pause | `PAUSED` | calculate actual remaining; clear `expectedEndAt`; set `pausedAt` and frozen remaining |
| `PAUSED` | resume | `RUNNING` | set a new `expectedEndAt`; clear paused fields |
| `RUNNING`/`PAUSED` | submit | `COMPLETED` | freeze timer; calculate and persist result; set manual completion metadata |
| `RUNNING` | derived remaining reaches zero | `EXPIRED` | freeze at zero; calculate and persist result; set expired completion metadata |

The 250 ms React interval only requests a UI refresh. It never decrements persisted state. `visibilitychange` and focus refresh immediately from the injected clock, so background interval throttling cannot create drift. Clock rollback is clamped and cannot grant more than the original duration. `COMPLETED` and `EXPIRED` are terminal; paused time never advances.

## Backup and restore

A backup is a versioned JSON envelope containing selected packs, sessions, settings, creation time, and a SHA-256 digest per payload. Export uses a consistent IndexedDB read transaction. Restore validates the envelope, every schema, all references, and digests before writing anything.

Restore is atomic. ID collisions default to `skip` or explicit user-approved replacement; sessions whose pack is absent are rejected. No remote upload is implied.

## Mac-side PDF preparation tool

The implemented Mac CLI operates only on user-selected local files. Python/pdfplumber performs
layout-aware text extraction and preserves raw/normalized page artifacts. It classifies inputs
as TEXT, MIXED, or SCANNED from deterministic per-page character coverage. SCANNED inputs stop
at `OCR_REQUIRED`; this phase does not silently install OCR or call AI.

The parser joins page-spanning questions and multiline options, removes repeated page margins,
uses sequential question numbers, recognizes A-E option markers, links explicit shared-passage
ranges, and maps a same-file or separate answer key. Every question retains source-page and
rule-warning metadata in the preparation artifact. Missing questions, options, or answers are
fatal to finalization and answers are never inferred.

`prepared-exam.json` is the editable review boundary. A static escaped `review.html` highlights
warnings/errors. The Node finalizer removes preparation metadata and reuses the canonical Phase
2 JSON Schema and semantic validator before writing `.ydspack`. The Player receives an ordinary
Exam Pack and has no PDF-specific branch. Source-derived work and final private packs remain
ignored by Git.

## Optional local LLM adapter

An optional later adapter may suggest segmentation or repair for locally supplied text. It is disabled by default and injected behind a narrow interface. Deterministic parsing runs first. LLM output is always untrusted draft data and must pass human review plus the same validator; it cannot invent answers, provenance, completeness, or official status. The player never depends on it.

## PWA offline/cache architecture

The future service worker precaches only the versioned application shell and local static assets. Hashed assets use cache-first; navigation uses an offline app-shell fallback; update activation is explicit and atomic. Exam Packs and sessions stay in IndexedDB and are included through backup, not Cache Storage.

No cross-origin ÖSYM PDF is silently cached. A service-worker update must not delete user data. An incompatible database migration blocks activation with a recoverable backup prompt rather than clearing storage.

## Validation layers

1. JSON Schema checks shape, required fields, enums, five choices, and official-source requirements.
2. Semantic validation checks uniqueness, references, question counts, answer coverage, group consistency, and verified-key timestamps.
3. Import review checks source fidelity and copyright-sensitive decisions that code cannot prove.

Run:

```bash
npm run validate:exam -- fixtures/sample-exam.json
```

## Versioning and migration

`schemaVersion: 1` is mandatory. The app will keep a registry of pure migrations such as `migrateExamPackV1ToV2(input)`. Import flow validates the old schema, clones the value, applies migrations sequentially, validates each output version, and only then stores the new pack. Original imported data remains available until the transaction succeeds. Downgrades are unsupported.

The same rule applies independently to session schema versions. A pack migration never mutates user answers; a session migration maps references explicitly and aborts if it cannot do so safely.

## Documented assumptions

- v1 supports text questions only; images, audio, and rich inline annotations are deferred to v2+.
- Year starts at 2013 because this schema is for YDS packs established in 2013; other exam families need another schema or later generalization.
- A partial official pack may validate structurally, but product policy must keep it out of full-exam mode.
- Question numbering need not be contiguous because partial source material can preserve original numbers.
- Numeric scoring is shown only when both scoring metadata and the final answer key are verified.

# YDS Player architecture

Status: `PHASE_5_PERSISTENCE_BASELINE`

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

## Exam Pack importer

The future importer is a boundary process, not part of playback:

1. ingest a user-selected local source;
2. extract deterministically;
3. normalize into a draft pack;
4. require human review for ambiguous text, order, provenance, and answers;
5. run JSON Schema and semantic validation;
6. write an immutable pack only after validation passes.

It must never fill missing official questions or answers, promote a 10% release to `full`, or infer official identity. Import failures produce reviewable diagnostics, not partially trusted packs.

## IndexedDB persistence

The implemented database is `yds-study`, version 1. It currently creates only the
`examSessions` store; pack, settings, backup, and cache stores are deferred. The store uses
session `id` as its key and has `by-exam-id` and `by-updated-at` indexes. Session IDs are
independent from exam IDs, so multiple exams and attempts do not share a primary key.

`SessionRepository` is the only IndexedDB boundary. Writes are queued in invocation order;
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

## Exam Session model

[`exam-session.schema.json`](../schemas/exam-session.schema.json) is separate from Exam Pack. A session references `examId` and `examPackSchemaVersion` and owns:

- current question ID (resolved against the pack at render time);
- selected answers and flagged question IDs;
- lifecycle state and timestamps;
- timer state;
- completion result.

The pack forbids session fields through `additionalProperties: false`; the session likewise cannot contain questions or an answer key. Completed results are snapshots so later UI reads do not silently recalculate historical results against a different pack.

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
| `RUNNING`/`PAUSED` | submit | `COMPLETED` | reserved for the later completion flow |
| `RUNNING` | derived remaining reaches zero | `EXPIRED` | clear end timestamp; freeze remaining at zero; set session `expiredAt` |

The 250 ms React interval only requests a UI refresh. It never decrements persisted state. `visibilitychange` and focus refresh immediately from the injected clock, so background interval throttling cannot create drift. Clock rollback is clamped and cannot grant more than the original duration. `COMPLETED` and `EXPIRED` are terminal; paused time never advances.

## Backup and restore

A backup is a versioned JSON envelope containing selected packs, sessions, settings, creation time, and a SHA-256 digest per payload. Export uses a consistent IndexedDB read transaction. Restore validates the envelope, every schema, all references, and digests before writing anything.

Restore is atomic. ID collisions default to `skip` or explicit user-approved replacement; sessions whose pack is absent are rejected. No remote upload is implied.

## Mac-side PDF preparation tool

The future Mac CLI operates only on user-selected local files. Its pipeline is PDF/text extraction → page/order reconstruction → candidate segmentation → draft pack → review report → validator. It records tool version, source file digest, extraction warnings, and provenance. Generated official content remains local and ignored by Git.

This component is deferred; Phase 2 includes no PDF parser or download logic.

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

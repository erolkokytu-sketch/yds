# PHASE 0 — Environment inspection

Inspection date: 2026-09-26 (Europe/Istanbul)

| Component | Detected |
|---|---|
| Operating system | macOS 26.5 (Build 25F71) |
| Node.js | v26.7.0 |
| npm | 11.19.0 |
| Python | 3.14.6 |
| Git | 2.50.1 (Apple Git-155) |
| `pdftotext` | Not installed |

## Decision

- The workspace was empty and was initialized as a Git repository on branch `main`.
- No packages were installed in this phase.
- Missing `pdftotext` is not a blocker for research. PDF tooling will be selected and verified in the importer phase; no installation is justified yet.
- `imports/` and `exam-packs/` are ignored by default so private/copyrighted material cannot be committed accidentally.

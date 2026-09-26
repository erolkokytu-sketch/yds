# Synthetic PDF fixtures

Tests create tiny original PDFs at runtime with ReportLab; binary PDFs are not committed.
Coverage includes text/scanned classification boundaries, question sequence, five and multiline
options, page splits, shared passages, repeated margins, answer-key formats, missing data,
duplicates, corrupt input, safe filenames, finalization, fingerprint stability, and validator
round-trip.

For a manual end-to-end fixture:

```bash
python3 fixtures/pdf/generate_synthetic.py /tmp/yds-pdf-fixture
```

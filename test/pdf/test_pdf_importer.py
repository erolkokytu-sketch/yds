from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

from pdf_importer import (  # noqa: E402
    ImportFailure,
    PageText,
    build_pack,
    inspect_and_extract,
    normalize_pages,
    parse_answer_key,
    parse_questions,
    safe_slug,
    validate_draft,
)


def make_pdf(path: Path, pages: list[list[str]]) -> None:
    pdf = canvas.Canvas(str(path))
    for lines in pages:
        text = pdf.beginText(54, 790)
        text.setLeading(14)
        for line in lines:
            text.textLine(line)
        pdf.drawText(text)
        pdf.showPage()
    pdf.save()


def five_options(prefix: str = "Choice") -> list[str]:
    return [f"{letter}) {prefix} {letter} has enough text" for letter in "ABCDE"]


class PdfImporterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_text_pdf_is_detected(self) -> None:
        path = self.base / "text.pdf"
        make_pdf(path, [["Synthetic exam page with selectable text " * 5]])
        inspection, _ = inspect_and_extract(path)
        self.assertEqual(inspection["pdfType"], "TEXT")

    def test_question_numbers_are_ordered(self) -> None:
        pages = [PageText(1, "", "1. First synthetic question prompt\n" + "\n".join(five_options()) + "\n2. Second synthetic question prompt\n" + "\n".join(five_options("Answer")))]
        questions, _, _, warnings = parse_questions(pages)
        self.assertEqual([q.number for q in questions], [1, 2])
        self.assertFalse([w for w in warnings if w.startswith("question-sequence")])

    def test_five_options_are_parsed(self) -> None:
        pages = [PageText(1, "", "1) A sufficiently long prompt\n" + "\n".join(five_options()))]
        questions, *_ = parse_questions(pages)
        self.assertEqual(set(questions[0].choices), set("ABCDE"))
        self.assertTrue(all(questions[0].choices.values()))

    def test_multiline_option_is_joined(self) -> None:
        pages = [PageText(1, "", "1. A sufficiently long prompt\nA) first line\nsecond line\nB) b text\nC) c text\nD) d text\nE) e text")]
        questions, *_ = parse_questions(pages)
        self.assertEqual(questions[0].choices["A"], "first line second line")

    def test_question_crossing_page_boundary(self) -> None:
        pages = [PageText(1, "", "1. A prompt that starts on page one"), PageText(2, "", "and continues here\n" + "\n".join(five_options()))]
        questions, *_ = parse_questions(pages)
        self.assertEqual(questions[0].source_pages, [1, 2])
        self.assertIn("page-boundary-split", questions[0].warnings)

    def test_shared_passage_is_linked(self) -> None:
        lines = ["Questions 1-2 are based on the following passage.", "A shared synthetic passage with sufficient content.", "1. First prompt"] + five_options() + ["2. Second prompt"] + five_options("Other")
        questions, blocks, groups, _ = parse_questions([PageText(1, "", "\n".join(lines))])
        self.assertEqual(len(blocks), 1)
        self.assertEqual(len(groups), 1)
        self.assertEqual(questions[0].content_block_ids, questions[1].content_block_ids)

    def test_repeated_header_footer_removed(self) -> None:
        pages = [PageText(1, "HEADER\nbody one\nFOOTER"), PageText(2, "HEADER\nbody two\nFOOTER")]
        normalized, removed = normalize_pages(pages)
        self.assertEqual([p.normalized for p in normalized], ["body one", "body two"])
        self.assertEqual(len(removed), 4)

    def test_answer_key_formats(self) -> None:
        pages = [PageText(1, "", "ANSWER KEY\n1. A   2 C   3-E")]
        answers, warnings = parse_answer_key(pages, require_heading=True)
        self.assertEqual(answers, {1: "A", 2: "C", 3: "E"})
        self.assertEqual(warnings, [])

    def test_missing_answer_requires_review(self) -> None:
        question = parse_questions([PageText(1, "", "1. Long enough prompt\n" + "\n".join(five_options()))])[0][0]
        errors, _ = validate_draft(1, [question], {}, [])
        self.assertIn("question-1:missing-answer", errors)

    def test_missing_option_requires_review(self) -> None:
        question = parse_questions([PageText(1, "", "1. Long enough prompt\n" + "\n".join(five_options()[:-1]))])[0][0]
        errors, _ = validate_draft(1, [question], {1: "A"}, [])
        self.assertIn("question-1:missing-options:E", errors)

    def test_duplicate_question_number_detected(self) -> None:
        text = "1. First long prompt\n" + "\n".join(five_options()) + "\n1. Second long prompt\n" + "\n".join(five_options("Other"))
        questions, _, _, warnings = parse_questions([PageText(1, "", text)])
        errors, _ = validate_draft(2, questions, {1: "A"}, warnings)
        self.assertIn("duplicate-question-number", errors)

    def test_corrupt_pdf_is_safe(self) -> None:
        path = self.base / "bad.pdf"
        path.write_bytes(b"not a pdf")
        with self.assertRaises(ImportFailure):
            inspect_and_extract(path)

    def test_filename_is_sanitized(self) -> None:
        self.assertEqual(safe_slug("../../Something Unsafe"), "something-unsafe")

    def test_finalize_round_trip_and_stable_fingerprint(self) -> None:
        exam_pdf = self.base / "synthetic.pdf"
        key_pdf = self.base / "answers.pdf"
        make_pdf(exam_pdf, [[
            "Synthetic YDS practice exam prepared for deterministic testing.",
            "1. Which option completes this long synthetic question correctly?",
            *five_options(),
            "2. Which answer belongs to the second synthetic test question?",
            *five_options("Alternative"),
        ]])
        make_pdf(key_pdf, [["ANSWER KEY", "1. A   2. B"]])
        work_root = self.base / "work"
        command = [
            sys.executable, str(ROOT / "tools/import_exam.py"), str(exam_pdf),
            "--answer-key", str(key_pdf), "--expected-questions", "2", "--year", "2026",
            "--title", "Synthetic PDF Exam", "--work-dir", str(work_root),
        ]
        imported = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertEqual(imported.returncode, 0, imported.stderr + imported.stdout)
        prepared_paths = list(work_root.glob("*/prepared-exam.json"))
        self.assertEqual(len(prepared_paths), 1)
        output = self.base / "packs"
        first = subprocess.run(["node", "scripts/finalize-exam.mjs", str(prepared_paths[0]), "--output", str(output)], cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertEqual(first.returncode, 0, first.stderr)
        pack_path = output / "synthetic-pdf-exam.ydspack"
        validated = subprocess.run(["node", "scripts/validate-exam.mjs", str(pack_path)], cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertEqual(validated.returncode, 0, validated.stderr)
        fingerprint_1 = next(line for line in first.stdout.splitlines() if line.startswith("Fingerprint:"))
        second = subprocess.run(["node", "scripts/finalize-exam.mjs", str(prepared_paths[0]), "--output", str(output)], cwd=ROOT, capture_output=True, text=True, check=False)
        fingerprint_2 = next(line for line in second.stdout.splitlines() if line.startswith("Fingerprint:"))
        self.assertEqual(fingerprint_1, fingerprint_2)

    def test_finalize_rejects_missing_answer_and_option(self) -> None:
        fixture = json.loads((ROOT / "fixtures/sample-exam.json").read_text())
        fixture["answerKey"]["answers"]["q-01"] = "UNKNOWN"
        fixture["questions"][0]["choices"]["E"] = ""
        prepared = self.base / "prepared.json"
        prepared.write_text(json.dumps({"examPack": fixture, "_preparation": {"warnings": [], "reviewApproved": False}}))
        result = subprocess.run(["node", "scripts/finalize-exam.mjs", str(prepared), "--output", str(self.base)], cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)

    def test_finalize_rejects_unsupported_schema(self) -> None:
        fixture = json.loads((ROOT / "fixtures/sample-exam.json").read_text())
        fixture["schemaVersion"] = 99
        prepared = self.base / "prepared.json"
        prepared.write_text(json.dumps({"examPack": fixture, "_preparation": {"warnings": [], "reviewApproved": False}}))
        result = subprocess.run(["node", "scripts/finalize-exam.mjs", str(prepared), "--output", str(self.base)], cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)

    def test_finalize_rejects_expected_question_count_mismatch(self) -> None:
        fixture = json.loads((ROOT / "fixtures/sample-exam.json").read_text())
        prepared = self.base / "prepared.json"
        prepared.write_text(json.dumps({"examPack": fixture, "_preparation": {"expectedQuestions": 80, "warnings": [], "reviewApproved": True}}))
        result = subprocess.run(["node", "scripts/finalize-exam.mjs", str(prepared), "--output", str(self.base)], cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()

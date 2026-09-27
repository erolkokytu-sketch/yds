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
    _split_inline_markers,
    ImportFailure,
    PageText,
    build_pack,
    inspect_and_extract,
    is_answer_key_page,
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

    def test_fixture_a_single_column_layout(self) -> None:
        path = self.base / "fixture-a.pdf"
        make_pdf(path, [[f"Single column line {index} with enough text" for index in range(12)]])
        inspection, _ = inspect_and_extract(path)
        self.assertEqual(inspection["pageLayouts"]["1"], "SINGLE_COLUMN")

    def test_fixture_b_clean_two_column_layout_and_reading_order(self) -> None:
        path = self.base / "fixture-b.pdf"
        pdf = canvas.Canvas(str(path))
        for index in range(1, 8):
            pdf.drawString(54, 790 - index * 28, f"{index}. Left question content {index}")
            pdf.drawString(330, 780 - index * 28, f"{index + 7}. Right question content {index}")
        pdf.save()
        inspection, pages = inspect_and_extract(path)
        self.assertEqual(inspection["pageLayouts"]["1"], "MULTI_COLUMN")
        self.assertLess(pages[0].raw.index("1. Left"), pages[0].raw.index("8. Right"))

    def test_fixture_c_side_by_side_options_are_split(self) -> None:
        value = _split_inline_markers("A) alpha B) beta C) gamma D) delta E) epsilon")
        self.assertEqual(len(value.splitlines()), 5)

    def test_fixture_d_full_width_blocks_produce_mixed_layout(self) -> None:
        path = self.base / "fixture-d.pdf"
        pdf = canvas.Canvas(str(path))
        pdf.setFont("Helvetica", 14)
        pdf.drawCentredString(297, 800, "FULL WIDTH EXAM HEADING ACROSS BOTH COLUMNS")
        pdf.drawCentredString(297, 775, "FULL WIDTH DIRECTIONS ACROSS BOTH COLUMNS")
        pdf.setFont("Helvetica", 10)
        for index in range(1, 8):
            pdf.drawString(54, 740 - index * 28, f"{index}. Left item text")
            pdf.drawString(330, 730 - index * 28, f"{index + 7}. Right item text")
        pdf.save()
        inspection, _ = inspect_and_extract(path)
        self.assertEqual(inspection["pageLayouts"]["1"], "MIXED_LAYOUT")

    def test_fixture_e_layout_debug_is_deterministic(self) -> None:
        path = self.base / "fixture-e.pdf"
        make_pdf(path, [["Deterministic layout evidence " * 8]])
        first, _ = inspect_and_extract(path)
        second, _ = inspect_and_extract(path)
        self.assertEqual(first["pageLayouts"], second["pageLayouts"])

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

    def test_fixture_f_page_spanning_question(self) -> None:
        self.test_question_crossing_page_boundary()

    def test_shared_passage_is_linked(self) -> None:
        lines = ["Questions 1-2 are based on the following passage.", "A shared synthetic passage with sufficient content.", "1. First prompt"] + five_options() + ["2. Second prompt"] + five_options("Other")
        questions, blocks, groups, _ = parse_questions([PageText(1, "", "\n".join(lines))])
        self.assertEqual(len(blocks), 1)
        self.assertEqual(len(groups), 1)
        self.assertEqual(questions[0].content_block_ids, questions[1].content_block_ids)

    def test_fixture_g_turkish_passage_heading_is_linked(self) -> None:
        text = "1. - 2. sorularda, aşağıdaki parçaya göre cevaplayınız.\nShared passage text is sufficiently long.\n1. First prompt\n" + "\n".join(five_options()) + "\n2. Second prompt\n" + "\n".join(five_options("Other"))
        questions, blocks, groups, _ = parse_questions([PageText(1, "", text)])
        self.assertEqual((len(questions), len(blocks), len(groups)), (2, 1, 1))

    def test_fixture_h_dense_answer_table_without_heading(self) -> None:
        text = " ".join(f"{index}. {'ABCDE'[(index - 1) % 5]}" for index in range(1, 21))
        page = PageText(1, text, text)
        self.assertTrue(is_answer_key_page(page))
        answers, _ = parse_answer_key([page], require_heading=True)
        self.assertEqual(len(answers), 20)

    def test_fixture_i_numbered_instructions_do_not_replace_exam_sequence(self) -> None:
        instruction = "1. First instruction with sufficient text\n2. Second instruction with sufficient text"
        exam = []
        for number in range(1, 4):
            exam.extend([f"{number}. Real question prompt number {number}", *five_options(str(number))])
        questions, *_ = parse_questions([PageText(1, "", instruction + "\n" + "\n".join(exam))])
        self.assertEqual([question.number for question in questions], [1, 2, 3])
        self.assertTrue(questions[0].prompt.startswith("Real question"))

    def test_joined_running_header_is_removed(self) -> None:
        pages = [
            PageText(index, f"ALPHA HEADER\nBETA FRAGMENT\nUnique body sentence number {index} with enough words")
            for index in range(1, 5)
        ]
        pages.append(PageText(5, "ALPHA HEADER BETA FRAGMENT\n6. A sufficiently different prompt stays"))
        normalized, _ = normalize_pages(pages)
        self.assertNotIn("ALPHA HEADER BETA FRAGMENT", normalized[-1].normalized)
        self.assertIn("sufficiently different prompt", normalized[-1].normalized)

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

    def test_answer_key_contamination_fixture_is_split_from_option(self) -> None:
        fixture = (ROOT / "fixtures/pdf/answer-key-contamination.txt").read_text()
        pages = [PageText(1, fixture, fixture)]
        questions, *_ = parse_questions(pages)
        answers, warnings = parse_answer_key(pages, require_heading=True)
        self.assertEqual([question.number for question in questions], [1, 2])
        self.assertEqual(questions[0].choices["E"], "normal option text")
        self.assertNotIn("CEVAP ANAHTARI", questions[0].choices["E"])
        self.assertEqual(answers, {1: "B", 2: "A", 3: "D", 4: "B"})
        self.assertEqual(warnings, [])

    def test_answer_key_headers_cut_option_content(self) -> None:
        for heading in ("ANSWER KEY", "Cevap   Anahtarı"):
            with self.subTest(heading=heading):
                text = "1. A sufficiently long prompt\n" + "\n".join(five_options()) + f"\n{heading} 1. B 2. A 3. D"
                questions, *_ = parse_questions([PageText(1, "", text)])
                self.assertEqual(questions[0].choices["E"], "Choice E has enough text")

    def test_ordinary_answer_and_date_words_are_not_cut(self) -> None:
        text = (
            "1. Which answer describes the date mentioned in the passage?\n"
            "A) The answer contains an ordinary date word\n"
            "B) second normal choice\nC) third normal choice\nD) fourth normal choice\nE) fifth normal choice"
        )
        questions, *_ = parse_questions([PageText(1, "", text)])
        self.assertIn("date mentioned", questions[0].prompt)
        self.assertIn("ordinary date word", questions[0].choices["A"])

    def test_answer_sequence_contamination_fails_validation(self) -> None:
        question = parse_questions([PageText(1, "", "1. Long enough prompt\n" + "\n".join(five_options()))])[0][0]
        question.choices["E"] += " 1. B 2. A 3. D 4. B"
        errors, _ = validate_draft(1, [question], {1: "B"}, [])
        self.assertIn("question-1:E-contamination:answer-sequence", errors)

    def test_worksheet_footer_contamination_fails_validation(self) -> None:
        question = parse_questions([PageText(1, "", "1. Long enough prompt\n" + "\n".join(five_options()))])[0][0]
        question.choices["E"] += " SAĞLIK Reading Comprehension Date: ______________"
        errors, _ = validate_draft(1, [question], {1: "B"}, [])
        self.assertIn("question-1:E-contamination:worksheet-metadata", errors)

    def test_column_crossover_contamination_fails_validation(self) -> None:
        question = parse_questions([PageText(1, "", "1. Long enough prompt\n" + "\n".join(five_options()))])[0][0]
        question.choices["E"] += " 53. Foreign question text entered this option"
        errors, _ = validate_draft(1, [question], {1: "B"}, [])
        self.assertIn("question-1:E-contamination:column-crossover", errors)

    def test_ordinal_century_is_not_column_crossover(self) -> None:
        question = parse_questions([PageText(1, "", "1. Long enough prompt\n" + "\n".join(five_options()))])[0][0]
        question.choices["A"] += " 15. yüzyıldan başlayarak"
        question.prompt += " 19. yüzyıl başlarında"
        errors, _ = validate_draft(1, [question], {1: "B"}, [])
        self.assertFalse(any("column-crossover" in error for error in errors))

    def test_decimal_quantity_does_not_split_question_run(self) -> None:
        parts = []
        for number in range(1, 4):
            if number == 3:
                parts.append("2.3 million people were living nearby")
            parts.append(f"{number}. Real question prompt number {number}")
            parts.extend(five_options(str(number)))
        questions, *_ = parse_questions([PageText(1, "", "\n".join(parts))])
        self.assertEqual([question.number for question in questions], [1, 2, 3])

    def test_wrapped_passage_heading_is_linked(self) -> None:
        lines = [
            "17-18: For these questions, choose the best",
            "word or expression to fill the spaces in the",
            "passage.",
            "Synthetic passage with a blank (17) ---- here.",
            "17.",
            *five_options(),
            "18.",
            *five_options("Other"),
        ]
        questions, blocks, groups, _ = parse_questions([PageText(1, "", "\n".join(lines))])
        self.assertEqual([question.number for question in questions], [17, 18])
        self.assertEqual(len(blocks), 1)
        self.assertEqual(len(groups), 1)
        self.assertEqual(questions[0].prompt, "Blank 17")
        self.assertEqual(questions[0].content_block_ids, questions[1].content_block_ids)

    def test_overly_long_option_creates_warning(self) -> None:
        text = "1. Long enough prompt\n" + "\n".join(five_options())
        text = text.replace("E) Choice E has enough text", "E) " + ("unusually long option " * 20))
        question = parse_questions([PageText(1, "", text)])[0][0]
        self.assertIn("option-E-length-outlier", question.warnings)

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

    def test_finalize_cannot_override_critical_extraction_error(self) -> None:
        fixture = json.loads((ROOT / "fixtures/sample-exam.json").read_text())
        prepared = self.base / "prepared.json"
        prepared.write_text(json.dumps({
            "examPack": fixture,
            "_preparation": {"errors": ["critical-layout-error"], "warnings": [], "reviewApproved": True},
        }))
        result = subprocess.run(
            ["node", "scripts/finalize-exam.mjs", str(prepared), "--output", str(self.base), "--reviewed"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("critical extraction errors remain", result.stderr)


if __name__ == "__main__":
    unittest.main()

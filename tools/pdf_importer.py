"""Deterministic, fail-closed PDF to Exam Pack preparation pipeline."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

TOOL_VERSION = "1.1.0"
MAX_PDF_BYTES = 100 * 1024 * 1024
OPTION_KEYS = ("A", "B", "C", "D", "E")
QUESTION_RE = re.compile(r"^\s*(\d{1,3})\s*(?:[.)]|-\s)\s*(.*)$")
OPTION_RE = re.compile(r"^\s*(?:\(([A-E])\)|([A-E])[.)])\s*(.*)$", re.I)
GROUP_RE = re.compile(
    r"(?:for\s+)?questions?\s+(\d{1,3})\s*[\-–]\s*(\d{1,3}).*?(?:passage|following|based)",
    re.I,
)
ANSWER_HEADING_RE = re.compile(
    r"(?<!\w)(?:answer\s*key|cevap\s*anahtar[ıi])(?=\s|$|[:\-])",
    re.I,
)
ANSWER_PAIR_RE = re.compile(r"(?<!\w)(\d{1,3})\s*(?:[.)-]\s*)?([A-E])(?!\w)", re.I)
WORKSHEET_FIELD_RE = re.compile(
    r"^\s*(?:date|name|class|score)\s*:\s*(?:[_\-. ]{2,})?\s*$",
    re.I,
)
WORKSHEET_FIELD_FRAGMENT_RE = re.compile(
    r"(?:^|\s)(?:date|name|class|score)\s*:\s*[_\-. ]{2,}(?:\s|$)",
    re.I,
)
CLASS_DISTRIBUTION_RE = re.compile(r"^\s*s[ıi]n[ıi]fa\s+da[ğg][ıi]t(?:[ıi]m|m)\s*$", re.I)
WORKSHEET_SECTION_RE = re.compile(
    r"^\s*[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s]{1,40}\s+"
    r"(?:Reading\s+Comprehension|Sentence\s+Completion|Irrelevant\s+Sentence)\s*$"
)
WORKSHEET_SECTION_FRAGMENT_RE = re.compile(
    r"(?:^|\s)[A-ZÇĞİÖŞÜ]{2,}(?:\s+[A-ZÇĞİÖŞÜ]{2,}){0,3}\s+"
    r"(?:Reading\s+Comprehension|Sentence\s+Completion|Irrelevant\s+Sentence)(?:\s|$)"
)
BRANDED_FOOTER_RE = re.compile(
    r"\b[\w.-]+\.(?:app|com|org|net)\b.*(?:ücretsiz|free\s+sample|örnek\s+k[âa][ğg][ıi]t)",
    re.I,
)


class ImportFailure(RuntimeError):
    """Readable failure at the untrusted PDF boundary."""


@dataclass
class PageText:
    number: int
    raw: str
    normalized: str = ""
    chars: int = 0


@dataclass
class ParsedQuestion:
    number: int
    prompt: str
    choices: dict[str, str]
    source_pages: list[int]
    warnings: list[str] = field(default_factory=list)
    content_block_ids: list[str] = field(default_factory=list)
    group_id: str | None = None


def safe_slug(value: str, fallback: str = "exam") -> str:
    value = value.casefold().replace("ı", "i")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")[:80]
    return value or fallback


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_pdfplumber():
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise ImportFailure(
            "pdfplumber is required. Run: python3 -m pip install -r tools/requirements-pdf.txt"
        ) from error
    return pdfplumber


def _extract_page_text(page: Any) -> str:
    """Use coordinates to read a likely two-column page column-by-column."""
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False) or []
    lines: dict[int, list[dict[str, Any]]] = {}
    for word in words:
        lines.setdefault(round(float(word["top"]) / 3), []).append(word)
    starts = [min(float(word["x0"]) for word in line) for line in lines.values() if line]
    left_starts = sum(start < page.width * 0.2 for start in starts)
    right_starts = sum(start > page.width * 0.5 for start in starts)
    if left_starts >= 5 and right_starts >= 5:
        midpoint = page.width / 2
        left = page.crop((0, 0, midpoint, page.height)).extract_text(layout=True, x_tolerance=2, y_tolerance=3) or ""
        right = page.crop((midpoint, 0, page.width, page.height)).extract_text(layout=True, x_tolerance=2, y_tolerance=3) or ""
        return f"{left}\n{right}"
    return page.extract_text(layout=True, x_tolerance=2, y_tolerance=3) or ""


def inspect_and_extract(path: Path) -> tuple[dict[str, Any], list[PageText]]:
    if not path.is_file():
        raise ImportFailure(f"File not found: {path}")
    size = path.stat().st_size
    if size <= 4 or size > MAX_PDF_BYTES:
        raise ImportFailure("PDF is empty or exceeds the 100 MB safety limit")
    with path.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise ImportFailure("Input does not have a valid PDF signature")

    pdfplumber = _load_pdfplumber()
    pages: list[PageText] = []
    try:
        with pdfplumber.open(path) as pdf:
            if not pdf.pages:
                raise ImportFailure("PDF has no pages")
            for index, page in enumerate(pdf.pages, 1):
                text = _extract_page_text(page)
                pages.append(PageText(index, text.replace("\x00", ""), chars=len(text.strip())))
    except ImportFailure:
        raise
    except Exception as error:
        raise ImportFailure(f"PDF parser rejected the file: {error}") from error

    usable = sum(page.chars >= 100 for page in pages)
    ratio = usable / len(pages)
    if ratio >= 0.8:
        pdf_type = "TEXT"
    elif ratio >= 0.2:
        pdf_type = "MIXED"
    else:
        pdf_type = "SCANNED"
    inspection = {
        "file": path.name,
        "pages": len(pages),
        "fileSize": size,
        "pdfType": pdf_type,
        "textCoverage": round(ratio, 4),
        "likelyScanned": pdf_type == "SCANNED",
        "extractionQuality": "good" if pdf_type == "TEXT" else "partial" if pdf_type == "MIXED" else "insufficient",
        "pageCharacters": {str(page.number): page.chars for page in pages},
    }
    return inspection, pages


def _line_key(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def detect_repeated_margins(pages: list[PageText]) -> set[str]:
    counts: dict[str, int] = {}
    for page in pages:
        lines = [line for line in page.raw.splitlines() if line.strip()]
        for line in set(lines[:2] + lines[-2:]):
            key = _line_key(line)
            if len(key) >= 3:
                counts[key] = counts.get(key, 0) + 1
    threshold = max(2, (len(pages) + 1) // 2)
    return {line for line, count in counts.items() if count >= threshold}


def normalize_pages(pages: list[PageText]) -> tuple[list[PageText], list[dict[str, Any]]]:
    repeated = detect_repeated_margins(pages)
    removed: list[dict[str, Any]] = []
    for page in pages:
        kept: list[str] = []
        for line in page.raw.replace("\r\n", "\n").replace("\r", "\n").splitlines():
            compact = re.sub(r"[ \t]+", " ", line).strip()
            if _line_key(compact) in repeated:
                removed.append({"page": page.number, "text": compact})
            elif compact:
                kept.append(compact)
        text = "\n".join(kept)
        text = re.sub(r"(?<=\w)-\n(?=[a-z])", "", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        page.normalized = text
    return pages, removed


def has_answer_sequence(value: str, minimum: int = 3) -> bool:
    return len(ANSWER_PAIR_RE.findall(value)) >= minimum


def contamination_markers(value: str) -> list[str]:
    markers: list[str] = []
    if ANSWER_HEADING_RE.search(value):
        markers.append("answer-key-heading")
    if has_answer_sequence(value):
        markers.append("answer-sequence")
    if (
        CLASS_DISTRIBUTION_RE.search(value)
        or WORKSHEET_FIELD_FRAGMENT_RE.search(value)
        or WORKSHEET_SECTION_FRAGMENT_RE.search(value)
    ):
        markers.append("worksheet-metadata")
    if BRANDED_FOOTER_RE.search(value):
        markers.append("branded-footer")
    return markers


def is_worksheet_metadata_line(value: str) -> bool:
    return bool(
        WORKSHEET_FIELD_RE.fullmatch(value)
        or CLASS_DISTRIBUTION_RE.fullmatch(value)
        or WORKSHEET_SECTION_RE.fullmatch(value)
        or BRANDED_FOOTER_RE.search(value)
    )


def _looks_like_question_start(value: str) -> bool:
    match = QUESTION_RE.match(value)
    return bool(match and len(match.group(2).strip()) >= 8 and not has_answer_sequence(value))


def page_lines(pages: list[PageText], stop_at_answer_key: bool = True) -> list[tuple[str, int]]:
    result: list[tuple[str, int]] = []
    suppress_answer_block = False
    for page in pages:
        for line in page.normalized.splitlines():
            heading = ANSWER_HEADING_RE.search(line) if stop_at_answer_key else None
            if heading:
                prefix = line[:heading.start()].strip()
                if prefix and not is_worksheet_metadata_line(prefix):
                    result.append((prefix, page.number))
                suppress_answer_block = True
                continue
            if suppress_answer_block:
                if _looks_like_question_start(line):
                    suppress_answer_block = False
                else:
                    continue
            if is_worksheet_metadata_line(line):
                continue
            result.append((line, page.number))
    return result


def _join(parts: Iterable[str]) -> str:
    return re.sub(r"\s+", " ", " ".join(part.strip() for part in parts if part.strip())).strip()


def find_passages(
    lines: list[tuple[str, int]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[int, tuple[str, str]], set[int]]:
    blocks: list[dict[str, Any]] = []
    groups: list[dict[str, Any]] = []
    question_links: dict[int, tuple[str, str]] = {}
    consumed: set[int] = set()
    for index, (line, _) in enumerate(lines):
        match = GROUP_RE.search(line)
        if not match:
            continue
        start, end = int(match.group(1)), int(match.group(2))
        passage_lines: list[str] = []
        cursor = index + 1
        while cursor < len(lines):
            q_match = QUESTION_RE.match(lines[cursor][0])
            if q_match and int(q_match.group(1)) == start:
                break
            passage_lines.append(lines[cursor][0])
            consumed.add(cursor)
            cursor += 1
        content = _join(passage_lines)
        if not content:
            continue
        consumed.add(index)
        block_id = f"passage-{start}-{end}"
        group_id = f"group-{start}-{end}"
        blocks.append({"id": block_id, "type": "passage", "order": len(blocks) + 1, "content": content})
        ids = [f"q-{number:02d}" for number in range(start, end + 1)]
        groups.append({"id": group_id, "type": "reading-set", "title": f"Questions {start}-{end}", "order": len(groups) + 1, "questionIds": ids})
        for number in range(start, end + 1):
            question_links[number] = (block_id, group_id)
    return blocks, groups, question_links, consumed


def parse_questions(pages: list[PageText]) -> tuple[list[ParsedQuestion], list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    lines = page_lines(pages)
    blocks, groups, links, consumed = find_passages(lines)
    starts: list[tuple[int, int]] = []
    for index, (line, _) in enumerate(lines):
        if index in consumed:
            continue
        match = QUESTION_RE.match(line)
        if match:
            starts.append((index, int(match.group(1))))

    questions: list[ParsedQuestion] = []
    global_warnings: list[str] = []
    seen: set[int] = set()
    for position, (start_index, number) in enumerate(starts):
        if number in seen:
            global_warnings.append(f"duplicate-question-number:{number}")
        seen.add(number)
        end_index = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        segment = [(text, page) for idx, (text, page) in enumerate(lines[start_index:end_index], start_index) if idx not in consumed]
        if not segment:
            continue
        first_match = QUESTION_RE.match(segment[0][0])
        body: list[tuple[str, int]] = [(first_match.group(2), segment[0][1])] if first_match else []
        body.extend(segment[1:])
        prompt_parts: list[str] = []
        choice_parts: dict[str, list[str]] = {}
        current: str | None = None
        source_pages = sorted({page for _, page in segment})
        for text, _ in body:
            option = OPTION_RE.match(text)
            if option:
                current = (option.group(1) or option.group(2)).upper()
                choice_parts.setdefault(current, []).append(option.group(3))
            elif current:
                choice_parts[current].append(text)
            else:
                prompt_parts.append(text)
        choices = {key: _join(choice_parts.get(key, [])) for key in OPTION_KEYS}
        warnings: list[str] = []
        for key, value in choices.items():
            if not value:
                warnings.append(f"option-{key}-missing")
            elif len(value) < 2:
                warnings.append(f"option-{key}-short")
        non_empty = [value for value in choices.values() if value]
        if len(set(non_empty)) != len(non_empty):
            warnings.append("duplicated-option-text")
        lengths = [len(value) for value in non_empty]
        if lengths:
            median_length = statistics.median(lengths)
            for key, value in choices.items():
                if value and len(value) > max(80, median_length * 3):
                    warnings.append(f"option-{key}-length-outlier")
        prompt = _join(prompt_parts)
        if len(prompt) < 8:
            warnings.append("question-text-short")
        if len(source_pages) > 1:
            warnings.append("page-boundary-split")
        block_id, group_id = links.get(number, (None, None))
        questions.append(ParsedQuestion(
            number=number,
            prompt=prompt,
            choices=choices,
            source_pages=source_pages,
            warnings=warnings,
            content_block_ids=[block_id] if block_id else [],
            group_id=group_id,
        ))

    numbers = [question.number for question in questions]
    for left, right in zip(numbers, numbers[1:]):
        if right != left + 1:
            global_warnings.append(f"question-sequence:{left}->{right}")
    return questions, blocks, groups, global_warnings


def parse_answer_key(pages: list[PageText], require_heading: bool = False) -> tuple[dict[int, str], list[str]]:
    text = "\n".join(page.normalized for page in pages)
    if require_heading:
        heading = re.search(r"(?:answer\s*key|cevap\s*anahtar[ıi])", text, re.I)
        if not heading:
            return {}, []
        text = text[heading.end():]
    pairs = ANSWER_PAIR_RE.findall(text)
    answers: dict[int, str] = {}
    warnings: list[str] = []
    for raw_number, raw_answer in pairs:
        number, answer = int(raw_number), raw_answer.upper()
        if number in answers:
            warnings.append(f"answer-key-duplicate:{number}")
        answers[number] = answer
    return answers, warnings


def classify_question(number: int, expected_questions: int, grouped: bool) -> str:
    if grouped:
        return "reading_comprehension"
    if expected_questions != 80:
        return "other"
    ranges = [
        (1, 6, "vocabulary"), (7, 16, "grammar"), (17, 26, "cloze"),
        (27, 36, "sentence_completion"), (37, 42, "translation"),
        (43, 62, "reading_comprehension"), (63, 67, "dialogue_completion"),
        (68, 71, "closest_meaning"), (72, 75, "paragraph_completion"),
        (76, 80, "irrelevant_sentence"),
    ]
    return next((kind for start, end, kind in ranges if start <= number <= end), "other")


def build_pack(args: argparse.Namespace, questions: list[ParsedQuestion], blocks: list[dict[str, Any]], groups: list[dict[str, Any]], answers: dict[int, str]) -> dict[str, Any]:
    title = args.title or args.pdf.stem
    exam_id = safe_slug(args.id or title)
    source: dict[str, Any] = {
        "completeness": args.completeness,
        "verification": args.source_verification,
        "licenseNotes": args.license_notes,
    }
    if args.publisher:
        source["publisher"] = args.publisher
    if args.source_url:
        source["questionUrl"] = args.source_url
    if args.answer_key_url:
        source["answerKeyUrl"] = args.answer_key_url
    if args.retrieved_at:
        source["retrievedAt"] = args.retrieved_at
    answer_map = {f"q-{q.number:02d}": answers.get(q.number, "UNKNOWN") for q in questions}
    return {
        "schemaVersion": 1,
        "id": exam_id,
        "title": title,
        "year": args.year or 2000,
        "term": args.term,
        "language": args.language,
        "durationMinutes": args.duration,
        "kind": args.kind,
        "source": source,
        "scoring": {"type": "scaled-correct-count", "wrongAnswerPenalty": 0, "maximumScore": 100, "status": "unverified"},
        "contentBlocks": blocks,
        "questionGroups": groups,
        "questionCount": len(questions),
        "questions": [
            {
                "id": f"q-{q.number:02d}", "number": q.number,
                "type": classify_question(q.number, args.expected_questions, bool(q.group_id)),
                "prompt": q.prompt, "contentBlockIds": q.content_block_ids,
                **({"groupId": q.group_id} if q.group_id else {}), "choices": q.choices,
            }
            for q in questions
        ],
        "answerKey": {
            "revision": args.answer_revision,
            "status": "verified" if args.answer_key_verified_at else "unverified",
            **({"verifiedAt": args.answer_key_verified_at} if args.answer_key_verified_at else {}),
            "answers": answer_map,
        },
    }


def validate_draft(expected: int, questions: list[ParsedQuestion], answers: dict[int, str], globals_: list[str]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings = list(globals_)
    if len(questions) != expected:
        errors.append(f"question-count:{len(questions)}/{expected}")
    numbers = [q.number for q in questions]
    if len(numbers) != len(set(numbers)):
        errors.append("duplicate-question-number")
    for question in questions:
        warnings.extend(f"question-{question.number}:{warning}" for warning in question.warnings)
        content = [("prompt", question.prompt), *question.choices.items()]
        for field, value in content:
            for marker in contamination_markers(value):
                errors.append(f"question-{question.number}:{field}-contamination:{marker}")
        missing = [key for key, value in question.choices.items() if not value]
        if missing:
            errors.append(f"question-{question.number}:missing-options:{','.join(missing)}")
        if not question.prompt:
            errors.append(f"question-{question.number}:missing-prompt")
        if question.number not in answers:
            errors.append(f"question-{question.number}:missing-answer")
    orphan_answers = sorted(set(answers) - set(numbers))
    if orphan_answers:
        errors.append("orphan-answers:" + ",".join(map(str, orphan_answers)))
    return sorted(set(errors)), sorted(set(warnings))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_review(path: Path, prepared: dict[str, Any]) -> None:
    prep = prepared["_preparation"]
    pack = prepared["examPack"]
    warning_map = prep["questionWarnings"]
    cards: list[str] = []
    for question in pack["questions"]:
        qid = question["id"]
        warnings = warning_map.get(qid, [])
        answer = pack["answerKey"]["answers"].get(qid, "UNKNOWN")
        question_errors = [error for error in prep["errors"] if error.startswith(f"question-{question['number']}:")]
        severity = "error" if question_errors else "warning" if warnings or answer == "UNKNOWN" else "ok"
        choices = "".join(f"<li><b>{key}</b> {html.escape(value)}</li>" for key, value in question["choices"].items())
        cards.append(
            f'<article class="card {severity}" data-status="{severity}"><h2>Question {question["number"]}</h2>'
            f'<p>{html.escape(question["prompt"])}</p><ol>{choices}</ol>'
            f'<p><b>Correct:</b> {html.escape(answer)} · <b>Source page:</b> {", ".join(map(str, prep["sourcePages"].get(qid, [])))}</p>'
            f'<p><b>Status:</b> {"CHECK" if severity == "warning" else "OK"}</p>'
            f'<p class="flags">{html.escape(", ".join(question_errors + warnings))}</p></article>'
        )
    document = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>YDS PDF Import Review</title><style>
body{{font:16px system-ui;max-width:960px;margin:2rem auto;padding:0 1rem;background:#f5f7fa;color:#17202a}}button{{padding:.6rem 1rem;margin:.25rem;border:1px solid #789;border-radius:.5rem;background:white}}.card{{background:white;padding:1rem 1.3rem;margin:1rem 0;border-left:6px solid #2a7;border-radius:.6rem}}.warning{{border-color:#d83}}.error{{border-color:#c22}}.flags{{color:#a32}}li{{margin:.35rem 0}}
</style><body><h1>YDS PDF Import Review</h1><p><b>Status:</b> {prep["status"]}</p>
<p>Detected: {len(pack["questions"])} questions · {sum(v != "UNKNOWN" for v in pack["answerKey"]["answers"].values())} answers · {len(pack["contentBlocks"])} passages</p>
<p>Errors: {len(prep["errors"])} · Warnings: {len(prep["warnings"])}</p>
<nav><button data-filter="all">All</button><button data-filter="warning">Warnings</button><button data-filter="error">Errors</button></nav>
<pre>{html.escape(chr(10).join(prep["errors"]))}</pre>{''.join(cards)}
<script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{{let f=b.dataset.filter;document.querySelectorAll('.card').forEach(c=>c.hidden=f!=='all'&&c.dataset.status!==f)}})</script></body></html>"""
    path.write_text(document, encoding="utf-8")


def command_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Prepare a local YDS PDF for human review and Exam Pack finalization.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--answer-key", type=Path)
    parser.add_argument("--work-dir", type=Path, default=Path("work"))
    parser.add_argument("--title")
    parser.add_argument("--id")
    parser.add_argument("--year", type=int)
    parser.add_argument("--term", default="Imported")
    parser.add_argument("--language", default="English")
    parser.add_argument("--duration", type=int, default=180)
    parser.add_argument("--expected-questions", type=int, default=80)
    parser.add_argument("--kind", choices=("practice", "official"), default="practice")
    parser.add_argument("--publisher")
    parser.add_argument("--source-url")
    parser.add_argument("--answer-key-url")
    parser.add_argument("--retrieved-at")
    parser.add_argument("--completeness", choices=("full", "partial", "sample", "unknown"), default="unknown")
    parser.add_argument("--source-verification", choices=("verified", "unverified"), default="unverified")
    parser.add_argument("--license-notes", default="Private local PDF supplied by the user; redistribution rights not inferred.")
    parser.add_argument("--answer-revision", default="imported-v1")
    parser.add_argument("--answer-key-verified-at")
    parser.add_argument("--debug", action="store_true")
    return parser


def run_import(args: argparse.Namespace) -> tuple[Path, str]:
    source_digest = sha256_file(args.pdf) if args.pdf.is_file() else "missing"
    import_id = f"{safe_slug(args.id or args.pdf.stem)}-{source_digest[:12]}"
    work = args.work_dir.resolve() / import_id
    if work.exists():
        shutil.rmtree(work)
    (work / "raw-pages").mkdir(parents=True)
    (work / "normalized-pages").mkdir()

    print("[1/6] Inspecting PDF")
    inspection, pages = inspect_and_extract(args.pdf)
    write_json(work / "inspection.json", inspection)
    for page in pages:
        (work / "raw-pages" / f"page-{page.number:03d}.txt").write_text(page.raw, encoding="utf-8")
    if args.debug:
        for page in pages:
            print(f"Page {page.number}: {page.chars} chars")
    if inspection["pdfType"] == "SCANNED":
        manifest = {"toolVersion": TOOL_VERSION, "sourceSha256": source_digest, "status": "OCR_REQUIRED", "inspection": "inspection.json"}
        write_json(work / "manifest.json", manifest)
        return work, "OCR_REQUIRED"

    print("[2/6] Extracting text")
    pages, removed = normalize_pages(pages)
    for page in pages:
        (work / "normalized-pages" / f"page-{page.number:03d}.txt").write_text(page.normalized, encoding="utf-8")
    write_json(work / "removed-margins.json", removed)

    print("[3/6] Detecting questions")
    questions, blocks, groups, global_warnings = parse_questions(pages)
    if inspection["pdfType"] == "MIXED":
        global_warnings.append("mixed-pdf-pages-require-review")
    if args.year is None:
        global_warnings.append("metadata-year-required")
    write_json(work / "detected-questions.json", [q.__dict__ for q in questions])

    print("[4/6] Parsing answer key")
    key_pages = pages
    require_heading = args.answer_key is None
    if args.answer_key:
        _, key_pages = inspect_and_extract(args.answer_key)
        key_pages, _ = normalize_pages(key_pages)
    answers, answer_warnings = parse_answer_key(key_pages, require_heading=require_heading)
    global_warnings.extend(answer_warnings)

    print("[5/6] Validating")
    errors, warnings = validate_draft(args.expected_questions, questions, answers, global_warnings)
    status = "READY" if not errors and not warnings else "REVIEW_REQUIRED"
    pack = build_pack(args, questions, blocks, groups, answers)
    prepared = {
        "examPack": pack,
        "_preparation": {
            "toolVersion": TOOL_VERSION, "sourcePdf": args.pdf.name, "sourceSha256": source_digest,
            "expectedQuestions": args.expected_questions,
            "status": status, "errors": errors, "warnings": warnings,
            "questionWarnings": {f"q-{q.number:02d}": q.warnings for q in questions if q.warnings},
            "sourcePages": {f"q-{q.number:02d}": q.source_pages for q in questions},
            "reviewApproved": False,
        },
    }
    write_json(work / "prepared-exam.json", prepared)
    write_json(work / "validation-report.json", {"status": status, "errors": errors, "warnings": warnings})

    print("[6/6] Preparing review")
    write_review(work / "review.html", prepared)
    manifest = {
        "toolVersion": TOOL_VERSION, "sourceSha256": source_digest, "status": status,
        "artifacts": ["inspection.json", "raw-pages", "normalized-pages", "detected-questions.json", "prepared-exam.json", "validation-report.json", "review.html"],
    }
    write_json(work / "manifest.json", manifest)
    return work, status


def main() -> int:
    args = command_parser().parse_args()
    try:
        work, status = run_import(args)
        inspection = json.loads((work / "inspection.json").read_text(encoding="utf-8"))
        print(f"\nPDF type: {inspection['pdfType']}")
        if (work / "prepared-exam.json").exists():
            prepared = json.loads((work / "prepared-exam.json").read_text(encoding="utf-8"))
            pack, prep = prepared["examPack"], prepared["_preparation"]
            complete = sum(all(q["choices"].values()) for q in pack["questions"])
            answers = sum(value != "UNKNOWN" for value in pack["answerKey"]["answers"].values())
            print(f"Questions: {len(pack['questions'])}/{args.expected_questions}")
            print(f"Options complete: {complete}/{len(pack['questions'])}")
            print(f"Answers: {answers}/{len(pack['questions'])}")
            print(f"Passages: {len(pack['contentBlocks'])}")
            print(f"Errors: {len(prep['errors'])}\nWarnings: {len(prep['warnings'])}")
        print(f"STATUS: {status}\nWork: {work}")
        return 0 if status in {"READY", "REVIEW_REQUIRED", "OCR_REQUIRED"} else 1
    except ImportFailure as error:
        print(f"FAILED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

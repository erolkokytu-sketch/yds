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

TOOL_VERSION = "1.2.0"
MAX_PDF_BYTES = 100 * 1024 * 1024
OPTION_KEYS = ("A", "B", "C", "D", "E")
QUESTION_RE = re.compile(r"^\s*(\d{1,3})\s*(?:[.)]|-\s)\s*(.*)$")
OPTION_RE = re.compile(r"^\s*(?:\(([A-E])\)|([A-E])[.)])\s*(.*)$", re.I)
GROUP_RE = re.compile(
    r"(?:(?:for\s+)?questions?\s+|)(\d{1,3})\s*[. ]*[-–]\s*(\d{1,3})"
    r".*?(?:passage|following|based|a[şs]a[ğg][ıi]daki\s+par|par[çc]aya\s+g[öo]re)",
    re.I,
)
POST_EXAM_HEADER_RE = re.compile(
    r"(?:s[ıi]navda\s+uyula(?:cak)?|uyulacak\s+kurallar|test\s+bitti|end\s+of\s+(?:the\s+)?test)",
    re.I,
)
SECTION_RANGE_RE = re.compile(
    r"^\s*(?:(?:for\s+)?questions?\s+)?\d{1,3}\s*[. ]*[-–]\s*\d{1,3}\b",
    re.I,
)
GROUP_INSTRUCTION_RE = re.compile(
    r"^\s*(?:(?:sorular[ıi]\s+)?(?:a[şs]a[ğg][ıi]daki\s+)?(?:par[çc]aya\s+g[öo]re\s+)?)?"
    r"(?:cevaplay[ıi]n[ıi]z|uygun\s+(?:se[çc]ene[ğg]i|ifade(?:yi)?)\s+bulunuz)\.?\s*$",
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
CROSS_COLUMN_MARKER_RE = re.compile(
    r"(?:^|\s)\d{1,3}[.)]\s+(?=[A-ZÇĞİÖŞÜ])|"
    r"(?:^|\s)\d{1,3}\s*[. ]*[-–]\s*\d{1,3}\b.*(?:questions?|sorular)",
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
    layout: str = "SINGLE_COLUMN"
    layout_debug: dict[str, Any] = field(default_factory=dict)


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


def _split_inline_markers(value: str) -> str:
    """Put side-by-side A-E choices on independent structural lines."""
    return re.sub(r"(?<!\w)(?=(?:\([A-E]\)|[A-E][.)])\s*)", "\n", value).strip()


def _analyze_page_layout(page: Any) -> dict[str, Any]:
    """Classify a page from word coordinates and choose a deterministic gutter."""
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False) or []
    lines: dict[int, list[dict[str, Any]]] = {}
    for word in words:
        lines.setdefault(round(float(word["top"]) / 3), []).append(word)
    candidates: list[tuple[float, int, float]] = []
    for x in range(round(page.width * 0.4), round(page.width * 0.6) + 1):
        crossing = sum(float(word["x0"]) < x < float(word["x1"]) for word in words)
        left = sum(float(word["x1"]) <= x for word in words)
        right = sum(float(word["x0"]) >= x for word in words)
        balance = abs(left - right) / max(1, len(words))
        candidates.append((crossing * 10 + balance, crossing, float(x)))
    minimum_crossings = min((item[1] for item in candidates), default=0)
    eligible = [item for item in candidates if item[1] <= minimum_crossings + 2]
    _, crossings, gutter = min(
        eligible, key=lambda item: (abs(item[2] - page.width / 2), item[0]),
        default=(0.0, 0, page.width / 2),
    )
    dual_rows = 0
    spanning_rows = 0
    for row in lines.values():
        has_left = any(float(word["x1"]) < gutter - 3 for word in row)
        has_right = any(float(word["x0"]) > gutter + 3 for word in row)
        crosses = any(float(word["x0"]) <= gutter <= float(word["x1"]) for word in row)
        if has_left and has_right and not crosses:
            dual_rows += 1
        if crosses or (has_left and has_right and min(float(w["x0"]) for w in row) < page.width * .25
                       and max(float(w["x1"]) for w in row) > page.width * .75):
            spanning_rows += 1
    enough_sides = (
        sum(float(word["x1"]) <= gutter for word in words) >= 20
        and sum(float(word["x0"]) >= gutter for word in words) >= 20
    )
    structural = [word for word in words if re.fullmatch(r"(?:\d{1,3}[.)]?|[A-E][.)])", str(word["text"]))]
    structural_left = sum(float(word["x0"]) < gutter for word in structural)
    structural_right = sum(float(word["x0"]) > gutter for word in structural)
    is_multi = enough_sides and (dual_rows >= 4 or (structural_left >= 3 and structural_right >= 3))
    layout = "MIXED_LAYOUT" if is_multi and spanning_rows >= 2 else "MULTI_COLUMN" if is_multi else "SINGLE_COLUMN"
    result: dict[str, Any] = {
        "classification": layout,
        "gutter": round(gutter, 2) if is_multi else None,
        "dualRows": dual_rows,
        "spanningRows": spanning_rows,
        "wordCount": len(words),
        "gutterCrossings": crossings,
        "structuralMarkers": {"left": structural_left, "right": structural_right},
    }
    if is_multi:
        left_blocks: list[dict[str, Any]] = []
        right_blocks: list[dict[str, Any]] = []
        for row_index, (_, row) in enumerate(sorted(lines.items()), 1):
            for side, target in (("left", left_blocks), ("right", right_blocks)):
                selected = [
                    word for word in row
                    if (((float(word["x0"]) + float(word["x1"])) / 2 < gutter) == (side == "left"))
                ]
                if selected:
                    selected.sort(key=lambda word: float(word["x0"]))
                    target.append({
                        "id": f"{side[0].upper()}{row_index}",
                        "x0": round(min(float(word["x0"]) for word in selected), 2),
                        "x1": round(max(float(word["x1"]) for word in selected), 2),
                        "top": round(min(float(word["top"]) for word in selected), 2),
                        "bottom": round(max(float(word["bottom"]) for word in selected), 2),
                        "text": " ".join(str(word["text"]) for word in selected),
                    })
        result["usableContentWidth"] = {
            "x0": round(min((float(word["x0"]) for word in words), default=0), 2),
            "x1": round(max((float(word["x1"]) for word in words), default=page.width), 2),
        }
        result["leftBlocks"] = left_blocks
        result["rightBlocks"] = right_blocks
        result["readingOrder"] = [block["id"] for block in left_blocks + right_blocks]
    return result


def _extract_page_text(page: Any) -> tuple[str, dict[str, Any]]:
    """Read columns top-to-bottom, left first, while retaining layout evidence."""
    debug = _analyze_page_layout(page)
    if debug["classification"] in {"MULTI_COLUMN", "MIXED_LAYOUT"}:
        gutter = float(debug["gutter"])
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False) or []
        crossing_headers: list[str] = []
        for word in words:
            value = str(word["text"])
            letters = [char for char in value if char.isalpha()]
            if (
                float(word["x0"]) < gutter < float(word["x1"])
                and len(letters) >= 4
                and sum(char.isupper() for char in letters) / len(letters) >= 0.7
            ):
                crossing_headers.append(value)

        def remove_split_headers(value: str) -> str:
            result: list[str] = []
            for line in value.splitlines():
                tokens = line.split()
                kept: list[str] = []
                for token in tokens:
                    compact = re.sub(r"\W", "", token, flags=re.UNICODE)
                    if any(
                        len(compact) >= 2 and (header.startswith(compact) or header.endswith(compact))
                        for header in crossing_headers
                    ):
                        continue
                    kept.append(token)
                if kept:
                    result.append(" ".join(kept))
            return "\n".join(result)

        left = page.crop((0, 0, gutter, page.height)).extract_text(layout=False, x_tolerance=2, y_tolerance=3) or ""
        right = page.crop((gutter, 0, page.width, page.height)).extract_text(layout=False, x_tolerance=2, y_tolerance=3) or ""
        full_width = "\n".join(dict.fromkeys(crossing_headers))
        return _split_inline_markers("\n".join(filter(None, (full_width, remove_split_headers(left), remove_split_headers(right))))), debug
    text = page.extract_text(layout=False, x_tolerance=2, y_tolerance=3) or ""
    return _split_inline_markers(text), debug


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
                text, layout_debug = _extract_page_text(page)
                pages.append(PageText(
                    index, text.replace("\x00", ""), chars=len(text.strip()),
                    layout=layout_debug["classification"], layout_debug=layout_debug,
                ))
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
        "pageLayouts": {str(page.number): page.layout for page in pages},
    }
    return inspection, pages


def _line_key(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def detect_repeated_margins(pages: list[PageText]) -> set[str]:
    counts: dict[str, int] = {}
    for page in pages:
        lines = [line for line in page.raw.splitlines() if line.strip()]
        for line in set(lines):
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
            elif re.fullmatch(r"\d{1,3}", compact) or re.fullmatch(r"di[ğg]er\s+sayfaya\s+ge[çc]iniz\.?", compact, re.I):
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
    if CROSS_COLUMN_MARKER_RE.search(value):
        markers.append("column-crossover")
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
    if not match:
        return False
    remainder = match.group(2).strip()
    return bool(
        len(remainder) >= 8
        and not re.match(r"^[-–]\s*\d", remainder)
        and not has_answer_sequence(value)
    )


def _answer_pairs_on_page(page: PageText) -> dict[int, str]:
    return {int(number): answer.upper() for number, answer in ANSWER_PAIR_RE.findall(page.normalized)}


def is_answer_key_page(page: PageText) -> bool:
    pairs = _answer_pairs_on_page(page)
    heading = ANSWER_HEADING_RE.search(page.normalized)
    if heading and heading.start() < 100 and len(pairs) >= 3:
        return True
    if len(pairs) < 20:
        return False
    ordered = sorted(pairs)
    density = len(ordered) / max(1, ordered[-1] - ordered[0] + 1)
    return ordered[0] <= 2 and density >= 0.8


def page_lines(pages: list[PageText], stop_at_answer_key: bool = True) -> list[tuple[str, int]]:
    result: list[tuple[str, int]] = []
    suppress_answer_block = False
    for page in pages:
        if stop_at_answer_key and is_answer_key_page(page):
            continue
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
        while cursor < len(lines) and GROUP_INSTRUCTION_RE.match(lines[cursor][0]):
            consumed.add(cursor)
            cursor += 1
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
        next_has_option = False
        for cursor in range(index + 1, min(index + 80, len(lines))):
            if OPTION_RE.match(lines[cursor][0]):
                next_has_option = True
                break
            if QUESTION_RE.match(lines[cursor][0]):
                break
        remainder = match.group(2).strip() if match else ""
        is_range_heading = bool(re.match(r"^[-–]\s*\d", remainder))
        if match and not is_range_heading and (_looks_like_question_start(line) or next_has_option):
            starts.append((index, int(match.group(1))))

    # Covers and instructions also contain numbered prose. The exam body is the
    # longest strict 1..N sequence; section range headings were filtered above.
    runs: list[list[tuple[int, int]]] = []
    for start in starts:
        if not runs or start[1] != runs[-1][-1][1] + 1:
            runs.append([start])
        else:
            runs[-1].append(start)
    best_run = max(runs, key=lambda run: (len(run), run[0][1] == 1), default=[])
    starts = best_run if len(best_run) >= 2 else starts

    questions: list[ParsedQuestion] = []
    global_warnings: list[str] = []
    seen: set[int] = set()
    for position, (start_index, number) in enumerate(starts):
        if number in seen:
            global_warnings.append(f"duplicate-question-number:{number}")
        seen.add(number)
        if position + 1 < len(starts):
            end_index = starts[position + 1][0]
        else:
            end_index = next(
                (index for index in range(start_index + 1, len(lines)) if POST_EXAM_HEADER_RE.search(lines[index][0])),
                len(lines),
            )
        segment = [(text, page) for idx, (text, page) in enumerate(lines[start_index:end_index], start_index) if idx not in consumed]
        range_boundary = next(
            (index for index, (text, _) in enumerate(segment[1:], 1) if SECTION_RANGE_RE.match(text)),
            None,
        )
        if range_boundary is not None:
            segment = segment[:range_boundary]
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
        roman_options = all(re.fullmatch(r"(?:I|II|III|IV|V)", value or "") for value in choices.values())
        for key, value in choices.items():
            if not value:
                warnings.append(f"option-{key}-missing")
            elif len(value) < 2 and not roman_options:
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
        block_id, group_id = links.get(number, (None, None))
        prompt = _join(prompt_parts) or (f"Blank {number}" if block_id else "")
        if len(prompt) < 8:
            warnings.append("question-text-short")
        if len(source_pages) > 1:
            warnings.append("page-boundary-split")
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
        if heading:
            text = text[heading.end():]
        else:
            key_pages = [page for page in pages if is_answer_key_page(page)]
            if not key_pages:
                return {}, []
            text = "\n".join(page.normalized for page in key_pages)
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


def build_review_sample(
    questions: list[ParsedQuestion], answers: dict[int, str], blocks: list[dict[str, Any]],
) -> dict[str, Any]:
    by_page: dict[int, list[ParsedQuestion]] = {}
    for question in questions:
        for page in question.source_pages:
            by_page.setdefault(page, []).append(question)
    column_boundary: list[ParsedQuestion] = []
    for page_questions in by_page.values():
        unique = list({question.number: question for question in page_questions}.values())
        if len(unique) >= 4:
            middle = len(unique) // 2
            column_boundary.extend(unique[max(0, middle - 1):middle + 2])
            if len(column_boundary) >= 3:
                break
    page_boundary = [
        left for left, right in zip(questions, questions[1:])
        if left.source_pages[-1] != right.source_pages[0]
    ][:3]
    passage = next(
        (question for question in questions if question.content_block_ids and not question.prompt.startswith("Blank ")),
        next((question for question in questions if question.content_block_ids), None),
    )
    block_map = {block["id"]: block["content"] for block in blocks}

    def serialize(items: list[ParsedQuestion]) -> list[dict[str, Any]]:
        return [{
            "number": question.number,
            "prompt": question.prompt,
            "choices": question.choices,
            "answer": answers.get(question.number, "UNKNOWN"),
            "sourcePages": question.source_pages,
            "contentBlocks": [block_map[block_id] for block_id in question.content_block_ids if block_id in block_map],
        } for question in items]

    return {
        "firstThree": serialize(questions[:3]),
        "columnBoundaryThree": serialize(column_boundary[:3]),
        "pageBoundaryThree": serialize(page_boundary),
        "passageQuestion": serialize([passage] if passage else []),
        "finalThree": serialize(questions[-3:]),
        "reviewStatus": "PENDING_HUMAN_REVIEW",
    }


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
        (work / "layout-debug").mkdir()
        for page in pages:
            print(f"Page {page.number}: {page.chars} chars")
            write_json(work / "layout-debug" / f"page-{page.number:03d}.json", page.layout_debug)
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
    write_json(work / "review-sample.json", build_review_sample(questions, answers, blocks))

    print("[6/6] Preparing review")
    write_review(work / "review.html", prepared)
    manifest = {
        "toolVersion": TOOL_VERSION, "sourceSha256": source_digest, "status": status,
        "artifacts": ["inspection.json", "raw-pages", "normalized-pages", "detected-questions.json", "prepared-exam.json", "validation-report.json", "review-sample.json", "review.html"]
        + (["layout-debug"] if args.debug else []),
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

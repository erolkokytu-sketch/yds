#!/usr/bin/env python3
"""Generate original, non-ÖSYM PDFs for manual Phase 8 acceptance."""

import argparse
from pathlib import Path

from reportlab.pdfgen import canvas


def write_pdf(path: Path, lines: list[str]) -> None:
    pdf = canvas.Canvas(str(path))
    text = pdf.beginText(54, 790)
    text.setLeading(14)
    for line in lines:
        text.textLine(line)
    pdf.drawText(text)
    pdf.showPage()
    pdf.save()


def options(prefix: str) -> list[str]:
    return [f"{letter}) {prefix} option {letter} contains original synthetic text" for letter in "ABCDE"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    exam = [
        "Synthetic YDS Practice - deterministic PDF fixture",
        "1. Which choice completes the first original synthetic question?",
        *options("First"),
        "Questions 2-3 are based on the following passage.",
        "A fictional coastal library lends maps and records local wind patterns for students.",
        "2. What does the fictional library lend to visitors?",
        *options("Second"),
        "3. Which local pattern does the fictional library record?",
        *options("Third"),
    ]
    write_pdf(args.output / "simple-text-exam.pdf", exam)
    write_pdf(args.output / "answer-key.pdf", ["ANSWER KEY", "1. A   2. B   3. C"])
    print(args.output)


if __name__ == "__main__":
    main()

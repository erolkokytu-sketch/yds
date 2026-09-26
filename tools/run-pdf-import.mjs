#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const candidates = [
  process.env.YDS_PYTHON,
  "python3",
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"),
].filter(Boolean);

for (const python of candidates) {
  const probe = spawnSync(python, ["-c", "import pdfplumber"], { stdio: "ignore" });
  if (probe.status === 0) {
    const result = spawnSync(python, ["tools/import_exam.py", ...process.argv.slice(2)], { stdio: "inherit" });
    process.exit(result.status ?? 1);
  }
}

console.error("Python with pdfplumber was not found. Run: python3 -m pip install -r tools/requirements-pdf.txt");
process.exit(1);

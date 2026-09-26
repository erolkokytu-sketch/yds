#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const candidates = [
  process.env.YDS_PYTHON,
  "python3",
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"),
].filter(Boolean);

for (const python of candidates) {
  const probe = spawnSync(python, ["-c", "import pdfplumber, reportlab"], { stdio: "ignore" });
  if (probe.status === 0) {
    const result = spawnSync(python, ["-m", "unittest", "discover", "-s", "test/pdf", "-p", "test_*.py", "-v"], { stdio: "inherit" });
    process.exit(result.status ?? 1);
  }
}
console.error("Python PDF test dependencies were not found.");
process.exit(1);

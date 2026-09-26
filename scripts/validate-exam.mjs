#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateExamPack } from "../src/exam-pack-validator.mjs";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run validate:exam -- <exam-pack.json>");
  process.exitCode = 2;
} else {
  try {
    const absolutePath = resolve(inputPath);
    const examPack = JSON.parse(await readFile(absolutePath, "utf8"));
    const result = validateExamPack(examPack);

    if (result.valid) {
      console.log(`PASS ${inputPath}`);
    } else {
      console.error(`FAIL ${inputPath}`);
      for (const error of result.errors) {
        console.error(`- [${error.code}] ${error.path}: ${error.message}`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`FAIL ${inputPath}: ${error.message}`);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const [packArgument, baseURL = "http://127.0.0.1:4174"] = process.argv.slice(2);
if (!packArgument) {
  console.error("Usage: node scripts/verify-pdf-pack-player.mjs <generated.ydspack> [base-url]");
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.goto(baseURL);
  await page.getByTestId("exam-pack-input").setInputFiles(resolve(packArgument));
  await page.getByRole("dialog").getByRole("button", { name: "Sınavı Ekle" }).click();
  await page.getByRole("button", { name: "Sınava Git" }).click();
  await page.getByTestId("answer-choice").first().click();
  await page.getByRole("button", { name: "Sınavı Bitir" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sınavı Bitir" }).click();
  await page.getByRole("heading", { name: "Sınav Tamamlandı" }).waitFor();
  await page.getByRole("button", { name: "Soruları İncele" }).click();
  await page.getByText("Doğru cevapladın").waitFor();
  console.log("PASS PDF -> .ydspack -> browser importer -> Player -> result -> review");
} finally {
  await browser.close();
}

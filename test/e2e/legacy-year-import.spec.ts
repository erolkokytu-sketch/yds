import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const packs = [
  ["2006-osys-yds-ingilizce.ydspack", "2006 ÖSYS YDS İngilizce", "2006-osys-yds-ingilizce"],
  ["2007-osys-yds-ingilizce.ydspack", "2007 ÖSYS YDS İngilizce", "2007-osys-yds-ingilizce"],
  ["2008-osys-yds-ingilizce.ydspack", "2008 ÖSYS YDS İngilizce", "2008-osys-yds-ingilizce"],
  ["2009-osys-yds-ingilizce.ydspack", "2009 ÖSYS YDS İngilizce", "2009-osys-yds-ingilizce"],
] as const;

test("legacy full packs import, appear on Home, and start", async ({ page }) => {
  const missing = packs.filter(([file]) => !existsSync(resolve("private-exam-packs", file)));
  test.skip(missing.length > 0, "private legacy packs are not in this checkout");

  await page.goto("/");
  for (const [file, title, id] of packs) {
    await page.getByTestId("exam-pack-input").setInputFiles(resolve("private-exam-packs", file));
    const preview = page.getByRole("dialog", { name: title });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("100");
    await expect(page.getByText("must be >= 2013")).toHaveCount(0);
    await preview.getByRole("button", { name: "Sınavı Ekle" }).click();
    await expect(page.getByText("Sınav eklendi")).toBeVisible();
    await page.getByRole("button", { name: "Tamam" }).click();
    await expect(page.locator(`[data-exam-id="${id}"]`)).toBeVisible();
  }

  await page.locator('[data-exam-id="2006-osys-yds-ingilizce"]').getByRole("button", { name: "Sınava Başla" }).click();
  await expect(page.getByText("Soru 1 / 100")).toBeVisible();
});

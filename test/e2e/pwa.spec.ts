import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("production PWA works offline with import, persistence, timer, result, and review", async ({ context, page }) => {
  test.skip(process.env.PWA_E2E !== "1", "production service worker test");
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByRole("heading", { name: "YDS Çalışma" })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cdp = await context.newCDPSession(page);
  const detected = await cdp.send("Page.getAppManifest");
  expect(detected.errors).toEqual([]);
  expect(JSON.parse(detected.data ?? "{}")).toMatchObject({ name: "YDS Çalışma", display: "standalone" });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "YDS Çalışma" })).toBeVisible();
  await page.getByTestId("exam-pack-input").setInputFiles(resolve("fixtures/packs/valid.ydspack"));
  await page.getByRole("dialog").getByRole("button", { name: "Sınavı Ekle" }).click();
  await page.getByRole("button", { name: "Sınava Git" }).click();
  await page.getByTestId("answer-choice").first().click();
  await page.getByRole("button", { name: "Duraklat" }).click();
  await expect(page.getByRole("heading", { name: "Sınav Duraklatıldı" })).toBeVisible();
  await page.waitForTimeout(200);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sınav Duraklatıldı" })).toBeVisible();

  await page.close();
  page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("Duraklatıldı")).toBeVisible();
  await page.getByRole("button", { name: "Devam Et" }).click();
  await expect(page.getByRole("heading", { name: "Sınav Duraklatıldı" })).toBeVisible();
  await page.getByRole("button", { name: "▶ Devam Et" }).click();
  await page.getByRole("button", { name: "Sınavı Bitir" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sınavı Bitir" }).click();
  await expect(page.getByRole("heading", { name: "Sınav Tamamlandı" })).toBeVisible();
  await page.getByRole("button", { name: "Soruları İncele" }).click();
  await expect(page.getByText("Doğru cevapladın")).toBeVisible();
});

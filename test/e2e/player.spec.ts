import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const VALID_PACK_PATH = resolve("fixtures/packs/valid.ydspack");

function monitorBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

function timerSeconds(value: string | null) {
  return (value ?? "0:0:0").split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

test("mobile user flow preserves answers, jumps, and flags", async ({ page }) => {
  const expectNoBrowserErrors = monitorBrowserErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sample YDS Exam" })).toBeVisible();
  await page.getByRole("button", { name: "Sınava Başla" }).click();
  await expect(page.getByText("Soru 1 / 12")).toBeVisible();

  await page.getByTestId("answer-choice").first().click();
  await expect(page.getByText("Soru 2 / 12")).toBeVisible();
  await page.getByRole("button", { name: "← Önceki" }).click();
  await expect(page.getByTestId("answer-choice").first()).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Sorular" }).click();
  await page.getByRole("button", { name: /^Soru 8,/ }).click();
  await expect(page.getByText("Soru 8 / 12")).toBeVisible();
  await page.getByRole("button", { name: "Sonra Bak" }).click();
  await page.getByRole("button", { name: "Sorular" }).click();
  await expect(page.getByRole("button", { name: /Soru 8, mevcut, cevaplanmadı, sonra bak işaretli/ }))
    .toBeVisible();
  expectNoBrowserErrors();
});

test("360x800 viewport has no horizontal overflow and usable controls", async ({ page }) => {
  const expectNoBrowserErrors = monitorBrowserErrors(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Sınava Başla" }).click();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  const firstChoice = page.getByTestId("answer-choice").first();
  await expect(firstChoice).toBeVisible();
  const box = await firstChoice.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);

  const nextButton = page.getByRole("button", { name: "Sonraki →" });
  await nextButton.scrollIntoViewIfNeeded();
  await expect(nextButton).toBeVisible();
  await nextButton.click();
  await expect(page.getByText("Soru 2 / 12")).toBeVisible();
  expectNoBrowserErrors();
});

test("timer pauses privately and resumes the same answered question", async ({ page }) => {
  const expectNoBrowserErrors = monitorBrowserErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sınava Başla" }).click();
  await expect(page.getByText("03:00:00")).toBeVisible();

  await page.getByTestId("answer-choice").first().click();
  await page.getByRole("button", { name: "Duraklat" }).click();
  await expect(page.getByRole("heading", { name: "Sınav Duraklatıldı" })).toBeVisible();
  await expect(page.getByTestId("answer-choice")).toHaveCount(0);
  await expect(page.getByText(/The team kept a detailed/)).toHaveCount(0);

  await page.getByRole("button", { name: "▶ Devam Et" }).click();
  await expect(page.getByText("Soru 1 / 12")).toBeVisible();
  await expect(page.getByTestId("answer-choice").first()).toHaveAttribute("aria-pressed", "true");
  expectNoBrowserErrors();
});

test("timestamp jump expires the exam without waiting three hours", async ({ page }) => {
  const expectNoBrowserErrors = monitorBrowserErrors(page);
  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
  await page.goto("/");
  await page.getByRole("button", { name: "Sınava Başla" }).click();
  await page.clock.fastForward(180 * 60_000 + 1_000);

  await expect(page.getByRole("heading", { name: "Süre Doldu" })).toBeVisible();
  await expect(page.getByText("00:00:00")).toBeVisible();
  await expect(page.locator(".result-grid div", { hasText: "Boş" })).toContainText("12");
  await expect(page.getByText("Tamamlama:")).toContainText("Süre doldu");
  await expect(page.getByTestId("answer-choice")).toHaveCount(0);
  expectNoBrowserErrors();
});

test("manual completion shows persisted results and read-only review filters", async ({ page }) => {
  const expectNoBrowserErrors = monitorBrowserErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sınava Başla" }).click();
  await page.getByTestId("answer-choice").first().click();
  await expect(page.getByText("Soru 2 / 12")).toBeVisible();
  await page.getByTestId("answer-choice").first().click();
  await expect(page.getByText("Soru 3 / 12")).toBeVisible();
  await page.getByRole("button", { name: "Sonra Bak" }).click();
  await page.getByRole("button", { name: "Sınavı Bitir" }).click();

  const dialog = page.getByRole("dialog", { name: "Sınavı bitirmek istediğine emin misin?" });
  await expect(dialog).toContainText("Cevaplanan2");
  await expect(dialog).toContainText("Boş10");
  await expect(dialog).toContainText("Sonra Bak1");
  await dialog.getByRole("button", { name: "Sınavı Bitir" }).click();

  await expect(page.getByRole("heading", { name: "Sınav Tamamlandı" })).toBeVisible();
  await expect(page.locator(".result-grid div", { hasText: "Doğru" })).toContainText("1");
  await expect(page.locator(".result-grid div", { hasText: "Yanlış" })).toContainText("1");
  await expect(page.locator(".result-grid div", { hasText: "Boş" })).toContainText("10");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sınav Tamamlandı" })).toBeVisible();

  await page.getByRole("button", { name: "Soruları İncele" }).click();
  await page.getByRole("button", { name: "Yanlışlar" }).click();
  await expect(page.locator('[data-question-id="q-02"]')).toBeVisible();
  await page.getByRole("button", { name: "Boşlar" }).click();
  await expect(page.locator('[data-question-id="q-03"]')).toBeVisible();
  await page.getByRole("button", { name: "Doğrular" }).click();
  await expect(page.locator('[data-question-id="q-01"]')).toBeVisible();
  await expect(page.getByTestId("answer-choice")).toHaveCount(0);
  await page.getByRole("button", { name: "Sonuçlara Dön" }).click();
  await page.getByRole("button", { name: "Ana Sayfaya Dön" }).click();
  await expect(page.getByText("Son sonuç")).toBeVisible();
  expectNoBrowserErrors();
});

test("reload restores progress and keeps a paused timer frozen", async ({ page }) => {
  const expectNoBrowserErrors = monitorBrowserErrors(page);
  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
  await page.goto("/");
  await page.getByRole("button", { name: "Sınava Başla" }).click();
  await page.getByTestId("answer-choice").first().click();
  await expect(page.getByText("Soru 2 / 12")).toBeVisible();
  await page.getByRole("button", { name: "Sorular" }).click();
  await page.getByRole("button", { name: /^Soru 5,/ }).click();
  await page.getByRole("button", { name: "Sonra Bak" }).click();
  await page.clock.fastForward(5_000);
  await expect(page.locator(".exam-timer span")).toHaveText("02:59:55");

  await page.reload();
  await expect(page.getByText("Soru 5 / 12")).toBeVisible();
  const restoredSeconds = timerSeconds(await page.locator(".exam-timer span").textContent());
  expect(restoredSeconds).toBeLessThanOrEqual(2 * 3600 + 59 * 60 + 55);
  expect(restoredSeconds).toBeGreaterThanOrEqual(2 * 3600 + 59 * 60 + 50);
  await expect(page.getByRole("button", { name: "İşaretlendi" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Sorular" }).click();
  await page.getByRole("button", { name: /Soru 1, cevaplandı/ }).click();
  await expect(page.getByTestId("answer-choice").first()).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Duraklat" }).click();
  const frozen = await page.getByLabel("Duraklatılmış kalan süre").textContent();
  await page.waitForTimeout(100);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sınav Duraklatıldı" })).toBeVisible();
  await expect(page.getByLabel("Duraklatılmış kalan süre")).toHaveText(frozen ?? "");
  expectNoBrowserErrors();
});

test("imports a .ydspack and runs it through persistence, results, review, and export", async ({ page }) => {
  const expectNoBrowserErrors = monitorBrowserErrors(page);
  await page.goto("/");
  await page.getByTestId("exam-pack-input").setInputFiles(VALID_PACK_PATH);
  const preview = page.getByRole("dialog", { name: "Coastal English Practice" });
  await expect(preview).toContainText("3");
  await expect(preview).toContainText("30 dakika");
  await preview.getByRole("button", { name: "Sınavı Ekle" }).click();
  await expect(page.getByText("Sınav eklendi")).toBeVisible();
  await expect(page.locator('[data-exam-id="coastal-english-practice"]')).toBeVisible();
  await page.getByRole("button", { name: "Sınava Git" }).click();

  await expect(page.getByText("Soru 1 / 3")).toBeVisible();
  await page.getByTestId("answer-choice").first().click();
  await expect(page.getByText("Soru 2 / 3")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Soru 2 / 3")).toBeVisible();
  await page.getByRole("button", { name: "Duraklat" }).click();
  await page.getByRole("button", { name: "▶ Devam Et" }).click();
  await page.getByRole("button", { name: "Sınavı Bitir" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sınavı Bitir" }).click();
  await expect(page.getByRole("heading", { name: "Sınav Tamamlandı" })).toBeVisible();
  await expect(page.locator(".result-grid div", { hasText: "Doğru" })).toContainText("1");
  await page.getByRole("button", { name: "Soruları İncele" }).click();
  await expect(page.getByText("Doğru cevapladın")).toBeVisible();
  await page.getByRole("button", { name: "Sonuçlara Dön" }).click();
  await page.getByRole("button", { name: "Ana Sayfaya Dön" }).click();
  await page.reload();
  const installedCard = page.locator('[data-exam-id="coastal-english-practice"]');
  await expect(installedCard).toContainText("Son sonuç");
  const downloadPromise = page.waitForEvent("download");
  await installedCard.getByRole("button", { name: "Sınav Paketini Dışa Aktar" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("coastal-english-practice.ydspack");
  expectNoBrowserErrors();
});

test("rejects importing an identical pack twice", async ({ page }) => {
  const expectNoBrowserErrors = monitorBrowserErrors(page);
  await page.goto("/");
  const input = page.getByTestId("exam-pack-input");
  await input.setInputFiles(VALID_PACK_PATH);
  await page.getByRole("dialog").getByRole("button", { name: "Sınavı Ekle" }).click();
  await expect(page.getByText("Sınav eklendi")).toBeVisible();
  await input.setInputFiles(VALID_PACK_PATH);
  await expect(page.getByRole("alert")).toContainText("Bu sınav zaten yüklü.");
  await expect(page.locator('[data-exam-id="coastal-english-practice"]')).toHaveCount(1);
  expectNoBrowserErrors();
});

import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.getByTestId("answer-choice")).toHaveCount(0);
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

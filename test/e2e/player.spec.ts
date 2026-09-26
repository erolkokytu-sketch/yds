import { expect, test, type Page } from "@playwright/test";

function monitorBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors).toEqual([]);
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

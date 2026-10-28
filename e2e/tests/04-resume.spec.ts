import path from "node:path";
import { expect, test } from "@playwright/test";
import { newUser, pageFor } from "../helpers";

const fixture = (name: string) => path.join(__dirname, "..", "fixtures", name);

test("a resume PDF becomes a plan; a text file named .pdf is refused", async ({ browser, request }) => {
  const user = await newUser(request);
  const page = await pageFor(browser, user, "/new?from=resume");
  const prepare = page.getByRole("button", { name: "Prepare my interview" });

  await test.step("a text file renamed to .pdf is refused by the server", async () => {
    await page.getByTestId("resume-input").setInputFiles(fixture("not-a-pdf.pdf"));
    await expect(page.getByText("not-a-pdf.pdf")).toBeVisible();
    await prepare.click();
    const toast = page.getByRole("region", { name: /Notifications/ }).getByRole("listitem");
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText("Could not start");
    await expect(toast).toContainText("Upload a PDF or a Word (.docx) file.");
    await expect(page).toHaveURL(/\/new/);
  });

  await test.step("a real PDF resume is read and planned", async () => {
    await page.getByTestId("resume-input").setInputFiles(fixture("resume.pdf"));
    await expect(page.getByText("resume.pdf", { exact: true })).toBeVisible();
    await prepare.click();
    await expect(page).toHaveURL(/\/i\/[0-9A-Z]{26}$/);
    await expect(page.getByText("Ready to start")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/From your resume · .* rounds · \d+ questions/)).toBeVisible();
    expect(await page.getByRole("heading", { level: 3 }).count()).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId("start-interview")).toBeEnabled();
  });

  await page.context().close();
});

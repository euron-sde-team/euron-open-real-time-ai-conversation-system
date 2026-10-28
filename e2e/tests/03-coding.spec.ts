import { expect, test } from "@playwright/test";
import { answerBox, jdInterview, newUser, pageFor, waitForScores } from "../helpers";

const SOLUTION = `def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
    return []`;

test("run through to the coding question, submit code, finish, and see the code answer scored", async ({ browser, request }) => {
  const user = await newUser(request);
  const iv = await jdInterview(request, user);
  const plan = iv.plan ?? [];
  const codeRound = plan.findIndex((r) => r.questions.some((q) => q.code));
  expect(codeRound, "the stub planner adds a coding round for a technical role").toBeGreaterThan(-1);
  const before = plan.slice(0, codeRound).reduce((n, r) => n + r.questions.length, 0);
  const page = await pageFor(browser, user, `/room/${iv.id}`);
  const next = page.getByTestId("next-question");

  await test.step("join by typing and move through the voice questions", async () => {
    await page.getByRole("button", { name: "Type instead of speaking" }).click();
    for (let i = 0; i < before; i++) {
      await expect(answerBox(page)).toBeEnabled({ timeout: 20_000 });
      await answerBox(page).fill(`Answer ${i + 1}: I would measure first, then change one thing at a time and keep the tests green.`);
      await answerBox(page).press("Enter");
      await expect(page.getByTestId("transcript").getByText(`Answer ${i + 1}:`)).toBeVisible();
      await expect(next).toHaveText(/Next question/);
      await next.click();
    }
  });

  await test.step("the coding question opens the editor; type a solution and submit", async () => {
    await expect(next).toHaveText(/Submit code/, { timeout: 20_000 });
    await expect(page.getByRole("status").filter({ hasText: "Write your solution, then submit" })).toBeVisible();
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.insertText(SOLUTION);
    await expect(editor).toContainText("return [seen[target - n], i]");
    await next.click();
  });

  await test.step("answer the last question with Finish and land on the report", async () => {
    await expect(next).toHaveText(/Finish/, { timeout: 20_000 });
    await expect(answerBox(page)).toBeEnabled();
    await answerBox(page).fill("In two years I want to lead a platform team that other engineers enjoy building on.");
    await answerBox(page).press("Enter");
    await next.click();
    await expect(page).toHaveURL(/\/i\/[0-9A-Z]{26}\/report$/, { timeout: 20_000 });
  });

  await test.step("the code answer is scored, and its code and transcript expand", async () => {
    await waitForScores(page);
    const row = page.getByTestId(`report-question-${codeRound}-0`);
    await expect(row).toContainText(/Domain 80 · Communication 76 · Code/);
    await row.getByRole("button").first().click();
    await expect(row.getByText("Submitted code")).toBeVisible();
    await expect(row.locator("pre").filter({ hasText: "def two_sum" })).toContainText("return [seen[target - n], i]");
    await row.getByText("Transcript").click();
    await expect(row.getByText("Interviewer").first()).toBeVisible();
  });

  await page.context().close();
});

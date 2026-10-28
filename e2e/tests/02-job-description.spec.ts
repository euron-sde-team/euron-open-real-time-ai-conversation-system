import { expect, test } from "@playwright/test";
import { answerBox, JD, newUser, pageFor, waitForScores } from "../helpers";

test("plan from a job description, edit a question, answer it by typing, end, and read the scored report", async ({ browser, request }) => {
  const user = await newUser(request);
  const page = await pageFor(browser, user, "/new?from=jd");
  const edited = "Tell me about the backend system you are proudest of and why.";
  const answer = "I built a billing service in Python that handles a million invoices a month on Postgres.";

  await test.step("create from a job description and see the plan", async () => {
    await page.locator("#company").fill(JD.company);
    await page.locator("#role").fill(JD.role);
    await page.locator("#jd").fill(JD.jobDescription);
    await page.getByRole("button", { name: "Prepare my interview" }).click();
    await expect(page).toHaveURL(/\/i\/[0-9A-Z]{26}$/);
    await expect(page.getByText("Ready to start")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1, name: `${JD.role} at ${JD.company}` })).toBeVisible();
    expect(await page.getByRole("heading", { level: 3 }).count()).toBeGreaterThanOrEqual(3);
  });

  await test.step("edit the first question and save; the edit survives a reload", async () => {
    await page.getByRole("button", { name: "Edit questions" }).click();
    await page.getByLabel("Round 1, question 1").fill(edited);
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("button", { name: "Edit questions" })).toBeVisible();
    await page.reload();
    await expect(page.getByText(edited)).toBeVisible();
  });

  await test.step("start, and join by typing", async () => {
    await page.getByTestId("start-interview").click();
    await expect(page).toHaveURL(/\/room\/[0-9A-Z]{26}$/);
    await page.getByRole("button", { name: "Type instead of speaking" }).click();
    await expect(page.getByTestId("transcript").getByText(edited)).toBeVisible();
  });

  await test.step("answer by typing; the transcript shows the answer and the interviewer's reply", async () => {
    await answerBox(page).fill(answer);
    await answerBox(page).press("Enter");
    const transcript = page.getByTestId("transcript");
    await expect(transcript.getByText(answer)).toBeVisible();
    await expect(transcript.getByText(/press Next question when you are done/)).toBeVisible();
  });

  await test.step("Next question moves on to question 1.2", async () => {
    await page.getByTestId("next-question").click();
    await expect(page.getByTestId("transcript").getByText("Question 1.2")).toBeVisible({ timeout: 20_000 });
    await expect(answerBox(page)).toBeEnabled();
  });

  await test.step("End and Finish opens the report with a scored answer", async () => {
    await page.getByRole("button", { name: "End", exact: true }).click();
    await page.getByRole("button", { name: "Finish and see report" }).click();
    await expect(page).toHaveURL(/\/i\/[0-9A-Z]{26}\/report$/);
    await waitForScores(page);
    const first = page.getByTestId("report-question-0-0");
    await expect(first).toContainText(/Domain \d+ · Communication \d+/);
    await expect(page.getByText(/^1 of \d+ questions answered/)).toBeVisible();
    await first.getByRole("button").click();
    await first.getByText("Transcript").click();
    await expect(first.getByText(answer)).toBeVisible();
  });

  await page.context().close();
});

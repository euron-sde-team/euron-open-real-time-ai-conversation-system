import { expect, test } from "@playwright/test";
import { completedInterview, newContext, newUser, pageFor, waitForScores } from "../helpers";

test("share a report without the transcript, read it signed out, revoke it in Settings", async ({ browser, request }) => {
  const user = await newUser(request);
  const iv = await completedInterview(request, user);
  const page = await pageFor(browser, user, `/i/${iv.id}/report`);
  let url = "";

  await test.step("create a link without the transcript", async () => {
    await waitForScores(page);
    await page.getByTestId("share-report").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await dialog.getByRole("button", { name: "Create link" }).click();
    url = await dialog.getByLabel("Share link").inputValue();
    expect(url).toMatch(/\/s\/[^/]+$/);
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  const visitor = await newContext(browser);
  const shared = await visitor.newPage();

  await test.step("a signed-out visitor sees the scores but no transcript", async () => {
    await shared.goto(url);
    await expect(shared.getByText("Shared interview report")).toBeVisible();
    await expect(shared.getByText("Overall", { exact: false }).first()).toBeVisible();
    const first = shared.getByTestId("report-question-0-0");
    await expect(first).toContainText(/Domain \d+ · Communication \d+/);
    await first.getByRole("button").click();
    await expect(first.getByText("Strengths")).toBeVisible();
    await expect(first.getByText("Transcript")).toHaveCount(0);
    await expect(shared.getByText("six years building Python")).toHaveCount(0);
    await expect(shared.getByTestId("account-menu")).toHaveCount(0);
  });

  await test.step("revoke it in Settings, Shared links", async () => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Shared links" }).click();
    const list = page.getByTestId("shares-list");
    await expect(list.getByText("Scores only, no transcript")).toBeVisible();
    await list.locator('[data-testid^="share-revoke-"]').click();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("toast-success").filter({ hasText: "Link revoked" })).toBeVisible();
    await expect(list.getByText("No shared links")).toBeVisible();
  });

  await test.step("the public page now says the link does not work", async () => {
    await shared.reload();
    await expect(shared.getByText("This link does not work")).toBeVisible();
  });

  await visitor.close();
  await page.context().close();
});

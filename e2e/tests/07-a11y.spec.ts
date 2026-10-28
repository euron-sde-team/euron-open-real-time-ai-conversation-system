import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { jdInterview, newUser, pageFor, completedInterview } from "../helpers";

// Runs when @axe-core/playwright is installed (a root dev dependency); skips otherwise.
const require = createRequire(__filename);
let AxeBuilder: (new (opts: { page: Page }) => { withTags(t: string[]): { analyze(): Promise<{ violations: { id: string; impact?: string | null; help: string; nodes: { target: unknown[] }[] }[] }> } }) | null = null;
try {
  AxeBuilder = require("@axe-core/playwright").default;
} catch {
  AxeBuilder = null;
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder!({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")})`);
}

test("home, plan and report have no serious or critical axe violations", async ({ browser, request }) => {
  test.skip(!AxeBuilder, "@axe-core/playwright is not installed");
  const user = await newUser(request);
  const planned = await jdInterview(request, user);
  const done = await completedInterview(request, user);
  const page = await pageFor(browser, user);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto(`/i/${planned.id}`);
  await expect(page.getByTestId("start-interview")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto(`/i/${done.id}/report`);
  await expect(page.getByRole("heading", { name: "Question by question" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.context().close();
});

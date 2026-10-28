import { expect, test } from "@playwright/test";
import { apiLogin, as, completedInterview, DEMO, newUser, pageFor, uniq } from "../helpers";

type Tier = { id: string; name: string; monthlyInterviews: number | null };

test("an admin opens the console, sees interviews, and edits a quota tier", async ({ browser, request }) => {
  const admin = await apiLogin(request, DEMO.admin);
  // At least one interview exists whatever else ran before.
  await completedInterview(request, await newUser(request));
  // A throwaway tier, so the deployment's real tiers are never touched.
  const name = uniq("tier");
  const tiers = await as<Tier[]>(request, admin, "POST", "/admin/tiers", { name, monthlyInterviews: 3, monthlyVoiceMinutes: 30, maxSessionMinutes: 15, isDefault: false });
  const tier = tiers.find((t) => t.name === name)!;
  const page = await pageFor(browser, admin, "/admin");

  try {
    await test.step("the overview opens", async () => {
      await expect(page.getByTestId("admin-overview")).toBeVisible();
    });

    await test.step("the interviews list has rows", async () => {
      await page.getByTestId("admin-nav-interviews").click();
      await expect(page).toHaveURL(/\/admin\/interviews/);
      await expect(page.locator('[data-testid^="interview-row-"]').first()).toBeVisible();
    });

    await test.step("change a tier's monthly interviews and see it saved", async () => {
      await page.goto("/admin/quotas");
      const row = page.getByTestId(`tier-row-${name}`);
      await expect(row).toContainText("3");
      await row.click();
      const dialog = page.getByTestId("tier-dialog");
      await dialog.getByTestId("tier-interviews").fill("7");
      await dialog.getByTestId("tier-save").click();
      await expect(page.getByTestId("toast-success").filter({ hasText: "Tier saved" })).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId(`tier-row-${name}`).getByRole("cell").nth(1)).toHaveText("7");
      const saved = (await as<Tier[]>(request, admin, "GET", "/admin/tiers")).find((t) => t.id === tier.id);
      expect(saved?.monthlyInterviews).toBe(7);
    });
  } finally {
    await as(request, admin, "DELETE", `/admin/tiers/${tier.id}`);
    await page.context().close();
  }
});

test("a normal account gets the forbidden page at /admin", async ({ browser, request }) => {
  const user = await newUser(request);
  const page = await pageFor(browser, user, "/admin");
  await expect(page.getByTestId("admin-forbidden")).toBeVisible();
  await expect(page.getByText("This area is for admins")).toBeVisible();
  await page.context().close();
});

import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { clientIp, newContext, signIn, signOut, uniq } from "../helpers";

test("sign up in the UI, sign out, a wrong password is refused, the right one signs in", async ({ browser }) => {
  const ctx = await newContext(browser, clientIp());
  const page = await ctx.newPage();
  const username = uniq("su");
  const user = { email: `${username}@example.com`, password: `Pw-${randomBytes(9).toString("base64url")}` };

  await test.step("sign up lands on home, signed in", async () => {
    await page.goto("/signup");
    await page.locator("#email").fill(user.email);
    await page.locator("#displayName").fill("Signup Tester");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(user.password);
    await page.getByTestId("signup-submit").click();
    await expect(page.getByRole("heading", { name: "Ready when you are, Signup." })).toBeVisible();
    await expect(page.getByTestId("account-menu").first()).toBeVisible();
  });

  await test.step("the session survives a reload", async () => {
    await page.reload();
    await expect(page.getByTestId("account-menu").first()).toBeVisible();
  });

  await test.step("sign out, and private pages ask to sign in", async () => {
    await signOut(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);
  });

  await test.step("a wrong password is refused", async () => {
    await page.locator("#login").fill(user.email);
    await page.locator("#password").fill(`${user.password}-wrong`);
    await page.getByTestId("login-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: "is not right" })).toBeVisible();
    await expect(page.getByTestId("account-menu")).toHaveCount(0);
  });

  await test.step("the right password signs in", async () => {
    await signIn(page, user);
    await expect(page.getByTestId("account-menu").first()).toBeVisible();
  });

  await ctx.close();
});

import { test, expect } from "@playwright/test";

test("a rejected login requires a fresh CAPTCHA token before retry", async ({ page }) => {
  const tokens: string[] = [];
  await page.route("https://www.google.com/recaptcha/api.js?*", route => route.fulfill({
    contentType: "application/javascript",
    body: `let issued=0;window.grecaptcha={render:(element,options)=>{
      const button=document.createElement('button');button.type='button';button.textContent='Complete test CAPTCHA';
      button.onclick=()=>options.callback('token-'+(++issued));element.append(button);return 1;
    },reset:()=>{}};setTimeout(()=>window.onloadcallback(),100);`,
  }));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/recaptcha-config")) return route.fulfill({ json: { success: true, data: { enabled: true, siteKey: "test-site-key", mode: "v2_checkbox" } } });
    if (path.endsWith("/login")) {
      tokens.push(route.request().postDataJSON().recaptchaToken);
      return route.fulfill({ status: 401, json: { success: false, error: { code: "INVALID_CREDENTIALS", message: "Incorrect email or password." } } });
    }
    return route.fulfill({ status: 401, json: { success: false, error: { code: "INVALID_REFRESH_TOKEN", message: "Sign in" } } });
  });
  await page.goto("/doctor/login");
  await page.getByLabel("Email address").fill("doctor@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Password123!");
  const submit = page.getByRole("button", { name: "Continue to OTP" });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "Complete test CAPTCHA" }).click();
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("Incorrect email or password.");
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "Complete test CAPTCHA" }).click();
  await submit.click();
  await expect(submit).toBeDisabled();
  expect(tokens).toEqual(["token-1", "token-2"]);
});

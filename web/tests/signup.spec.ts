import { test, expect } from "@playwright/test";
import { websiteRegisterSchema } from "../../src/validation/doctorAuth.schemas.js";

for (const scenario of ["success", "gateway", "email"] as const) {
  test(`signup contract and ${scenario} handling without real account creation`, async ({
    page,
  }) => {
    let registrations = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/refresh"))
        return route.fulfill({
          status: 401,
          json: {
            success: false,
            error: { code: "INVALID_REFRESH_TOKEN", message: "Sign in" },
          },
        });
      if (!path.endsWith("/register"))
        return route.fulfill({
          status: 500,
          json: {
            success: false,
            error: { message: "Unexpected test request" },
          },
        });
      registrations++;
      const body = route.request().postDataJSON();
      expect(websiteRegisterSchema.safeParse({ body }).success).toBe(true);
      expect(Object.keys(body).sort()).toEqual([
        "dateOfBirth",
        "email",
        "licenseNumber",
        "password",
        "phoneNumber",
        "professionalCategory",
        "timezone",
      ]);
      if (scenario === "gateway")
        return route.fulfill({
          status: 502,
          contentType: "text/html",
          body: "<html>Bad Gateway</html>",
          headers: { "X-Request-Id": "test-gateway-reference" },
        });
      if (scenario === "email")
        return route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "EMAIL_DELIVERY_UNAVAILABLE",
              message: "The verification email could not be sent.",
            },
          },
        });
      return route.fulfill({
        status: 201,
        json: {
          success: true,
          data: {
            challengeToken: "test-proof",
            email: body.email,
            purpose: "VERIFY_EMAIL",
            status: "OTP_SENT",
            retryAfterSeconds: 60,
            otpExpiresInSeconds: 600,
            message: "Check your email.",
          },
        },
      });
    });
    await page.goto("/doctor/register");
    await page.getByLabel("Email address").fill("signup-test@example.test");
    await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
    await page.getByLabel("Phone number").fill("+919876543210");
    await page.getByLabel("Date of birth").fill("1990-01-01");
    await page.getByLabel("Professional category").selectOption("PSYCHOLOGIST");
    await page
      .getByLabel("License / registration number")
      .fill("TEST-NOT-REAL");
    await page.getByRole("button", { name: "Create account" }).click();
    if (scenario !== "success") {
      await expect(page.getByRole("alert")).toContainText(
        scenario === "gateway"
          ? "test-gateway-reference"
          : "verification email could not be sent",
      );
      await page
        .getByRole("link", { name: "Sign in to verify your email" })
        .click();
    }
    await expect(
      page.getByLabel(
        scenario === "success" ? "Verification code" : "Password",
        { exact: true },
      ),
    ).toBeVisible();
    expect(registrations).toBe(1);
  });
}

test("earlier accounts can set a password with a reset code", async ({
  page,
}) => {
  const requests: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/refresh"))
      return route.fulfill({
        status: 401,
        json: { success: false, error: { message: "Sign in" } },
      });
    requests.push({ path, body: route.request().postDataJSON() });
    return route.fulfill({ json: { success: true, data: {} } });
  });
  await page.goto("/doctor/forgot-password");
  await page.getByLabel("Email address").fill("existing@example.test");
  await page
    .getByRole("button", { name: "Request password-reset code" })
    .click();
  await page.getByLabel("Reset code").fill("123456");
  await page.getByLabel("New password").fill("UpdatedPassword123!");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("status")).toContainText("Password saved.");
  expect(requests).toEqual([
    {
      path: "/api/auth/forgot-password",
      body: { email: "existing@example.test" },
    },
    {
      path: "/api/auth/reset-password",
      body: {
        email: "existing@example.test",
        otp: "123456",
        newPassword: "UpdatedPassword123!",
      },
    },
  ]);
});

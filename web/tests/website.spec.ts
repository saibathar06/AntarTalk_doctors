import { test, expect, type Page } from "@playwright/test";

// Isolated contract fixtures only: never imported by production code or seeded into a database.
const profile = {
  id: "test-doctor",
  firstName: "Test",
  lastName: "Professional",
  email: "test@example.test",
  phoneNumber: "+919876543210",
  dateOfBirth: "1990-01-01",
  professionalCategory: "PSYCHOLOGIST",
  professionalStatus: "LICENSED_PROFESSIONAL",
  verificationStatus: "PENDING",
  licenseNumber: "TEST-ONLY",
  timezone: "Asia/Kolkata",
  bio: null,
  qualification: null,
  institution: null,
  graduationYear: null,
  experienceYears: null,
  languages: [],
  expertise: [],
  consultationFee: null,
  profileImageUrl: null,
  licenseDocumentUrl: null,
  profileCompleted: false,
  completionPercentage: 33,
  missingFields: ["photo"],
  isAcceptingBookings: false,
  canTakeSessions: false,
  emailNotifications: true,
};
const empty = {
  items: [],
  pagination: { page: 1, limit: 20, total: 0, pages: 0 },
};
async function mockWorkspace(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/refresh")
      ? { accessToken: "test-only" }
      : path.endsWith("/profile")
        ? profile
        : path.endsWith("/dashboard")
          ? {
              todaySessions: 0,
              totalClients: 0,
              monthSessions: 0,
              averageRating: null,
              schedule: empty,
            }
          : path.endsWith("/availability") || path.endsWith("/blocked-slots")
            ? []
            : empty;
    await route.fulfill({ json: { success: true, data } });
  });
}
test("OTP entry and browser-protected navigation", async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 401,
      json: {
        success: false,
        error: { code: "INVALID_REFRESH_TOKEN", message: "Sign in" },
      },
    }),
  );
  await page.goto("/doctor/dashboard");
  await expect(page).toHaveURL(/\/doctor\/login/);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/login-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("real empty states, profile completion, navigation and responsive layout", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/doctor/dashboard");
  await expect(
    page.getByRole("heading", { name: "Complete your professional profile" }),
  ).toBeVisible();
  await expect(page.getByText("Your day has room to breathe")).toBeVisible();
  await expect(page.getByText("Ratings are not available yet")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/dashboard-${test.info().project.name}.png`,
    fullPage: true,
  });
  for (const route of [
    "schedule",
    "appointments",
    "clients",
    "availability",
    "profile",
    "settings",
    "earnings",
  ]) {
    await page.goto(`/doctor/${route}`);
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      route,
    ).toBe(true);
  }
});
test("availability saves multiple and overnight periods through API", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/doctor/availability");
  await page.getByRole("button", { name: "Add Monday window" }).click();
  await page.getByLabel("Monday start").fill("23:00");
  await page.getByLabel("Monday end").fill("03:00");
  await expect(page.getByText("+1 day")).toBeVisible();
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/doctor/availability") &&
      request.method() === "PUT",
  );
  await page.getByRole("button", { name: "Save working hours" }).click();
  expect((await request).postDataJSON()).toEqual({
    timezone: "Asia/Kolkata",
    windows: [
      { dayOfWeek: 1, startTime: "23:00", endTime: "03:00", isActive: true },
    ],
  });
  await expect(page.getByText("Working hours saved.")).toBeVisible();
});
test("sign-in requests an email code and keeps tokens out of browser storage", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: path.endsWith("/refresh") ? 401 : 200,
      json: path.endsWith("/refresh")
        ? {
            success: false,
            error: { code: "INVALID_REFRESH_TOKEN", message: "Sign in" },
          }
        : { success: true, data: {} },
    });
  });
  await page.goto("/doctor/login");
  await page.getByLabel("Email or phone number").fill("test@example.test");
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/send-otp"),
  );
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  expect((await request).postDataJSON()).toEqual({
    identifier: "test@example.test",
    purpose: "DOCTOR_LOGIN",
  });
  await expect(page.getByLabel("Verification code")).toBeVisible();
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});
test("profile edits persist through the API and never submit completion flags", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/doctor/profile");
  await page
    .getByLabel("Qualification", { exact: true })
    .fill("MSc Psychology");
  await page.getByLabel("Years of experience").fill("0");
  await page.getByLabel("Short bio").fill("A test-only professional profile.");
  await page.getByLabel("Languages (comma separated)").fill("English, Hindi");
  await page.getByLabel("Areas of expertise (comma separated)").fill("Anxiety");
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/doctor/profile") &&
      request.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save profile" }).click();
  const body = (await request).postDataJSON();
  expect(body.languages).toEqual(["English", "Hindi"]);
  expect(body.experienceYears).toBe(0);
  expect(body).not.toHaveProperty("verificationStatus");
  expect(body).not.toHaveProperty("profileCompleted");
  await expect(page.getByRole("status")).toContainText("Profile saved");
});
test("join button follows backend permission and cannot fake a video room", async ({
  page,
}) => {
  await mockWorkspace(page);
  const item = {
    id: "test-booking",
    clientLabel: "Client TEST-ONLY",
    sessionType: "Therapy session",
    status: "CONFIRMED",
    startTime: "2030-01-01T10:00:00Z",
    endTime: "2030-01-01T11:00:00Z",
    sessionDurationMinutes: 40,
    bufferDurationMinutes: 20,
    join: { state: "NOT_YET", canJoin: false },
  };
  await page.route("**/api/doctor/appointments?*", (route) =>
    route.fulfill({
      json: { success: true, data: { ...empty, items: [item] } },
    }),
  );
  await page.goto("/doctor/appointments");
  await expect(
    page.getByRole("button", { name: "Not ready to join" }),
  ).toBeDisabled();
  item.join = { state: "READY", canJoin: true };
  await page.reload();
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/sessions/test-booking/join"),
  );
  await page.getByRole("button", { name: "Join session" }).click();
  expect((await request).method()).toBe("POST");
  await expect(page.getByText(/Video calling is not configured/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

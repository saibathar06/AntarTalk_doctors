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
      : path.endsWith("/auth/me")
        ? { id: "test-doctor", role: "DOCTOR" }
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
        : {
            success: true,
            data: {
              challengeToken: "test-proof",
              email: "test@example.test",
              purpose: "DOCTOR_LOGIN",
              status: "OTP_SENT",
              retryAfterSeconds: 0,
              otpExpiresInSeconds: 600,
              message: "Your verification email was sent.",
            },
          },
    });
  });
  await page.goto("/doctor/login");
  await page.getByLabel("Email address").fill("test@example.test");
  await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/login"),
  );
  await page.getByRole("button", { name: "Continue to OTP" }).click();
  expect((await request).postDataJSON()).toEqual({
    email: "test@example.test",
    password: "TestPassword123!",
  });
  await expect(page.getByLabel("Verification code")).toBeVisible();
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  expect(
    await page.evaluate(() => JSON.stringify(history.state)),
  ).not.toContain("TestPassword123!");
  await page.getByRole("button", { name: "Resend code", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Your verification email was sent.",
  );
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Enter email and password to continue" }),
  ).toBeVisible();
});

test("admin sees only the verification queue and can reject with a reason", async ({
  page,
}) => {
  const review = {
    id: "11111111-1111-4111-8111-111111111111",
    firstName: "Review",
    lastName: "Doctor",
    email: "review@example.test",
    phoneNumber: "+919876543210",
    professionalCategory: "PSYCHOLOGIST",
    professionalStatus: "LICENSED_PROFESSIONAL",
    licenseNumber: "TEST-LICENSE",
    licenseAuthority: "Test authority",
    university: null,
    course: null,
    specialization: null,
    expectedGraduationDate: null,
    enrollmentNumber: null,
    qualification: "MSc Psychology",
    institution: "Test University",
    graduationYear: 2020,
    experienceYears: 3,
    bio: "Test profile only.",
    languages: ["English"],
    expertise: ["Anxiety"],
    profileImageUrl: null,
    licenseDocumentUrl: null,
    hasLicenseDocument: false,
    verificationStatus: "PENDING",
    verificationSubmittedAt: "2030-01-01T10:00:00Z",
    verificationReason: null,
    isAcceptingBookings: false,
    updatedAt: "2030-01-01T10:01:00Z",
    timezone: "Asia/Kolkata",
  };
  let decision: unknown;
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/refresh"))
      return route.fulfill({
        json: { success: true, data: { accessToken: "admin-token" } },
      });
    if (url.pathname.endsWith("/auth/me"))
      return route.fulfill({
        json: { success: true, data: { id: "admin", role: "ADMIN" } },
      });
    if (url.pathname.endsWith("/verification-requests"))
      return route.fulfill({
        json: {
          success: true,
          data: {
            items: [review],
            pagination: { page: 1, limit: 25, total: 1, pages: 1 },
          },
        },
      });
    if (url.pathname.endsWith("/verification")) {
      decision = route.request().postDataJSON();
      return route.fulfill({ json: { success: true, data: {} } });
    }
    return route.fulfill({
      status: 500,
      json: { success: false, error: { message: "Unexpected test request" } },
    });
  });
  await page.goto("/doctor/admin");
  await page.getByRole("button", { name: "Review Doctor" }).click();
  await page
    .getByLabel("Rejection reason")
    .fill("Please upload a current license document.");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(
    page.getByText("Verification request rejected with the reason provided."),
  ).toBeVisible();
  expect(decision).toEqual({
    status: "REJECTED",
    reason: "Please upload a current license document.",
    expectedUpdatedAt: review.updatedAt,
  });
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

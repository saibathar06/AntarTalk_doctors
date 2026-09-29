import { test, expect, type Page } from "@playwright/test";
import { DateTime } from "luxon";

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
  gender: "FEMALE",
  licenseNumber: "TEST-ONLY",
  timezone: "Asia/Kolkata",
  bio: null,
  qualification: null,
  institution: null,
  graduationYear: null,
  experienceYears: null,
  languages: [],
  preferredSessionLanguage: null,
  expertise: [],
  consultationFee: "1200.00",
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
async function mockWorkspace(page: Page, doctorProfile = profile) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/refresh")
      ? { accessToken: "test-only" }
      : path.endsWith("/availability/default-timing")
        ? null
        : path.endsWith("/auth/me")
          ? { id: "test-doctor", role: "DOCTOR" }
          : path.endsWith("/profile")
            ? doctorProfile
            : path.endsWith("/dashboard")
              ? {
                  todaySessions: 0,
                  totalClients: 0,
                  monthSessions: 0,
                  earnings: [],
                  averageRating: null,
                  schedule: empty,
                }
              : path.endsWith("/availability") ||
                  path.endsWith("/availability/slots") ||
                  path.endsWith("/blocked-slots") ||
                  path.endsWith("/availability/presets")
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
  await expect(
    page.getByText("Net earnings from completed financial records"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/dashboard-${test.info().project.name}.png`,
    fullPage: true,
  });
  for (const route of ["profile", "settings"]) {
    await page.goto(`/doctor/${route}`);
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      route,
    ).toBe(true);
  }
  for (const route of ["appointments", "clients", "availability", "earnings"]) {
    await page.goto(`/doctor/${route}`);
    await expect(page).toHaveURL(/\/doctor\/dashboard$/);
  }
});
test("availability saves multiple and overnight periods through API", async ({
  page,
}) => {
  await mockWorkspace(page, {
    ...profile,
    verificationStatus: "VERIFIED",
    isAcceptingBookings: true,
    profileCompleted: true,
  });
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
      {
        dayOfWeek: 1,
        availableDate: DateTime.now()
          .setZone("Asia/Kolkata")
          .plus({
            days: (8 - DateTime.now().setZone("Asia/Kolkata").weekday) % 7,
          })
          .toISODate(),
        startTime: "23:00",
        endTime: "03:00",
        isActive: true,
        useDefault: false,
      },
    ],
  });
  await expect(page.getByText("Working hours saved.")).toBeVisible();
});

test("default timing applies to seven days and permits a custom daily override", async ({
  page,
}) => {
  await mockWorkspace(page, {
    ...profile,
    verificationStatus: "VERIFIED",
    isAcceptingBookings: true,
  });
  let timing: { startTime: string; endTime: string } | null = null;
  await page.route(
    "**/api/doctor/availability/default-timing",
    async (route) => {
      if (route.request().method() === "PUT")
        timing = route.request().postDataJSON().timing;
      return route.fulfill({ json: { success: true, data: timing } });
    },
  );
  await page.route("**/api/doctor/availability", async (route) => {
    const today = DateTime.now().setZone("Asia/Kolkata");
    const rows = timing
      ? Array.from({ length: 7 }, (_, offset) => ({
          ...timing,
          dayOfWeek: today.plus({ days: offset }).weekday,
          availableDate: today.plus({ days: offset }).toISODate(),
          isActive: true,
          useDefault: true,
        }))
      : [];
    return route.fulfill({ json: { success: true, data: rows } });
  });
  await page.goto("/doctor/availability");
  await expect(page.getByLabel("Favorite name")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Morning|Afternoon|Evening/ }),
  ).toHaveCount(0);
  await page.getByLabel("Starting time").fill("09:00");
  await page.getByLabel("Working until").fill("15:00");
  await page.getByRole("button", { name: "Save default timing" }).click();
  await expect(page.locator(".day-windows input[type=time]")).toHaveCount(14);
  await page.reload();
  const day = DateTime.now().setZone("Asia/Kolkata").toFormat("cccc");
  await expect(page.getByLabel(day + " start", { exact: true })).toHaveValue(
    "09:00",
  );
  await page.getByLabel(day + " start", { exact: true }).fill("10:00");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/doctor/availability") && r.method() === "PUT",
  );
  await page.getByRole("button", { name: "Save working hours" }).click();
  const rows = (await request).postDataJSON().windows;
  expect(
    rows.filter((row: { useDefault: boolean }) => row.useDefault),
  ).toHaveLength(6);
  expect(rows[0]).toMatchObject({
    startTime: "10:00",
    endTime: "15:00",
    useDefault: false,
  });
});

test("generated slots stay inside their day card and can be blocked or unblocked there", async ({
  page,
}) => {
  await mockWorkspace(page, {
    ...profile,
    verificationStatus: "VERIFIED",
    isAcceptingBookings: true,
  });
  const date = DateTime.now()
    .setZone("Asia/Kolkata")
    .startOf("day")
    .plus({ days: 1 });
  const startTime = date.set({ hour: 10 }).toUTC().toISO()!;
  const endTime = date.set({ hour: 11 }).toUTC().toISO()!;
  let blocked: null | {
    id: string;
    startTime: string;
    endTime: string;
    reason: string;
  } = null;
  await page.route("**/api/doctor/availability/slots?*", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: blocked
          ? []
          : [
              {
                doctorId: profile.id,
                startTime,
                endTime,
                sessionDurationMinutes: 40,
                bufferDurationMinutes: 20,
              },
            ],
      },
    }),
  );
  await page.route("**/api/doctor/blocked-slots", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      blocked = { id: "block-one", ...body };
      return route.fulfill({
        status: 201,
        json: { success: true, data: blocked },
      });
    }
    return route.fulfill({
      json: { success: true, data: blocked ? [blocked] : [] },
    });
  });
  await page.route("**/api/doctor/blocked-slots/block-one", async (route) => {
    blocked = null;
    return route.fulfill({ json: { success: true, data: { deleted: true } } });
  });

  await page.goto("/doctor/availability");
  const dayName = date.toFormat("cccc");
  const row = page.locator(".day-row").nth(1);
  await expect(row.getByText("Generated appointment times")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Time away" })).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  const create = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/doctor/blocked-slots") &&
      request.method() === "POST",
  );
  await row.getByRole("button", { name: `Block ${dayName} 10:00 AM` }).click();
  expect((await create).postDataJSON()).toEqual({
    startTime,
    endTime,
    reason: "Unavailable appointment time",
  });
  await expect(
    row.getByRole("button", { name: `Unblock ${dayName} 10:00 AM` }),
  ).toBeVisible();
  await row
    .getByRole("button", { name: `Unblock ${dayName} 10:00 AM` })
    .click();
  await expect(
    row.getByRole("button", { name: `Block ${dayName} 10:00 AM` }),
  ).toBeVisible();
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
    preferredSessionLanguage: "English",
    expertise: ["Anxiety"],
    profileImageUrl: null,
    licenseDocumentUrl: "/uploads/credentials/review-doctor.pdf",
    hasLicenseDocument: true,
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
    if (url.pathname.endsWith("/license-document")) {
      return route.fulfill({
        contentType: "application/pdf",
        body: "%PDF-1.4 test credential document",
      });
    }
    return route.fulfill({
      status: 500,
      json: { success: false, error: { message: "Unexpected test request" } },
    });
  });
  await page.goto("/doctor/admin");
  await page.getByRole("button", { name: "Review Doctor" }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download credential document" })
    .click();
  expect((await download).suggestedFilename()).toBe("credential-document.pdf");
  await expect(
    page.getByText("Credential document download started."),
  ).toBeVisible();
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
test("admin searches the verified doctor directory by name", async ({
  page,
}) => {
  const directoryDoctor = {
    id: "22222222-2222-4222-8222-222222222222",
    firstName: "Asha",
    lastName: "Sharma",
    email: "asha@example.test",
    phoneNumber: "+919876543210",
    gender: "FEMALE",
    professionalCategory: "PSYCHOLOGIST",
    professionalStatus: "LICENSED_PROFESSIONAL",
    licenseNumber: "LIC-12345",
    licenseAuthority: null,
    university: null,
    course: null,
    specialization: null,
    expectedGraduationDate: null,
    enrollmentNumber: null,
    qualification: "MSc Psychology",
    institution: null,
    graduationYear: null,
    experienceYears: 5,
    consultationFee: "1200.00",
    bio: "Verified professional.",
    languages: ["English"],
    preferredSessionLanguage: "English",
    expertise: ["Anxiety"],
    profileImageUrl: null,
    licenseDocumentUrl: null,
    hasLicenseDocument: false,
    verificationStatus: "VERIFIED",
    verificationSubmittedAt: "2030-01-01T10:00:00Z",
    verificationReason: null,
    isAcceptingBookings: true,
    updatedAt: "2030-01-01T10:01:00Z",
    timezone: "Asia/Kolkata",
  };
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
    if (url.pathname.endsWith("/doctors"))
      return route.fulfill({
        json: {
          success: true,
          data: {
            items: [directoryDoctor],
            pagination: { page: 1, limit: 25, total: 1, pages: 1 },
          },
        },
      });
    return route.fulfill({
      json: {
        success: true,
        data: {
          items: [],
          pagination: { page: 1, limit: 25, total: 0, pages: 0 },
        },
      },
    });
  });
  await page.goto("/doctor/admin");
  await expect(
    page.getByRole("heading", { name: "AntarTalk Admin Panel" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "All doctors" }).click();
  await expect(page.getByLabel("Search verified doctors")).toBeVisible();
  await page.getByLabel("Search verified doctors").fill("Asha Sharma");
  const request = page.waitForRequest(
    (item) =>
      item.url().includes("/api/admin/doctors?") &&
      item.url().includes("search=Asha%20Sharma"),
  );
  await page.getByRole("button", { name: "Search" }).click();
  await request;
  await expect(page.getByRole("button", { name: /Asha Sharma/ })).toBeVisible();
  await expect(page.getByText("1 verified doctors")).toBeVisible();
});
test("admin reviews a payout before recording its transfer", async ({
  page,
}) => {
  const payoutId = "22222222-2222-4222-8222-222222222222";
  let status = "PENDING";
  let reviewBody: unknown;
  let completionBody: unknown;
  const item = () => ({
    id: payoutId,
    doctorId: "doctor",
    payoutAccountId: "account",
    amount: "750.00",
    currency: "INR",
    status,
    createdAt: "2030-01-01T10:00:00Z",
    completedAt: null,
    providerReference: null,
    failureReason: null,
    doctor: {
      id: "doctor",
      firstName: "Asha",
      lastName: "Sharma",
      email: "asha@example.test",
    },
    payoutAccount: {
      id: "account",
      type: "UPI",
      displayLabel: "Primary UPI",
      details: { type: "UPI", upiId: "asha@bank" },
    },
  });
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
            items: [],
            pagination: { page: 1, limit: 25, total: 0, pages: 0 },
          },
        },
      });
    if (
      url.pathname.endsWith("/payouts") &&
      route.request().method() === "GET"
    ) {
      const matches = url.searchParams.get("status") === status;
      return route.fulfill({
        json: {
          success: true,
          data: {
            items: matches ? [item()] : [],
            pagination: {
              page: 1,
              limit: 25,
              total: matches ? 1 : 0,
              pages: matches ? 1 : 0,
            },
          },
        },
      });
    }
    if (url.pathname.endsWith(`/payouts/${payoutId}`))
      return route.fulfill({ json: { success: true, data: item() } });
    if (url.pathname.endsWith("/review")) {
      reviewBody = route.request().postDataJSON();
      status = "PROCESSING";
      return route.fulfill({ json: { success: true, data: item() } });
    }
    if (url.pathname.endsWith("/complete")) {
      completionBody = route.request().postDataJSON();
      status = "COMPLETED";
      return route.fulfill({ json: { success: true, data: item() } });
    }
    return route.fulfill({
      status: 500,
      json: { success: false, error: { message: "Unexpected test request" } },
    });
  });
  await page.goto("/doctor/admin");
  await page.getByRole("tab", { name: "Payouts" }).click();
  await page.getByRole("button", { name: /Asha Sharma/ }).click();
  await expect(page.getByText("asha@bank")).toBeVisible();
  await page.getByRole("button", { name: "Approve request" }).click();
  expect(reviewBody).toEqual({ decision: "APPROVE" });
  await page.getByLabel("Request status").selectOption("PROCESSING");
  await page.getByRole("button", { name: /Asha Sharma/ }).click();
  await page.getByLabel("Bank / UPI transfer reference").fill("UTR123456");
  await page.getByRole("button", { name: "Record completed transfer" }).click();
  expect(completionBody).toEqual({ providerReference: "UTR123456" });
  await expect(
    page.getByText("Transfer recorded and payout marked completed."),
  ).toBeVisible();
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
  await page.getByLabel("Preferred session language").selectOption("English");
  await page.getByLabel("Areas of expertise (comma separated)").fill("Anxiety");
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/doctor/profile") &&
      request.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save profile" }).click();
  const body = (await request).postDataJSON();
  expect(body.languages).toEqual(["English", "Hindi"]);
  expect(body.preferredSessionLanguage).toBe("English");
  expect(body.experienceYears).toBe(0);
  expect(body).not.toHaveProperty("verificationStatus");
  expect(body).not.toHaveProperty("profileCompleted");
  await expect(page.getByRole("status")).toContainText("Profile saved");
});
test("a verified doctor explicitly enters edit mode and cannot alter verified credentials", async ({
  page,
}) => {
  const verifiedProfile = {
    ...profile,
    firstName: "Asha",
    lastName: "Sharma",
    gender: "FEMALE",
    dateOfBirth: "1990-01-01T00:00:00.000Z",
    phoneNumber: "+919876543210",
    professionalCategory: "PSYCHOLOGIST",
    professionalStatus: "LICENSED_PROFESSIONAL",
    licenseNumber: "LIC-12345",
    qualification: "MSc Psychology",
    experienceYears: 5,
    bio: "Client-facing bio.",
    languages: ["English"],
    preferredSessionLanguage: "English",
    expertise: ["Anxiety"],
    consultationFee: "1200.00",
    profileImageUrl: "/api/doctor/files/photo.jpg",
    profileCompleted: true,
    completionPercentage: 100,
    missingFields: [],
    verificationStatus: "VERIFIED",
    isAcceptingBookings: true,
    canTakeSessions: true,
  };
  await mockWorkspace(page, verifiedProfile);
  await page.goto("/doctor/profile");
  await expect(page.getByText("Profile complete and verified")).toBeVisible();
  await expect(page.getByLabel("First name")).toBeDisabled();
  await expect(page.getByLabel("License / registration number")).toBeDisabled();
  await page.getByRole("button", { name: "Edit personal details" }).click();
  await expect(page.getByLabel("First name")).toBeEnabled();
  await expect(page.getByLabel("License / registration number")).toBeDisabled();
  await page.getByLabel("First name").fill("Asha Updated");
  const request = page.waitForRequest(
    (item) =>
      item.url().endsWith("/api/doctor/profile") && item.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save profile" }).click();
  const body = (await request).postDataJSON();
  expect(body.firstName).toBe("Asha Updated");
  expect(body).not.toHaveProperty("licenseNumber");
  await expect(page.getByRole("status")).toContainText(
    "verification remains active",
  );
});
test("join button follows backend permission and embeds only the authorized video room", async ({
  page,
}) => {
  await mockWorkspace(page, {
    ...profile,
    verificationStatus: "VERIFIED",
    isAcceptingBookings: true,
    profileCompleted: true,
  });
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
  await page.route("**/api/doctor/sessions/test-booking/join", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          launchUrl: "https://video.test/call?ticket=one-use",
          videoOrigin: "https://video.test",
          expiresAt: "2030-01-01T09:59:00Z",
        },
      },
    }),
  );
  await page.route("https://video.test/call?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<main>Secure video call</main>",
    }),
  );
  await page.reload();
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/sessions/test-booking/join"),
  );
  await page.getByRole("button", { name: "Join session" }).click();
  expect((await request).method()).toBe("POST");
  await expect(
    page.getByRole("dialog", { name: "AntarTalk video session" }),
  ).toBeVisible();
  await expect(
    page.locator('iframe[title="AntarTalk video session"]'),
  ).toHaveAttribute("src", /https:\/\/video\.test\/call\?ticket=one-use/);
  await page.getByRole("button", { name: "Leave call" }).click();
  await expect(
    page.getByRole("dialog", { name: "AntarTalk video session" }),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

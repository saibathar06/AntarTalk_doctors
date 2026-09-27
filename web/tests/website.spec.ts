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
test("client booking uses the live slot, reservation, and confirmation contracts", async ({
  page,
}) => {
  const doctorId = "11111111-1111-4111-8111-111111111111";
  const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const end = new Date(new Date(start).getTime() + 60 * 60_000).toISOString();
  let reservationRequest: unknown;
  let confirmationRequest: unknown;
  await page.addInitScript(() => {
    window.Razorpay = class {
      // @ts-expect-error Test checkout accepts the production options shape.
      constructor(private options: { handler: (result: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void }) {}
      open() { this.options.handler({ razorpay_payment_id: "pay_test", razorpay_order_id: "order_test", razorpay_signature: "a".repeat(64) }); }
    };
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/bookings/doctors/${doctorId}`) {
      return route.fulfill({
        json: {
          success: true,
          data: {
            id: doctorId,
            firstName: "Asha",
            lastName: "Sharma",
            professionalCategory: "PSYCHOLOGIST",
            specialization: "Anxiety care",
            qualification: "MSc Psychology",
            institution: "Test University",
            experienceYears: 7,
            preferredSessionLanguage: "English",
            languages: ["English"],
            bio: "Public profile.",
            timezone: "Asia/Kolkata",
            verificationStatus: "VERIFIED",
            hasProfileImage: false,
            consultationFee: "1200.00",
          },
        },
      });
    }
    if (url.pathname === "/api/bookings/availability") {
      return route.fulfill({
        json: {
          success: true,
          data: [
            {
              doctorId,
              startTime: start,
              endTime: end,
              sessionDurationMinutes: 40,
              bufferDurationMinutes: 20,
            },
          ],
        },
      });
    }
    if (url.pathname === "/api/auth/login") {
      return route.fulfill({
        json: {
          success: true,
          data: {
            user: { id: "client-id", email: "client@example.test", role: "CLIENT" },
            tokens: { accessToken: "client-token", refreshToken: "x".repeat(48) },
          },
        },
      });
    }
    if (url.pathname === "/api/bookings/reserve") {
      reservationRequest = route.request().postDataJSON();
      expect(route.request().headers().authorization).toBe("Bearer client-token");
      return route.fulfill({
        status: 201,
        json: {
          success: true,
          data: {
            reservationId: "22222222-2222-4222-8222-222222222222",
            expiresAt: new Date(Date.now() + 180_000).toISOString(),
            slot: { doctorId, startTime: start, endTime: end, sessionDurationMinutes: 40, bufferDurationMinutes: 20 },
          },
        },
      });
    }
    if (url.pathname === "/api/bookings/razorpay/order") {
      return route.fulfill({ status: 201, json: { success: true, data: { paymentId: "44444444-4444-4444-8444-444444444444", keyId: "rzp_test_key", orderId: "order_test", amount: 120000, currency: "INR", doctorName: "Asha Sharma", expiresAt: new Date(Date.now() + 180_000).toISOString() } } });
    }
    if (url.pathname === "/api/bookings/razorpay/verify") {
      confirmationRequest = route.request().postDataJSON();
      expect(route.request().headers()["idempotency-key"]).toHaveLength(36);
      return route.fulfill({
        status: 201,
        json: {
          success: true,
          data: {
            id: "33333333-3333-4333-8333-333333333333",
            doctorId,
            clientId: "client-id",
            startTime: start,
            endTime: end,
            sessionDurationMinutes: 40,
            bufferDurationMinutes: 20,
            status: "CONFIRMED",
            paymentId: "44444444-4444-4444-8444-444444444444",
            createdAt: new Date().toISOString(),
          },
        },
      });
    }
    return route.fulfill({
      status: 500,
      json: { success: false, error: { code: "UNEXPECTED", message: "Unexpected test request" } },
    });
  });
  await page.goto(`/book-session/${doctorId}`);
  await expect(page.getByRole("heading", { name: "Dr. Asha Sharma" })).toBeVisible();
  await page.getByLabel("Client email").fill("client@example.test");
  await page.getByLabel("Password").fill("TestPassword123!");
  await page.getByRole("button", { name: "Sign in to book" }).click();
  await page.getByRole("button", { name: /Available/ }).click();
  await page.getByRole("button", { name: "Book session" }).click();
  await expect(page.getByText("Secure Razorpay checkout")).toBeVisible();
  expect(reservationRequest).toEqual({ doctorId, startTime: start });
  await page.getByRole("button", { name: "Pay securely with Razorpay" }).click();
  await expect(page.getByRole("heading", { name: "Session booked successfully" })).toBeVisible();
  expect(confirmationRequest).toEqual({
    reservationId: "22222222-2222-4222-8222-222222222222",
    doctorId,
    startTime: start,
    paymentId: "44444444-4444-4444-8444-444444444444",
    razorpayOrderId: "order_test",
    razorpayPaymentId: "pay_test",
    razorpaySignature: "a".repeat(64),
  });
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
  await expect(page.getByText("Net earnings from completed financial records")).toBeVisible();
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
  await mockWorkspace(page, { ...profile, verificationStatus: "VERIFIED", isAcceptingBookings: true, profileCompleted: true });
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
  await page.route("https://www.google.com/recaptcha/api.js?render=explicit", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "window.grecaptcha={render:(element,options)=>{setTimeout(()=>options.callback('test-recaptcha-token'),0);return 1},reset:()=>{}};",
  }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/recaptcha-config")) return route.fulfill({ json: { success: true, data: { enabled: true, siteKey: "test-site-key" } } });
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
    recaptchaToken: "test-recaptcha-token",
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
  await expect(page.getByText("Credential document download started.")).toBeVisible();
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
test("admin reviews a payout before recording its transfer", async ({ page }) => {
  const payoutId = "22222222-2222-4222-8222-222222222222";
  let status = "PENDING";
  let reviewBody: unknown;
  let completionBody: unknown;
  const item = () => ({
    id: payoutId, doctorId: "doctor", payoutAccountId: "account", amount: "750.00", currency: "INR", status,
    createdAt: "2030-01-01T10:00:00Z", completedAt: null, providerReference: null, failureReason: null,
    doctor: { id: "doctor", firstName: "Asha", lastName: "Sharma", email: "asha@example.test" },
    payoutAccount: { id: "account", type: "UPI", displayLabel: "Primary UPI", details: { type: "UPI", upiId: "asha@bank" } },
  });
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/refresh")) return route.fulfill({ json: { success: true, data: { accessToken: "admin-token" } } });
    if (url.pathname.endsWith("/auth/me")) return route.fulfill({ json: { success: true, data: { id: "admin", role: "ADMIN" } } });
    if (url.pathname.endsWith("/verification-requests")) return route.fulfill({ json: { success: true, data: { items: [], pagination: { page: 1, limit: 25, total: 0, pages: 0 } } } });
    if (url.pathname.endsWith("/payouts") && route.request().method() === "GET") {
      const matches = url.searchParams.get("status") === status;
      return route.fulfill({ json: { success: true, data: { items: matches ? [item()] : [], pagination: { page: 1, limit: 25, total: matches ? 1 : 0, pages: matches ? 1 : 0 } } } });
    }
    if (url.pathname.endsWith(`/payouts/${payoutId}`)) return route.fulfill({ json: { success: true, data: item() } });
    if (url.pathname.endsWith("/review")) { reviewBody = route.request().postDataJSON(); status = "PROCESSING"; return route.fulfill({ json: { success: true, data: item() } }); }
    if (url.pathname.endsWith("/complete")) { completionBody = route.request().postDataJSON(); status = "COMPLETED"; return route.fulfill({ json: { success: true, data: item() } }); }
    return route.fulfill({ status: 500, json: { success: false, error: { message: "Unexpected test request" } } });
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
  await expect(page.getByText("Transfer recorded and payout marked completed.")).toBeVisible();
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
test("join button follows backend permission and cannot fake a video room", async ({
  page,
}) => {
  await mockWorkspace(page, { ...profile, verificationStatus: "VERIFIED", isAcceptingBookings: true, profileCompleted: true });
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

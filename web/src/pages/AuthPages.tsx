import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRightIcon,
  HeartbeatIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { mutate } from "../api";
import { useAuth, type PasswordChallenge } from "../auth";
import { ErrorState, TransitionLoader } from "../components";
import { RecaptchaCheckbox } from "../components/RecaptchaCheckbox";

const countries = [
  { name: "India", code: "+91" },
  { name: "United States / Canada", code: "+1" },
  { name: "United Kingdom", code: "+44" },
  { name: "United Arab Emirates", code: "+971" },
  { name: "Australia", code: "+61" },
  { name: "Bangladesh", code: "+880" },
  { name: "Nepal", code: "+977" },
  { name: "Pakistan", code: "+92" },
  { name: "Singapore", code: "+65" },
  { name: "South Africa", code: "+27" },
];

function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link className="brand" to="/doctor/login">
          <HeartbeatIcon weight="bold" />
          AntarTalk<span>PROFESSIONALS</span>
        </Link>
        <div>
          <p className="eyebrow">CARE STARTS WITH CONNECTION</p>
          <h1>
            A little more space
            <br />
            for meaningful care.
          </h1>
          <p>
            Your schedule, your practice, your people.
            <br />
            One thoughtful workspace for it all.
          </p>
          <div className="story-art" aria-hidden="true">
            <div />
            <div />
            <div />
            <span>
              Here for the people
              <br />
              who are there for others.
            </span>
          </div>
        </div>
        <p className="story-foot">
          <ShieldCheckIcon size={22} />A private workspace for mental-health
          professionals
        </p>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form">
          <p className="eyebrow">ANTARTALK FOR PROFESSIONALS</p>
          <h1>{title}</h1>
          <p>{description}</p>
          {children}
          <p className="help security-note">
            <ShieldCheckIcon />
            Your account and professional approval are verified separately.
          </p>
        </div>
      </section>
    </main>
  );
}

type AuthMode = "login" | "register" | "verify" | "forgot" | "reset";
export function AuthPage({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate(),
    location = useLocation(),
    auth = useAuth();
  const challenge = auth.challenge;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [cooldown, setCooldown] = useState(0),
    [countryCode, setCountryCode] = useState("+91"),
    [busyLabel, setBusyLabel] = useState(""),
    [recaptchaToken, setRecaptchaToken] = useState(""),
    [captchaResetVersion, setCaptchaResetVersion] = useState(0);
  useEffect(() => {
    setError("");
    setNotice(mode === "verify" ? (challenge?.message ?? "") : (location.state as { notice?: string } | null)?.notice ?? "");
    setCooldown(mode === "verify" ? (challenge?.retryAfterSeconds ?? 0) : 0);
  }, [mode, challenge]);
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setBusyLabel(
      mode === "verify"
        ? "Verifying your code…"
        : mode === "reset"
          ? "Changing your password…"
          : mode === "forgot"
            ? "Sending reset code…"
        : "Sending your verification code…",
    );
    setError("");
    setNotice("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      if (mode === "verify") {
        const result = await mutate<{ accessToken: string }>(
          "/api/doctor/auth/verify-otp",
          "POST",
          { challengeToken: challenge?.challengeToken, otp: values.otp },
        );
        const viewer = await auth.signIn(result.accessToken);
        navigate(viewer.role === "ADMIN" ? "/doctor/admin" : "/doctor/dashboard", { replace: true });
      } else if (mode === "forgot") {
        if (!recaptchaToken) throw new Error("Complete the security verification before continuing.");
        await mutate("/api/doctor/auth/forgot-password", "POST", { email: values.email, recaptchaToken });
        navigate("/doctor/reset-password", { state: { email: values.email, notice: "If an eligible account exists, we sent a six-digit reset code." } });
      } else if (mode === "reset") {
        if (values.newPassword !== values.confirmPassword) throw new Error("The new password and confirmation do not match.");
        await mutate("/api/doctor/auth/reset-password", "POST", { email: values.email, otp: values.otp, newPassword: values.newPassword });
        navigate("/doctor/login", { state: { email: values.email, notice: "Password changed. Sign in with your new password." } });
      } else {
        if (!recaptchaToken) throw new Error("Complete the security verification before continuing.");
        const body =
          mode === "register"
            ? (() => {
                const registration = Object.fromEntries(
                  Object.entries(values).filter(
                    ([key]) => key !== "countryCode" && key !== "localPhoneNumber" && key !== "g-recaptcha-response",
                  ),
                );
                return {
                  ...registration,
                  phoneNumber: `${countryCode}${String(values.localPhoneNumber).replace(/\D/g, "")}`,
                  timezone: "Asia/Kolkata",
                  recaptchaToken,
                };
              })()
            : { email: values.email, password: values.password, recaptchaToken };
        const result = await mutate<PasswordChallenge>(
          `/api/doctor/auth/${mode}`,
          "POST",
          body,
        );
        if (!result.challengeToken)
          throw new Error(
            "The backend needs the password + OTP update. Deploy the current backend before signing in.",
          );
        // Only the short-lived password-step proof stays in memory. Never persist passwords.
        auth.setChallenge(result);
        form.reset();
        navigate("/doctor/verify");
      }
    } catch (e) {
      setError((e as Error).message);
      if (mode === "login" || mode === "register" || mode === "forgot") {
        setRecaptchaToken("");
        setCaptchaResetVersion((version) => version + 1);
      }
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }
  async function resend() {
    setBusy(true);
    setBusyLabel("Sending a new verification code…");
    setError("");
    setNotice("");
    try {
      const result = await mutate<
        Pick<PasswordChallenge, "message" | "retryAfterSeconds">
      >("/api/doctor/auth/send-otp", "POST", {
        challengeToken: challenge?.challengeToken,
      });
      setNotice(result.message);
      setCooldown(result.retryAfterSeconds);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }
  return (
    <>
    <AuthShell
      title={
        mode === "register"
          ? "Start your practice here."
          : mode === "verify"
            ? "Verify your email."
            : mode === "forgot"
              ? "Reset your password."
              : mode === "reset"
                ? "Choose a new password."
            : "Welcome back."
      }
      description={
        mode === "register"
          ? "Create your account with a password, then verify your email."
          : mode === "verify"
            ? "Enter the six-digit email code to finish signing in. Resending reports whether a new email was sent."
            : mode === "forgot"
              ? "Enter your account email and complete the security check to receive a reset code."
              : mode === "reset"
                ? "Enter the reset code from your email, then choose a strong new password."
            : "Enter your email and password. Next, verify the code sent to your email."
      }
    >
      <ErrorState message={error || auth.error} />
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      {mode === "verify" && !challenge ? (
        <Link className="button" to="/doctor/login">
          Enter email and password to continue
        </Link>
      ) : (
        <form onSubmit={submit}>
          {mode !== "verify" && mode !== "reset" && (
            <>
              <label>
                Email address
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="username"
                  defaultValue={
                    (location.state as { email?: string } | null)?.email ?? ""
                  }
                />
              </label>
              {mode !== "forgot" && <label>
                Password
                <input
                  type="password"
                  name="password"
                  required
                  minLength={mode === "register" ? 10 : 1}
                  maxLength={128}
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                />
              </label>}
              {mode === "login" && <p className="help auth-forgot"><Link to="/doctor/forgot-password">Forgot password?</Link></p>}
            </>
          )}
          {mode === "reset" && <>
            <label>Email address<input type="email" name="email" autoComplete="username" required defaultValue={(location.state as { email?: string } | null)?.email ?? ""} /></label>
            <label>Reset code<input className="otp-input" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
            <label>New password<input type="password" name="newPassword" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
            <label>Confirm new password<input type="password" name="confirmPassword" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
            <p className="help">Use 10–128 characters with uppercase, lowercase and a number.</p>
          </>}
          {mode === "register" && (
            <>
              <p className="help">
                Use 10–128 characters with uppercase, lowercase and a number.
                Passwords are stored only as Argon2id hashes.
              </p>
              <div className="form-grid">
                <label>
                  First name
                  <input
                    name="firstName"
                    autoComplete="given-name"
                    maxLength={100}
                    required
                  />
                </label>
                <label>
                  Last name
                  <input
                    name="lastName"
                    autoComplete="family-name"
                    maxLength={100}
                    required
                  />
                </label>
              </div>
              <div className="phone-field">
                <label>
                  Country / code
                  <select
                    name="countryCode"
                    value={countryCode}
                    onChange={(event) => setCountryCode(event.target.value)}
                  >
                    {countries.map((country) => (
                      <option key={`${country.name}-${country.code}`} value={country.code}>
                        {country.name} ({country.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mobile number
                  <div className="phone-input">
                    <span aria-hidden="true">{countryCode}</span>
                    <input
                      type="tel"
                      name="localPhoneNumber"
                      inputMode="numeric"
                      placeholder="98765 43210"
                      pattern="[0-9 ()-]{6,20}"
                      autoComplete="tel-national"
                      required
                    />
                  </div>
                </label>
              </div>
              <p className="help">Choose your country and enter the local mobile number. We save it in international format.</p>
              <div className="form-grid">
                <label>
                  Date of birth
                  <input type="date" name="dateOfBirth" required />
                </label>
                <label>
                  Gender
                  <select name="gender" defaultValue="" required>
                    <option value="" disabled>Select gender</option>
                    <option value="FEMALE">Female</option>
                    <option value="MALE">Male</option>
                    <option value="NON_BINARY">Non-binary</option>
                    <option value="OTHER">Other</option>
                    <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                  </select>
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Professional category
                  <select name="professionalCategory">
                    <option value="PSYCHOLOGIST">Psychologist</option>
                    <option value="PSYCHIATRIST">Psychiatrist</option>
                    <option value="COUNSELLOR">Counsellor</option>
                  </select>
                </label>
              </div>
              <label>
                License / registration number
                <input
                  name="licenseNumber"
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
              <p className="help">
                For licensed professionals. Account registration does not grant
                professional approval.
              </p>
            </>
          )}
          {mode === "verify" && (
            <>
              <p className="help">Signing in as {challenge?.email}</p>
              <label>
                Verification code
                <input
                  className="otp-input"
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                />
              </label>
            </>
          )}
          {(mode === "login" || mode === "register" || mode === "forgot") && <RecaptchaCheckbox key={mode} onToken={setRecaptchaToken} resetVersion={captchaResetVersion} />}
          <button className="button full" disabled={busy || ((mode === "login" || mode === "register" || mode === "forgot") && !recaptchaToken)}>
            {busy
              ? "Please wait…"
              : mode === "register"
                ? "Create account"
                : mode === "login"
                  ? "Continue to OTP"
                  : mode === "forgot"
                    ? "Send reset code"
                    : mode === "reset"
                      ? "Change password"
                      : "Verify & continue"}
            <ArrowRightIcon />
          </button>
        </form>
      )}
      {mode === "verify" && challenge && (
        <button
          className="text-button"
          onClick={resend}
          disabled={busy || cooldown > 0}
        >
          {cooldown ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      )}
      <p className="auth-switch">
        {mode === "login" ? (
          <>
            New to AntarTalk?{" "}
            <Link to="/doctor/register">Create an account</Link>
          </>
        ) : (
          <Link to="/doctor/login">Back to sign in</Link>
        )}
      </p>
    </AuthShell>
    {busy && <TransitionLoader label={busyLabel || "Please wait…"} />}
    </>
  );
}

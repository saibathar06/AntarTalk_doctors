import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRightIcon,
  HeartbeatIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { mutate } from "../api";
import { useAuth, type PasswordChallenge } from "../auth";
import { ErrorState } from "../components";

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

export function AuthPage({ mode }: { mode: "login" | "register" | "verify" }) {
  const navigate = useNavigate(),
    location = useLocation(),
    auth = useAuth();
  const challenge = auth.challenge;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    setError("");
    setNotice(mode === "verify" ? (challenge?.message ?? "") : "");
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
      } else {
        const body =
          mode === "register"
            ? {
                ...values,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }
            : { email: values.email, password: values.password };
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
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
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
    }
  }
  return (
    <AuthShell
      title={
        mode === "register"
          ? "Start your practice here."
          : mode === "verify"
            ? "Verify your email."
            : "Welcome back."
      }
      description={
        mode === "register"
          ? "Create your account with a password, then verify your email."
          : mode === "verify"
            ? "Enter the six-digit email code to finish signing in. Resending reports whether a new email was sent."
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
          {mode !== "verify" && (
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
              <label>
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
              </label>
            </>
          )}
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
              <label>
                Phone number
                <input
                  type="tel"
                  name="phoneNumber"
                  placeholder="+919876543210"
                  pattern="\+[1-9][0-9]{7,14}"
                  autoComplete="tel"
                  required
                />
              </label>
              <div className="form-grid">
                <label>
                  Date of birth
                  <input type="date" name="dateOfBirth" required />
                </label>
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
          <button className="button full" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "register"
                ? "Create account"
                : mode === "login"
                  ? "Continue to OTP"
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
  );
}

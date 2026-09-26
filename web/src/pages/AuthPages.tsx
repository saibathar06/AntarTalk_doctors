import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRightIcon,
  HeartbeatIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { ApiError, mutate } from "../api";
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
    [cooldown, setCooldown] = useState(0),
    [recoveryEmail, setRecoveryEmail] = useState("");
  useEffect(() => {
    setError("");
    setRecoveryEmail("");
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
      if (
        mode === "register" &&
        e instanceof ApiError &&
        [0, 409, 500, 502, 503, 504].includes(e.status)
      )
        setRecoveryEmail(String(values.email).trim().toLowerCase());
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
      {recoveryEmail && (
        <p className="alert">
          Your account may already exist.{" "}
          <Link to="/doctor/login" state={{ email: recoveryEmail }}>
            Sign in to verify your email
          </Link>
          . For an account created before passwords were added, use{" "}
          <Link to="/doctor/forgot-password" state={{ email: recoveryEmail }}>
            Forgot / set password
          </Link>
          . Do not register again.
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
          {mode === "login" && (
            <p className="help">
              <Link to="/doctor/forgot-password">Forgot / set password</Link> —
              use this for earlier passwordless accounts.
            </p>
          )}
          {mode === "register" && (
            <>
              <p className="help">
                Use 10–128 characters with uppercase, lowercase and a number.
                Passwords are stored only as Argon2id hashes.
              </p>
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

export function PasswordRecoveryPage() {
  const location = useLocation();
  const [email, setEmail] = useState(
    (location.state as { email?: string } | null)?.email ?? "",
  );
  const [requested, setRequested] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      if (!requested) {
        await mutate("/api/auth/forgot-password", "POST", { email });
        setRequested(true);
        setNotice(
          "Password-reset request received. Check your registered inbox and spam folder for the reset code. For security, this page does not disclose whether an account exists.",
        );
      } else {
        const values = Object.fromEntries(new FormData(form));
        await mutate("/api/auth/reset-password", "POST", {
          email,
          otp: values.otp,
          newPassword: values.newPassword,
        });
        form.reset();
        setDone(true);
        setNotice(
          "Password saved. Sign in with your email and new password, then complete email OTP verification.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell
      title="Set a secure password."
      description="Reset a forgotten password, or set one for an earlier passwordless account. Existing bookings and profile data stay unchanged."
    >
      <ErrorState message={error} />
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      {!done && (
        <form onSubmit={submit}>
          <label>
            Email address
            <input
              type="email"
              required
              value={email}
              readOnly={requested}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </label>
          {requested && (
            <>
              <label>
                Reset code
                <input
                  name="otp"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                />
              </label>
              <label>
                New password
                <input
                  name="newPassword"
                  required
                  type="password"
                  minLength={10}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <p className="help">
                At least 10 characters with uppercase, lowercase and a number.
              </p>
            </>
          )}
          <button className="button full" disabled={busy}>
            {busy
              ? "Please wait…"
              : requested
                ? "Save new password"
                : "Request password-reset code"}
          </button>
        </form>
      )}
      {requested && !done && (
        <button
          className="text-button"
          onClick={() => {
            setRequested(false);
            setNotice("");
          }}
        >
          Request another reset code
        </button>
      )}
      <p className="auth-switch">
        <Link to="/doctor/login" state={{ email }}>
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

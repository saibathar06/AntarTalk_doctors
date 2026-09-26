import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRightIcon,
  HeartbeatIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { ApiError, mutate } from "../api";
import { useAuth } from "../auth";
import { ErrorState } from "../components";

export function AuthPage({ mode }: { mode: "login" | "register" | "verify" }) {
  const navigate = useNavigate(),
    location = useLocation(),
    auth = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [cooldown, setCooldown] = useState(0);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const challenge = location.state as {
    identifier?: string;
    purpose?: string;
  } | null;
  useEffect(() => {
    setError("");
    setNotice("");
    setRecoveryEmail("");
  }, [mode]);
  useEffect(() => {
    if (cooldown > 0) {
      const id = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(id);
    }
  }, [cooldown]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === "register") {
        await mutate("/api/doctor/auth/register", "POST", {
          ...values,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        navigate("/doctor/verify", {
          state: { identifier: values.email, purpose: "VERIFY_EMAIL" },
        });
      } else if (mode === "login") {
        await mutate("/api/doctor/auth/send-otp", "POST", {
          identifier: values.identifier,
          purpose: values.purpose,
        });
        navigate("/doctor/verify", {
          state: { identifier: values.identifier, purpose: values.purpose },
        });
      } else {
        const result = await mutate<{ accessToken: string }>(
          "/api/doctor/auth/verify-otp",
          "POST",
          {
            identifier: challenge?.identifier,
            purpose: challenge?.purpose,
            otp: values.otp,
          },
        );
        await auth.signIn(result.accessToken);
        navigate("/doctor/dashboard", { replace: true });
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
    try {
      await mutate("/api/doctor/auth/send-otp", "POST", challenge);
      setCooldown(60);
      setNotice(
        "If eligible, a new code will arrive at your registered email.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
          <ShieldCheckIcon size={22} /> A private workspace for mental-health
          professionals
        </p>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form">
          <p className="eyebrow">ANTARTALK FOR PROFESSIONALS</p>
          <h1>
            {mode === "register"
              ? "Start your practice here."
              : mode === "verify"
                ? "Check your inbox."
                : "Welcome back."}
          </h1>
          <p>
            {mode === "register"
              ? "Create your account. Build your profile at your own pace."
              : mode === "verify"
                ? "Enter the 6-digit code sent to your registered email. Codes expire after 10 minutes."
                : "A secure code is all you need to sign in."}
          </p>
          <ErrorState message={error || auth.error} />
          {recoveryEmail && (
            <p className="alert">
              Your account may already exist.{" "}
              <Link
                to="/doctor/verify"
                state={{ identifier: recoveryEmail, purpose: "VERIFY_EMAIL" }}
              >
                Continue to email verification
              </Link>{" "}
              to enter a code or request a new one. This does not submit
              registration again.
            </p>
          )}
          {notice && (
            <p role="status" className="alert">
              {notice}
            </p>
          )}
          {mode === "verify" && !challenge?.identifier ? (
            <Link className="button" to="/doctor/login">
              Request a new code
            </Link>
          ) : (
            <form onSubmit={submit}>
              {mode === "login" && (
                <>
                  <label>
                    Email or phone number
                    <input
                      name="identifier"
                      required
                      autoComplete="username"
                      placeholder="you@example.com or +919876543210"
                    />
                  </label>
                  <label>
                    Account status
                    <select name="purpose">
                      <option value="DOCTOR_LOGIN">
                        I have verified my email
                      </option>
                      <option value="VERIFY_EMAIL">
                        I still need to verify my email
                      </option>
                    </select>
                  </label>
                  <p className="help">
                    Phone numbers identify your account. Codes are delivered by
                    email, not SMS.
                  </p>
                </>
              )}
              {mode === "register" && (
                <>
                  <label>
                    Email address
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      required
                    />
                  </label>
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
                      minLength={2}
                      maxLength={100}
                      required
                    />
                  </label>
                  <p className="help">
                    This website registration is for licensed professionals.
                    Registration does not grant professional approval.
                  </p>
                </>
              )}
              {mode === "verify" && (
                <>
                  <p className="help">Signing in as {challenge?.identifier}</p>
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
                  : mode === "verify"
                    ? "Verify & continue"
                    : mode === "register"
                      ? "Create account"
                      : "Send sign-in code"}
                <ArrowRightIcon />
              </button>
            </form>
          )}
          {mode === "verify" && challenge?.identifier && (
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
          <p className="help security-note">
            <ShieldCheckIcon /> Your account and professional approval are
            verified separately.
          </p>
        </div>
      </section>
    </main>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, mutate, setAccessToken } from "../api";
import { useAuth } from "../auth";
import { ErrorState, PageHeader } from "../components";
export function SettingsPage() {
  const { profile, reload, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState("");
  async function update(change: object) {
    setBusy(true);
    setError("");
    try {
      await mutate("/api/doctor/profile", "PATCH", change);
      await reload();
      setNotice("Preferences saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await logout(true);
      navigate("/doctor/login");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteAccount() {
    setBusy(true);
    setError("");
    try {
      await api("/api/doctor/account", { method: "DELETE" });
      setAccessToken(null);
      window.location.assign("/doctor/login");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Make this space yours."
        description="Manage your account, practice preferences and security."
      />
      <ErrorState message={error} />
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      <section className="card">
        <h2>Account information</h2>
        <dl className="status-list">
          <div>
            <dt>Email</dt>
            <dd>{profile!.email}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{profile!.phoneNumber}</dd>
          </div>
          <div>
            <dt>Professional status</dt>
            <dd>{profile!.professionalStatus.replaceAll("_", " ")}</dd>
          </div>
        </dl>
        <p className="help">
          Email is verified for sign-in. Phone is an account identifier; SMS
          verification is not configured.
        </p>
      </section>
      <section className="card">
        <h2>Practice preferences</h2>
        <label className="setting-row">
          <span>
            <strong>Accept new bookings</strong>
            <small>
              Requires a complete profile and professional approval.
            </small>
          </span>
          <input
            type="checkbox"
            disabled={
              busy ||
              (!profile!.isAcceptingBookings &&
                (!profile!.profileCompleted ||
                  profile!.verificationStatus !== "VERIFIED"))
            }
            checked={profile!.isAcceptingBookings}
            onChange={(e) => update({ isAcceptingBookings: e.target.checked })}
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Email updates preference</strong>
            <small>
              Saved for future appointment notifications. Security codes are
              always sent; appointment emails are not enabled yet.
            </small>
          </span>
          <input
            type="checkbox"
            disabled={busy}
            checked={profile!.emailNotifications}
            onChange={(e) => update({ emailNotifications: e.target.checked })}
          />
        </label>
      </section>
      <section className="card">
        <h2>Security</h2>
        <p>
          Sign-in requires your password followed by a single-use email code.
          Refresh credentials are stored in an HttpOnly cookie, never in browser
          storage.
        </p>
        <button className="button secondary" disabled={busy} onClick={signOut}>
          Sign out on all devices
        </button>
      </section>
      <section className="card danger-zone">
        <h2>Delete account</h2>
        <p>
          Your access and availability will be revoked. Financial and audit
          records are retained. Active bookings must be resolved first.
        </p>
        <label>
          Type DELETE to confirm
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          className="button danger"
          disabled={busy || confirmation !== "DELETE"}
          onClick={deleteAccount}
        >
          Delete my account
        </button>
      </section>
    </>
  );
}

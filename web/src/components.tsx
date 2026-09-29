import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import {
  CalendarBlankIcon,
  CalendarDotsIcon,
  VideoCameraIcon,
  ArrowRightIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react";
import { api, fileUrl } from "./api";
import { useAuth } from "./auth";
import type { Appointment, Pagination, Profile } from "./types";

export function useResource<T>(path: string, poll = false) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    const load = () =>
      api<T>(path)
        .then((value) => {
          if (active) {
            setData(value);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    void load();
    const timer = poll ? window.setInterval(load, 30000) : undefined;
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [path, version, poll]);
  return { data, error, loading, reload: () => setVersion((v) => v + 1) };
}
export function ErrorState({ message }: { message: string }) {
  return message ? (
    <div className="alert error" role="alert">
      {message}
    </div>
  ) : null;
}
export function LoadingState({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" /> {label}
    </div>
  );
}
export function TransitionLoader({ label }: { label: string }) {
  return (
    <div className="transition-loader" role="status" aria-live="assertive" aria-label={label}>
      <div className="transition-loader-card">
        <span className="spinner" aria-hidden="true" />
        <strong>{label}</strong>
        <p>Please keep this page open.</p>
      </div>
    </div>
  );
}
export function EmptyState({
  title = "A little space in your day",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <CalendarBlankIcon size={34} />
      <h3>{title}</h3>
      <p>
        {children ??
          "Your appointments will appear here when clients book a session."}
      </p>
    </div>
  );
}
export function PageHeader({
  eyebrow = "YOUR PRACTICE",
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}
export function DoctorAvatar({
  profile,
  large = false,
}: {
  profile: Profile;
  large?: boolean;
}) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true,
      objectUrl = "";
    setSrc("");
    if (profile.profileImageUrl)
      fileUrl(profile.profileImageUrl)
        .then((url) => {
          objectUrl = url;
          if (active) setSrc(url);
          else URL.revokeObjectURL(url);
        })
        .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profile.profileImageUrl]);
  return (
    <span className={`avatar ${large ? "large" : ""}`}>
      {src ? (
        <img src={src} alt="Your profile" />
      ) : (
        `${profile.firstName[0] ?? "P"}${profile.lastName[0] ?? ""}`
      )}
    </span>
  );
}
export function ProfileCompletionCard({ profile }: { profile: Profile }) {
  return (
    <section className="completion card">
      <div className="completion-icon">
        <CheckCircleIcon size={28} />
      </div>
      <div>
        <h2>
          {profile.profileCompleted
            ? "Your profile is ready"
            : "Complete your professional profile"}
        </h2>
        <p>
          {profile.profileCompleted
            ? `Professional review: ${profile.verificationStatus.toLowerCase()}. Bookings are ${profile.isAcceptingBookings ? "enabled" : "paused"}.`
            : "Help clients get to know the professional behind the care."}
        </p>
        <div className="progress">
          <progress value={profile.completionPercentage} max={100} />
          <span>{profile.completionPercentage}% complete</span>
        </div>
      </div>
      <Link className="button" to="/doctor/profile">
        {profile.profileCompleted ? "View profile" : "Complete profile"}{" "}
        <ArrowRightIcon />
      </Link>
    </section>
  );
}
export const formatDate = (value: string, timezone: string) =>
  new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
export const formatTime = (value: string, timezone: string) =>
  new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
export function JoinSessionButton({
  appointment,
}: {
  appointment: Appointment;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [launchUrl, setLaunchUrl] = useState<string | null>(null);
  async function join() {
    setBusy(true);
    setMessage("");
    try {
      const access = await api<{
        launchUrl: string;
        videoOrigin: string;
        expiresAt: string;
      }>(`/api/doctor/sessions/${appointment.id}/join`, {
        method: "POST",
        body: JSON.stringify({ surface: "WEB" }),
      });
      const launch = new URL(access.launchUrl);
      if (launch.origin !== access.videoOrigin || launch.pathname !== "/call")
        throw new Error("The video service returned an invalid call link.");
      setLaunchUrl(launch.toString());
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const label =
    appointment.join.state === "ENDED"
      ? "Session ended"
      : appointment.join.state === "INELIGIBLE"
        ? "Eligibility required"
        : "Not ready to join";
  return (
    <div className="join-action">
      <button
        className="button small"
        disabled={!appointment.join.canJoin || busy}
        onClick={join}
      >
        <VideoCameraIcon size={18} />
        {busy
          ? "Authorizing…"
          : appointment.join.canJoin
            ? "Join session"
            : label}
      </button>
      {message && <p role="status">{message}</p>}
      {launchUrl && (
        <div className="video-call-overlay" role="dialog" aria-modal="true" aria-label="AntarTalk video session">
          <div className="video-call-toolbar">
            <strong>AntarTalk session</strong>
            <button className="button ghost small" onClick={() => setLaunchUrl(null)}>Leave call</button>
          </div>
          <iframe
            title="AntarTalk video session"
            src={launchUrl}
            allow="camera; microphone; fullscreen; display-capture"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
}
function AppointmentActions({ appointment, onChanged }: { appointment: Appointment; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newTime, setNewTime] = useState("");
  async function act(path: string, body: unknown = {}) {
    setBusy(true); setMessage("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      onChanged?.();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!window.confirm("Cancel this appointment? The client will receive a full refund. A 5% adjustment applies when cancelling on the appointment day.")) return;
    const reason = window.prompt("Reason for cancellation (optional)") ?? "";
    await act(`/api/doctor/sessions/${appointment.id}/cancel`, { reason });
  }
  async function reschedule(event: React.FormEvent) {
    event.preventDefault();
    const value = DateTime.fromISO(newTime, { zone: "Asia/Kolkata" });
    if (!value.isValid) return setMessage("Choose a valid appointment time.");
    await act(`/api/doctor/sessions/${appointment.id}/reschedule`, { startTime: value.toUTC().toISO() });
  }
  const request = appointment.rescheduleRequests?.[0];
  if (appointment.status !== "CONFIRMED") return null;
  return <div className="appointment-management">
    {request && <div className="reschedule-request">
      <strong>Client requested {formatDate(request.proposedStartTime, "Asia/Kolkata")} at {formatTime(request.proposedStartTime, "Asia/Kolkata")}</strong>
      {request.reason && <small>{request.reason}</small>}
      <div className="inline-actions">
        <button className="button small" disabled={busy} onClick={() => void act(`/api/doctor/reschedule-requests/${request.id}/respond`, { decision: "APPROVE" })}>Approve</button>
        <button className="button secondary small" disabled={busy} onClick={() => void act(`/api/doctor/reschedule-requests/${request.id}/respond`, { decision: "REJECT" })}>Decline</button>
      </div>
    </div>}
    <div className="inline-actions">
      {(new Date(appointment.startTime) > new Date() || appointment.join.state === "ENDED") && <>
        <details>
          <summary className="button secondary small"><CalendarDotsIcon /> Reschedule</summary>
          <form className="appointment-reschedule-form" onSubmit={reschedule}>
            <input aria-label="New appointment time" type="datetime-local" min={DateTime.now().setZone("Asia/Kolkata").toFormat("yyyy-MM-dd'T'HH:mm")} value={newTime} onChange={(event) => setNewTime(event.target.value)} required />
            <button className="button small" disabled={busy || !newTime}>Move appointment</button>
          </form>
        </details>
        {new Date(appointment.startTime) > new Date() && <button className="button danger small" disabled={busy} onClick={() => void cancel()}>Cancel appointment</button>}
      </>}
    </div>
    {message && <p className="action-message" role="status">{message}</p>}
  </div>;
}

export function AppointmentCard({ appointment, onChanged, showManagement = false }: { appointment: Appointment; onChanged?: () => void; showManagement?: boolean }) {
  const { profile } = useAuth();
  const zone = profile!.timezone;
  const therapyEnd = new Date(
    new Date(appointment.startTime).getTime() +
      appointment.sessionDurationMinutes * 60000,
  ).toISOString();
  return (
    <article className="appointment">
      <div className="time-column">
        <strong>{formatTime(appointment.startTime, zone)}</strong>
        <span>{formatDate(appointment.startTime, zone)}</span>
      </div>
      <div className="appointment-person">
        <span className="client-avatar">C</span>
        <div>
          <h3>{appointment.clientLabel}</h3>
          <p>
            {appointment.sessionType} · {appointment.sessionDurationMinutes} min
          </p>
          <small>Session scheduled until {formatTime(therapyEnd, zone)}</small>
        </div>
      </div>
      <span className={`badge ${appointment.status.toLowerCase()}`}>
        {appointment.status.replace("_", " ")}
      </span>
      <JoinSessionButton appointment={appointment} />
      {showManagement && <AppointmentActions appointment={appointment} onChanged={onChanged} />}
    </article>
  );
}
export function Pager({
  pagination,
  onPage,
}: {
  pagination: Pagination;
  onPage: (page: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {pagination.total} total · Page {pagination.page} of{" "}
        {Math.max(1, pagination.pages)}
      </span>
      <button
        className="button secondary small"
        disabled={pagination.page <= 1}
        onClick={() => onPage(pagination.page - 1)}
      >
        Previous
      </button>
      <button
        className="button secondary small"
        disabled={pagination.page >= pagination.pages}
        onClick={() => onPage(pagination.page + 1)}
      >
        Next
      </button>
    </div>
  );
}

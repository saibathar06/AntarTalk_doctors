import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CalendarBlankIcon,
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
    [message, setMessage] = useState("");
  async function join() {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/doctor/sessions/${appointment.id}/join`, {
        method: "POST",
      });
      // No video provider exists in this repository. Do not invent a meeting URL.
      setMessage(
        "Access authorized. Video calling is not configured yet; contact AntarTalk support.",
      );
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
    </div>
  );
}
export function AppointmentCard({ appointment }: { appointment: Appointment }) {
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
          <small>
            Until {formatTime(therapyEnd, zone)} ·{" "}
            {appointment.bufferDurationMinutes} min protected buffer
          </small>
        </div>
      </div>
      <span className={`badge ${appointment.status.toLowerCase()}`}>
        {appointment.status.replace("_", " ")}
      </span>
      <JoinSessionButton appointment={appointment} />
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

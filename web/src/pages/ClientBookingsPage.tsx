import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import {
  CalendarDotsIcon,
  ClockIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import { ApiError, apiWithAccessToken } from "../api";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  TransitionLoader,
} from "../components";
import type { BookingSlot, ClientBooking, Page } from "../types";
import { ClientSignIn, type ClientSession } from "./BookSessionPage";

const time = (value: string) =>
  DateTime.fromISO(value, { zone: "utc" })
    .setZone("Asia/Kolkata")
    .toFormat("d LLL yyyy, h:mm a");

function BookingActions({
  booking,
  session,
  reload,
}: {
  booking: ClientBooking;
  session: ClientSession;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slots, setSlots] = useState<BookingSlot[] | null>(null);
  async function cancel() {
    if (
      !window.confirm(
        "Cancel this appointment? Under the client cancellation policy, the consultation payment is not refunded.",
      )
    )
      return;
    const reason = window.prompt("Reason for cancellation (optional)") ?? "";
    setBusy(true);
    setError("");
    try {
      await apiWithAccessToken(
        `/api/bookings/${booking.id}/cancel`,
        session.accessToken,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadSlots() {
    setBusy(true);
    setError("");
    try {
      const from = DateTime.now()
        .setZone("Asia/Kolkata")
        .startOf("day")
        .toUTC()
        .toISO()!;
      const to = DateTime.now()
        .setZone("Asia/Kolkata")
        .startOf("day")
        .plus({ days: 7 })
        .toUTC()
        .toISO()!;
      setSlots(
        await apiWithAccessToken(
          `/api/bookings/availability?doctorId=${booking.doctorId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          null,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function request(slot: BookingSlot) {
    setBusy(true);
    setError("");
    try {
      await apiWithAccessToken(
        `/api/bookings/${booking.id}/reschedule-requests`,
        session.accessToken,
        { method: "POST", body: JSON.stringify({ startTime: slot.startTime }) },
      );
      setSlots(null);
      reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  if (
    booking.status !== "CONFIRMED" ||
    new Date(booking.startTime) <= new Date()
  )
    return null;
  const pending = booking.rescheduleRequests?.find(
    (item) => item.status === "PENDING",
  );
  return (
    <div className="client-booking-actions">
      <ErrorState message={error} />
      {pending ? (
        <p className="booking-notice">
          Reschedule requested for {time(pending.proposedStartTime)}. The
          original appointment remains confirmed until approval.
        </p>
      ) : (
        <div className="inline-actions">
          <button
            className="button secondary small"
            disabled={busy || Boolean(booking.rescheduleCount)}
            onClick={() => void loadSlots()}
          >
            <CalendarDotsIcon /> Request another time
          </button>
          <button
            className="button danger small"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancel appointment
          </button>
        </div>
      )}
      {slots && (
        <div className="reschedule-slot-panel">
          <h3>Choose an available time</h3>
          {slots.length ? (
            <div className="slot-grid">
              {slots
                .filter((slot) => slot.startTime !== booking.startTime)
                .map((slot) => (
                  <button
                    disabled={busy}
                    key={slot.startTime}
                    onClick={() => void request(slot)}
                  >
                    <ClockIcon /> {time(slot.startTime)}
                    <small>Request this time</small>
                  </button>
                ))}
            </div>
          ) : (
            <EmptyState title="No alternative times available" />
          )}
          <button className="button ghost small" onClick={() => setSlots(null)}>
            Close
          </button>
        </div>
      )}
      {busy && <TransitionLoader label="Updating your appointment…" />}
    </div>
  );
}

export function ClientBookingsPage() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [data, setData] = useState<Page<ClientBooking> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setError("");
    void apiWithAccessToken<Page<ClientBooking>>(
      "/api/bookings/mine?page=1&limit=50",
      session.accessToken,
    )
      .then((result) => active && setData(result))
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [session, version]);
  return (
    <main className="booking-page client-bookings-page">
      <header className="booking-brand">
        <span>AntarTalk</span>
        <small>MY SESSIONS</small>
      </header>
      <section className="booking-selection card">
        <p className="eyebrow">YOUR APPOINTMENTS</p>
        <h1>Sessions and booking changes</h1>
        <p>
          Request another available time or cancel an upcoming appointment
          securely.
        </p>
      </section>
      {!session ? (
        <ClientSignIn onSignedIn={setSession} />
      ) : (
        <>
          <p className="booking-client-state">
            Signed in as {session.email}.{" "}
            <button
              onClick={() => {
                setSession(null);
                setData(null);
              }}
            >
              Use another account
            </button>
          </p>
          <ErrorState message={error} />
          {loading ? (
            <LoadingState label="Loading your appointments…" />
          ) : data?.items.length ? (
            <div className="client-booking-list">
              {data.items.map((booking) => (
                <article className="card" key={booking.id}>
                  <div className="booking-section-heading">
                    <div>
                      <small>
                        {booking.doctor?.professionalCategory.replaceAll(
                          "_",
                          " ",
                        )}
                      </small>
                      <h2>
                        Dr. {booking.doctor?.firstName}{" "}
                        {booking.doctor?.lastName}
                      </h2>
                    </div>
                    <span className={`badge ${booking.status.toLowerCase()}`}>
                      {booking.status}
                    </span>
                  </div>
                  <p>
                    <strong>{time(booking.startTime)}</strong> · up to{" "}
                    {booking.sessionDurationMinutes} minutes
                  </p>
                  {booking.payment && (
                    <p>
                      Payment: {booking.payment.currency}{" "}
                      {booking.payment.amount} · {booking.payment.status}
                    </p>
                  )}
                  {booking.refund && (
                    <p>
                      Refund: {booking.refund.currency} {booking.refund.amount}{" "}
                      · {booking.refund.status}
                    </p>
                  )}
                  {booking.status === "CONFIRMED" && (
                    <Link
                      className="button small"
                      to={`/client-call/${booking.id}`}
                    >
                      <VideoCameraIcon /> Join call
                    </Link>
                  )}
                  <BookingActions
                    booking={booking}
                    session={session}
                    reload={() => setVersion((value) => value + 1)}
                  />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No bookings yet">
              Book a professional to see your appointment here.
            </EmptyState>
          )}
        </>
      )}
      <Link className="button secondary" to="/doctor/login">
        Professional sign in
      </Link>
    </main>
  );
}

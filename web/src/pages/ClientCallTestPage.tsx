import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DateTime } from "luxon";
import {
  ArrowLeftIcon,
  CalendarCheckIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import { apiWithAccessToken } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components";
import type { ClientBooking, Page } from "../types";
import { ClientSignIn, type ClientSession } from "./BookSessionPage";

type VideoAccess = {
  bookingId: string;
  launchUrl: string;
  videoOrigin: string;
  expiresAt: string;
};

const bookingTime = (value: string) =>
  DateTime.fromISO(value, { zone: "utc" })
    .setZone("Asia/Kolkata")
    .toFormat("d LLL yyyy, h:mm a");

export function ClientCallTestPage() {
  const { bookingId: routeBookingId = "" } = useParams();
  const [session, setSession] = useState<ClientSession | null>(null);
  const [bookings, setBookings] = useState<ClientBooking[]>([]);
  const [bookingId, setBookingId] = useState(routeBookingId);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);

  useEffect(() => {
    setBookingId(routeBookingId);
  }, [routeBookingId]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoadingBookings(true);
    setError("");
    void apiWithAccessToken<Page<ClientBooking>>(
      "/api/bookings/mine?page=1&limit=50",
      session.accessToken,
    )
      .then((data) => {
        if (!active) return;
        setBookings(data.items);
        if (!routeBookingId) {
          const nextConfirmed = data.items.find(
            (booking) => booking.status === "CONFIRMED",
          );
          setBookingId(nextConfirmed?.id ?? "");
        }
      })
      .catch((requestError) => {
        if (active) setError((requestError as Error).message);
      })
      .finally(() => {
        if (active) setLoadingBookings(false);
      });
    return () => {
      active = false;
    };
  }, [routeBookingId, session]);

  const confirmedBookings = useMemo(
    () => bookings.filter((booking) => booking.status === "CONFIRMED"),
    [bookings],
  );
  const selectedBooking = bookings.find((booking) => booking.id === bookingId);

  async function join() {
    const normalizedBookingId = bookingId.trim();
    if (!session || !normalizedBookingId) return;
    setJoining(true);
    setError("");
    try {
      const access = await apiWithAccessToken<VideoAccess>(
        `/api/bookings/${encodeURIComponent(normalizedBookingId)}/join`,
        session.accessToken,
        {
          method: "POST",
          body: JSON.stringify({ surface: "WEB" }),
        },
      );
      const launch = new URL(access.launchUrl);
      if (launch.origin !== access.videoOrigin || launch.pathname !== "/call") {
        throw new Error("The video service returned an invalid call link.");
      }
      setLaunchUrl(launch.toString());
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setJoining(false);
    }
  }

  function signOutClient() {
    setSession(null);
    setBookings([]);
    setLaunchUrl(null);
    setError("");
  }

  return (
    <main className="booking-page client-call-page">
      <header className="booking-brand">
        <span>AntarTalk</span>
        <small>CLIENT CALL TEST</small>
      </header>

      <section className="client-call-intro card">
        <p className="eyebrow">VIDEO SESSION CHECK</p>
        <h1>Join as the booked client</h1>
        <p>
          Keep the doctor call open in one browser, then use this page in a
          second browser or private window with the client account.
        </p>
        <Link className="client-call-back" to="/my-bookings">
          <ArrowLeftIcon /> Back to my bookings
        </Link>
      </section>

      {!session ? (
        <ClientSignIn onSignedIn={setSession} />
      ) : (
        <>
          <p className="booking-client-state">
            Client account: {session.email}.
            <button type="button" onClick={signOutClient}>
              Use another account
            </button>
          </p>
          <ErrorState message={error} />
          <section
            className="client-call-controls card"
            aria-labelledby="client-call-controls-title"
          >
            <div className="booking-section-heading">
              <div>
                <p className="eyebrow">REAL BOOKING ACCESS</p>
                <h2 id="client-call-controls-title">
                  Choose the confirmed session
                </h2>
              </div>
              <VideoCameraIcon size={25} />
            </div>

            {loadingBookings ? (
              <LoadingState label="Loading your confirmed bookings…" />
            ) : confirmedBookings.length ? (
              <div className="client-call-booking-grid">
                {confirmedBookings.map((booking) => (
                  <button
                    className={booking.id === bookingId ? "selected" : ""}
                    key={booking.id}
                    type="button"
                    onClick={() => {
                      setBookingId(booking.id);
                      setError("");
                    }}
                  >
                    <CalendarCheckIcon size={20} />
                    <span>
                      <strong>
                        Dr. {booking.doctor?.firstName}{" "}
                        {booking.doctor?.lastName}
                      </strong>
                      <small>{bookingTime(booking.startTime)}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="No confirmed sessions found">
                Book a session first, then return here during its join window.
              </EmptyState>
            )}

            <label className="client-call-booking-id">
              Booking ID
              <input
                value={bookingId}
                onChange={(event) => setBookingId(event.target.value)}
                placeholder="Paste the confirmed booking ID"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            {selectedBooking && (
              <p className="client-call-selection">
                Selected: {bookingTime(selectedBooking.startTime)} with Dr.{" "}
                {selectedBooking.doctor?.firstName}{" "}
                {selectedBooking.doctor?.lastName}
              </p>
            )}

            <button
              className="button client-call-join"
              type="button"
              disabled={joining || !bookingId.trim()}
              onClick={() => void join()}
            >
              <VideoCameraIcon size={19} />
              {joining ? "Authorizing call…" : "Join client session"}
            </button>
            <p className="client-call-help">
              The server verifies client ownership and the appointment join
              window before issuing a one-use video ticket.
            </p>
          </section>
        </>
      )}

      {launchUrl && (
        <div
          className="video-call-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="AntarTalk client video session"
        >
          <div className="video-call-toolbar">
            <strong>AntarTalk client session</strong>
            <button
              className="button ghost small"
              type="button"
              onClick={() => setLaunchUrl(null)}
            >
              Leave call
            </button>
          </div>
          <iframe
            title="AntarTalk client video session"
            src={launchUrl}
            allow="camera; microphone; fullscreen; display-capture"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </main>
  );
}

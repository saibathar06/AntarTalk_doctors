import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DateTime } from "luxon";
import {
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  CreditCardIcon,
  SealCheckIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { ApiError, apiWithAccessToken } from "../api";
import { ErrorState, LoadingState, TransitionLoader } from "../components";
import type {
  BookableDoctor,
  BookingSlot,
  ClientBooking,
  SlotReservation,
} from "../types";

type ClientSession = {
  accessToken: string;
  refreshToken: string;
  email: string;
};
type LoginResponse = {
  user: { id: string; email: string; role: string };
  tokens: { accessToken: string; refreshToken: string };
};

const iso = (date: DateTime) => date.toUTC().toISO()!;
const dateKey = (value: string, zone: string) =>
  DateTime.fromISO(value, { zone: "utc" }).setZone(zone).toISODate()!;
const slotTime = (value: string, zone: string) =>
  DateTime.fromISO(value, { zone: "utc" }).setZone(zone).toFormat("h:mm a");
const longDate = (value: string, zone: string) =>
  DateTime.fromISO(value, { zone: "utc" })
    .setZone(zone)
    .toFormat("cccc, d LLLL");

function PublicDoctorAvatar({ doctor }: { doctor: BookableDoctor }) {
  const [failed, setFailed] = useState(false);
  const initials = `${doctor.firstName[0] ?? "D"}${doctor.lastName[0] ?? ""}`;
  return (
    <span className="booking-avatar">
      {doctor.hasProfileImage && !failed ? (
        <img
          src={`/api/bookings/doctors/${doctor.id}/photo`}
          alt={`Dr. ${doctor.firstName} ${doctor.lastName}`}
          onError={() => setFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}

function ClientSignIn({ onSignedIn }: { onSignedIn: (session: ClientSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiWithAccessToken<LoginResponse>("/api/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (result.user.role !== "CLIENT") {
        throw new ApiError(403, "CLIENT_ACCOUNT_REQUIRED", "Use a verified client account to book a session.");
      }
      onSignedIn({
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        email: result.user.email,
      });
      setPassword("");
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="booking-sign-in card" aria-labelledby="client-sign-in-title">
      <p className="eyebrow">SECURE TEST CHECKOUT</p>
      <h2 id="client-sign-in-title">Sign in as a client to reserve a session</h2>
      <p>
        This test page uses the shared client account system. Tokens remain in memory and are cleared when this page is closed.
      </p>
      <ErrorState message={error} />
      <form onSubmit={submit} className="booking-login-form">
        <label>
          Client email
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button className="button" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in to book"}
        </button>
      </form>
    </section>
  );
}

export function BookSessionPage() {
  const { doctorId = "" } = useParams();
  const [doctor, setDoctor] = useState<BookableDoctor | null>(null);
  const [doctorError, setDoctorError] = useState("");
  const [loadingDoctor, setLoadingDoctor] = useState(true);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [slotsError, setSlotsError] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsVersion, setSlotsVersion] = useState(0);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [clientSession, setClientSession] = useState<ClientSession | null>(null);
  const [reservation, setReservation] = useState<SlotReservation | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [paymentId, setPaymentId] = useState("");
  const [booking, setBooking] = useState<ClientBooking | null>(null);
  const [busy, setBusy] = useState<"reserve" | "confirm" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmationKey, setConfirmationKey] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingDoctor(true);
    setDoctorError("");
    void apiWithAccessToken<BookableDoctor>(`/api/bookings/doctors/${doctorId}`, null)
      .then((data) => active && setDoctor(data))
      .catch((requestError) => active && setDoctorError((requestError as Error).message))
      .finally(() => active && setLoadingDoctor(false));
    return () => {
      active = false;
    };
  }, [doctorId]);

  const dates = useMemo(() => {
    if (!doctor) return [];
    const today = DateTime.now().setZone(doctor.timezone).startOf("day");
    return Array.from({ length: 14 }, (_, index) => today.plus({ days: index }));
  }, [doctor]);

  useEffect(() => {
    if (!doctor || !dates.length) return;
    let active = true;
    setLoadingSlots(true);
    setSlotsError("");
    const from = iso(dates[0]);
    const to = iso(dates.at(-1)!.plus({ days: 1 }));
    void apiWithAccessToken<BookingSlot[]>(
      `/api/bookings/availability?doctorId=${encodeURIComponent(doctor.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      null,
    )
      .then((data) => {
        if (!active) return;
        setSlots(data);
        const availableDates = new Set(data.map((slot) => dateKey(slot.startTime, doctor.timezone)));
        setSelectedDate((current) =>
          current && availableDates.has(current) ? current : [...availableDates][0] ?? "",
        );
        setSelectedSlot((current) =>
          current && data.some((slot) => slot.startTime === current.startTime) ? current : null,
        );
      })
      .catch((requestError) => active && setSlotsError((requestError as Error).message))
      .finally(() => active && setLoadingSlots(false));
    return () => {
      active = false;
    };
  }, [doctor, dates, slotsVersion]);

  const visibleSlots = useMemo(
    () => slots.filter((slot) => dateKey(slot.startTime, doctor?.timezone ?? "UTC") === selectedDate),
    [doctor?.timezone, selectedDate, slots],
  );

  useEffect(() => {
    if (!reservation) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((new Date(reservation.expiresAt).getTime() - Date.now()) / 1000));
      setRemainingSeconds(seconds);
      if (seconds === 0) {
        setReservation(null);
        setSelectedSlot(null);
        setPaymentId("");
        setNotice("Your reservation expired. Live availability has been refreshed.");
        setSlotsVersion((value) => value + 1);
      }
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [reservation]);

  async function reserve() {
    if (!selectedSlot || !clientSession) return;
    setBusy("reserve");
    setError("");
    setNotice("");
    try {
      const result = await apiWithAccessToken<SlotReservation>("/api/bookings/reserve", clientSession.accessToken, {
        method: "POST",
        body: JSON.stringify({ doctorId: selectedSlot.doctorId, startTime: selectedSlot.startTime }),
      });
      setReservation(result);
      setConfirmationKey(crypto.randomUUID());
    } catch (requestError) {
      const apiError = requestError as ApiError;
      setError(apiError.message);
      if (["SLOT_ALREADY_RESERVED", "SLOT_UNAVAILABLE", "DOCTOR_NOT_BOOKABLE"].includes(apiError.code)) {
        setSelectedSlot(null);
        setSlotsVersion((value) => value + 1);
      }
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!reservation || !clientSession || !paymentId.trim()) return;
    setBusy("confirm");
    setError("");
    setNotice("");
    try {
      const result = await apiWithAccessToken<ClientBooking>("/api/bookings/confirm", clientSession.accessToken, {
        method: "POST",
        headers: { "Idempotency-Key": confirmationKey },
        body: JSON.stringify({
          reservationId: reservation.reservationId,
          doctorId: reservation.slot.doctorId,
          startTime: reservation.slot.startTime,
          paymentId: paymentId.trim(),
        }),
      });
      setBooking(result);
      setReservation(null);
      setSlotsVersion((value) => value + 1);
    } catch (requestError) {
      const apiError = requestError as ApiError;
      setError(apiError.message);
      if (["RESERVATION_EXPIRED", "SLOT_UNAVAILABLE", "SLOT_ALREADY_BOOKED", "DOCTOR_NOT_BOOKABLE"].includes(apiError.code)) {
        setReservation(null);
        setSelectedSlot(null);
        setSlotsVersion((value) => value + 1);
      }
    } finally {
      setBusy(null);
    }
  }

  if (loadingDoctor) return <main className="booking-page"><LoadingState label="Loading professional information…" /></main>;
  if (!doctor) return <main className="booking-page"><ErrorState message={doctorError || "Professional not found."} /></main>;

  const activeSlot = reservation?.slot ?? selectedSlot;
  const therapyEnd = activeSlot
    ? DateTime.fromISO(activeSlot.startTime, { zone: "utc" })
        .plus({ minutes: activeSlot.sessionDurationMinutes })
        .toUTC()
        .toISO()!
    : null;
  const minutes = `${Math.floor(remainingSeconds / 60).toString().padStart(2, "0")}:${(remainingSeconds % 60).toString().padStart(2, "0")}`;

  if (booking) {
    return (
      <main className="booking-page booking-success-page">
        <section className="booking-success card">
          <CheckCircleIcon weight="fill" />
          <p className="eyebrow">BOOKING CONFIRMED</p>
          <h1>Session booked successfully</h1>
          <p>Your appointment is confirmed by AntarTalk’s booking service.</p>
          <dl className="booking-confirmation-details">
            <div><dt>Professional</dt><dd>Dr. {doctor.firstName} {doctor.lastName}</dd></div>
            <div><dt>Date</dt><dd>{longDate(booking.startTime, doctor.timezone)}</dd></div>
            <div><dt>Therapy time</dt><dd>{slotTime(booking.startTime, doctor.timezone)} – {slotTime(new Date(new Date(booking.startTime).getTime() + booking.sessionDurationMinutes * 60_000).toISOString(), doctor.timezone)}</dd></div>
            <div><dt>Session length</dt><dd>Up to {booking.sessionDurationMinutes} minutes</dd></div>
            <div><dt>Booking ID</dt><dd>{booking.id}</dd></div>
            <div><dt>Payment status</dt><dd>Successful payment accepted</dd></div>
            <div><dt>Booking status</dt><dd>{booking.status}</dd></div>
          </dl>
          <Link className="button" to={`/book-session/${doctor.id}`}>Back to doctor</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="booking-page">
      <header className="booking-brand"><span>AntarTalk</span><small>SESSION BOOKING</small></header>
      <section className="booking-doctor card">
        <PublicDoctorAvatar doctor={doctor} />
        <div className="booking-doctor-copy">
          <span className="verified-label"><SealCheckIcon weight="fill" /> Verified professional</span>
          <h1>Dr. {doctor.firstName} {doctor.lastName}</h1>
          <p className="booking-speciality">{doctor.professionalCategory.replaceAll("_", " ")}{doctor.specialization ? ` · ${doctor.specialization}` : ""}</p>
          <p>{doctor.bio || "This professional has not added a public biography yet."}</p>
          <div className="booking-doctor-meta">
            {doctor.qualification && <span>{doctor.qualification}{doctor.institution ? ` · ${doctor.institution}` : ""}</span>}
            {doctor.experienceYears !== null && <span>{doctor.experienceYears} years’ experience</span>}
            {doctor.preferredSessionLanguage && <span>Sessions in {doctor.preferredSessionLanguage}</span>}
          </div>
        </div>
      </section>

      {!clientSession ? <ClientSignIn onSignedIn={setClientSession} /> : (
        <p className="booking-client-state"><UserCircleIcon /> Booking as {clientSession.email}. <button onClick={() => setClientSession(null)}>Use another account</button></p>
      )}

      <ErrorState message={error} />
      {notice && <p className="booking-notice" role="status">{notice}</p>}

      {!reservation ? (
        <section className="booking-selection card">
          <div className="booking-section-heading">
            <div><p className="eyebrow">CHOOSE A TIME</p><h2>Available sessions</h2></div>
            <span>{doctor.timezone}</span>
          </div>
          <div className="date-picker" aria-label="Available dates">
            {dates.map((date) => {
              const key = date.toISODate()!;
              const available = slots.some((slot) => dateKey(slot.startTime, doctor.timezone) === key);
              return <button key={key} disabled={!available || loadingSlots} className={selectedDate === key ? "selected" : ""} onClick={() => { setSelectedDate(key); setSelectedSlot(null); }}>
                <small>{date.hasSame(DateTime.now().setZone(doctor.timezone), "day") ? "Today" : date.toFormat("ccc")}</small>
                <strong>{date.toFormat("d")}</strong>
                <span>{date.toFormat("LLL")}</span>
              </button>;
            })}
          </div>
          {loadingSlots ? <LoadingState label="Checking live availability…" /> : <>
            <ErrorState message={slotsError} />
            {selectedDate && visibleSlots.length ? <div className="slot-grid" aria-label="Available appointment times">
              {visibleSlots.map((slot) => <button key={slot.startTime} className={selectedSlot?.startTime === slot.startTime ? "selected" : ""} onClick={() => setSelectedSlot(slot)}>
                <ClockIcon /> {slotTime(slot.startTime, doctor.timezone)}
                <small>Available</small>
              </button>)}
            </div> : <div className="booking-empty"><CalendarBlankIcon /><strong>No available sessions on this date</strong><span>Blocked, held, booked, and past windows are intentionally omitted by the live booking API.</span></div>}
          </>}
        </section>
      ) : (
        <section className="booking-payment card">
          <div className="booking-section-heading"><div><p className="eyebrow">PAYMENT STEP</p><h2>Your session is temporarily held</h2></div><span className="reservation-clock" aria-live="polite">{minutes}</span></div>
          <p>The hold is owned by your client account and expires at the server-provided time. Keep this page open while completing payment.</p>
          <div className="payment-test-note"><CreditCardIcon /><div><strong>Development payment handoff</strong><p>No public payment provider/order endpoint exists in this backend. Use the payment ID from a successful trusted test payment that is bound to this exact doctor and appointment window.</p></div></div>
          <label>
            Successful payment ID
            <input value={paymentId} onChange={(event) => setPaymentId(event.target.value)} placeholder="Payment ID from the trusted test integration" autoComplete="off" />
          </label>
          <button className="button" disabled={busy === "confirm" || !paymentId.trim()} onClick={confirm}>{busy === "confirm" ? "Confirming booking…" : "Confirm paid booking"}</button>
        </section>
      )}

      {activeSlot && <aside className="booking-summary card">
        <p className="eyebrow">YOUR SESSION</p>
        <h2>Session summary</h2>
        <dl>
          <div><dt>Professional</dt><dd>Dr. {doctor.firstName} {doctor.lastName}</dd></div>
          <div><dt>Date</dt><dd>{longDate(activeSlot.startTime, doctor.timezone)}</dd></div>
          <div><dt>Therapy</dt><dd>{slotTime(activeSlot.startTime, doctor.timezone)} – {slotTime(therapyEnd!, doctor.timezone)}</dd></div>
          <div><dt>Session length</dt><dd>Up to {activeSlot.sessionDurationMinutes} minutes</dd></div>
          <div><dt>Language</dt><dd>{doctor.preferredSessionLanguage || "To be confirmed"}</dd></div>
          <div><dt>Listed fee</dt><dd>{doctor.consultationFee ? `₹${doctor.consultationFee}` : "Confirmed by payment order"}</dd></div>
        </dl>
        {!reservation && <button className="button full" disabled={!selectedSlot || !clientSession || busy === "reserve"} onClick={reserve}>{busy === "reserve" ? "Reserving session…" : "Book session"}</button>}
        {!clientSession && <p className="help">Sign in with a verified client account to reserve this time.</p>}
      </aside>}
      {busy && <TransitionLoader label={busy === "reserve" ? "Reserving your session…" : "Confirming your booking…"} />}
    </main>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import { ClockIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { api, mutate } from "../api";
import { useAuth } from "../auth";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  TransitionLoader,
  formatDate,
  formatTime,
  useResource,
} from "../components";
import type { Block, BookingSlot, WorkingHour } from "../types";

type DefaultTiming = { startTime: string; endTime: string };
export function AvailabilityPage() {
  const { profile, reload } = useAuth();
  const today = DateTime.now().setZone("Asia/Kolkata").startOf("day");
  const [slotDate, setSlotDate] = useState(today.toISODate()!);
  const hours = useResource<WorkingHour[]>("/api/doctor/availability");
  const blocks = useResource<Block[]>("/api/doctor/blocked-slots");
  const timing = useResource<DefaultTiming | null>("/api/doctor/availability/default-timing");
  const slotDay = DateTime.fromISO(slotDate, { zone: "Asia/Kolkata" }).startOf("day");
  const slots = useResource<BookingSlot[]>(`/api/doctor/availability/slots?from=${encodeURIComponent(slotDay.toUTC().toISO()!)}&to=${encodeURIComponent(slotDay.plus({ days: 1 }).toUTC().toISO()!)}`);
  async function saveDefault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError(""); setNotice("");
    try {
      await mutate("/api/doctor/availability/default-timing", "PUT", {
        timing: { startTime: String(values.startTime), endTime: String(values.endTime) }
      });
      timing.reload(); hours.reload(); slots.reload();
      setNotice("Default timing saved and applied to all days without custom hours.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const [windows, setWindows] = useState<WorkingHour[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busyLabel, setBusyLabel] = useState("");
  useEffect(() => {
    if (hours.data)
      setWindows(
        (profile!.timezone === "Asia/Kolkata" ? hours.data : []).filter((row) => !row.availableDate || row.availableDate >= DateTime.now().setZone("Asia/Kolkata").toISODate()!).map(({ dayOfWeek, availableDate, startTime, endTime, isActive, useDefault }) => ({
          dayOfWeek,
          useDefault,
          availableDate,
          startTime,
          endTime,
          isActive,
        })),
      );
  }, [hours.data, profile]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setBusyLabel("Saving your dated availability…");
    setError("");
    setNotice("");
    try {
      await mutate("/api/doctor/availability", "PUT", { timezone: "Asia/Kolkata", windows });
      await reload();
      hours.reload();
      slots.reload();
      setNotice("Working hours saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }
  async function block(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(true);
    setBusyLabel("Saving your unavailable period…");
    setError("");
    try {
      const start = DateTime.fromISO(String(values.startTime), {
          zone: "Asia/Kolkata",
        }),
        end = DateTime.fromISO(String(values.endTime), {
          zone: "Asia/Kolkata",
        });
      if (
        !start.isValid ||
        !end.isValid ||
        start.toFormat("yyyy-MM-dd'T'HH:mm") !== values.startTime ||
        end.toFormat("yyyy-MM-dd'T'HH:mm") !== values.endTime ||
        start.getPossibleOffsets().length !== 1 ||
        end.getPossibleOffsets().length !== 1
      )
        throw new Error(
          "Choose a valid India Standard Time.",
        );
      await mutate("/api/doctor/blocked-slots", "POST", {
        startTime: start.toUTC().toISO(),
        endTime: end.toUTC().toISO(),
        reason: values.reason,
      });
      blocks.reload();
      slots.reload();
      form.reset();
      setNotice("Unavailable period saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setBusyLabel("Removing your unavailable period…");
    setError("");
    try {
      await api(`/api/doctor/blocked-slots/${id}`, { method: "DELETE" });
      blocks.reload();
      slots.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }
  function update(index: number, change: Partial<WorkingHour>) {
    setWindows((old) =>
      old.map((row, i) => (i === index ? { ...row, ...change, useDefault: false } : row)),
    );
  }
  function addWindow(dayOfWeek: number, startTime: string, endTime: string) {
    setWindows((current) => {
      if (
        current.some(
          (window) =>
            window.dayOfWeek === dayOfWeek &&
            window.startTime === startTime &&
            window.endTime === endTime,
        )
      )
        return current;
      const date = today.plus({ days: (dayOfWeek - today.weekday + 7) % 7 }).toISODate()!;
      return [...current.map((row) => row.dayOfWeek === dayOfWeek ? { ...row, useDefault: false } : row), { dayOfWeek, availableDate: date, startTime, endTime, isActive: true, useDefault: false }];
    });
  }
  async function blockGeneratedSlot(slot: BookingSlot) {
    if (!window.confirm(`Block the ${DateTime.fromISO(slot.startTime, { zone: "utc" }).setZone("Asia/Kolkata").toFormat("h:mm a")} appointment on ${slotDay.toFormat("d LLL")}?`)) return;
    setBusy(true);
    setBusyLabel("Blocking this appointment time…");
    setError("");
    try {
      await mutate("/api/doctor/blocked-slots", "POST", { startTime: slot.startTime, endTime: slot.endTime, reason: "Unavailable appointment time" });
      blocks.reload();
      slots.reload();
      setNotice("The appointment time is now unavailable to clients.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setBusyLabel(""); }
  }
  const visibleDays = Array.from({ length: 7 }, (_, offset) => {
    const date = today.plus({ days: offset });
    return {
      dayOfWeek: date.weekday,
      dayName: date.toFormat("cccc"),
      dateLabel: date.toFormat("ccc, d LLL"),
      isToday: offset === 0,
    };
  });
  return (
    <>
      <PageHeader
        title="Your time. Your rhythm."
        description={`Today is ${today.toFormat("cccc, d LLLL yyyy")} in India Standard Time. Choose the times clients can book, then protect specific time away when needed.`}
      />
      <ErrorState message={error || hours.error || blocks.error} />
      {profile!.timezone !== "Asia/Kolkata" && <p className="alert">Your previous schedule used another timezone. Set fresh dated hours in IST and save them before clients can book new sessions. Existing appointments keep their original UTC times.</p>}
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      <section className="card">
        <h2>Default timing</h2>
        <p>Set your start and end time once. It applies every day within the next seven days, unless you set custom hours or mark a day inactive.</p>
        <ErrorState message={timing.error} />
        <form onSubmit={saveDefault} key={JSON.stringify(timing.data)}>
          <fieldset disabled={busy || timing.loading || hours.loading || Boolean(timing.error || hours.error)}>
            <div className="form-grid">
              <label>Starting time<input name="startTime" type="time" defaultValue={timing.data?.startTime ?? ""} required /></label>
              <label>Working until<input name="endTime" type="time" defaultValue={timing.data?.endTime ?? ""} required /></label>
            </div>
            <button className="button secondary">Save default timing</button>
          </fieldset>
        </form>
      </section>
      <form className="card" onSubmit={save}>
        <fieldset disabled={busy || hours.loading || Boolean(hours.error)}>
          <div className="section-title">
              <div>
                <h2>Your next seven days</h2>
                <p>
                  Default timing applies automatically. Edit a date for custom hours, or untick Active to take that day off. Custom hours apply only to that date.
              </p>
            </div>
            <span className="help">All availability uses India Standard Time (IST).</span>
          </div>
          {hours.loading ? (
            <LoadingState />
          ) : (
            visibleDays.map((day) => (
              <section className={`day-row ${day.isToday ? "today" : ""}`} key={`${day.dayOfWeek}-${day.dateLabel}`}>
                <div className="day-heading">
                  <strong>{day.isToday ? "Today" : day.dayName}</strong>
                  <span>{day.dateLabel}</span>
                  <small>{windows.some((row) => row.dayOfWeek === day.dayOfWeek && row.useDefault) ? "Default timing" : "Custom timing · this date only"}</small>
                </div>
                <div className="day-windows">
                  {windows.map(
                    (row, index) =>
                      row.dayOfWeek === day.dayOfWeek && (
                        <div className="time-window" key={index}>
                          <input
                            aria-label={`${day.dayName} start`}
                            type="time"
                            value={row.startTime}
                            onChange={(e) =>
                              update(index, { startTime: e.target.value })
                            }
                            required
                          />
                          <span>to</span>
                          <input
                            aria-label={`${day.dayName} end`}
                            type="time"
                            value={row.endTime}
                            onChange={(e) =>
                              update(index, { endTime: e.target.value })
                            }
                            required
                          />
                          {row.endTime < row.startTime && <small>+1 day</small>}
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={row.isActive}
                              onChange={(e) =>
                                update(index, { isActive: e.target.checked })
                              }
                            />
                            Active
                          </label>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove ${day.dayName} window`}
                            onClick={() =>
                              setWindows(windows.filter((_, n) => n !== index).some((row) => row.dayOfWeek === day.dayOfWeek)
                                ? windows.filter((_, n) => n !== index)
                                : windows.map((row, n) => n === index ? { ...row, isActive: false, useDefault: false } : row))
                            }
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      ),
                  )}
                  {!windows.some((w) => w.dayOfWeek === day.dayOfWeek) && (
                    <span className="muted">Set default timing above or add custom hours for this date.</span>
                  )}
                  <div className="quick-windows" aria-label={`${day.dayName} quick times`}>
                    {timing.data && !windows.some((row) => row.dayOfWeek === day.dayOfWeek && row.useDefault) && <button
                      type="button" className="quick-window"
                      onClick={() => setWindows((current) => [...current.filter((row) => row.dayOfWeek !== day.dayOfWeek), {
                        dayOfWeek: day.dayOfWeek, availableDate: today.plus({ days: (day.dayOfWeek - today.weekday + 7) % 7 }).toISODate()!,
                        ...timing.data!, isActive: true, useDefault: true
                      }])}>Use default timing</button>}
                    <button
                      type="button"
                      className="quick-window custom-window"
                      aria-label={`Add ${day.dayName} window`}
                      onClick={() => addWindow(day.dayOfWeek, "", "")}
                    >
                      <PlusIcon size={16} /> Add custom timing
                    </button>
                  </div>
                </div>
              </section>
            ))
          )}
          <div className="form-footer">
            <p className="help">
               A window ending earlier than it starts crosses midnight: 23:00–03:00 ends the following day. Sessions begin at the generated appointment times and include up to 40 minutes with the client.
            </p>
            <button className="button">
              {busy ? "Saving…" : "Save working hours"}
            </button>
          </div>
        </fieldset>
      </form>
      <section className="card">
        <h2>Time away</h2>
        <p>
           Pick one of your generated appointment times to block it instantly, or enter a custom period for leave, meetings, or personal time. Existing bookings cannot be blocked.
        </p>
        <div className="date-picker compact-date-picker" aria-label="Dates for available appointment times">
          {visibleDays.map((day, index) => {
            const date = today.plus({ days: index });
            const key = date.toISODate()!;
            return <button type="button" key={key} className={slotDate === key ? "selected" : ""} onClick={() => setSlotDate(key)}>
              <small>{day.isToday ? "Today" : date.toFormat("ccc")}</small><strong>{date.toFormat("d")}</strong><span>{date.toFormat("LLL")}</span>
            </button>;
          })}
        </div>
        <div className="available-slot-preview">
          <h3>Available appointment times</h3>
          <p className="help">These are the same live times clients can currently choose. Select one to make it unavailable.</p>
          {slots.loading ? <LoadingState label="Generating appointment times…" /> : slots.data?.length ? (
            <div className="slot-grid">
              {slots.data.map((slot) => <button type="button" disabled={busy} key={slot.startTime} onClick={() => void blockGeneratedSlot(slot)}>
                <ClockIcon /> {DateTime.fromISO(slot.startTime, { zone: "utc" }).setZone("Asia/Kolkata").toFormat("h:mm a")}
                <small>Available · select to block</small>
              </button>)}
            </div>
          ) : <EmptyState title="No available appointment times">Save working hours above, or choose another day.</EmptyState>}
        </div>
        <h3>Block a custom period</h3>
        <form onSubmit={block}>
          <fieldset disabled={busy}>
            <div className="form-grid">
              <label>
                From
                <input name="startTime" type="datetime-local" required />
              </label>
              <label>
                Until
                <input name="endTime" type="datetime-local" required />
              </label>
              <label>
                Reason (optional)
                <input name="reason" maxLength={500} />
              </label>
            </div>
            <button className="button secondary">Block time</button>
          </fieldset>
        </form>
        <div className="blocked-list">
          {blocks.data?.length ? (
            blocks.data.map((item) => (
              <div className="blocked-item" key={item.id}>
                <div>
                  <strong>
                    {formatDate(item.startTime, "Asia/Kolkata")} ·{" "}
                    {formatTime(item.startTime, "Asia/Kolkata")}
                  </strong>
                  <p>
                    Until {formatDate(item.endTime, "Asia/Kolkata")} ·{" "}
                    {formatTime(item.endTime, "Asia/Kolkata")}
                  </p>
                  <small>{item.reason}</small>
                </div>
                <button
                  disabled={busy}
                  className="button secondary small"
                  onClick={() => remove(item.id)}
                >
                  Unblock
                </button>
              </div>
            ))
          ) : (
            <EmptyState title="No time away scheduled">
              Add a blocked period whenever you need a break.
            </EmptyState>
          )}
        </div>
      </section>
      {busy && <TransitionLoader label={busyLabel || "Updating availability…"} />}
    </>
  );
}

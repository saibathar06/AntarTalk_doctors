import { useEffect, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import { ClockIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { api, mutate } from "../api";
import { useAuth } from "../auth";
import {
  ErrorState,
  LoadingState,
  PageHeader,
  TransitionLoader,
  useResource,
} from "../components";
import type { Block, BookingSlot, WorkingHour } from "../types";

type DefaultTiming = { startTime: string; endTime: string };
export function AvailabilityPage() {
  const { profile, reload } = useAuth();
  const today = DateTime.now().setZone("Asia/Kolkata").startOf("day");
  const hours = useResource<WorkingHour[]>("/api/doctor/availability");
  const blocks = useResource<Block[]>("/api/doctor/blocked-slots");
  const timing = useResource<DefaultTiming | null>("/api/doctor/availability/default-timing");
  const slots = useResource<BookingSlot[]>(`/api/doctor/availability/slots?from=${encodeURIComponent(today.toUTC().toISO()!)}&to=${encodeURIComponent(today.plus({ days: 7 }).toUTC().toISO()!)}`);
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
    const localStart = DateTime.fromISO(slot.startTime, { zone: "utc" }).setZone("Asia/Kolkata");
    if (!window.confirm(`Block the ${localStart.toFormat("h:mm a")} appointment on ${localStart.toFormat("d LLL")}?`)) return;
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
      dateKey: date.toISODate()!,
      isToday: offset === 0,
    };
  });
  return (
    <>
      <PageHeader
        title="Your time. Your rhythm."
        description={`Today is ${today.toFormat("cccc, d LLLL yyyy")} in India Standard Time. Set your hours, review the generated appointment times, and block any slot you cannot take.`}
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
            visibleDays.map((day) => {
              const daySlots = (slots.data ?? []).filter((slot) => DateTime.fromISO(slot.startTime, { zone: "utc" }).setZone("Asia/Kolkata").toISODate() === day.dateKey);
              const dayBlocks = (blocks.data ?? []).filter((item) => DateTime.fromISO(item.startTime, { zone: "utc" }).setZone("Asia/Kolkata").toISODate() === day.dateKey);
              return <section className={`day-row ${day.isToday ? "today" : ""}`} key={`${day.dayOfWeek}-${day.dateLabel}`}>
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
                  <div className="day-slot-panel">
                    <div className="day-slot-heading">
                      <div>
                        <strong>Generated appointment times</strong>
                        <span>These are the live times clients can book after you save your hours.</span>
                      </div>
                      <small>{daySlots.length} available{dayBlocks.length ? ` · ${dayBlocks.length} blocked` : ""}</small>
                    </div>
                    {slots.loading || blocks.loading ? <LoadingState label="Generating appointment times…" /> : (
                      <div className="day-slot-grid" aria-label={`${day.dayName} appointment times`}>
                        {daySlots.map((slot) => {
                          const time = DateTime.fromISO(slot.startTime, { zone: "utc" }).setZone("Asia/Kolkata").toFormat("h:mm a");
                          return <button type="button" disabled={busy} key={slot.startTime} aria-label={`Block ${day.dayName} ${time}`} onClick={() => void blockGeneratedSlot(slot)}>
                            <ClockIcon /> <strong>{time}</strong><small>Available · select to block</small>
                          </button>;
                        })}
                        {dayBlocks.map((item) => {
                          const start = DateTime.fromISO(item.startTime, { zone: "utc" }).setZone("Asia/Kolkata");
                          const end = DateTime.fromISO(item.endTime, { zone: "utc" }).setZone("Asia/Kolkata");
                          return <button type="button" disabled={busy} className="blocked" key={item.id} aria-label={`Unblock ${day.dayName} ${start.toFormat("h:mm a")}`} onClick={() => void remove(item.id)}>
                            <ClockIcon /> <strong>{start.toFormat("h:mm a")}</strong><small>Blocked until {end.toFormat("h:mm a")} · select to unblock</small>
                          </button>;
                        })}
                        {!daySlots.length && !dayBlocks.length && <p className="day-slot-empty">No appointment times generated for this day.</p>}
                      </div>
                    )}
                  </div>
                </div>
              </section>;
            })
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
      {busy && <TransitionLoader label={busyLabel || "Updating availability…"} />}
    </>
  );
}

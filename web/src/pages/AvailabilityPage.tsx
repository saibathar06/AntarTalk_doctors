import { useEffect, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
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
import type { Block, WorkingHour } from "../types";

const quickWindows = [
  { label: "Morning", startTime: "09:00", endTime: "12:00" },
  { label: "Afternoon", startTime: "13:00", endTime: "17:00" },
  { label: "Evening", startTime: "18:00", endTime: "21:00" },
];
export function AvailabilityPage() {
  const { profile, reload } = useAuth();
  const hours = useResource<WorkingHour[]>("/api/doctor/availability");
  const blocks = useResource<Block[]>("/api/doctor/blocked-slots");
  const [windows, setWindows] = useState<WorkingHour[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busyLabel, setBusyLabel] = useState("");
  useEffect(() => {
    if (hours.data)
      setWindows(
        (profile!.timezone === "Asia/Kolkata" ? hours.data : []).map(({ dayOfWeek, startTime, endTime, isActive }) => ({
          dayOfWeek,
          startTime,
          endTime,
          isActive,
        })),
      );
  }, [hours.data, profile]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setBusyLabel("Saving your weekly availability…");
    setError("");
    setNotice("");
    try {
      await mutate("/api/doctor/availability", "PUT", { timezone: "Asia/Kolkata", windows });
      await reload();
      hours.reload();
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }
  function update(index: number, change: Partial<WorkingHour>) {
    setWindows((old) =>
      old.map((row, i) => (i === index ? { ...row, ...change } : row)),
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
      return [...current, { dayOfWeek, startTime, endTime, isActive: true }];
    });
  }
  const today = DateTime.now().setZone("Asia/Kolkata").startOf("day");
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
      {profile!.timezone !== "Asia/Kolkata" && <p className="alert">Your previous schedule used another timezone. Set fresh weekly hours in IST and save them before clients can book new sessions. Existing appointments keep their original UTC times.</p>}
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      <form className="card" onSubmit={save}>
        <fieldset disabled={busy || hours.loading || Boolean(hours.error)}>
          <div className="section-title">
              <div>
                <h2>Your next seven days</h2>
                <p>
                  Set the hours for each dated day below. They repeat every week on that weekday until you change them.
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
                  <small>Repeats every {day.dayName}</small>
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
                              setWindows(windows.filter((_, n) => n !== index))
                            }
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      ),
                  )}
                  {!windows.some((w) => w.dayOfWeek === day.dayOfWeek) && (
                    <span className="muted">No time is available yet. Choose a quick period or add your own.</span>
                  )}
                  <div className="quick-windows" aria-label={`${day.dayName} quick times`}>
                    {quickWindows.map((window) => (
                      <button
                        className="quick-window"
                        type="button"
                        key={window.label}
                        onClick={() => addWindow(day.dayOfWeek, window.startTime, window.endTime)}
                      >
                        {window.label} <small>{window.startTime}–{window.endTime}</small>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="quick-window custom-window"
                      aria-label={`Add ${day.dayName} window`}
                      onClick={() => addWindow(day.dayOfWeek, "09:00", "12:00")}
                    >
                      <PlusIcon size={16} /> Add custom time
                    </button>
                  </div>
                </div>
              </section>
            ))
          )}
          <div className="form-footer">
            <p className="help">
               A window ending earlier than it starts crosses midnight: 23:00–03:00 ends the following day. Clients can book only full 60-minute appointment windows (40 minutes of session time plus a 20-minute protected buffer).
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
           Use this for leave, meetings, or personal time in India Standard Time. It removes only the selected period from availability; your weekly hours remain unchanged. Existing bookings must be resolved before blocking an overlap.
        </p>
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

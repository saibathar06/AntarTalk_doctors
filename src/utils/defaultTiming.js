import { bookingWindow } from './bookingWindow.js';
import { parseTimeToDate } from './time.js';

export function getDefaultTiming(presets) {
  if (!Array.isArray(presets)) return null;
  const value = presets.find((item) => item.isDefault === true);
  return value ? { startTime: value.startTime, endTime: value.endTime } : null;
}

// Explicit rows, including inactive rows, override the default for that date.
export function effectiveWorkingHours(rows, presets) {
  const timing = getDefaultTiming(presets);
  if (!timing) return rows;
  const { today } = bookingWindow();
  const result = [...rows];
  for (let offset = -1; offset < 7; offset++) {
    const date = today.plus({ days: offset });
    if (rows.some((row) => row.availableDate?.toISOString().slice(0, 10) === date.toISODate())) continue;
    result.push({
      dayOfWeek: date.weekday, availableDate: new Date(date.toISODate()),
      startTime: parseTimeToDate(timing.startTime), endTime: parseTimeToDate(timing.endTime),
      timezone: 'Asia/Kolkata', isActive: true, useDefault: true
    });
  }
  return result;
}

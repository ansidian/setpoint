// Time to Leave's rules (BRIEF.md › Calendar: from Home, using live routes, with the buffer).
// Harvested from v1's `time-to-leave-model` (see SV-6): the physical-location test, the leave time
// (start − buffer − travel) and the bounded route-check cadence. v2 changes: the buffer comes from
// Settings (5 min by default, not 15), the leave time is floored to the minute and the travel time
// rounded up, so "Leave by 2:05 PM · 18 min" adds up exactly; and implausible routes (a geocode in
// the wrong city) are refused instead of sending the user out hours early.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// A destination that's only a link or a video call has no route (v1's two patterns).
const URL_ONLY = /^(?:(?:https?:\/\/|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/i;
const ZOOM_ONLY = /^(?:zoom(?: meeting| call| video conference)?|join zoom|google meet|meet|teams|microsoft teams(?: meeting)?)$/i;

/** Whether an event's location is somewhere the user drives to. */
export function isPhysicalLocation(location: string | null | undefined): boolean {
  const text = location?.trim();
  if (!text) return false;
  return !URL_ONLY.test(text) && !ZOOM_ONLY.test(text);
}

/** The longest drive and distance Setpoint believes; anything more is a wrong geocode. */
export const MAX_TRAVEL_SECONDS = 4 * 60 * 60;
export const MAX_TRAVEL_METERS = 400_000;

export const plausibleRoute = (durationSeconds: number, distanceMeters: number) =>
  Number.isSafeInteger(durationSeconds) && durationSeconds >= 0 && durationSeconds <= MAX_TRAVEL_SECONDS
  && Number.isSafeInteger(distanceMeters) && distanceMeters >= 0 && distanceMeters <= MAX_TRAVEL_METERS;

/** Whole minutes of travel, rounded up: a 17 min 10 s drive is "18 min". */
export const travelMinutes = (durationSeconds: number) => Math.max(1, Math.ceil(durationSeconds / 60));

/**
 * When to leave: the start, less the buffer, less the travel in whole minutes, on a whole minute
 * (never later than the true time).
 */
export function leaveAt(startsAt: string, durationSeconds: number, bufferMinutes: number): string {
  const at = Date.parse(startsAt) - bufferMinutes * MINUTE - travelMinutes(durationSeconds) * MINUTE;
  return new Date(Math.floor(at / MINUTE) * MINUTE).toISOString();
}

/**
 * When to check the route next (v1's cadence): more than 3 hours before leaving, once at 3 hours
 * before; between 1 and 3 hours, every 15 minutes; in the last hour (or past it), every 5; never
 * after the start, and not at all once it has started.
 */
export function nextRouteCheck(now: string, departure: string, startsAt: string): string | null {
  const nowMs = Date.parse(now);
  const start = Date.parse(startsAt);
  if (nowMs >= start) return null;
  const untilDeparture = Date.parse(departure) - nowMs;
  const next = untilDeparture > 3 * HOUR ? Date.parse(departure) - 3 * HOUR : untilDeparture > HOUR ? nowMs + 15 * MINUTE : nowMs + 5 * MINUTE;
  return new Date(Math.min(next, start)).toISOString();
}

/** After a failed check: the last estimate stands, and the next try is at least 5 minutes away. */
export function retryRouteCheck(now: string, departure: string | null, startsAt: string): string | null {
  const nowMs = Date.parse(now);
  if (nowMs >= Date.parse(startsAt)) return null;
  const planned = departure ? nextRouteCheck(now, departure, startsAt) : null;
  return new Date(Math.min(Math.max(planned ? Date.parse(planned) : 0, nowMs + 5 * MINUTE), Date.parse(startsAt))).toISOString();
}

/** How far ahead Time to Leave looks: events starting within this get a route. */
export const TIME_TO_LEAVE_HORIZON_MS = 24 * HOUR;

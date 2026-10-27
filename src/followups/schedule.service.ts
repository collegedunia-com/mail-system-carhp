import { DateTime } from "luxon";
import type { Config } from "../common/config.js";

type WindowConfig = Pick<Config, "timezone" | "startHour" | "endHour">;

export function insideWindow(now: Date, cfg: WindowConfig): boolean {
  const local = DateTime.fromJSDate(now, { zone: cfg.timezone });
  return (
    local.weekday <= 5 &&
    local.hour >= cfg.startHour &&
    local.hour < cfg.endHour
  );
}

export function nextWindow(now: Date, cfg: WindowConfig): Date {
  let local = DateTime.fromJSDate(now, { zone: cfg.timezone });
  if (insideWindow(now, cfg)) return now;
  if (local.hour >= cfg.endHour) local = local.plus({ days: 1 });
  local = local.set({
    hour: cfg.startHour,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  while (local.weekday > 5) local = local.plus({ days: 1 });
  return local.toUTC().toJSDate();
}

export function nextFollowup(
  acceptedAt: Date,
  cfg: WindowConfig & Pick<Config, "followupDays">,
): Date {
  const due = DateTime.fromJSDate(acceptedAt, { zone: cfg.timezone }).plus({
    days: cfg.followupDays,
  });
  return nextWindow(due.toJSDate(), cfg);
}

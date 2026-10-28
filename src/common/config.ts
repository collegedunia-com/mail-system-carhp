import "dotenv/config";
import { DateTime } from "luxon";

export function config(env: NodeJS.ProcessEnv = process.env) {
  function integer(
    name: string,
    fallback: number,
    min = 1,
    max = Number.MAX_SAFE_INTEGER,
  ): number {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  }

  const timezone = env.SEND_TIMEZONE || "UTC";
  if (!DateTime.now().setZone(timezone).isValid)
    throw new Error("Invalid SEND_TIMEZONE");
  const cronTimezone = env.CRON_TIMEZONE || "Asia/Kolkata";
  if (!DateTime.now().setZone(cronTimezone).isValid)
    throw new Error("Invalid CRON_TIMEZONE");
  const cronHours = (env.CRON_HOURS ?? "10,18")
    .split(",")
    .map((value) => value.trim());
  if (cronHours.some((value) => !/^\d{1,2}$/.test(value) || Number(value) > 23))
    throw new Error(
      "CRON_HOURS must be comma-separated hours between 0 and 23",
    );
  const startHour = integer("SEND_HOUR_START", 9, 0, 23);
  const endHour = integer("SEND_HOUR_END", 17, 1, 24);
  if (startHour >= endHour)
    throw new Error("SEND_HOUR_START must precede SEND_HOUR_END");
  const trackingEnabled = env.TRACKING_ENABLED === "true";
  const trackingBaseUrl = (env.TRACKING_BASE_URL || "").replace(/\/+$/, "");
  if (trackingBaseUrl || trackingEnabled) {
    let url: URL;
    try {
      url = new URL(trackingBaseUrl);
    } catch {
      throw new Error("TRACKING_BASE_URL must be a public HTTPS URL");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "TRACKING_BASE_URL must use HTTPS without credentials, query or fragment",
      );
  }
  return {
    databaseHost: env.DB_HOST || "127.0.0.1",
    databasePort: integer("DB_PORT", 3306, 1, 65535),
    databaseName: env.DB_NAME || "",
    databaseUser: env.DB_USER || "",
    databasePassword: env.DB_PASS || "",
    databaseSsl: env.DB_SSL === "true",
    databaseSslCa: env.DB_SSL_CA || "",
    encryptionKey: env.TOKEN_ENCRYPTION_KEY || "",
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      env.GOOGLE_REDIRECT_URI || "http://127.0.0.1:3003/oauth/callback",
    spreadsheetId: env.SPREADSHEET_ID || "",
    sheetName: env.SHEET_NAME || "Outreach",
    templateSheetName: env.TEMPLATE_SHEET_NAME || "Template Library",
    sendEnabled: env.SEND_ENABLED === "true",
    pollMs: integer("POLL_INTERVAL_MS", 60_000, 1000),
    cronMaxMessages: integer("CRON_MAX_MESSAGES", 50, 1, 10000),
    cronMaxRuntimeMs:
      integer("CRON_MAX_RUNTIME_SECONDS", 1800, 1, 86400) * 1000,
    cronTimezone,
    cronHours: [...new Set(cronHours.map(Number))].sort((a, b) => a - b),
    trackingEnabled,
    trackingBaseUrl,
    trackingHost: env.TRACKING_HOST || "127.0.0.1",
    trackingPort: integer("TRACKING_PORT", 3001, 1, 65535),
    followupDays: integer("FOLLOWUP_DAYS", 2),
    maxFollowups: integer("MAX_FOLLOWUPS", 3, 0, 3),
    timezone,
    startHour,
    endHour,
    dailyLimit: integer("DAILY_SEND_LIMIT", 50),
    hourlyLimit: integer("HOURLY_SEND_LIMIT", 15),
    minGapSeconds: integer("MIN_SEND_GAP_SECONDS", 120),
    staleDays: integer("STALE_FOLLOWUP_DAYS", 7),
    attachmentHosts: (env.ATTACHMENT_ALLOWED_HOSTS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}
export type Config = ReturnType<typeof config>;

export function required(value: string, name: string): string {
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

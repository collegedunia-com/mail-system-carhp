import { GmailError } from "../gmail/gmail.service.js";

export function safeError(error: unknown): string {
  if (error instanceof GmailError) return error.message;
  if (
    error instanceof Error &&
    !("response" in error) &&
    !/https?:\/\//i.test(error.message)
  )
    return error.message.slice(0, 300);
  return "Operation failed; inspect configuration and retry safely";
}

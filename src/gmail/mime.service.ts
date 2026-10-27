import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type { CloudAttachment } from "../common/types.js";

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function trackedHtml(text: string, trackingUrl: string): string {
  if (new URL(trackingUrl).protocol !== "https:")
    throw new Error("Tracking images require HTTPS");
  return (
    "<!doctype html><html><body><div>" +
    escapeHtml(text).replace(/\r?\n/g, "<br>\n") +
    '</div><img src="' +
    escapeHtml(trackingUrl) +
    '" width="1" height="1" alt="" style="display:block;border:0"></body></html>'
  );
}

export async function composeMail(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: CloudAttachment[];
  trackingUrl?: string;
}): Promise<Buffer> {
  const raw = await new MailComposer({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.trackingUrl
      ? trackedHtml(input.text, input.trackingUrl)
      : undefined,
    messageId: input.messageId,
    inReplyTo: input.inReplyTo,
    references: input.references,
    attachments: input.attachments,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
    .compile()
    .build();
  if (raw.length > 24 * 1024 * 1024)
    throw new Error("Encoded email exceeds the 24 MB application limit");
  return raw;
}

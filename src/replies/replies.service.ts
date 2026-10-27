import { LoggerService } from "../logger/logger.service.js";
import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import type { DatabaseService } from "../database/database.service.js";
import type { GmailAccount } from "../gmail/model/gmail-account.model.js";
import type { Outreach as OutreachModel } from "../outreach/model/outreach.model.js";
import type { EmailMessage } from "../outreach/model/email-message.model.js";
import type { SuppressedRecipient } from "./model/suppressed-recipient.model.js";
import type {
  Account,
  GmailMessage,
  GmailPart,
  GmailPort,
  Outreach,
} from "../common/types.js";

export const header = (message: GmailMessage, name: string): string =>
  message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  )?.value || "";

export function bodyText(part?: GmailPart): string {
  if (!part) return "";
  const own = part.body?.data
    ? Buffer.from(part.body.data, "base64url").toString("utf8")
    : "";
  const children = (part.parts || []).map(bodyText).filter(Boolean).join("\n");
  const plain = (part.parts || [])
    .filter((item) => item.mimeType === "text/plain")
    .map(bodyText)
    .join("\n");
  if (part.mimeType === "multipart/report")
    return [own, children].filter(Boolean).join("\n");
  if (plain) return plain;
  if (part.mimeType === "text/html")
    return own
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?\s*>|<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  return [own, children].filter(Boolean).join("\n");
}

export function unquoted(text: string): string {
  return text
    .split(
      /\n\s*(?:On .{0,200}wrote:|-----Original Message-----|From:\s|>)/i,
    )[0]
    .trim();
}

export type ReplyClass =
  | "unsubscribe"
  | "hard_bounce"
  | "soft_bounce"
  | "auto_reply"
  | "human";
export function classifyReply(message: GmailMessage): ReplyClass {
  const text = unquoted(bodyText(message.payload) || message.snippet || "");
  const from = header(message, "from");
  const report =
    /multipart\/report/i.test(message.payload?.mimeType || "") ||
    /mailer-daemon|postmaster/i.test(from);
  if (report) {
    if (
      /\b(?:Status:\s*)?5\.\d\.\d\b|Action:\s*failed/i.test(
        bodyText(message.payload),
      )
    )
      return "hard_bounce";
    return "soft_bounce"; // An unrecognised delivery report pauses for review instead of suppressing.
  }
  const auto = header(message, "auto-submitted");
  if (
    (auto && auto.toLowerCase() !== "no") ||
    header(message, "x-autoreply") ||
    header(message, "x-autorespond") ||
    /^(bulk|auto_reply|list)$/i.test(header(message, "precedence")) ||
    /^\s*(?:out of office|automatic reply|auto(?:matic)?[- ]response)\b/i.test(
      header(message, "subject"),
    )
  )
    return "auto_reply";
  if (
    /\b(?:unsubscribe|remove me|do not contact|stop emailing|stop contacting|take me off)\b/i.test(
      text,
    )
  )
    return "unsubscribe";
  return "human";
}

export type ReplyModels = {
  GmailAccount: typeof GmailAccount;
  Outreach: typeof OutreachModel;
  EmailMessage: typeof EmailMessage;
  SuppressedRecipient: typeof SuppressedRecipient;
};

export class ReplyMonitor {
  constructor(
    private models: ReplyModels,
    private logger: LoggerService,
  ) {}

  async ingest(
    db: DatabaseService,
    account: Account,
    messages: GmailMessage[],
  ): Promise<void> {
    const { Outreach, EmailMessage, SuppressedRecipient } = this.models;
    for (const incoming of messages) {
      if (incoming.labelIds?.includes("SENT")) continue;
      const from = header(incoming, "from")
        .match(
          /<?([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i,
        )?.[1]
        .toLowerCase();
      if (from === account.email) continue;
      let matches = await Outreach.findAll({
        where: { account_id: account.id, thread_id: incoming.threadId },
      });
      if (!matches.length) {
        const references =
          [
            header(incoming, "in-reply-to"),
            header(incoming, "references"),
            bodyText(incoming.payload),
          ]
            .join(" ")
            .match(/<[^<>\s]+@[^<>\s]+>/g) || [];
        if (references.length) {
          const originals = await EmailMessage.findAll({
            attributes: ["outreach_id"],
            where: {
              account_id: account.id,
              direction: "out",
              rfc_message_id: { [Op.in]: references },
            },
          });
          const ids = [
            ...new Set(
              originals
                .map((row) => row.get().outreach_id)
                .filter((id): id is string => !!id),
            ),
          ];
          if (ids.length)
            matches = await Outreach.findAll({
              where: { account_id: account.id, id: { [Op.in]: ids } },
            });
        }
      }
      if (matches.length !== 1) continue;
      const outreach = matches[0].get({ plain: true });
      const classification = classifyReply(incoming);
      await db.transaction(async (transaction) => {
        const [, created] = await EmailMessage.findOrCreate({
          where: { account_id: account.id, gmail_message_id: incoming.id },
          defaults: {
            id: randomUUID(),
            outreach_id: outreach.id,
            account_id: account.id,
            direction: "in",
            step: null,
            subject: header(incoming, "subject"),
            body_text: bodyText(incoming.payload),
            gmail_message_id: incoming.id,
            rfc_message_id: header(incoming, "message-id") || null,
            send_state: "received",
            classification,
          },
          transaction,
        });
        if (!created) return;
        this.logger.log(
          {
            event: "reply_classified",
            outreach_id: outreach.id,
            classification,
          },
          "Replies",
        );
        if (classification === "auto_reply") return;
        const received =
          incoming.internalDate &&
          Number.isFinite(Number(incoming.internalDate))
            ? new Date(Number(incoming.internalDate))
            : new Date();
        if (
          classification === "unsubscribe" ||
          classification === "hard_bounce"
        ) {
          await SuppressedRecipient.findOrCreate({
            where: { email: outreach.to_email },
            defaults: { email: outreach.to_email, reason: classification },
            transaction,
          });
          await Outreach.update(
            {
              status:
                classification === "unsubscribe" ? "suppressed" : "bounced",
              next_followup_at: null,
              last_reply_at: received,
            },
            {
              where: {
                to_email: outreach.to_email,
                status: { [Op.notIn]: ["suppressed", "bounced"] },
              },
              transaction,
            },
          );
        } else if (classification === "soft_bounce") {
          await Outreach.update(
            {
              status: "needs_review",
              next_followup_at: null,
              error: "Delivery report requires review",
            },
            {
              where: {
                id: outreach.id,
                status: { [Op.notIn]: ["suppressed", "bounced"] },
              },
              transaction,
            },
          );
        } else {
          await Outreach.update(
            {
              status: "replied",
              last_reply_at: received,
              next_followup_at: null,
              error: null,
            },
            {
              where: {
                id: outreach.id,
                status: { [Op.notIn]: ["suppressed", "bounced"] },
              },
              transaction,
            },
          );
        }
      });
    }
  }

  async poll(
    db: DatabaseService,
    account: Account,
    gmail: GmailPort,
  ): Promise<void> {
    const changes = await gmail.changes(account.history_id);
    await this.ingest(db, account, changes.messages);
    await this.models.GmailAccount.update(
      { history_id: changes.historyId },
      { where: { id: account.id } },
    );
    account.history_id = changes.historyId;
  }
}

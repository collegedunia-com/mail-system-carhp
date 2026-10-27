import { LoggerService } from "../logger/logger.service.js";
import { randomUUID } from "node:crypto";
import { Op, col, fn } from "sequelize";
import { DateTime } from "luxon";
import type { Config } from "../common/config.js";
import type { Account, GmailPort, Message, Outreach } from "../common/types.js";
import type { DatabaseService } from "../database/database.service.js";
import { GmailError } from "../gmail/gmail.service.js";
import { createGmailFacade, type GmailFactory } from "../gmail/gmail.module.js";
import type { AttachmentLoader } from "../attachments/attachments.module.js";
import { safeError } from "../common/errors.js";
import { ReplyMonitor, bodyText, header } from "../replies/replies.service.js";
import { composeMail } from "../gmail/mime.service.js";
import { insideWindow, nextFollowup } from "./schedule.service.js";
import { TrackingService } from "../tracking/tracking.service.js";
import type { GmailAccount } from "../gmail/model/gmail-account.model.js";
import type { Outreach as OutreachModel } from "../outreach/model/outreach.model.js";
import type { EmailMessage } from "../outreach/model/email-message.model.js";
import type { SendAttempt } from "./model/send-attempt.model.js";
import type { SuppressedRecipient } from "../replies/model/suppressed-recipient.model.js";

export interface TickOptions {
  scope?: { spreadsheet_id: string; sheet_name: string };
  maxAttempts?: number;
  deadline?: Date;
  signal?: AbortSignal;
}
export interface TickSummary {
  attempts: number;
  accepted: number;
  accountErrors: number;
  nextAttemptAt?: Date;
}

export type FollowupModels = {
  GmailAccount: typeof GmailAccount;
  Outreach: typeof OutreachModel;
  EmailMessage: typeof EmailMessage;
  SendAttempt: typeof SendAttempt;
  SuppressedRecipient: typeof SuppressedRecipient;
};

export class FollowupService {
  constructor(
    private db: DatabaseService,
    private cfg: Config,
    private attachments: AttachmentLoader,
    private factory: GmailFactory,
    private replies: ReplyMonitor,
    private tracking: TrackingService,
    private models: FollowupModels,
    private logger: LoggerService,
  ) {}

  async tick(
    now = new Date(),
    options: TickOptions = {},
  ): Promise<TickSummary> {
    const summary: TickSummary = { attempts: 0, accepted: 0, accountErrors: 0 };
    const rememberRetry = (date?: Date) => {
      if (date && (!summary.nextAttemptAt || date < summary.nextAttemptAt))
        summary.nextAttemptAt = date;
    };
    const accounts = await this.models.GmailAccount.findAll({
      where: { status: "connected" },
      order: [["email", "ASC"]],
    });
    for (const model of accounts) {
      if (
        options.signal?.aborted ||
        (options.deadline && new Date() >= options.deadline)
      )
        break;
      const account = model.get({ plain: true });
      await this.db.withLock(`gmail:${account.id}`, async () => {
        try {
          const gmail = this.factory(account);
          await this.recover(account.id);
          await this.reconcile(account, gmail, now);
          await this.replies.poll(this.db, account, gmail);
          if (
            !this.cfg.sendEnabled ||
            summary.attempts >= (options.maxAttempts ?? Infinity)
          )
            return;
          const where = {
            ...options.scope,
            account_id: account.id,
            [Op.or]: [
              { status: "ready" },
              { status: "waiting", next_followup_at: { [Op.lte]: now } },
            ],
          };
          const due = await this.models.Outreach.findAll({
            where,
            order: [
              [
                fn("COALESCE", col("next_followup_at"), col("created_at")),
                "ASC",
              ],
              ["id", "ASC"],
            ],
          });
          if (!due.length) return;
          if (insideWindow(now, this.cfg)) {
            const rate = await this.rateState(account.id, now);
            if (!rate.allowed) {
              rememberRetry(rate.retryAt);
              return;
            }
          }
          const before = summary.attempts;
          for (const row of due) {
            if (
              options.signal?.aborted ||
              (options.deadline && new Date() >= options.deadline)
            )
              break;
            if (
              await this.process(
                account,
                gmail,
                row.get({ plain: true }),
                now,
                () => {
                  summary.attempts++;
                },
                () =>
                  !options.signal?.aborted &&
                  (!options.deadline || new Date() < options.deadline),
              )
            )
              summary.accepted++;
            if (summary.attempts > before) break;
          }
          if (
            summary.attempts > before &&
            insideWindow(now, this.cfg) &&
            (await this.models.Outreach.findOne({ where }))
          ) {
            rememberRetry((await this.rateState(account.id, now)).retryAt);
          }
        } catch (error) {
          summary.accountErrors++;
          if (error instanceof GmailError && error.httpStatus === 401)
            await this.models.GmailAccount.update(
              { status: "disconnected" },
              { where: { id: account.id } },
            );
          this.logger.error(
            {
              event: "account_tick_failed",
              account_id: account.id,
              error: safeError(error),
            },
            undefined,
            "Followups",
          );
        }
      });
    }
    return summary;
  }

  private async recover(accountId: string): Promise<void> {
    const { EmailMessage, SendAttempt, Outreach } = this.models;
    await this.db.transaction(async (transaction) => {
      const interrupted = await EmailMessage.findAll({
        where: {
          account_id: accountId,
          direction: "out",
          send_state: "sending",
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      for (const message of interrupted) {
        await message.update({ send_state: "uncertain" }, { transaction });
        await SendAttempt.update(
          {
            status: "uncertain",
            error: "Worker interrupted during send",
            finished_at: new Date(),
          },
          {
            where: { message_id: message.get().id, status: "sending" },
            transaction,
          },
        );
        await Outreach.update(
          {
            status: "needs_review",
            error: "uncertain_send",
            next_followup_at: null,
          },
          {
            where: {
              id: message.get().outreach_id!,
              status: {
                [Op.in]: ["ready", "sending", "waiting", "needs_review"],
              },
            },
            transaction,
          },
        );
      }
      for (const outreach of await Outreach.findAll({
        where: { account_id: accountId, status: "sending" },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })) {
        const pending = await EmailMessage.count({
          where: {
            outreach_id: outreach.get().id,
            send_state: { [Op.in]: ["sending", "uncertain"] },
          },
          transaction,
        });
        if (!pending)
          await outreach.update(
            { status: outreach.get().initial_sent_at ? "waiting" : "ready" },
            { transaction },
          );
      }
    });
  }

  private async reconcile(
    account: Account,
    gmail: GmailPort,
    now: Date,
  ): Promise<void> {
    const { EmailMessage, Outreach } = this.models;
    const pending = await EmailMessage.findAll({
      where: {
        account_id: account.id,
        direction: "out",
        send_state: "uncertain",
        reconcile_checks: { [Op.lt]: 2 },
        [Op.or]: [
          { last_reconciled_at: null },
          {
            last_reconciled_at: { [Op.lte]: new Date(now.getTime() - 300_000) },
          },
        ],
      },
      order: [["created_at", "ASC"]],
    });
    for (const model of pending) {
      const message = model.get({ plain: true }) as Message;
      const matches = (await gmail.findSent(message.rfc_message_id)).filter(
        (candidate) =>
          header(candidate, "message-id") === message.rfc_message_id &&
          normaliseBody(bodyText(candidate.payload)) ===
            normaliseBody(message.body_text),
      );
      if (matches.length === 1) {
        const sent = matches[0];
        await this.accepted(
          message,
          sent.id,
          sent.threadId,
          sent.internalDate && Number.isFinite(Number(sent.internalDate))
            ? new Date(Number(sent.internalDate))
            : now,
        );
      } else {
        await model.update({
          reconcile_checks: message.reconcile_checks + 1,
          last_reconciled_at: now,
        });
        await Outreach.update(
          {
            status: "needs_review",
            error:
              matches.length > 1
                ? "Multiple Sent messages found; inspect mailbox manually"
                : "uncertain_send",
            next_followup_at: null,
          },
          {
            where: {
              id: message.outreach_id,
              status: {
                [Op.in]: ["ready", "waiting", "sending", "needs_review"],
              },
            },
          },
        );
      }
    }
  }

  private async rateState(
    accountId: string,
    now: Date,
  ): Promise<{ allowed: boolean; retryAt?: Date }> {
    const { SendAttempt, EmailMessage } = this.models;
    const include = [
      {
        model: EmailMessage,
        as: "message",
        attributes: [],
        required: true,
        where: { account_id: accountId },
      },
    ];
    const dayStart = DateTime.fromJSDate(now, { zone: this.cfg.timezone })
      .startOf("day")
      .toUTC()
      .toJSDate();
    const [daily, hourly, last] = await Promise.all([
      SendAttempt.count({
        include,
        where: { attempted_at: { [Op.gte]: dayStart } },
      }),
      SendAttempt.count({
        include,
        where: {
          attempted_at: { [Op.gte]: new Date(now.getTime() - 3600_000) },
        },
      }),
      SendAttempt.findOne({ include, order: [["attempted_at", "DESC"]] }),
    ]);
    if (daily >= this.cfg.dailyLimit || hourly >= this.cfg.hourlyLimit)
      return { allowed: false };
    const retryAt =
      last &&
      new Date(
        last.get().attempted_at.getTime() + this.cfg.minGapSeconds * 1000,
      );
    if (retryAt && retryAt > now) return { allowed: false, retryAt };
    return { allowed: true };
  }

  private async rateAllowed(accountId: string, now: Date): Promise<boolean> {
    return (await this.rateState(accountId, now)).allowed;
  }

  private async process(
    account: Account,
    gmail: GmailPort,
    outreach: Outreach,
    now: Date,
    onAttempt: () => void,
    canSend: () => boolean,
  ): Promise<boolean> {
    const startedAt = Date.now();
    const { Outreach, EmailMessage, SendAttempt, SuppressedRecipient } =
      this.models;
    if (
      outreach.initial_sent_at &&
      outreach.followup_count >= this.cfg.maxFollowups
    ) {
      await Outreach.update(
        { status: "no_response", next_followup_at: null },
        { where: { id: outreach.id, status: "waiting" } },
      );
      return false;
    }
    if (!insideWindow(now, this.cfg)) return false;
    if (
      outreach.initial_sent_at &&
      outreach.next_followup_at &&
      now.getTime() - outreach.next_followup_at.getTime() >
        this.cfg.staleDays * 86_400_000
    ) {
      await this.review(
        outreach.id,
        "Follow-up is stale; review before sending",
      );
      return false;
    }
    if (outreach.thread_id)
      await this.replies.ingest(
        this.db,
        account,
        await gmail.thread(outreach.thread_id),
      );
    const current = await Outreach.findByPk(outreach.id);
    if (!current) return false;
    outreach = current.get({ plain: true });
    if (!["ready", "waiting"].includes(outreach.status)) return false;
    if (await SuppressedRecipient.findByPk(outreach.to_email)) {
      await current.update({ status: "suppressed", next_followup_at: null });
      return false;
    }
    if (!(await this.rateAllowed(account.id, now))) return false;
    const step = outreach.initial_sent_at ? outreach.followup_count + 1 : 0;
    let message = (
      await EmailMessage.findOne({
        where: { outreach_id: outreach.id, direction: "out", step },
      })
    )?.get({ plain: true }) as Message | undefined;
    if (message?.send_state === "accepted") {
      await this.accepted(
        message,
        message.gmail_message_id!,
        outreach.thread_id!,
        message.accepted_at!,
      );
      return false;
    }
    if (
      message &&
      (["uncertain", "sending"].includes(message.send_state) ||
        (message.send_state === "failed" && !message.retry_at))
    )
      return false;
    if (message?.retry_at && message.retry_at > now) return false;
    const earlier = (
      await EmailMessage.findAll({
        where: {
          outreach_id: outreach.id,
          direction: "out",
          send_state: "accepted",
        },
        order: [["step", "ASC"]],
      })
    ).map((row) => row.get({ plain: true }) as Message);
    const last = earlier.at(-1);
    if (
      last?.accepted_at &&
      now.getTime() - last.accepted_at.getTime() < 86_400_000
    )
      return false;
    let trackingUrl: string | undefined;
    try {
      const frozen = await this.db.transaction(async (transaction) => {
        const row = await Outreach.findOne({
          where: {
            id: outreach.id,
            account_id: account.id,
            status: { [Op.in]: ["ready", "waiting"] },
          },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!row) return false;
        const snapshot = row.get({ plain: true });
        if (!message) {
          const rendered = snapshot.template_snapshot[step];
          if (!rendered)
            throw new Error(`No template snapshot for step ${step}`);
          const id = randomUUID();
          message = (
            await EmailMessage.create(
              {
                id,
                outreach_id: snapshot.id,
                account_id: account.id,
                direction: "out",
                step,
                subject: rendered.subject,
                body_text: rendered.text,
                rfc_message_id: `<${id}@${account.email.split("@")[1]}>`,
                send_state: "prepared",
              },
              { transaction },
            )
          ).get({ plain: true }) as Message;
        }
        trackingUrl = await this.tracking.prepare(message.id, transaction);
        await row.update({ status: "sending" }, { transaction });
        return snapshot;
      });
      if (!frozen || !message) return false;
      outreach = frozen;
      const attachments =
        step === 0 ? await this.attachments.load(outreach.attachment_refs) : [];
      const raw = await composeMail({
        from: account.email,
        to: outreach.to_email,
        subject: message.subject,
        text: message.body_text,
        messageId: message.rfc_message_id,
        inReplyTo: last?.rfc_message_id,
        references: earlier.map((row) => row.rfc_message_id),
        attachments,
        trackingUrl,
      });
      if (outreach.thread_id)
        await this.replies.ingest(
          this.db,
          account,
          await gmail.thread(outreach.thread_id),
        );
      const attemptedAt = new Date(now.getTime() + Date.now() - startedAt);
      if (!canSend() || !insideWindow(attemptedAt, this.cfg)) {
        await Outreach.update(
          { status: outreach.initial_sent_at ? "waiting" : "ready" },
          { where: { id: outreach.id, status: "sending" } },
        );
        return false;
      }
      const attemptId = randomUUID();
      const prepared = message;
      const allowed = await this.db.transaction(async (transaction) => {
        const row = await Outreach.findOne({
          where: { id: outreach.id, account_id: account.id, status: "sending" },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (
          !row ||
          (await SuppressedRecipient.findByPk(row.get().to_email, {
            transaction,
          }))
        )
          return false;
        await EmailMessage.update(
          { send_state: "sending", retry_at: null },
          { where: { id: prepared.id }, transaction },
        );
        await SendAttempt.create(
          {
            id: attemptId,
            message_id: prepared.id,
            status: "sending",
            attempted_at: attemptedAt,
          },
          { transaction },
        );
        return true;
      });
      if (!allowed) return false;
      let response: { id: string; threadId: string };
      onAttempt();
      try {
        response = await gmail.send(raw, outreach.thread_id || undefined);
      } catch (error) {
        await this.sendFailed(message, attemptId, error, attemptedAt);
        return false;
      }
      await this.accepted(message, response.id, response.threadId, new Date());
      this.logger.log(
        { event: "gmail_accepted", outreach_id: outreach.id, step },
        "Followups",
      );
      return true;
    } catch (error) {
      const state = message && (await EmailMessage.findByPk(message.id));
      if (state?.get().send_state === "sending") throw error;
      this.logger.error(
        {
          event: "outreach_needs_review",
          outreach_id: outreach.id,
          error: safeError(error),
        },
        undefined,
        "Followups",
      );
      await this.review(outreach.id, safeError(error));
      return false;
    }
  }

  private async sendFailed(
    message: Message,
    attemptId: string,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const { EmailMessage, SendAttempt, Outreach, GmailAccount } = this.models;
    const uncertain = !(error instanceof GmailError) || error.uncertain;
    const count = await SendAttempt.count({
      where: { message_id: message.id },
    });
    const retry =
      !uncertain &&
      error instanceof GmailError &&
      error.retryable &&
      count <= 3;
    this.logger.error(
      {
        event: "gmail_send_failed",
        outreach_id: message.outreach_id,
        step: message.step,
        uncertain,
        retry,
        error: safeError(error),
      },
      undefined,
      "Followups",
    );
    const retryAt = retry
      ? new Date(now.getTime() + [1, 5, 15][count - 1] * 60_000)
      : null;
    await this.db.transaction(async (transaction) => {
      await EmailMessage.update(
        { send_state: uncertain ? "uncertain" : "failed", retry_at: retryAt },
        { where: { id: message.id }, transaction },
      );
      await SendAttempt.update(
        {
          status: uncertain ? "uncertain" : "failed",
          http_status:
            error instanceof GmailError ? (error.httpStatus ?? null) : null,
          error: safeError(error),
          finished_at: new Date(),
        },
        { where: { id: attemptId }, transaction },
      );
      await Outreach.update(
        {
          status: retry
            ? message.step === 0
              ? "ready"
              : "waiting"
            : "needs_review",
          error: uncertain ? "uncertain_send" : safeError(error),
          next_followup_at: retryAt,
        },
        { where: { id: message.outreach_id, status: "sending" }, transaction },
      );
      if (error instanceof GmailError && error.httpStatus === 401)
        await GmailAccount.update(
          { status: "disconnected" },
          { where: { id: message.account_id }, transaction },
        );
    });
  }

  private async accepted(
    message: Message,
    gmailId: string,
    threadId: string,
    acceptedAt: Date,
  ): Promise<void> {
    const { EmailMessage, SendAttempt, Outreach } = this.models;
    const next =
      message.step >= this.cfg.maxFollowups
        ? DateTime.fromJSDate(acceptedAt, { zone: this.cfg.timezone })
            .plus({ days: this.cfg.followupDays })
            .toJSDate()
        : nextFollowup(acceptedAt, this.cfg);
    await this.db.transaction(async (transaction) => {
      await EmailMessage.update(
        {
          send_state: "accepted",
          gmail_message_id: gmailId,
          accepted_at: acceptedAt,
          retry_at: null,
        },
        { where: { id: message.id }, transaction },
      );
      await SendAttempt.update(
        { status: "accepted", finished_at: new Date(), error: null },
        {
          where: {
            message_id: message.id,
            status: { [Op.in]: ["sending", "uncertain"] },
          },
          transaction,
        },
      );
      const row = await Outreach.findByPk(message.outreach_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!row) throw new Error("Outreach record disappeared after send");
      const resume =
        ["ready", "waiting", "sending"].includes(row.get().status) ||
        (row.get().status === "needs_review" &&
          row.get().error === "uncertain_send");
      await row.update(
        {
          thread_id: threadId,
          initial_sent_at:
            message.step === 0
              ? row.get().initial_sent_at || acceptedAt
              : row.get().initial_sent_at,
          followup_count: Math.max(row.get().followup_count, message.step),
          status: resume ? "waiting" : row.get().status,
          next_followup_at: resume ? next : null,
          error:
            row.get().error === "uncertain_send" ||
            row.get().status === "sending"
              ? null
              : row.get().error,
        },
        { transaction },
      );
    });
  }

  private async review(id: string, error: string): Promise<void> {
    await this.models.Outreach.update(
      { status: "needs_review", error, next_followup_at: null },
      { where: { id, status: { [Op.in]: ["ready", "waiting", "sending"] } } },
    );
  }
}
function normaliseBody(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

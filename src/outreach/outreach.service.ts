import { Op } from "sequelize";
import type { Outreach } from "../common/types.js";
import type { DatabaseService } from "../database/database.service.js";
import type { Outreach as OutreachEntity } from "./model/outreach.model.js";
import type { EmailMessage } from "./model/email-message.model.js";
import type { SuppressedRecipient } from "../replies/model/suppressed-recipient.model.js";

export type OutreachSummary = Pick<
  Outreach,
  | "id"
  | "sheet_row_id"
  | "status"
  | "followup_count"
  | "next_followup_at"
  | "error"
>;

export class OutreachService {
  constructor(
    private db: DatabaseService,
    private outreachModel: typeof OutreachEntity,
    private emailMessageModel: typeof EmailMessage,
    private suppressedRecipientModel: typeof SuppressedRecipient,
  ) {}
  async list(): Promise<OutreachSummary[]> {
    const rows = await this.outreachModel.findAll({
      attributes: [
        "id",
        "sheet_row_id",
        "status",
        "followup_count",
        "next_followup_at",
        "error",
      ],
      order: [["created_at", "DESC"]],
      limit: 100,
    });
    return rows.map((row: { get(options: { plain: true }): OutreachSummary }) =>
      row.get({ plain: true }),
    );
  }
  async retry(id: string): Promise<void> {
    const existing = await this.outreachModel.findByPk(id);
    if (!existing) throw new Error("Outreach record not found");
    const done = await this.db.withLock(
      `gmail:${existing.get().account_id}`,
      () =>
        this.db.transaction(async (transaction) => {
          const outreach = await this.outreachModel.findOne({
            where: { id, status: "needs_review" },
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          if (!outreach)
            throw new Error("Only needs_review records can be retried");
          if (
            await this.emailMessageModel.count({
              where: {
                outreach_id: id,
                send_state: { [Op.in]: ["uncertain", "sending"] },
              },
              transaction,
            })
          )
            throw new Error(
              "Uncertain send: inspect Sent mail; automatic/manual retry is blocked to prevent duplicates",
            );
          if (
            await this.suppressedRecipientModel.findByPk(
              outreach.get().to_email,
              { transaction },
            )
          )
            throw new Error("Recipient is suppressed");
          await this.emailMessageModel.update(
            { send_state: "prepared", retry_at: null },
            {
              where: {
                outreach_id: id,
                direction: "out",
                send_state: "failed",
              },
              transaction,
            },
          );
          await outreach.update(
            {
              status: outreach.get().initial_sent_at ? "waiting" : "ready",
              next_followup_at: new Date(),
              error: null,
            },
            { transaction },
          );
          return true;
        }),
    );
    if (!done)
      throw new Error("Account worker is busy; retry this command shortly");
  }
}

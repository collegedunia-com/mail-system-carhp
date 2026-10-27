import { randomBytes } from "node:crypto";
import { Op, col, fn, type Transaction } from "sequelize";
import type { Config } from "../common/config.js";
import type { DatabaseService } from "../database/database.service.js";
import type { EmailTracking } from "./model/email-tracking.model.js";
import type { EmailMessage } from "../outreach/model/email-message.model.js";

export interface OpenStats {
  first_opened_at: Date | null;
  last_opened_at: Date | null;
  open_count: number;
}

export class TrackingService {
  constructor(
    private db: DatabaseService,
    private cfg: Config,
    private emailTrackingModel: typeof EmailTracking,
    private emailMessageModel: typeof EmailMessage,
  ) {}

  async prepare(
    messageId: string,
    transaction: Transaction,
  ): Promise<string | undefined> {
    const existing = await this.emailTrackingModel.findByPk(messageId, {
      transaction,
    });
    if (existing) return existing.get().pixel_url;
    if (!this.cfg.trackingEnabled) return;
    const token = randomBytes(32).toString("hex");
    const pixelUrl = this.cfg.trackingBaseUrl + "/open/" + token + ".gif";
    await this.emailTrackingModel.create(
      { message_id: messageId, token, pixel_url: pixelUrl },
      { transaction },
    );
    return pixelUrl;
  }

  async record(token: string, now = new Date()): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(token)) return;
    await this.db.transaction(async (transaction) => {
      const tracking = await this.emailTrackingModel.findOne({
        where: { token },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!tracking) return;
      const message = await this.emailMessageModel.findByPk(
        tracking.get().message_id,
        { transaction },
      );
      if (
        !message ||
        message.get().direction !== "out" ||
        !["sending", "accepted", "uncertain"].includes(message.get().send_state)
      )
        return;
      const row = tracking.get();
      await tracking.update(
        {
          first_opened_at:
            row.first_opened_at && row.first_opened_at < now
              ? row.first_opened_at
              : now,
          last_opened_at:
            row.last_opened_at && row.last_opened_at > now
              ? row.last_opened_at
              : now,
          open_count: row.open_count + 1,
        },
        { transaction },
      );
    });
  }

  async stats(outreachIds: string[]): Promise<Map<string, OpenStats>> {
    if (!outreachIds.length) return new Map();
    const rows = (await this.emailTrackingModel.findAll({
      attributes: [
        [col("message.outreach_id"), "outreach_id"],
        [fn("MIN", col("first_opened_at")), "first_opened_at"],
        [fn("MAX", col("last_opened_at")), "last_opened_at"],
        [fn("SUM", col("open_count")), "open_count"],
      ],
      include: [
        {
          model: this.emailMessageModel,
          as: "message",
          attributes: [],
          required: true,
          where: { outreach_id: { [Op.in]: outreachIds } },
        },
      ],
      group: ["message.outreach_id"],
      raw: true,
    })) as unknown as Array<OpenStats & { outreach_id: string }>;
    return new Map(
      rows.map((row) => [
        row.outreach_id,
        {
          first_opened_at: row.first_opened_at
            ? new Date(row.first_opened_at)
            : null,
          last_opened_at: row.last_opened_at
            ? new Date(row.last_opened_at)
            : null,
          open_count: Number(row.open_count),
        },
      ]),
    );
  }
}

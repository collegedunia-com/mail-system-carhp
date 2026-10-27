import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import type { Connection, RowDataPacket } from "mysql2";
import { required, type Config } from "../common/config.js";
import { GmailAccount } from "../gmail/model/gmail-account.model.js";
import { Outreach } from "../outreach/model/outreach.model.js";
import { EmailMessage } from "../outreach/model/email-message.model.js";
import { SendAttempt } from "../followups/model/send-attempt.model.js";
import { SuppressedRecipient } from "../replies/model/suppressed-recipient.model.js";
import { EmailTracking } from "../tracking/model/email-tracking.model.js";

export class DatabaseService {
  readonly sequelize: Sequelize;

  constructor(cfg: Config) {
    const database = required(cfg.databaseName, "DB_NAME");
    const username = required(cfg.databaseUser, "DB_USER");
    this.sequelize = new Sequelize({
      database,
      username,
      password: cfg.databasePassword,
      host: cfg.databaseHost,
      port: cfg.databasePort,
      dialect: "mysql",
      logging: false,
      timezone: "+00:00",
      retry: { max: 0 },
      pool: { max: 10, min: 0, idle: 10_000 },
      dialectOptions: cfg.databaseSsl
        ? {
            ssl: {
              rejectUnauthorized: true,
              ...(cfg.databaseSslCa
                ? { ca: readFileSync(cfg.databaseSslCa, "utf8") }
                : {}),
            },
          }
        : {},
      models: [
        GmailAccount,
        Outreach,
        EmailMessage,
        SendAttempt,
        SuppressedRecipient,
        EmailTracking,
      ],
    });
  }

  transaction<T>(fn: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
      fn,
    );
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    timeoutSeconds = 0,
  ): Promise<T | undefined> {
    const manager = this.sequelize.connectionManager;
    const connection = await manager.getConnection({ type: "write" });
    const mysql = (connection as unknown as Connection).promise();
    const name =
      "mailer:" +
      createHash("sha256")
        .update(`${this.sequelize.getDatabaseName()}:${key}`)
        .digest("hex")
        .slice(0, 56);
    let locked = false,
      reusable = true;
    try {
      const [rows] = await mysql.query<RowDataPacket[]>(
        "SELECT GET_LOCK(?, ?) AS acquired",
        [name, timeoutSeconds],
      );
      locked = Number(rows[0].acquired) === 1;
      if (rows[0].acquired === null) throw new Error("MySQL named lock failed");
      if (locked) return await fn();
    } finally {
      if (locked) {
        try {
          const [rows] = await mysql.query<RowDataPacket[]>(
            "SELECT RELEASE_LOCK(?) AS released",
            [name],
          );
          reusable = Number(rows[0].released) === 1;
        } catch {
          reusable = false;
        }
      }
      if (reusable) manager.releaseConnection(connection);
      else await manager.destroyConnection(connection);
    }
  }

  close(): Promise<void> {
    return this.sequelize.close();
  }
}

import { LoggerService } from "../logger/logger.service.js";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DataTypes, Model } from "sequelize";
import type { DatabaseService } from "./database.service.js";

export async function migrate(
  db: DatabaseService,
  logger: LoggerService,
): Promise<void> {
  const done = await db.withLock(
    "migrations",
    async () => {
      const Meta =
        db.sequelize.models.schema_migrations ||
        db.sequelize.define<
          Model<{ name: string; sha256: string; applied_at: Date }>
        >(
          "schema_migrations",
          {
            name: { type: DataTypes.STRING(128), primaryKey: true },
            sha256: { type: DataTypes.STRING(64), allowNull: false },
            applied_at: {
              type: DataTypes.DATE(3),
              allowNull: false,
              defaultValue: DataTypes.NOW,
            },
          },
          {
            tableName: "schema_migrations",
            timestamps: false,
            freezeTableName: true,
          },
        );
      await Meta.sync();
      for (const name of (await readdir(resolve("migrations")))
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        const sql = await readFile(resolve("migrations", name), "utf8");
        const hash = createHash("sha256").update(sql).digest("hex");
        const previous = await Meta.findByPk(name);
        if (previous) {
          if (previous.get("sha256") !== hash)
            throw new Error(`Applied migration changed: ${name}`);
          continue;
        }
        for (const statement of sql
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean))
          await db.sequelize.query(statement);
        await Meta.create({ name, sha256: hash });
        logger.log(`Applied ${name}`, "Migrations");
      }
      return true;
    },
    30,
  );
  if (!done)
    throw new Error(
      "Another process is applying migrations; try again shortly",
    );
}

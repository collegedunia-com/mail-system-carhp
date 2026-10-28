import { LoggerService } from "../logger/logger.service.js";
import { randomUUID } from "node:crypto";
import { Op, UniqueConstraintError } from "sequelize";
import type { DatabaseService } from "../database/database.service.js";
import type { Config } from "../common/config.js";
import { required } from "../common/config.js";
import type { GoogleService } from "../google/google.service.js";
import {
  emailAddress,
  TemplatesService,
} from "../templates/templates.service.js";
import { validateCloudRef } from "../attachments/attachments.service.js";
import type { Outreach as OutreachRow } from "../common/types.js";
import type { Outreach } from "../outreach/model/outreach.model.js";
import type { EmailMessage } from "../outreach/model/email-message.model.js";
import type { GmailAccount } from "../gmail/model/gmail-account.model.js";
import type { SuppressedRecipient } from "../replies/model/suppressed-recipient.model.js";
import { TrackingService } from "../tracking/tracking.service.js";
import { unquoted } from "../replies/replies.service.js";

export const INPUT_HEADERS = [
  "id",
  "ready",
  "to",
  "from",
  "template_key",
  "attachment_refs",
  "contact_name",
  "brand",
  "product_lines",
  "publisher",
  "sender_name",
];
export const TEMPLATE_DATA_HEADERS = [
  "publisher_description",
  "audience_stat",
  "agency_name",
  "vertical_list",
];
export const OUTPUT_HEADERS = [
  "status",
  "sent_at",
  "followup_count",
  "next_followup_at",
  "replied_at",
  "error",
  "first_opened_at",
  "last_opened_at",
  "open_count",
  "reply_text",
];
const RESERVED = new Set([
  ...INPUT_HEADERS.slice(0, 6),
  ...OUTPUT_HEADERS,
  "merge_data",
]);
export const isReady = (value: string) => /^(true|yes|1)$/i.test(value.trim());

export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

export function parseRow(row: Record<string, string>, cfg: Config) {
  if (!row.id?.trim() || row.id.length > 128)
    throw new Error("Set a permanent id (up to 128 characters)");
  const to = emailAddress(row.to || "");
  const from = emailAddress(row.from || "");
  const attachments: unknown = JSON.parse(row.attachment_refs || "[]");
  if (
    !Array.isArray(attachments) ||
    attachments.length > 5 ||
    attachments.some((ref) => typeof ref !== "string")
  )
    throw new Error(
      "attachment_refs must be a JSON array of up to 5 cloud references",
    );
  for (const ref of attachments as string[])
    validateCloudRef(ref, cfg.attachmentHosts);
  const data: unknown = row.merge_data ? JSON.parse(row.merge_data) : {};
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("merge_data must be a JSON object");
  const mergeData: Record<string, unknown> = { ...data };
  for (const [key, value] of Object.entries(row))
    if (!RESERVED.has(key)) mergeData[key] = value;
  mergeData.sender_email = from;
  mergeData.recipient_email = to;
  mergeData.has_attachments = attachments.length > 0;
  const templateKey = row.template_key?.trim();
  if (!templateKey)
    throw new Error("Set a template_key from the Template Library tab");
  return {
    rowId: row.id.trim(),
    to,
    from,
    templateKey,
    attachments: attachments as string[],
    mergeData,
  };
}

export interface SheetGrid {
  headers: string[];
  rows: Array<Record<string, string>>;
}
export interface SheetPort {
  read(): Promise<SheetGrid>;
  write(
    updates: Map<string, Record<string, string>>,
    extraHeaders?: string[],
  ): Promise<void>;
}

export class GoogleSheet implements SheetPort {
  private base: string;
  private tab: string;
  constructor(
    private cfg: Config,
    private google: GoogleService,
  ) {
    this.base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      required(cfg.spreadsheetId, "SPREADSHEET_ID"),
    )}`;
    this.tab = `'${cfg.sheetName.replace(/'/g, "''")}'`;
  }
  private async cells(): Promise<string[][]> {
    const result = await this.google.json<{ values?: unknown[][] }>(
      `${this.base}/values/${encodeURIComponent(`${this.tab}!A:ZZ`)}`,
    );
    return (result.values || []).map((row) =>
      row.map((value) => String(value ?? "")),
    );
  }
  async init(): Promise<void> {
    if ((await this.cells()).some((row) => row.some(Boolean)))
      throw new Error(
        "Sheet is not empty; initialise a new empty tab or add headers manually",
      );
    await this.google.json(
      `${this.base}/values/${encodeURIComponent(
        `${this.tab}!A1`,
      )}?valueInputOption=RAW`,
      "PUT",
      { values: [[...INPUT_HEADERS, ...OUTPUT_HEADERS, ...TEMPLATE_DATA_HEADERS]] },
    );
  }
  async read(): Promise<SheetGrid> {
    const [first = [], ...rows] = await this.cells();
    const headers = first.map((value) => value.trim());
    if (!headers.length)
      throw new Error("Sheet is empty; run npm run sheets:init first");
    if (
      new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length
    )
      throw new Error("Duplicate sheet column headers");
    for (const header of ["id", "ready", "to", "from", "template_key"])
      if (!headers.includes(header))
        throw new Error(`Missing sheet column: ${header}`);
    return {
      headers,
      rows: rows
        .filter((row) => row.some(Boolean))
        .map((row) =>
          Object.fromEntries(
            headers
              .filter(Boolean)
              .map((header) => [header, row[headers.indexOf(header)] || ""]),
          ),
        ),
    };
  }
  async write(
    updates: Map<string, Record<string, string>>,
    extraHeaders = OUTPUT_HEADERS,
  ): Promise<void> {
    const [first = [], ...rows] = await this.cells();
    const headers = first.map((value) => value.trim());
    if (!headers.includes("id")) throw new Error("Missing sheet id column");
    const missing = extraHeaders.filter((header) => !headers.includes(header));
    const data: Array<{ range: string; values: string[][] }> = [];
    if (missing.length) {
      data.push({
        range: `${this.tab}!${columnName(headers.length)}1`,
        values: [missing],
      });
      headers.push(...missing);
    }
    const idColumn = headers.indexOf("id");
    const counts = new Map<string, number>();
    for (const row of rows) {
      const id = (row[idColumn] || "").trim();
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    rows.forEach((row, index) => {
      const id = (row[idColumn] || "").trim();
      if (counts.get(id) !== 1) return;
      const update = updates.get(id);
      if (!update) return;
      for (const [key, value] of Object.entries(update)) {
        const column = headers.indexOf(key);
        if (column >= 0)
          data.push({
            range: `${this.tab}!${columnName(column)}${index + 2}`,
            values: [[value]],
          });
      }
    });
    for (let offset = 0; offset < data.length; offset += 500) {
      await this.google.json(`${this.base}/values:batchUpdate`, "POST", {
        valueInputOption: "RAW",
        data: data.slice(offset, offset + 500),
      });
    }
  }
}

export type SheetModels = {
  Outreach: typeof Outreach;
  EmailMessage: typeof EmailMessage;
  GmailAccount: typeof GmailAccount;
  SuppressedRecipient: typeof SuppressedRecipient;
};

export class SheetSync {
  constructor(
    private db: DatabaseService,
    private cfg: Config,
    private sheet: SheetPort,
    private templates: TemplatesService,
    private models: SheetModels,
    private tracking: TrackingService,
    private logger: LoggerService,
  ) {}

  async run(): Promise<{ imported: number; invalid: number }> {
    const { Outreach, EmailMessage, GmailAccount, SuppressedRecipient } =
      this.models;
    const grid = await this.sheet.read();
    const ids = new Map<string, number>();
    for (const row of grid.rows)
      if (row.id?.trim())
        ids.set(row.id.trim(), (ids.get(row.id.trim()) || 0) + 1);
    const updates = new Map<string, Record<string, string>>();
    let imported = 0,
      invalid = 0;
    const scope = {
      spreadsheet_id: this.cfg.spreadsheetId,
      sheet_name: this.cfg.sheetName,
    };
    const readyIds = grid.rows
      .filter(
        (row) =>
          row.id?.trim() &&
          ids.get(row.id.trim()) === 1 &&
          isReady(row.ready || ""),
      )
      .map((row) => row.id.trim());
    if (readyIds.length) await this.templates.refresh();
    await Outreach.update(
      { status: "paused" },
      {
        where: {
          ...scope,
          status: { [Op.in]: ["ready", "waiting", "sending"] },
          ...(readyIds.length
            ? { sheet_row_id: { [Op.notIn]: readyIds } }
            : {}),
        },
      },
    );
    for (const row of grid.rows) {
      const rowId = row.id?.trim();
      if (!rowId || ids.get(rowId) !== 1) {
        invalid++;
        continue;
      }
      const identity = { ...scope, sheet_row_id: rowId };
      let existing = await Outreach.findOne({ where: identity });
      if (!isReady(row.ready || "")) continue;
      if (existing?.get().status === "paused") {
        const id = existing.get().id;
        await this.db.transaction(async (transaction) => {
          const locked = await Outreach.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          if (!locked || locked.get().status !== "paused") return;
          const uncertain = await EmailMessage.count({
            where: {
              outreach_id: id,
              send_state: { [Op.in]: ["sending", "uncertain"] },
            },
            transaction,
          });
          if (!uncertain)
            await locked.update(
              { status: locked.get().initial_sent_at ? "waiting" : "ready" },
              { transaction },
            );
        });
        existing = await Outreach.findByPk(id);
      }
      if (
        existing?.get().initial_sent_at ||
        (existing &&
          !["draft", "ready", "paused"].includes(existing.get().status))
      )
        continue;
      try {
        const parsed = parseRow(row, this.cfg);
        const account = await GmailAccount.findOne({
          where: { email: parsed.from, status: "connected" },
        });
        if (!account)
          throw new Error(
            "The from account is not connected; run gmail:connect",
          );
        if (await SuppressedRecipient.findByPk(parsed.to))
          throw new Error("Recipient is suppressed");
        const snapshot = await this.templates.render(
          parsed.templateKey,
          parsed.mergeData,
        );
        const changed = await this.db.transaction(async (transaction) => {
          const current = await Outreach.findOne({
            where: identity,
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          const input = {
            ...identity,
            account_id: account.get().id,
            to_email: parsed.to,
            template_key: parsed.templateKey,
            merge_data: parsed.mergeData,
            template_snapshot: snapshot,
            attachment_refs: parsed.attachments,
            status: "ready",
            error: null,
          };
          if (current) {
            if (
              current.get().initial_sent_at ||
              !["draft", "ready", "paused"].includes(current.get().status)
            )
              return false;
            if (
              await EmailMessage.count({
                where: { outreach_id: current.get().id, direction: "out" },
                transaction,
              })
            )
              return false;
            await current.update(input, { transaction });
          } else
            await Outreach.create(
              { id: randomUUID(), ...input },
              { transaction },
            );
          return true;
        });
        if (changed) imported++;
      } catch (error) {
        if (error instanceof UniqueConstraintError) continue; // A concurrent sync already imported this permanent ID.
        invalid++;
        const message = error instanceof Error ? error.message : "Invalid row";
        this.logger.warn(
          { event: "sheet_row_invalid", row_id: rowId, error: message },
          "Sheets",
        );
        updates.set(rowId, { status: "invalid", error: message });
        if (existing)
          await Outreach.update(
            { status: "needs_review", error: message },
            {
              where: {
                id: existing.get().id,
                initial_sent_at: null,
                status: { [Op.in]: ["draft", "ready", "paused"] },
              },
            },
          );
      }
    }
    const records = await Outreach.findAll({ where: scope });
    const outreachIds = records.map((row) => row.get().id);
    const [opens, replies] = await Promise.all([
      this.tracking.stats(outreachIds),
      outreachIds.length
        ? EmailMessage.findAll({
            attributes: ["outreach_id", "body_text"],
            where: {
              outreach_id: { [Op.in]: outreachIds },
              direction: "in",
              classification: { [Op.in]: ["human", "unsubscribe"] },
            },
            order: [
              ["created_at", "DESC"],
              ["id", "DESC"],
            ],
          })
        : Promise.resolve([]),
    ]);
    const replyTexts = new Map<string, string>();
    for (const model of replies) {
      const reply = model.get({ plain: true });
      if (!reply.outreach_id || replyTexts.has(reply.outreach_id)) continue;
      const text = unquoted(reply.body_text);
      // Keep the complete message in SQL; bound the text written to one sheet cell.
      const display =
        text.length > 45_000
          ? text.slice(0, 44_000).replace(/[\uD800-\uDBFF]$/, "") +
            "\n[Reply shortened for the sheet; full text is stored in the database.]"
          : text;
      replyTexts.set(reply.outreach_id, display);
    }
    for (const model of records) {
      const row = model.get({ plain: true });
      const tracking = opens.get(row.id);
      if (updates.has(row.sheet_row_id)) continue;
      updates.set(row.sheet_row_id, {
        status: row.status,
        sent_at: row.initial_sent_at?.toISOString() || "",
        followup_count: String(row.followup_count),
        next_followup_at: row.next_followup_at?.toISOString() || "",
        replied_at: row.last_reply_at?.toISOString() || "",
        error: row.error || "",
        first_opened_at: tracking?.first_opened_at?.toISOString() || "",
        last_opened_at: tracking?.last_opened_at?.toISOString() || "",
        open_count: String(tracking?.open_count || 0),
        reply_text: replyTexts.get(row.id) || "",
      });
    }
    await this.sheet.write(updates);
    this.logger.log({ event: "sheet_synced", imported, invalid }, "Sheets");
    return { imported, invalid };
  }
}

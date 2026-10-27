import { DataType } from "sequelize-typescript";
import {
  BelongsTo,
  Column,
  CreatedAt,
  Index,
  ForeignKey,
  HasMany,
  Model,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { GmailAccount } from "../../gmail/model/gmail-account.model.js";
import { EmailMessage } from "./email-message.model.js";

@Table({
  tableName: "outreach",
  underscored: true,
  timestamps: true,
})
export class Outreach extends Model {
  @Column({
    type: DataType.UUID,
    primaryKey: true,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @Index({ name: "outreach_sheet_row", unique: true })
  @Column({ type: DataType.STRING(128), allowNull: false })
  declare spreadsheet_id: string;

  @Index("outreach_sheet_row")
  @Column({ type: DataType.STRING(100), allowNull: false })
  declare sheet_name: string;

  @Index("outreach_sheet_row")
  @Column({ type: DataType.STRING(128), allowNull: false })
  declare sheet_row_id: string;

  @Index({ name: "outreach_thread", unique: true })
  @Index("outreach_due")
  @ForeignKey(() => GmailAccount)
  @Column({ type: DataType.UUID, allowNull: false })
  declare account_id: string;

  @BelongsTo(() => GmailAccount, { foreignKey: "account_id", as: "account" })
  declare account: GmailAccount | null;

  @Column({
    type: DataType.STRING(320),
    allowNull: false,
    validate: { isEmail: true, isLowercase: true },
  })
  declare to_email: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare template_key: string;

  @Column({ type: DataType.JSON, allowNull: false, defaultValue: {} })
  declare merge_data: Record<string, unknown>;

  @Column({ type: DataType.JSON, allowNull: false })
  declare template_snapshot: Array<{ subject: string; text: string }>;

  @Column({ type: DataType.JSON, allowNull: false, defaultValue: [] })
  declare attachment_refs: string[];

  @Index("outreach_due")
  @Column({
    type: DataType.ENUM(
      "draft",
      "ready",
      "sending",
      "waiting",
      "paused",
      "replied",
      "bounced",
      "suppressed",
      "no_response",
      "needs_review",
    ),
    allowNull: false,
  })
  declare status:
    | "draft"
    | "ready"
    | "sending"
    | "waiting"
    | "paused"
    | "replied"
    | "bounced"
    | "suppressed"
    | "no_response"
    | "needs_review";

  @Index("outreach_thread")
  @Column({ type: DataType.STRING(128), allowNull: true, defaultValue: null })
  declare thread_id: string | null;

  @Column({ type: DataType.DATE(3), allowNull: true, defaultValue: null })
  declare initial_sent_at: Date | null;

  @Column({ type: DataType.DATE(3), allowNull: true, defaultValue: null })
  declare last_reply_at: Date | null;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0, max: 3 },
  })
  declare followup_count: number;

  @Index("outreach_due")
  @Column({ type: DataType.DATE(3), allowNull: true, defaultValue: null })
  declare next_followup_at: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true, defaultValue: null })
  declare error: string | null;

  @HasMany(() => EmailMessage, { foreignKey: "outreach_id", as: "messages" })
  declare messages: EmailMessage[];

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare created_at: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare updated_at: Date;
}

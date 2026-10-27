import { DataType, Model } from "sequelize-typescript";
import {
  BeforeValidate,
  BelongsTo,
  Column,
  CreatedAt,
  Index,
  ForeignKey,
  HasOne,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { GmailAccount } from "../../gmail/model/gmail-account.model.js";
import { EmailTracking } from "../../tracking/model/email-tracking.model.js";
import { Outreach } from "./outreach.model.js";

@Table({
  tableName: "email_messages",
  underscored: true,
  timestamps: true,
})
export class EmailMessage extends Model {
  @Column({
    type: DataType.UUID,
    primaryKey: true,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @Index({ name: "one_outbound_step", unique: true })
  @ForeignKey(() => Outreach)
  @Column({ type: DataType.UUID, allowNull: true, defaultValue: null })
  declare outreach_id: string | null;

  @BelongsTo(() => Outreach, { foreignKey: "outreach_id", as: "outreach" })
  declare outreach: Outreach | null;

  @Index({ name: "gmail_message_identity", unique: true })
  @Index("email_account_time")
  @ForeignKey(() => GmailAccount)
  @Column({ type: DataType.UUID, allowNull: false })
  declare account_id: string;

  @BelongsTo(() => GmailAccount, { foreignKey: "account_id", as: "account" })
  declare account: GmailAccount | null;

  @Column({ type: DataType.ENUM("out", "in"), allowNull: false })
  declare direction: "out" | "in";

  @Index("one_outbound_step")
  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: true,
    defaultValue: null,
    validate: { min: 0, max: 3 },
  })
  declare step: number | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare subject: string;

  @Column({ type: DataType.TEXT("long"), allowNull: false })
  declare body_text: string;

  @Index("gmail_message_identity")
  @Column({ type: DataType.STRING(128), allowNull: true, defaultValue: null })
  declare gmail_message_id: string | null;

  @Column({ type: DataType.STRING(512), allowNull: true, defaultValue: null })
  declare rfc_message_id: string | null;

  @Column({
    type: DataType.ENUM(
      "prepared",
      "sending",
      "accepted",
      "failed",
      "uncertain",
      "received",
    ),
    allowNull: false,
  })
  declare send_state:
    "prepared" | "sending" | "accepted" | "failed" | "uncertain" | "received";

  @Column({ type: DataType.STRING(32), allowNull: true, defaultValue: null })
  declare classification: string | null;

  @Index("email_account_time")
  @Column({ type: DataType.DATE(3), allowNull: true, defaultValue: null })
  declare accepted_at: Date | null;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
  })
  declare reconcile_checks: number;

  @Column({ type: DataType.DATE(3), allowNull: true, defaultValue: null })
  declare last_reconciled_at: Date | null;

  @Column({ type: DataType.DATE(3), allowNull: true, defaultValue: null })
  declare retry_at: Date | null;

  @HasOne(() => EmailTracking, {
    foreignKey: "message_id",
    as: "tracking",
    onDelete: "CASCADE",
  })
  declare tracking: EmailTracking | null;

  @BeforeValidate
  static directionMatchesStep(message: EmailMessage): void {
    if (
      (message.direction === "out" && message.step === null) ||
      (message.direction === "in" && message.step !== null)
    ) {
      throw new Error(
        "Outgoing messages need a step; incoming messages must have a null step",
      );
    }
  }

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare created_at: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare updated_at: Date;
}

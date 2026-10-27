import { DataType } from "sequelize-typescript";
import {
  BelongsTo,
  Column,
  CreatedAt,
  Index,
  ForeignKey,
  Model,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { EmailMessage } from "../../outreach/model/email-message.model.js";

@Table({
  tableName: "send_attempts",
  underscored: true,
  timestamps: true,
})
export class SendAttempt extends Model {
  @Column({
    type: DataType.UUID,
    primaryKey: true,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @ForeignKey(() => EmailMessage)
  @Column({ type: DataType.UUID, allowNull: false })
  declare message_id: string;

  @BelongsTo(() => EmailMessage, { foreignKey: "message_id", as: "message" })
  declare message: EmailMessage | null;

  @Column({
    type: DataType.ENUM("sending", "accepted", "failed", "uncertain"),
    allowNull: false,
  })
  declare status: "sending" | "accepted" | "failed" | "uncertain";

  @Column({ type: DataType.INTEGER, allowNull: true, defaultValue: null })
  declare http_status: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, defaultValue: null })
  declare error: string | null;

  @Index("attempt_time")
  @Column({
    type: DataType.DATE(3),
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare attempted_at: Date;

  @Column({ type: DataType.DATE(3), allowNull: true, defaultValue: null })
  declare finished_at: Date | null;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare created_at: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare updated_at: Date;
}

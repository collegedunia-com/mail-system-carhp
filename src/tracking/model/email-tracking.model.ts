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
  tableName: "email_tracking",
  underscored: true,
  timestamps: true,
})
export class EmailTracking extends Model {
  @ForeignKey(() => EmailMessage)
  @Column({ type: DataType.UUID, primaryKey: true, allowNull: false })
  declare message_id: string;

  @BelongsTo(() => EmailMessage, { foreignKey: "message_id", as: "message" })
  declare message: EmailMessage | null;

  @Index({ name: "email_tracking_token", unique: true })
  @Column({ type: DataType.CHAR(64), allowNull: false })
  declare token: string;

  @Column({ type: DataType.STRING(2048), allowNull: false })
  declare pixel_url: string;

  @Column({ type: DataType.DATE(3), allowNull: true, defaultValue: null })
  declare first_opened_at: Date | null;

  @Column({ type: DataType.DATE(3), allowNull: true, defaultValue: null })
  declare last_opened_at: Date | null;

  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
  })
  declare open_count: number;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare created_at: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare updated_at: Date;
}

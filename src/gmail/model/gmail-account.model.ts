import { DataType } from "sequelize-typescript";
import { Outreach } from "../../outreach/model/outreach.model.js";
import {
  Column,
  CreatedAt,
  HasMany,
  Model,
  Table,
  UpdatedAt,
} from "sequelize-typescript";

@Table({
  tableName: "gmail_accounts",
  underscored: true,
  timestamps: true,
})
export class GmailAccount extends Model {
  @Column({
    type: DataType.UUID,
    primaryKey: true,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @Column({
    type: DataType.STRING(320),
    allowNull: false,
    unique: "gmail_account_email",
    validate: { isEmail: true, isLowercase: true },
  })
  declare email: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare encrypted_tokens: string;

  @Column({
    type: DataType.ENUM("connected", "disconnected", "paused"),
    allowNull: false,
    defaultValue: "connected",
  })
  declare status: "connected" | "disconnected" | "paused";

  @Column({ type: DataType.STRING(128), allowNull: true, defaultValue: null })
  declare history_id: string | null;

  @HasMany(() => Outreach, { foreignKey: "account_id", as: "outreach" })
  declare outreach: Outreach[];

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare created_at: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare updated_at: Date;
}

import { DataType } from "sequelize-typescript";
import {
  Column,
  CreatedAt,
  Model,
  Table,
  UpdatedAt,
} from "sequelize-typescript";

@Table({
  tableName: "suppressed_recipients",
  underscored: true,
  timestamps: true,
})
export class SuppressedRecipient extends Model {
  @Column({
    type: DataType.STRING(320),
    primaryKey: true,
    allowNull: false,
    validate: { isEmail: true, isLowercase: true },
  })
  declare email: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare reason: string;

  @CreatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare created_at: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE(3), allowNull: false })
  declare updated_at: Date;
}

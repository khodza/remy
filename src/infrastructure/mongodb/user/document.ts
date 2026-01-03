import { Types, HydratedDocument } from 'mongoose';

export type UserDocument = {
  _id: Types.ObjectId;
  telegram_user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  timezone: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserHydratedDocument = HydratedDocument<UserDocument>;

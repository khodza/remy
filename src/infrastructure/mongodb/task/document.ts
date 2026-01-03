import { Types, HydratedDocument } from 'mongoose';

export type TaskDocument = {
  _id: Types.ObjectId;
  user_id: string;
  telegram_chat_id: number;
  description: string;
  scheduled_at: Date;
  status: string;
  last_sent_at?: Date;
  created_at: Date;
  updated_at: Date;
};

export type TaskHydratedDocument = HydratedDocument<TaskDocument>;

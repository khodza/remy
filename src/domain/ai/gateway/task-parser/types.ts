export type TaskParserInput = {
  text: string;
  userTimezone?: string;
};

export type TaskParserOutput = {
  description: string;
  scheduledAt: Date;
};

export type TimeOfDay = string; // "HH:mm", 24-hour

export type UserSettings = {
  hour12: boolean;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
  defaultView: 'timeline' | 'list';
  morningBrief: { enabled: boolean; time: TimeOfDay };
  eveningReview: { enabled: boolean; time: TimeOfDay };
  quietHours: {
    enabled: boolean;
    from: TimeOfDay;
    to: TimeOfDay;
    allowHighPriority: boolean;
  };
  /** Re-ping an ignored reminder after each of these delays (minutes). */
  escalation: { enabled: boolean; stepsMinutes: number[] };
  /** Weekly summary at the evening-review time on the last day of the week. */
  weeklyWrap: { enabled: boolean };
  /** The morning brief is also sent as a spoken (TTS) voice message. */
  voiceBrief: boolean;
  /** Keep a live "Today" agenda message pinned in the chat. */
  pinnedAgenda: boolean;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  hour12: false,
  weekStartsOn: 1,
  defaultView: 'timeline',
  morningBrief: { enabled: true, time: '08:00' },
  eveningReview: { enabled: true, time: '21:00' },
  quietHours: {
    enabled: true,
    from: '23:00',
    to: '07:00',
    allowHighPriority: true,
  },
  escalation: { enabled: true, stepsMinutes: [30, 120] },
  weeklyWrap: { enabled: true },
  voiceBrief: false,
  pinnedAgenda: false,
};

/** Deep-partial of UserSettings, one level of nesting. */
export type UserSettingsPatch = {
  [K in keyof UserSettings]?: UserSettings[K] extends object
    ? UserSettings[K] extends unknown[]
      ? UserSettings[K]
      : Partial<UserSettings[K]>
    : UserSettings[K];
};

export type Category = {
  id: string;
  name: string;
  emoji: string;
  /** #RRGGBB */
  color: string;
  /** Words that make Remy suggest this category. */
  keywords: string[];
};

export const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  {
    name: 'Work',
    emoji: '💼',
    color: '#5B5BD6',
    keywords: [
      'work',
      'office',
      'meeting',
      'standup',
      'report',
      'boss',
      'deadline',
    ],
  },
  {
    name: 'Home',
    emoji: '🏠',
    color: '#12B76A',
    keywords: ['home', 'rent', 'bill', 'electricity', 'clean', 'repair'],
  },
  {
    name: 'Health',
    emoji: '🩺',
    color: '#F04438',
    keywords: ['doctor', 'dentist', 'clinic', 'meds', 'vitamins', 'gym', 'run'],
  },
  {
    name: 'Errand',
    emoji: '🛒',
    color: '#F79009',
    keywords: ['buy', 'pick up', 'shop', 'groceries', 'laundry', 'post'],
  },
  {
    name: 'Personal',
    emoji: '🙂',
    color: '#0E9F9E',
    keywords: ['mom', 'dad', 'family', 'friend', 'birthday', 'call'],
  },
];

export type User = {
  id: string;
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  timezone: string | null;
  settings: UserSettings;
  /**
   * Null until the user first opens Categories; the defaults are created
   * then. An empty array means the user deleted them all on purpose.
   */
  categories: Category[] | null;
  /**
   * Secret in the private calendar feed URL; null when the feed is off.
   * Anyone with the link can read the feed, so it can be replaced.
   */
  calendarToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateUserParams = {
  telegramUserId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  timezone?: string;
};

export type UpdateUserParams = {
  id: string;
  /** null = unset (back to OWNER_TIMEZONE / UTC). */
  timezone?: string | null;
  /** null = back to the defaults. */
  settings?: UserSettings | null;
  /** null = never set up (the defaults are created on next use). */
  categories?: Category[] | null;
  calendarToken?: string | null;
};

// Setpoint's settings, typed, each with its default (DESIGN.md › Settings; BRIEF.md › Settings).
// API fields are snake_case, as everywhere in the API. The server keeps one row per section and fills anything missing from these defaults, so a new
// setting needs no migration. Secrets (AI keys, the Places key, ntfy's token) aren't settings: they
// are write-only (see SECRET_NAMES). Appearance is per browser, so it isn't here either.
import {z} from 'zod';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A 24-hour time such as 09:00');

/** How long a verification code's row stays in the Inbox after the email arrives (Settings › Mail). */
export const CODE_EXPIRY_PRESETS = [5, 10, 15, 30, 60] as const;

/** Home, for Time to Leave's routes (Settings › Calendar). */
export const homeSchema = z.strictObject({
  label: z.string().min(1).max(80),
  address: z.string().min(1).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Home = z.infer<typeof homeSchema>;

export const settingsSchema = z.strictObject({
  mail: z.strictObject({
    code_expiry_minutes: z.number().int().refine(value => (CODE_EXPIRY_PRESETS as readonly number[]).includes(value), 'One of 5, 10, 15, 30 or 60 minutes'),
  }),
  reminders: z.strictObject({
    // Events: minutes before the start; tasks: a time on the due day. Null is None (D49).
    event_minutes_before: z.number().int().min(0).max(7 * 24 * 60).nullable(),
    task_time: clock.nullable(),
  }),
  time_to_leave: z.strictObject({
    enabled: z.boolean(),
    buffer_minutes: z.number().int().min(0).max(120),
  }),
  notifications: z.strictObject({
    // The user's self-hosted ntfy; null until it's set up. Its token, if any, is the `ntfy_token` secret.
    ntfy_server: z.url({protocol: /^https?$/}).nullable(),
    topics: z.strictObject({
      reminders: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      mail: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    }),
    // F7: the setpoint-reminders topic's switch (board 18b): reminders, Time to Leave and reconnect alerts.
    reminders: z.boolean(),
    // Attention mail stays quiet until attention precision is trusted (BRIEF.md › ntfy).
    attention_mail: z.boolean(),
    // One notification per source that needs reconnecting.
    reconnect_alerts: z.boolean(),
  }),
  calendar: z.strictObject({
    weather: z.boolean(),
    home: homeSchema.nullable(),
  }),
  todoist: z.strictObject({
    // A project's name, where a task with none goes; null is Todoist's Inbox.
    default_project: z.string().min(1).nullable(),
  }),
  ai: z.strictObject({
    // Model ids, chosen in Settings › AI (B3); null uses the built-in choice.
    triage_model: z.string().min(1).nullable(),
    triage_strong_model: z.string().min(1).nullable(),
    alfred_model: z.string().min(1).nullable(),
    // The one-time read of backfilled history (D20, D26).
    history_model: z.string().min(1).nullable(),
  }),
  // N3: News's monthly cap in US dollars (D90; shown in Settings › AI's News group): past it, story
  // summaries use Claude Haiku 5.5 for the rest of the month.
  news: z.strictObject({
    monthly_cap_usd: z.number().min(0).max(1000),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsSection = keyof Settings;
export const SETTINGS_SECTIONS = Object.keys(settingsSchema.shape) as SettingsSection[];

export const DEFAULT_SETTINGS: Settings = {
  mail: {code_expiry_minutes: 15},
  reminders: {event_minutes_before: null, task_time: null},
  time_to_leave: {enabled: true, buffer_minutes: 5},
  notifications: {
    ntfy_server: null,
    topics: {reminders: 'setpoint-reminders', mail: 'setpoint-mail'},
    reminders: true,
    attention_mail: false,
    reconnect_alerts: true,
  },
  calendar: {weather: true, home: null},
  todoist: {default_project: null},
  ai: {triage_model: null, triage_strong_model: null, alfred_model: null, history_model: null},
  news: {monthly_cap_usd: 40},
};

/** PATCH /api/settings: any sections, each with any of its fields. */
const shape = settingsSchema.shape;
export const settingsPatchInput = z.strictObject({
  mail: shape.mail.partial().optional(),
  reminders: shape.reminders.partial().optional(),
  time_to_leave: shape.time_to_leave.partial().optional(),
  notifications: shape.notifications.partial().optional(),
  calendar: shape.calendar.partial().optional(),
  todoist: shape.todoist.partial().optional(),
  ai: shape.ai.partial().optional(),
  news: shape.news.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchInput>;

// Setpoint's fixed sets: the contract shared by the server, its database schema and the web app.
// Change them deliberately. Words follow DESIGN.md › Vocabulary.

/** How urgent triage thinks an email is. A message with no lane yet is Unsorted. */
export const LANES = ['attention', 'fyi', 'noise'] as const;
export type Lane = (typeof LANES)[number];

/** What an email is. It groups FYI. Career and People, not Work and Personal. */
export const KINDS = ['deliveries', 'money', 'career', 'security', 'updates', 'people', 'other'] as const;
export type Kind = (typeof KINDS)[number];

/**
 * An email's type, extracted at triage and used by search chips. "Deadline or reminder" is two
 * values here, so a search can ask for either.
 */
export const MESSAGE_TYPES = [
  'confirmation', 'rejection', 'receipt', 'shipping', 'deadline', 'reminder',
  'verification_code', 'alert', 'newsletter', 'statement',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** The Inbox's group order, with `pinned` and `unsorted` only when they have mail. */
export const INBOX_GROUPS = ['pinned', 'attention', 'unsorted', 'security', 'deliveries', 'money', 'career', 'people', 'updates', 'other', 'noise'] as const;
export type InboxGroup = (typeof INBOX_GROUPS)[number];

export const ACCOUNT_PROVIDERS = ['gmail', 'icloud'] as const;
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];

/** Where calendar items come from: each Google calendar, and Todoist as one more. */
export const CALENDAR_PROVIDERS = ['google', 'todoist'] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

/** Anything on the calendar is an item: an event or a Todoist task. */
export const ITEM_KINDS = ['event', 'task'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/**
 * An event's free/busy, as Google names it (its `transparency`): `transparent` is free time, which
 * the editor's conflict preview leaves out, and `opaque` busy, Google's default.
 */
export const TRANSPARENCIES = ['opaque', 'transparent'] as const;
export type Transparency = (typeof TRANSPARENCIES)[number];

/**
 * What an .ics import leaves out of a file, each counted in the review: a
 * cancelled event, a to-do or other non-event, an event with no start, an alarm after the start, at
 * a fixed time or past Google's 5 reminders and 4 weeks, an event's categories, a second copy of an
 * event, and a changed occurrence whose repeating event isn't in the file.
 */
export const ICS_DROP_REASONS = [
  'cancelled', 'not_an_event', 'no_start', 'alarm_after_start', 'alarm_at_fixed_time', 'alarm_over_limit', 'categories', 'duplicate', 'occurrence_without_series',
] as const;
export type IcsDropReason = (typeof ICS_DROP_REASONS)[number];

/** A day's forecast, drawn as sunny, partly_cloudy_day, cloud and rainy. */
export const WEATHER_CONDITIONS = ['sun', 'partly_cloudy', 'cloud', 'rain'] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

/** The 11 swatches. Accounts and calendars pick one (DESIGN.md › Colour). */
export const COLOURS = ['ink2', 'ink3', 'cool', 'warm', 'caution', 'comf', 'good', 'sun', 'alert', 'violet', 'cyan'] as const;
export type Colour = (typeof COLOURS)[number];

/**
 * The swatches Settings offers an account or a calendar (DESIGN.md › Colour): every one but
 * `caution` and `alert`, whose jobs are "needs you" and "danger and now". One picked before still
 * shows, so COLOURS keeps them.
 */
export const SWATCH_COLOURS = ['ink2', 'ink3', 'cool', 'warm', 'comf', 'good', 'sun', 'violet', 'cyan'] as const satisfies readonly Colour[];

/**
 * The swatches an event can take for its own colour (the floating detail's Colour): the ones
 * Google Calendar's eleven event colours fall on (server/src/domain/colours.ts maps them both ways).
 */
export const EVENT_COLOURS = ['ink2', 'cool', 'warm', 'comf', 'good', 'sun', 'alert', 'violet', 'cyan'] as const satisfies readonly Colour[];
export type EventColour = (typeof EVENT_COLOURS)[number];

/** A source's health. */
export const HEALTH_STATES = ['healthy', 'stale', 'failing', 'needs_reconnect'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** Which occurrences of a recurring event a change applies to. This event is the default. */
export const RECURRING_SCOPES = ['this', 'following', 'all'] as const;
export type RecurringScope = (typeof RECURRING_SCOPES)[number];

/** The typed live events, one stream, with `news` after 2.0 and `jobs` after News. */
export const LIVE_EVENT_TYPES = ['mail', 'items', 'health', 'news', 'jobs'] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

/**
 * Every provider connection Setpoint keeps (DESIGN.md › Vocabulary: source). A mail account is a
 * source. So are Google Calendar (per Google account, on the same consent as Gmail), Todoist and
 * weather.
 */
export const SOURCE_PROVIDERS = ['gmail', 'icloud', 'google_calendar', 'todoist', 'weather'] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

/** How a source learns of changes: the provider pushes (with a sweep behind it), or it's polled. */
export const SYNC_MODES = ['push', 'poll'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

/**
 * A change sent to a provider, through one command layer. `reverted` is Move back: the user abandoned a failed change, and the mirror shows the provider's own state again.
 */
export const COMMAND_STATES = ['pending', 'confirmed', 'failed', 'reverted'] as const;
export type CommandState = (typeof COMMAND_STATES)[number];

/** What a command is about: one email, one calendar item, an account (Mark all as read), a calendar (its colour) or a Todoist project (its colour). */
export const COMMAND_TARGETS = ['message', 'item', 'account', 'calendar', 'project'] as const;
export type CommandTarget = (typeof COMMAND_TARGETS)[number];

export const COMMAND_KINDS = [
  // Mail.
  'open', 'mark_read', 'mark_unread', 'done', 'trash', 'untrash', 'pin', 'unpin', 'mark_all_read',
  // Calendar items.
  'item_create', 'item_update', 'item_delete', 'item_complete', 'item_reopen',
  // A Google calendar's colour, written to the user's calendar list.
  'calendar_colour',
  // A Todoist project's colour.
  'project_colour',
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** Owner sign-in: a password alone or a passkey alone, or strictly both. */
export const AUTH_MODES = ['password_or_passkey', 'password_plus_passkey'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** How a session was signed in. */
export const SESSION_METHODS = ['password', 'passkey', 'password_plus_passkey', 'recovery', 'claim'] as const;
export type SessionMethod = (typeof SESSION_METHODS)[number];

/** ntfy topics by kind, so iOS groups them and each can be muted. */
export const NOTIFY_TOPICS = ['reminders', 'mail'] as const;
export type NotifyTopic = (typeof NOTIFY_TOPICS)[number];

/** What a notification is for. */
export const NOTIFICATION_KINDS = ['reminder', 'time_to_leave', 'reconnect', 'mail', 'test'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Bring your own key: the model providers, and what each call was for (the AI usage ledger). News has
 * its own rows: each article read, grouping, stories written, and the hourly ranking, which asks
 * no model now and keeps its earlier calls. Jobs (a wiring point) adds its three parts: each email
 * read, finding JDs and reading JDs, named together so the ledger's table is rebuilt once. Removing
 * Jobs may leave them.
 */
export const AI_PROVIDERS = ['anthropic', 'openai'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_PURPOSES = ['triage', 'alfred', 'news_articles', 'news_grouping', 'news_stories', 'news_ranking', 'jobs_emails', 'jobs_finding_jds', 'jobs_reading_jds', 'search_terms', 'search_reading', 'mail_drafts'] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

/**
 * Instance secrets, write-only through the API (Settings › AI, Calendar, Notifications). AirNow's key
 * is no longer read: News's air quality comes from AirNow's keyless file. It
 * stays a name the secrets table allows, since dropping it would rebuild the table, and a stored one
 * does no harm.
 */
export const SECRET_NAMES = ['anthropic_api_key', 'openai_api_key', 'places_api_key', 'ntfy_token', 'airnow_api_key'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/** Search chips: recognised words that filter exactly. */
export const SEARCH_CHIP_KINDS = ['organisation', 'type', 'date', 'account', 'kind'] as const;
export type SearchChipKind = (typeof SEARCH_CHIP_KINDS)[number];

/**
 * A search with chips a suggestion made. `kept` applies the chips given, with no model
 * call (accepting it, a later page, a chip removed). `left_out` lists what they left out ("6 more
 * emails match your words"). The model is reached only by POST /api/search/suggestion.
 */
export const SEARCH_READS = ['kept', 'left_out'] as const;
export type SearchRead = (typeof SEARCH_READS)[number];

/**
 * Why a suggestion has no reading in it: no Anthropic key, the model was too slow or failed,
 * its filters left nothing, or nothing in the search was there to read (quotes, "!" words or a date
 * alone).
 */
export const SEARCH_READING_FALLBACKS = ['no_key', 'slow', 'failed', 'left_nothing', 'nothing_to_read'] as const;
export type SearchReadingFallback = (typeof SEARCH_READING_FALLBACKS)[number];

/** Why a search result matched: a chip, or free text in sender, then subject, then body, then date. */
export const MATCH_FIELDS = ['organisation', 'type', 'date', 'account', 'kind', 'sender', 'subject', 'body'] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];

/** Why a calendar search result matched: a chip, or free text in one of the item's fields. */
export const CALENDAR_MATCH_FIELDS = ['calendar', 'date', 'title', 'place', 'address', 'attendees', 'project', 'labels'] as const;
export type CalendarMatchField = (typeof CALENDAR_MATCH_FIELDS)[number];

// ---- News (after 2.0) ----

/** News's sections, in All's fixed order: the user's area, launches, the labs, US events. */
export const NEWS_SECTIONS = ['local', 'tech', 'ai', 'general'] as const;
export type NewsSection = (typeof NEWS_SECTIONS)[number];

/**
 * A story's dot: new until it's seen, updated when a new fact arrives after the user last saw it,
 * and no dot once seen. Seen is per story, never per article.
 */
export const STORY_STATES = ['new', 'updated', 'seen'] as const;
export type StoryState = (typeof STORY_STATES)[number];

/**
 * How a News source is read: an outlet's feed, official data (the hazard APIs), a page
 * read directly where there's no feed (Anthropic's news page), or discovery only (Google News
 * search for the area, which finds stories and is never read).
 */
export const NEWS_SOURCE_KINDS = ['feed', 'official_api', 'page_read', 'discovery'] as const;
export type NewsSourceKind = (typeof NEWS_SOURCE_KINDS)[number];

/**
 * Which adapter reads a News source: RSS and Atom feeds, the hazard APIs (NWS alerts for the home
 * location's zone, USGS, Cal Fire and AirNow by distance from it), Hacker News through Algolia, a
 * page read directly, and Google News search (discovery only). Settings › News draws each
 * source's icon from it.
 */
export const NEWS_ADAPTERS = ['feed', 'nws', 'usgs', 'cal_fire', 'airnow', 'hn_algolia', 'page_read', 'google_news'] as const;
export type NewsAdapterKey = (typeof NEWS_ADAPTERS)[number];

/**
 * The adapters that read official hazard data (NWS alerts, USGS quakes, Cal Fire, AirNow): always
 * Local. A story led by one names it, so the list can draw the hazard's glyph where a photo would go.
 */
export const NEWS_HAZARDS = ['nws', 'usgs', 'cal_fire', 'airnow'] as const satisfies readonly NewsAdapterKey[];
export type NewsHazard = (typeof NEWS_HAZARDS)[number];

/**
 * An icon a source on the local list may name for its tile in Settings › News (board 30a): a TV
 * station's `live_tv`, a crime wire's `local_police`, or a paper. A source without one takes its
 * adapter's.
 */
export const NEWS_SOURCE_ICONS = ['newspaper', 'live_tv', 'local_police'] as const;
export type NewsSourceIcon = (typeof NEWS_SOURCE_ICONS)[number];

CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`address` text NOT NULL,
	`colour` text NOT NULL,
	`icon` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "accounts_provider" CHECK("accounts"."provider" in ('gmail', 'icloud')),
	CONSTRAINT "accounts_colour" CHECK("accounts"."colour" in ('ink2', 'ink3', 'cool', 'warm', 'caution', 'comf', 'good', 'sun', 'alert', 'violet', 'cyan'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_label_unique` ON `accounts` (`label`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_address_unique` ON `accounts` (`address`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`provider_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_message` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `calendars` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`account_id` integer,
	`name` text NOT NULL,
	`colour` text,
	`position` integer NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "calendars_provider_kind" CHECK("calendars"."provider" in ('google', 'todoist')),
	CONSTRAINT "calendars_colour" CHECK("calendars"."colour" is null or "calendars"."colour" in ('ink2', 'ink3', 'cool', 'warm', 'caution', 'comf', 'good', 'sun', 'alert', 'violet', 'cyan'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendars_provider` ON `calendars` (`provider`,`provider_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calendar_id` integer NOT NULL,
	`provider_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`start_date` text,
	`end_date` text,
	`due_date` text,
	`due_at` text,
	`time_zone` text,
	`recurrence` text,
	`place` text,
	`address` text,
	`attendees` text,
	`reminders` text,
	`project` text,
	`done_at` text,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "items_kind" CHECK("items"."kind" in ('event', 'task')),
	CONSTRAINT "items_when" CHECK(case "items"."kind"
    when 'task' then "items"."due_date" is not null and "items"."starts_at" is null and "items"."start_date" is null
    else ("items"."all_day" and "items"."start_date" is not null and "items"."end_date" is not null)
      or (not "items"."all_day" and "items"."starts_at" is not null and "items"."ends_at" is not null) end)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_calendar_provider` ON `items` (`calendar_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `items_starts` ON `items` (`starts_at`);--> statement-breakpoint
CREATE INDEX `items_due` ON `items` (`due_date`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`provider_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`from_name` text NOT NULL,
	`from_address` text NOT NULL,
	`organisation` text,
	`via` text,
	`subject` text NOT NULL,
	`summary` text,
	`snippet` text NOT NULL,
	`body_text` text NOT NULL,
	`body_html` text,
	`received_at` text NOT NULL,
	`unread` integer NOT NULL,
	`lane` text,
	`kind` text,
	`type` text,
	`key_date` text,
	`security_facts` text,
	`protected` integer DEFAULT false NOT NULL,
	`pinned_at` text,
	`done_at` text,
	`opened_before_done` integer,
	`code` text,
	`code_expires_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "messages_lane" CHECK("messages"."lane" is null or "messages"."lane" in ('attention', 'fyi', 'noise')),
	CONSTRAINT "messages_kind" CHECK("messages"."kind" is null or "messages"."kind" in ('deliveries', 'money', 'career', 'security', 'updates', 'people', 'other')),
	CONSTRAINT "messages_type" CHECK("messages"."type" is null or "messages"."type" in ('confirmation', 'rejection', 'receipt', 'shipping', 'deadline', 'reminder', 'verification_code', 'alert', 'newsletter', 'statement')),
	CONSTRAINT "messages_done" CHECK(("messages"."done_at" is null) = ("messages"."opened_before_done" is null)),
	CONSTRAINT "messages_code" CHECK(("messages"."code" is null) = ("messages"."code_expires_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_account_provider` ON `messages` (`account_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `messages_received` ON `messages` (`received_at`);--> statement-breakpoint
CREATE INDEX `messages_thread` ON `messages` (`account_id`,`thread_id`);--> statement-breakpoint
CREATE TABLE `weather_days` (
	`date` text PRIMARY KEY NOT NULL,
	`condition` text NOT NULL,
	`high_f` integer NOT NULL,
	`low_f` integer NOT NULL,
	`fetched_at` text NOT NULL,
	CONSTRAINT "weather_condition" CHECK("weather_days"."condition" in ('sun', 'partly_cloudy', 'cloud', 'rain'))
);

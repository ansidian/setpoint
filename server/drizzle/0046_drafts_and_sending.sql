-- Drafts, kept in Setpoint until sent; the addresses each account can send as (Gmail's aliases);
-- and the `send` job, with the draft it sends. The jobs table is rebuilt for its kind check and the
-- new column. The copy leaves out `draft_id`, which the old table lacks (Drizzle wrote it in).
CREATE TABLE `drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`message_id` integer,
	`account_id` integer NOT NULL,
	`from_address` text NOT NULL,
	`to_recipients` text NOT NULL,
	`cc_recipients` text NOT NULL,
	`bcc_recipients` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`send_state` text,
	`send_at` text,
	`send_error` text,
	`rfc822_id` text,
	`attempted_at` text,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "drafts_kind" CHECK("drafts"."kind" in ('reply', 'reply_all', 'forward', 'new')),
	CONSTRAINT "drafts_send_state" CHECK("drafts"."send_state" is null or "drafts"."send_state" in ('held', 'sending', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_answer` ON `drafts` (`message_id`,`kind`) WHERE "drafts"."message_id" is not null;--> statement-breakpoint
CREATE INDEX `drafts_updated` ON `drafts` (`updated_at`);--> statement-breakpoint
CREATE TABLE `send_as` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`address` text NOT NULL,
	`name` text,
	`primary` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_as_account_address` ON `send_as` (`account_id`,`address`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`source_id` integer,
	`command_id` integer,
	`message_id` integer,
	`news_source_id` integer,
	`draft_id` integer,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_at` text NOT NULL,
	`lease_until` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	`again` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`news_source_id`) REFERENCES `news_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_kind" CHECK("__new_jobs"."kind" in ('sync', 'sweep', 'push', 'command', 'triage', 'extract', 'news', 'news_sort', 'jobs_read', 'search_terms', 'mailpieces', 'send')),
	CONSTRAINT "jobs_state" CHECK("__new_jobs"."state" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "kind", "key", "source_id", "command_id", "message_id", "news_source_id", "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at", "again") SELECT "id", "kind", "key", "source_id", "command_id", "message_id", "news_source_id", "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at", "again" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_key` ON `jobs` (`key`) WHERE "jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX `jobs_due` ON `jobs` (`state`,`run_at`);
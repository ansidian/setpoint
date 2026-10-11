CREATE TABLE `news_sorting` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_success_at` text,
	`last_failure_at` text,
	`failing_since` text,
	`last_error` text,
	`last_error_kind` text,
	`first_run_started_at` text,
	`first_run_done_at` text,
	`last_ranked_at` text,
	CONSTRAINT "news_sorting_singleton" CHECK("news_sorting"."id" = 1)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`purpose` text NOT NULL,
	`message_id` integer,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_usage_provider" CHECK("__new_ai_usage"."provider" in ('anthropic', 'openai')),
	CONSTRAINT "ai_usage_purpose" CHECK("__new_ai_usage"."purpose" in ('triage', 'alfred', 'news_articles', 'news_grouping', 'news_stories', 'news_ranking'))
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage`("id", "at", "provider", "model", "purpose", "message_id", "input_tokens", "output_tokens", "cached_tokens", "cost_micros") SELECT "id", "at", "provider", "model", "purpose", "message_id", "input_tokens", "output_tokens", "cached_tokens", "cost_micros" FROM `ai_usage`;--> statement-breakpoint
DROP TABLE `ai_usage`;--> statement-breakpoint
ALTER TABLE `__new_ai_usage` RENAME TO `ai_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_usage_at` ON `ai_usage` (`at`);--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`source_id` integer,
	`command_id` integer,
	`message_id` integer,
	`news_source_id` integer,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_at` text NOT NULL,
	`lease_until` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`news_source_id`) REFERENCES `news_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_kind" CHECK("__new_jobs"."kind" in ('sync', 'sweep', 'push', 'command', 'triage', 'extract', 'news', 'news_sort')),
	CONSTRAINT "jobs_state" CHECK("__new_jobs"."state" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "kind", "key", "source_id", "command_id", "message_id", "news_source_id", "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at") SELECT "id", "kind", "key", "source_id", "command_id", "message_id", "news_source_id", "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_key` ON `jobs` (`key`) WHERE "jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX `jobs_due` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
ALTER TABLE `news_articles` ADD `lat` real;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `lng` real;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `wire_key` text;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `noise` text;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `sorted_at` text;--> statement-breakpoint
CREATE INDEX `news_articles_sorted` ON `news_articles` (`sorted_at`);--> statement-breakpoint
ALTER TABLE `news_stories` ADD `importance` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `news_stories` ADD `outlets` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `news_stories` ADD `ranked_at` text;--> statement-breakpoint
ALTER TABLE `news_stories` ADD `needs_writing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `news_stories` ADD `written_at` text;--> statement-breakpoint
ALTER TABLE `news_stories` ADD `backfill` integer DEFAULT false NOT NULL;
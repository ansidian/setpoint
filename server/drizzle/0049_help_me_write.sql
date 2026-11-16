-- Help me write: its drafts in the AI usage ledger (purpose mail_drafts), and its line and the body's versions saved with a draft.
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
	CONSTRAINT "ai_usage_purpose" CHECK("__new_ai_usage"."purpose" in ('triage', 'alfred', 'news_articles', 'news_grouping', 'news_stories', 'news_ranking', 'jobs_emails', 'jobs_finding_jds', 'jobs_reading_jds', 'search_terms', 'search_reading', 'mail_drafts'))
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage`("id", "at", "provider", "model", "purpose", "message_id", "input_tokens", "output_tokens", "cached_tokens", "cost_micros") SELECT "id", "at", "provider", "model", "purpose", "message_id", "input_tokens", "output_tokens", "cached_tokens", "cost_micros" FROM `ai_usage`;--> statement-breakpoint
DROP TABLE `ai_usage`;--> statement-breakpoint
ALTER TABLE `__new_ai_usage` RENAME TO `ai_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_usage_at` ON `ai_usage` (`at`);--> statement-breakpoint
ALTER TABLE `drafts` ADD `write` text;
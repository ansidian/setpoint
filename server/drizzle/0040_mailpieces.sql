CREATE TABLE `mail_digests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer,
	`day` text NOT NULL,
	`pieces` integer NOT NULL,
	`stored_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_digests_message` ON `mail_digests` (`message_id`);--> statement-breakpoint
CREATE INDEX `mail_digests_day` ON `mail_digests` (`day`);--> statement-breakpoint
CREATE TABLE `mail_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`digest_id` integer NOT NULL,
	`position` integer NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`digest_id`) REFERENCES `mail_digests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_scans_order` ON `mail_scans` (`digest_id`,`position`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`again` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`news_source_id`) REFERENCES `news_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_kind" CHECK("__new_jobs"."kind" in ('sync', 'sweep', 'push', 'command', 'triage', 'extract', 'news', 'news_sort', 'jobs_read', 'search_terms', 'mailpieces')),
	CONSTRAINT "jobs_state" CHECK("__new_jobs"."state" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "kind", "key", "source_id", "command_id", "message_id", "news_source_id", "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at", "again") SELECT "id", "kind", "key", "source_id", "command_id", "message_id", "news_source_id", "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at", "again" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_key` ON `jobs` (`key`) WHERE "jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX `jobs_due` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
ALTER TABLE `messages` ADD `usps_digest` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Hand-written below this line (SV-274): digests already in the record leave the Inbox, as new ones
-- will (src/domain/mailpieces.ts › isDigestSender). If this migration is regenerated, append this
-- block again unchanged.
UPDATE `messages` SET `usps_digest` = 1 WHERE lower(`from_address`) = 'uspsinformeddelivery@email.informeddelivery.usps.com' AND `sender_authenticated` = 1 AND `subject` LIKE 'Your Daily Digest for %';

CREATE TABLE `jobs_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`company` text,
	`title_key` text,
	`requisition_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `jobs_applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_aliases_application` ON `jobs_aliases` (`application_id`);--> statement-breakpoint
CREATE TABLE `jobs_rejected_postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`link` text NOT NULL,
	`rejected_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `jobs_applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_rejected_postings_link` ON `jobs_rejected_postings` (`application_id`,`link`);--> statement-breakpoint
CREATE TABLE `jobs_undo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs_needs_you` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`from_history` integer DEFAULT false NOT NULL,
	`application_id` integer,
	`company` text NOT NULL,
	`title` text,
	`platform` text,
	`subject` text,
	`sender` text,
	`event_kind` text,
	`line` text,
	`account_id` integer,
	`at` text NOT NULL,
	`message_id` integer,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolution` text,
	FOREIGN KEY (`application_id`) REFERENCES `jobs_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_needs_you_kind" CHECK("__new_jobs_needs_you"."kind" in ('jd_to_confirm', 'update_to_assign', 'email_to_track')),
	CONSTRAINT "jobs_needs_you_reason" CHECK("__new_jobs_needs_you"."reason" in ('matches_several', 'names_no_role', 'names_other_role', 'no_application', 'unsure_posting', 'taken_off')),
	CONSTRAINT "jobs_needs_you_jd" CHECK("__new_jobs_needs_you"."kind" <> 'jd_to_confirm' or "__new_jobs_needs_you"."application_id" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_jobs_needs_you`("id", "kind", "reason", "from_history", "application_id", "company", "title", "platform", "subject", "sender", "event_kind", "line", "account_id", "at", "message_id", "created_at", "resolved_at", "resolution") SELECT "id", "kind", "reason", "from_history", "application_id", "company", "title", "platform", "subject", "sender", "event_kind", "line", "account_id", "at", "message_id", "created_at", "resolved_at", "resolution" FROM `jobs_needs_you`;--> statement-breakpoint
DROP TABLE `jobs_needs_you`;--> statement-breakpoint
ALTER TABLE `__new_jobs_needs_you` RENAME TO `jobs_needs_you`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `jobs_needs_you_open` ON `jobs_needs_you` (`resolved_at`,`from_history`);--> statement-breakpoint
CREATE TABLE `__new_jobs_blocked_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer,
	`blocked_at` text NOT NULL,
	`company` text,
	`title_key` text,
	`requisition_id` text,
	`application_id` integer
);
--> statement-breakpoint
INSERT INTO `__new_jobs_blocked_emails`("message_id", "blocked_at") SELECT "message_id", "blocked_at" FROM `jobs_blocked_emails`;--> statement-breakpoint
DROP TABLE `jobs_blocked_emails`;--> statement-breakpoint
ALTER TABLE `__new_jobs_blocked_emails` RENAME TO `jobs_blocked_emails`;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_blocked_emails_message` ON `jobs_blocked_emails` (`message_id`);--> statement-breakpoint
ALTER TABLE `jobs_jd_candidates` ADD `source` text;--> statement-breakpoint
ALTER TABLE `jobs_jd_candidates` ADD `picked_at` text;
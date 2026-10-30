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
	CONSTRAINT "jobs_needs_you_reason" CHECK("__new_jobs_needs_you"."reason" in ('matches_several', 'names_no_role', 'names_other_role', 'same_role_elsewhere', 'no_application', 'unsure_posting', 'taken_off')),
	CONSTRAINT "jobs_needs_you_jd" CHECK("__new_jobs_needs_you"."kind" <> 'jd_to_confirm' or "__new_jobs_needs_you"."application_id" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_jobs_needs_you`("id", "kind", "reason", "from_history", "application_id", "company", "title", "platform", "subject", "sender", "event_kind", "line", "account_id", "at", "message_id", "created_at", "resolved_at", "resolution") SELECT "id", "kind", "reason", "from_history", "application_id", "company", "title", "platform", "subject", "sender", "event_kind", "line", "account_id", "at", "message_id", "created_at", "resolved_at", "resolution" FROM `jobs_needs_you`;--> statement-breakpoint
DROP TABLE `jobs_needs_you`;--> statement-breakpoint
ALTER TABLE `__new_jobs_needs_you` RENAME TO `jobs_needs_you`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `jobs_needs_you_open` ON `jobs_needs_you` (`resolved_at`,`from_history`);
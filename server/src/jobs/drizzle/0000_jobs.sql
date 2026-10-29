CREATE TABLE `jobs_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`requisition_id` text,
	`platform` text,
	`account_id` integer,
	`applied_at` text NOT NULL,
	`status` text NOT NULL,
	`status_set_by` text NOT NULL,
	`status_set_at` text NOT NULL,
	`step` text,
	`step_at` text,
	`reapplied_from_id` integer,
	`first_seen_in_email` integer DEFAULT false NOT NULL,
	`jd_lookup` text DEFAULT 'none' NOT NULL,
	`jd_lookup_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`reapplied_from_id`) REFERENCES `jobs_applications`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "jobs_applications_status" CHECK("jobs_applications"."status" in ('applied', 'in_process', 'offer', 'rejected', 'withdrawn')),
	CONSTRAINT "jobs_applications_status_set_by" CHECK("jobs_applications"."status_set_by" in ('email', 'user')),
	CONSTRAINT "jobs_applications_jd_lookup" CHECK("jobs_applications"."jd_lookup" in ('none', 'looking', 'candidates', 'not_found'))
);
--> statement-breakpoint
CREATE INDEX `jobs_applications_applied` ON `jobs_applications` (`applied_at`);--> statement-breakpoint
CREATE INDEX `jobs_applications_company` ON `jobs_applications` (`company`);--> statement-breakpoint
CREATE TABLE `jobs_blocked_emails` (
	`message_id` integer PRIMARY KEY NOT NULL,
	`blocked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs_emails_read` (
	`message_id` integer PRIMARY KEY NOT NULL,
	`read_at` text NOT NULL,
	`outcome` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`sender` text NOT NULL,
	`subject` text NOT NULL,
	`line` text,
	`message_id` integer,
	`first_seen` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `jobs_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_events_kind" CHECK("jobs_events"."kind" in ('applied', 'assessment', 'interview', 'offer', 'rejection', 'duplicate', 'account', 'verification', 'next_step', 'form', 'match', 'other'))
);
--> statement-breakpoint
CREATE INDEX `jobs_events_application` ON `jobs_events` (`application_id`,`at`);--> statement-breakpoint
CREATE INDEX `jobs_events_message` ON `jobs_events` (`message_id`);--> statement-breakpoint
CREATE TABLE `jobs_hand_set` (
	`application_id` integer NOT NULL,
	`field` text NOT NULL,
	`set_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `jobs_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_hand_set_field" CHECK("jobs_hand_set"."field" in ('company', 'title', 'status'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_hand_set_key` ON `jobs_hand_set` (`application_id`,`field`);--> statement-breakpoint
CREATE TABLE `jobs_jd_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`platform` text NOT NULL,
	`link` text NOT NULL,
	`position` integer NOT NULL,
	`found_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `jobs_applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_jd_candidates_link` ON `jobs_jd_candidates` (`application_id`,`link`);--> statement-breakpoint
CREATE TABLE `jobs_needs_you` (
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
	CONSTRAINT "jobs_needs_you_kind" CHECK("jobs_needs_you"."kind" in ('jd_to_confirm', 'update_to_assign', 'email_to_track')),
	CONSTRAINT "jobs_needs_you_reason" CHECK("jobs_needs_you"."reason" in ('matches_several', 'names_no_role', 'names_other_role', 'no_application', 'unsure_posting')),
	CONSTRAINT "jobs_needs_you_jd" CHECK("jobs_needs_you"."kind" <> 'jd_to_confirm' or "jobs_needs_you"."application_id" is not null)
);
--> statement-breakpoint
CREATE INDEX `jobs_needs_you_open` ON `jobs_needs_you` (`resolved_at`,`from_history`);--> statement-breakpoint
CREATE TABLE `jobs_postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`full_text` text NOT NULL,
	`summary` text NOT NULL,
	`location` text,
	`workplace` text,
	`workplace_detail` text,
	`salary` text,
	`must_haves` text NOT NULL,
	`nice_to_haves` text NOT NULL,
	`link` text,
	`source` text NOT NULL,
	`platform` text,
	`found_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `jobs_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_postings_source" CHECK("jobs_postings"."source" in ('email_link', 'platform', 'search')),
	CONSTRAINT "jobs_postings_workplace" CHECK("jobs_postings"."workplace" is null or "jobs_postings"."workplace" in ('on_site', 'hybrid', 'remote'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_postings_application_id_unique` ON `jobs_postings` (`application_id`);--> statement-breakpoint
CREATE TABLE `jobs_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`accounts` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "jobs_settings_one" CHECK("jobs_settings"."id" = 1)
);

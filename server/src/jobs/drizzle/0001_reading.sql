-- J2. application_id's ON DELETE set null is added by hand: drizzle-kit leaves it out of ADD COLUMN, and
-- without it J6's Delete would be refused while a read email points at the application.
CREATE TABLE `jobs_reader` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_success_at` text,
	`last_failure_at` text,
	`failing_since` text,
	`last_error` text,
	`last_error_kind` text,
	CONSTRAINT "jobs_reader_one" CHECK("jobs_reader"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `jobs_applications` ADD `company_unknown` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs_emails_read` ADD `at` text;--> statement-breakpoint
ALTER TABLE `jobs_emails_read` ADD `event` text;--> statement-breakpoint
ALTER TABLE `jobs_emails_read` ADD `company` text;--> statement-breakpoint
ALTER TABLE `jobs_emails_read` ADD `title` text;--> statement-breakpoint
ALTER TABLE `jobs_emails_read` ADD `title_key` text;--> statement-breakpoint
ALTER TABLE `jobs_emails_read` ADD `requisition_id` text;--> statement-breakpoint
ALTER TABLE `jobs_emails_read` ADD `line` text;--> statement-breakpoint
ALTER TABLE `jobs_emails_read` ADD `application_id` integer REFERENCES jobs_applications(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `jobs_emails_read_event` ON `jobs_emails_read` (`event`,`at`);--> statement-breakpoint
ALTER TABLE `jobs_settings` ADD `enabled_at` text;
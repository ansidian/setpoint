PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs_postings` (
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
	CONSTRAINT "jobs_postings_source" CHECK("__new_jobs_postings"."source" in ('email_link', 'platform', 'search', 'pasted')),
	CONSTRAINT "jobs_postings_workplace" CHECK("__new_jobs_postings"."workplace" is null or "__new_jobs_postings"."workplace" in ('on_site', 'hybrid', 'remote'))
);
--> statement-breakpoint
INSERT INTO `__new_jobs_postings`("id", "application_id", "full_text", "summary", "location", "workplace", "workplace_detail", "salary", "must_haves", "nice_to_haves", "link", "source", "platform", "found_at") SELECT "id", "application_id", "full_text", "summary", "location", "workplace", "workplace_detail", "salary", "must_haves", "nice_to_haves", "link", "source", "platform", "found_at" FROM `jobs_postings`;--> statement-breakpoint
DROP TABLE `jobs_postings`;--> statement-breakpoint
ALTER TABLE `__new_jobs_postings` RENAME TO `jobs_postings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_postings_application_id_unique` ON `jobs_postings` (`application_id`);
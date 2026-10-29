CREATE TABLE `jobs_history` (
	`id` integer PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`before` text NOT NULL,
	`started_at` text NOT NULL,
	`total` integer NOT NULL,
	`read` integer,
	`finished_at` text,
	CONSTRAINT "jobs_history_one" CHECK("jobs_history"."id" = 1),
	CONSTRAINT "jobs_history_state" CHECK("jobs_history"."state" in ('running', 'done'))
);
--> statement-breakpoint
ALTER TABLE `jobs_applications` ADD `jd_lookup_from_history` integer DEFAULT false NOT NULL;
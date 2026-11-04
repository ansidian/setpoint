CREATE TABLE `jobs_check_token` (
	`id` integer PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "jobs_check_token_one" CHECK("jobs_check_token"."id" = 1)
);

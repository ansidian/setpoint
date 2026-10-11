CREATE TABLE `todoist_labels` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `items` ADD `labels` text;
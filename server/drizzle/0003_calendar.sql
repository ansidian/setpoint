CREATE TABLE `calendar_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` integer NOT NULL,
	`calendar_id` integer NOT NULL,
	`address` text NOT NULL,
	`token_hash` text NOT NULL,
	`resource_id` text,
	`state` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_notification_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_channels_state" CHECK("calendar_channels"."state" in ('pending', 'active', 'retired', 'unsupported'))
);
--> statement-breakpoint
CREATE INDEX `calendar_channels_calendar` ON `calendar_channels` (`calendar_id`,`state`);--> statement-breakpoint
CREATE TABLE `schedule_marks` (
	`name` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todoist_oauth_states` (
	`hash` text PRIMARY KEY NOT NULL,
	`bind_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todoist_projects` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`inbox` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `travel_estimates` (
	`item_id` integer NOT NULL,
	`occurrence_start` text NOT NULL,
	`inputs` text NOT NULL,
	`duration_seconds` integer,
	`distance_meters` integer,
	`leave_at` text,
	`checked_at` text,
	`next_check_at` text,
	`error` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `travel_estimates_occurrence` ON `travel_estimates` (`item_id`,`occurrence_start`);--> statement-breakpoint
ALTER TABLE `items` ADD `etag` text;--> statement-breakpoint
ALTER TABLE `items` ADD `expanded` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `read_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `due_string` text;--> statement-breakpoint
ALTER TABLE `items` ADD `due_recurring` integer DEFAULT false NOT NULL;
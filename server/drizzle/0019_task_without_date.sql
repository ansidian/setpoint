-- Hand-edited (SV-74), as 0009 and 0013 were: the migrator runs in a transaction, where PRAGMA
-- foreign_keys=OFF does nothing, so dropping `items` would cascade to its own completed
-- occurrences (recurring_item_id ON DELETE CASCADE, which a copy made first points at too) and to
-- Time to Leave's routes (travel_estimates.item_id). Both tables are kept aside, `items` is made
-- again under its own name, and the rows go back, each series before its occurrences. If this
-- migration is regenerated, make the edit again.
CREATE TABLE `__items_aside` AS SELECT * FROM `items`;--> statement-breakpoint
CREATE TABLE `__travel_aside` AS SELECT * FROM `travel_estimates`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calendar_id` integer NOT NULL,
	`provider_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`start_date` text,
	`end_date` text,
	`due_date` text,
	`due_at` text,
	`time_zone` text,
	`recurrence` text,
	`place` text,
	`address` text,
	`attendees` text,
	`reminders` text,
	`leave_reminder` integer DEFAULT false NOT NULL,
	`project` text,
	`done_at` text,
	`recurring_item_id` integer,
	`original_start` text,
	`cancelled` integer DEFAULT false NOT NULL,
	`etag` text,
	`expanded` integer DEFAULT false NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	`due_string` text,
	`due_recurring` integer DEFAULT false NOT NULL,
	`colour` text,
	`labels` text,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "items_exception" CHECK(("items"."recurring_item_id" is null) = ("items"."original_start" is null)),
	CONSTRAINT "items_kind" CHECK("items"."kind" in ('event', 'task')),
	CONSTRAINT "items_when" CHECK(case "items"."kind"
    when 'task' then ("items"."due_date" is not null or "items"."due_at" is null) and "items"."starts_at" is null and "items"."start_date" is null
    else ("items"."all_day" and "items"."start_date" is not null and "items"."end_date" is not null)
      or (not "items"."all_day" and "items"."starts_at" is not null and "items"."ends_at" is not null) end)
);
--> statement-breakpoint
INSERT INTO `items`("id", "calendar_id", "provider_id", "kind", "title", "all_day", "starts_at", "ends_at", "start_date", "end_date", "due_date", "due_at", "time_zone", "recurrence", "place", "address", "attendees", "reminders", "leave_reminder", "project", "done_at", "recurring_item_id", "original_start", "cancelled", "etag", "expanded", "read_only", "due_string", "due_recurring", "colour", "labels") SELECT "id", "calendar_id", "provider_id", "kind", "title", "all_day", "starts_at", "ends_at", "start_date", "end_date", "due_date", "due_at", "time_zone", "recurrence", "place", "address", "attendees", "reminders", "leave_reminder", "project", "done_at", "recurring_item_id", "original_start", "cancelled", "etag", "expanded", "read_only", "due_string", "due_recurring", "colour", "labels" FROM `__items_aside` ORDER BY "recurring_item_id" IS NOT NULL, "id";--> statement-breakpoint
INSERT INTO `travel_estimates` SELECT * FROM `__travel_aside`;--> statement-breakpoint
DROP TABLE `__items_aside`;--> statement-breakpoint
DROP TABLE `__travel_aside`;--> statement-breakpoint
CREATE UNIQUE INDEX `items_calendar_provider` ON `items` (`calendar_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `items_starts` ON `items` (`starts_at`);--> statement-breakpoint
CREATE INDEX `items_due` ON `items` (`due_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_occurrence` ON `items` (`recurring_item_id`,`original_start`);
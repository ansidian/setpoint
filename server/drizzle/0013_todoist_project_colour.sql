-- Hand-edited (SV-25), as 0009 was: the commands table's rebuild keeps pending commands' jobs aside
-- (jobs.command_id ON DELETE CASCADE, and PRAGMA foreign_keys=OFF does nothing in the migrator's
-- transaction), and todoist_projects' rebuild copies only the columns it had, its new id numbered
-- as it goes. If this migration is regenerated, make both edits again.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_commands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text NOT NULL,
	`target_id` integer NOT NULL,
	`kind` text NOT NULL,
	`source_id` integer,
	`state` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`previous` text,
	`previous_when` text,
	`provider_message` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "commands_target" CHECK("__new_commands"."target" in ('message', 'item', 'account', 'calendar', 'project')),
	CONSTRAINT "commands_kind" CHECK("__new_commands"."kind" in ('open', 'mark_read', 'mark_unread', 'done', 'trash', 'untrash', 'pin', 'unpin', 'mark_all_read', 'item_create', 'item_update', 'item_delete', 'item_complete', 'item_reopen', 'calendar_colour', 'project_colour')),
	CONSTRAINT "commands_state" CHECK("__new_commands"."state" in ('pending', 'confirmed', 'failed', 'reverted'))
);
--> statement-breakpoint
INSERT INTO `__new_commands`("id", "target", "target_id", "kind", "source_id", "state", "payload", "previous", "previous_when", "provider_message", "attempts", "created_at", "settled_at") SELECT "id", "target", "target_id", "kind", "source_id", "state", "payload", "previous", "previous_when", "provider_message", "attempts", "created_at", "settled_at" FROM `commands`;--> statement-breakpoint
CREATE TEMP TABLE `__command_jobs` AS SELECT * FROM `jobs` WHERE `command_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `commands`;--> statement-breakpoint
ALTER TABLE `__new_commands` RENAME TO `commands`;--> statement-breakpoint
INSERT INTO `jobs` SELECT * FROM `__command_jobs`;--> statement-breakpoint
DROP TABLE `__command_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `commands_one_active` ON `commands` (`target`,`target_id`) WHERE "commands"."state" in ('pending', 'failed');--> statement-breakpoint
CREATE TABLE `__new_todoist_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`inbox` integer DEFAULT false NOT NULL,
	`colour` text
);
--> statement-breakpoint
INSERT INTO `__new_todoist_projects`("provider_id", "name", "position", "inbox") SELECT "provider_id", "name", "position", "inbox" FROM `todoist_projects` ORDER BY "position";--> statement-breakpoint
DROP TABLE `todoist_projects`;--> statement-breakpoint
ALTER TABLE `__new_todoist_projects` RENAME TO `todoist_projects`;--> statement-breakpoint
CREATE UNIQUE INDEX `todoist_projects_provider` ON `todoist_projects` (`provider_id`);
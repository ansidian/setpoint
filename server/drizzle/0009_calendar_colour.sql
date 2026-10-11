-- Hand-edited (SV-20), one drizzle-kit fault: the migrator runs in a transaction, where PRAGMA
-- foreign_keys=OFF does nothing, so dropping `commands` would cascade to the jobs of pending
-- commands (jobs.command_id ON DELETE CASCADE) and leave those commands waiting forever. They're
-- kept aside and put back after the rename. If this migration is regenerated, make the edit again.
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
	CONSTRAINT "commands_target" CHECK("__new_commands"."target" in ('message', 'item', 'account', 'calendar')),
	CONSTRAINT "commands_kind" CHECK("__new_commands"."kind" in ('open', 'mark_read', 'mark_unread', 'done', 'trash', 'untrash', 'pin', 'unpin', 'mark_all_read', 'item_create', 'item_update', 'item_delete', 'item_complete', 'item_reopen', 'calendar_colour')),
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
CREATE UNIQUE INDEX `commands_one_active` ON `commands` (`target`,`target_id`) WHERE "commands"."state" in ('pending', 'failed');
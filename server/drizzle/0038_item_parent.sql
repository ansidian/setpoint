ALTER TABLE `items` ADD `parent_provider_id` text;--> statement-breakpoint
ALTER TABLE `items` ADD `child_order` integer;--> statement-breakpoint
-- Hand-added (SV-272), as 0014 was: a full Todoist sync once, so the subtasks left out before these
-- columns are mirrored; an incremental poll returns a task only when it changes. If this migration
-- is regenerated, add it again.
DELETE FROM `sync_cursors` WHERE `scope` = '' AND `source_id` IN (SELECT `id` FROM `sources` WHERE `provider` = 'todoist');

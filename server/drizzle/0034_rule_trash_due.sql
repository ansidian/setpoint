ALTER TABLE `messages` ADD `trash_due_at` text;--> statement-breakpoint
CREATE INDEX `messages_trash_due` ON `messages` (`trash_due_at`);
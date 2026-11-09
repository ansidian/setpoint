ALTER TABLE `triage_rules` ADD `mark_read` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `triage_rules` ADD `trash` text DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE `triage_rules` ADD `changed_at` text;
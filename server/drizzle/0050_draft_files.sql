-- The user's own files attached to drafts, kept in the data directory's draft-files/ by id.
CREATE TABLE `draft_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`draft_id` integer,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	`released_at` text,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `draft_files_draft` ON `draft_files` (`draft_id`);
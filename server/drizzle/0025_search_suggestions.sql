CREATE TABLE `search_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`query` text NOT NULL,
	`account_id` integer,
	`chips` text NOT NULL,
	`words` integer NOT NULL,
	`hides` integer NOT NULL,
	`total` integer NOT NULL,
	`reading` text,
	`shown_at` text,
	`accepted_at` text,
	`search_id` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`search_id`) REFERENCES `search_log`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `search_suggestions_at` ON `search_suggestions` (`at`);
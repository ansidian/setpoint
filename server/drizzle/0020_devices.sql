CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_hash_unique` ON `devices` (`hash`);--> statement-breakpoint
CREATE TABLE `pairing_codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);

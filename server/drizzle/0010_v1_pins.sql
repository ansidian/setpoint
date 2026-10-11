CREATE TABLE `pending_pins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`provider_id` text,
	`message_id` text,
	`pinned_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pending_pins_key" CHECK("pending_pins"."provider_id" is not null or "pending_pins"."message_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_pins_provider` ON `pending_pins` (`account_id`,`provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pending_pins_message` ON `pending_pins` (`account_id`,`message_id`);
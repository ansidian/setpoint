PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversation_summaries` (
	`account_id` integer NOT NULL,
	`thread_id` text NOT NULL,
	`summary` text,
	`message_id` integer,
	`at` text NOT NULL,
	`failed_message_id` integer,
	`failure_cause` text,
	`failure_status` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`failed_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "conversation_summaries_cause" CHECK("__new_conversation_summaries"."failure_cause" is null or "__new_conversation_summaries"."failure_cause" in ('down', 'limited', 'refused', 'unreachable', 'unusable', 'budget', 'triage_down'))
);
--> statement-breakpoint
INSERT INTO `__new_conversation_summaries`("account_id", "thread_id", "summary", "message_id", "at", "failed_message_id", "failure_cause", "failure_status") SELECT "account_id", "thread_id", "summary", "message_id", "at", NULL, NULL, NULL FROM `conversation_summaries`;--> statement-breakpoint
DROP TABLE `conversation_summaries`;--> statement-breakpoint
ALTER TABLE `__new_conversation_summaries` RENAME TO `conversation_summaries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_summaries_thread` ON `conversation_summaries` (`account_id`,`thread_id`);
CREATE TABLE `alfred_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`transcript` text NOT NULL,
	`created_at` text NOT NULL,
	`touched_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "alfred_conversations_provider" CHECK("alfred_conversations"."provider" in ('anthropic', 'openai'))
);
--> statement-breakpoint
CREATE INDEX `alfred_conversations_touched` ON `alfred_conversations` (`touched_at`);--> statement-breakpoint
CREATE TABLE `alfred_turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`at` text NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`emphasis` text NOT NULL,
	`source_ids` text NOT NULL,
	`searched` text NOT NULL,
	`proposals` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `alfred_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alfred_turns_conversation` ON `alfred_turns` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `search_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`query` text NOT NULL,
	`free_text` text NOT NULL,
	`chips` text NOT NULL,
	`account_id` integer,
	`order` text NOT NULL,
	`total` integer NOT NULL,
	`result_ids` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "search_log_order" CHECK("search_log"."order" in ('newest', 'match'))
);
--> statement-breakpoint
CREATE INDEX `search_log_at` ON `search_log` (`at`);--> statement-breakpoint
CREATE TABLE `search_opens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_id` integer NOT NULL,
	`message_id` integer,
	`position` integer NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `search_log`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `search_opens_search` ON `search_opens` (`search_id`);
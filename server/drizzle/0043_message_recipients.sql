-- Who an email was sent to and what it answers (To, Cc, Reply-To, References, In-Reply-To).
-- Null until read: new mail writes them as it arrives, and the header pass (src/sync/headers.ts)
-- fills the mail held from before.
ALTER TABLE `messages` ADD `to_recipients` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `cc_recipients` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `reply_to` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `reference_ids` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `in_reply_to` text;
-- Sent mail: whether the user sent an email, and whether it came to them. Existing rows all came
-- through the inbox, so they are received and not sent.
ALTER TABLE `messages` ADD `sent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `received` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `messages_sent` ON `messages` (`sent`,`received_at`);
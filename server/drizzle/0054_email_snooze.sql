-- An email's snooze, Setpoint's own: until when, and when it last returned. The list index holds both.
DROP INDEX `messages_list`;--> statement-breakpoint
ALTER TABLE `messages` ADD `snoozed_until` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `returned_at` text;--> statement-breakpoint
CREATE INDEX `messages_snoozed` ON `messages` (`snoozed_until`);--> statement-breakpoint
CREATE INDEX `messages_list` ON `messages` (`received`,`usps_digest`,`account_id`,`lane`,`kind`,`unread`,`received_at`,`organisation`,`from_name`,`pinned_at`,`done_at`,`trashed_at`,`code_expires_at`,`archived_at`,`triaged_at`,`triage_source`,`snoozed_until`,`returned_at`);
ALTER TABLE `items` ADD `ical_uid` text;--> statement-breakpoint
CREATE INDEX `items_ical_uid` ON `items` (`calendar_id`,`ical_uid`);
ALTER TABLE `calendars` ADD `listed` integer DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE `calendars` SET `listed` = false, `visible` = true WHERE `visible` = false;

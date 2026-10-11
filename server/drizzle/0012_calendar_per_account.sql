DROP INDEX `calendars_provider`;--> statement-breakpoint
CREATE UNIQUE INDEX `calendars_account_provider` ON `calendars` (`account_id`,`provider`,`provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendars_provider` ON `calendars` (`provider`,`provider_id`) WHERE "calendars"."account_id" is null;
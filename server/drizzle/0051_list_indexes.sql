-- The lists read many emails' small columns, which sit after the bodies in each row: these indexes hold them.
CREATE INDEX `messages_list` ON `messages` (`received`,`usps_digest`,`account_id`,`lane`,`kind`,`unread`,`received_at`,`organisation`,`from_name`,`pinned_at`,`done_at`,`trashed_at`,`code_expires_at`,`archived_at`,`triaged_at`,`triage_source`);--> statement-breakpoint
CREATE INDEX `messages_verdicts` ON `messages` (`lane`,`backfill`,`done_at`,`organisation`,`type`,`kind`,`protected`,`opened_before_done`);

ALTER TABLE `messages` ADD `sender_auth` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `rfc822_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `backfill` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `trash_ref` text;--> statement-breakpoint
CREATE INDEX `messages_rfc822` ON `messages` (`account_id`,`rfc822_id`);--> statement-breakpoint
-- Hand-written below this line (B2): Drizzle can't express FTS5 virtual tables or triggers, so
-- drizzle-kit generated only the statements above. If this migration is regenerated, append this
-- block again unchanged. `messages_fts` is an external-content FTS5 index over the message record
-- (sender, organisation, subject, body) whose rowid is messages.id; the triggers keep it in step
-- on insert, delete and on updates to those columns only (read state, Done and pins don't touch
-- it); the rebuild indexes rows that existed before this migration.
CREATE VIRTUAL TABLE `messages_fts` USING fts5(
	`from_name`, `from_address`, `organisation`, `subject`, `body_text`,
	content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);--> statement-breakpoint
CREATE TRIGGER `messages_fts_insert` AFTER INSERT ON `messages` BEGIN
	INSERT INTO `messages_fts`(rowid, `from_name`, `from_address`, `organisation`, `subject`, `body_text`)
	VALUES (new.`id`, new.`from_name`, new.`from_address`, new.`organisation`, new.`subject`, new.`body_text`);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_delete` AFTER DELETE ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, rowid, `from_name`, `from_address`, `organisation`, `subject`, `body_text`)
	VALUES ('delete', old.`id`, old.`from_name`, old.`from_address`, old.`organisation`, old.`subject`, old.`body_text`);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_update` AFTER UPDATE OF `from_name`, `from_address`, `organisation`, `subject`, `body_text` ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, rowid, `from_name`, `from_address`, `organisation`, `subject`, `body_text`)
	VALUES ('delete', old.`id`, old.`from_name`, old.`from_address`, old.`organisation`, old.`subject`, old.`body_text`);
	INSERT INTO `messages_fts`(rowid, `from_name`, `from_address`, `organisation`, `subject`, `body_text`)
	VALUES (new.`id`, new.`from_name`, new.`from_address`, new.`organisation`, new.`subject`, new.`body_text`);
END;--> statement-breakpoint
INSERT INTO `messages_fts`(`messages_fts`) VALUES ('rebuild');

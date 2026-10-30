ALTER TABLE `messages` ADD `search_body` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `search_terms` text;--> statement-breakpoint
-- Hand-written below this line (SV-135): Drizzle can't express FTS5 virtual tables or triggers, so
-- drizzle-kit generated only the statements above. If this migration is regenerated, append this
-- block again unchanged. It replaces 0002_mail's `messages_fts`: the body it indexes is now
-- `search_body`, and the summary and search terms join it. Both of those arrive after insert, so
-- the update trigger follows them. `body_text` leaves the index; the mirror writes `search_body`
-- beside it. `search_body_of` is src/domain/searchBody.ts,
-- registered by src/db/open.ts before migrations run, so the backfill is the same rule new mail
-- gets and lands in this migration's transaction with the index built from it.
DROP TRIGGER `messages_fts_insert`;--> statement-breakpoint
DROP TRIGGER `messages_fts_delete`;--> statement-breakpoint
DROP TRIGGER `messages_fts_update`;--> statement-breakpoint
DROP TABLE `messages_fts`;--> statement-breakpoint
UPDATE `messages` SET `search_body` = search_body_of(`body_text`);--> statement-breakpoint
CREATE VIRTUAL TABLE `messages_fts` USING fts5(
	`from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`,
	content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);--> statement-breakpoint
CREATE TRIGGER `messages_fts_insert` AFTER INSERT ON `messages` BEGIN
	INSERT INTO `messages_fts`(rowid, `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`)
	VALUES (new.`id`, new.`from_name`, new.`from_address`, new.`organisation`, new.`subject`, new.`summary`, new.`search_terms`, new.`search_body`);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_delete` AFTER DELETE ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, rowid, `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`)
	VALUES ('delete', old.`id`, old.`from_name`, old.`from_address`, old.`organisation`, old.`subject`, old.`summary`, old.`search_terms`, old.`search_body`);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_update` AFTER UPDATE OF `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body` ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, rowid, `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`)
	VALUES ('delete', old.`id`, old.`from_name`, old.`from_address`, old.`organisation`, old.`subject`, old.`summary`, old.`search_terms`, old.`search_body`);
	INSERT INTO `messages_fts`(rowid, `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`)
	VALUES (new.`id`, new.`from_name`, new.`from_address`, new.`organisation`, new.`subject`, new.`summary`, new.`search_terms`, new.`search_body`);
END;--> statement-breakpoint
INSERT INTO `messages_fts`(`messages_fts`) VALUES ('rebuild');

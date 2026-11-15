ALTER TABLE `messages` ADD `search_recipients` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Hand-written below this line, as in 0022: Drizzle can't express FTS5 virtual tables or triggers.
-- If this migration is regenerated, append this block again unchanged. The index takes a sent
-- email's recipients, To then Cc as names and addresses, for mail the user sent to others only.
-- The index's triggers work them out from the recipients themselves, so they never depend on the
-- order triggers fire in. `search_recipients` holds the same text for ranking and for 'rebuild',
-- written by its own triggers and left out of the index's update trigger.
DROP TRIGGER `messages_fts_insert`;--> statement-breakpoint
DROP TRIGGER `messages_fts_delete`;--> statement-breakpoint
DROP TRIGGER `messages_fts_update`;--> statement-breakpoint
DROP TABLE `messages_fts`;--> statement-breakpoint
UPDATE `messages` SET `search_recipients` = CASE WHEN messages.`sent` AND NOT messages.`received` THEN coalesce((SELECT group_concat(trim(coalesce(json_extract(value, '$.name'), '') || ' ' || json_extract(value, '$.address')), ' ') FROM (SELECT value FROM json_each(coalesce(messages.`to_recipients`, '[]')) UNION ALL SELECT value FROM json_each(coalesce(messages.`cc_recipients`, '[]')))), '') ELSE '' END WHERE `sent` AND NOT `received`;--> statement-breakpoint
CREATE VIRTUAL TABLE `messages_fts` USING fts5(
	`from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`, `search_recipients`,
	content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);--> statement-breakpoint
CREATE TRIGGER `messages_fts_insert` AFTER INSERT ON `messages` BEGIN
	INSERT INTO `messages_fts`(rowid, `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`, `search_recipients`)
	VALUES (new.`id`, new.`from_name`, new.`from_address`, new.`organisation`, new.`subject`, new.`summary`, new.`search_terms`, new.`search_body`, CASE WHEN new.`sent` AND NOT new.`received` THEN coalesce((SELECT group_concat(trim(coalesce(json_extract(value, '$.name'), '') || ' ' || json_extract(value, '$.address')), ' ') FROM (SELECT value FROM json_each(coalesce(new.`to_recipients`, '[]')) UNION ALL SELECT value FROM json_each(coalesce(new.`cc_recipients`, '[]')))), '') ELSE '' END);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_delete` AFTER DELETE ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, rowid, `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`, `search_recipients`)
	VALUES ('delete', old.`id`, old.`from_name`, old.`from_address`, old.`organisation`, old.`subject`, old.`summary`, old.`search_terms`, old.`search_body`, CASE WHEN old.`sent` AND NOT old.`received` THEN coalesce((SELECT group_concat(trim(coalesce(json_extract(value, '$.name'), '') || ' ' || json_extract(value, '$.address')), ' ') FROM (SELECT value FROM json_each(coalesce(old.`to_recipients`, '[]')) UNION ALL SELECT value FROM json_each(coalesce(old.`cc_recipients`, '[]')))), '') ELSE '' END);
END;--> statement-breakpoint
CREATE TRIGGER `messages_fts_update` AFTER UPDATE OF `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`, `to_recipients`, `cc_recipients`, `sent`, `received` ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, rowid, `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`, `search_recipients`)
	VALUES ('delete', old.`id`, old.`from_name`, old.`from_address`, old.`organisation`, old.`subject`, old.`summary`, old.`search_terms`, old.`search_body`, CASE WHEN old.`sent` AND NOT old.`received` THEN coalesce((SELECT group_concat(trim(coalesce(json_extract(value, '$.name'), '') || ' ' || json_extract(value, '$.address')), ' ') FROM (SELECT value FROM json_each(coalesce(old.`to_recipients`, '[]')) UNION ALL SELECT value FROM json_each(coalesce(old.`cc_recipients`, '[]')))), '') ELSE '' END);
	INSERT INTO `messages_fts`(rowid, `from_name`, `from_address`, `organisation`, `subject`, `summary`, `search_terms`, `search_body`, `search_recipients`)
	VALUES (new.`id`, new.`from_name`, new.`from_address`, new.`organisation`, new.`subject`, new.`summary`, new.`search_terms`, new.`search_body`, CASE WHEN new.`sent` AND NOT new.`received` THEN coalesce((SELECT group_concat(trim(coalesce(json_extract(value, '$.name'), '') || ' ' || json_extract(value, '$.address')), ' ') FROM (SELECT value FROM json_each(coalesce(new.`to_recipients`, '[]')) UNION ALL SELECT value FROM json_each(coalesce(new.`cc_recipients`, '[]')))), '') ELSE '' END);
END;--> statement-breakpoint
CREATE TRIGGER `messages_recipients_insert` AFTER INSERT ON `messages` WHEN new.`sent` AND NOT new.`received` BEGIN
	UPDATE `messages` SET `search_recipients` = CASE WHEN new.`sent` AND NOT new.`received` THEN coalesce((SELECT group_concat(trim(coalesce(json_extract(value, '$.name'), '') || ' ' || json_extract(value, '$.address')), ' ') FROM (SELECT value FROM json_each(coalesce(new.`to_recipients`, '[]')) UNION ALL SELECT value FROM json_each(coalesce(new.`cc_recipients`, '[]')))), '') ELSE '' END WHERE `id` = new.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `messages_recipients_update` AFTER UPDATE OF `to_recipients`, `cc_recipients`, `sent`, `received` ON `messages` BEGIN
	UPDATE `messages` SET `search_recipients` = CASE WHEN new.`sent` AND NOT new.`received` THEN coalesce((SELECT group_concat(trim(coalesce(json_extract(value, '$.name'), '') || ' ' || json_extract(value, '$.address')), ' ') FROM (SELECT value FROM json_each(coalesce(new.`to_recipients`, '[]')) UNION ALL SELECT value FROM json_each(coalesce(new.`cc_recipients`, '[]')))), '') ELSE '' END WHERE `id` = new.`id`;
END;--> statement-breakpoint
INSERT INTO `messages_fts`(`messages_fts`) VALUES ('rebuild');

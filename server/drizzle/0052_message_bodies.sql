-- An email's bodies move to their own table: SQLite walks a row's earlier values to read a later
-- one, so bodies in `messages` made every read of many emails read their bodies too.
--
-- Written by hand. `messages` is never rebuilt (create a copy, drop, rename): inside the migrator's
-- transaction `foreign_keys=OFF` does nothing, so dropping `messages` would cascade to attachments,
-- jobs and everything else that names an email. DROP COLUMN rewrites the rows in place and deletes
-- none. Neither `messages_fts` nor its triggers read a body (they index `search_body`, 0022), so the
-- index is left as it is.
CREATE TABLE `message_bodies` (
	`message_id` integer PRIMARY KEY NOT NULL,
	`body_text` text NOT NULL,
	`body_html` text,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `message_bodies` (`message_id`, `body_text`, `body_html`) SELECT `id`, `body_text`, `body_html` FROM `messages`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `body_text`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `body_html`;

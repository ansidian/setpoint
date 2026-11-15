-- A forward's attachments the user took off it, by their ids; the rest go with it.
ALTER TABLE `drafts` ADD `removed_attachments` text DEFAULT '[]' NOT NULL;

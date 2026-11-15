-- A reply's quote as the user trimmed it, as rich-text blocks; null quotes the original in full.
ALTER TABLE `drafts` ADD `quote` text;

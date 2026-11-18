-- When a job last failed, for "as of" on a change waiting to try again.
ALTER TABLE `jobs` ADD `last_error_at` text;

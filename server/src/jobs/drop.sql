-- Removing Jobs (D303, server/src/jobs/README.md › Removal): drops every jobs_ table and Jobs's
-- migrations table. Mail's tables and rows are untouched: nothing in them points at Jobs. Children
-- first, so it runs with foreign keys on.
DROP TABLE IF EXISTS `jobs_events`;
DROP TABLE IF EXISTS `jobs_postings`;
DROP TABLE IF EXISTS `jobs_jd_candidates`;
DROP TABLE IF EXISTS `jobs_needs_you`;
DROP TABLE IF EXISTS `jobs_hand_set`;
DROP TABLE IF EXISTS `jobs_aliases`;
DROP TABLE IF EXISTS `jobs_rejected_postings`;
DROP TABLE IF EXISTS `jobs_emails_read`;
DROP TABLE IF EXISTS `jobs_applications`;
DROP TABLE IF EXISTS `jobs_blocked_emails`;
DROP TABLE IF EXISTS `jobs_settings`;
DROP TABLE IF EXISTS `jobs_reader`;
DROP TABLE IF EXISTS `jobs_history`;
DROP TABLE IF EXISTS `jobs_undo`;
DROP TABLE IF EXISTS `jobs_migrations`;

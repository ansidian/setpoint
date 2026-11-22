-- A campaign USPS shows by its piece's scan is a letter in the mail, so the days kept left out
-- pieces they should have shown. They're dropped here with their scans, and the mailpieces worker
-- reads each digest of the last 30 days again from its source under the new rule
-- (src/mailpieces/worker.ts › queueMailpieces queues every digest with no day).
DELETE FROM `mail_scans`;
--> statement-breakpoint
DELETE FROM `mail_digests`;

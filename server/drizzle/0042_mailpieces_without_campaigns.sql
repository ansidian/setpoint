-- D572: a mailer's campaign isn't a piece in the mail, so the days kept counted and showed pieces
-- they shouldn't. They're dropped here with their scans, and the mailpieces worker reads each
-- digest of the last 30 days again from its source under the new rule (src/mailpieces/worker.ts ›
-- queueMailpieces queues every digest with no day).
DELETE FROM `mail_scans`;
--> statement-breakpoint
DELETE FROM `mail_digests`;

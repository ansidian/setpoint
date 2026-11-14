-- SV-274: Gmail names a subdomain sender's DMARC domain as its parent (header.from=usps.com for
-- email.informeddelivery.usps.com), and the evaluator wanted the From domain exactly, so a DMARC
-- pass was stored as a fail. It now takes the From domain or a parent on a label boundary
-- (src/domain/senderAuthentication.ts › dmarcCovers); this puts the stored verdicts right, from the
-- evidence kept with each message.
UPDATE `messages`
SET `sender_auth` = json_set(`sender_auth`, '$.status', 'pass', '$.dmarc.aligned', json('true')),
    `sender_authenticated` = 1
WHERE json_valid(`sender_auth`)
  AND json_extract(`sender_auth`, '$.provider') = 'gmail'
  AND json_extract(`sender_auth`, '$.status') = 'fail'
  AND json_extract(`sender_auth`, '$.dmarc.result') = 'pass'
  AND json_extract(`sender_auth`, '$.dmarc.aligned') = 0
  AND instr(json_extract(`sender_auth`, '$.dmarc.domain'), '.') > 0
  AND length(lower(substr(`from_address`, instr(`from_address`, '@') + 1))) > length(json_extract(`sender_auth`, '$.dmarc.domain')) + 1
  AND substr(lower(substr(`from_address`, instr(`from_address`, '@') + 1)), -(length(json_extract(`sender_auth`, '$.dmarc.domain')) + 1))
    = '.' || json_extract(`sender_auth`, '$.dmarc.domain');
--> statement-breakpoint
-- The digests now authenticated leave the Inbox as 0040 meant them to (src/domain/mailpieces.ts ›
-- isDigest); the mailpieces worker's next check queues their scans.
UPDATE `messages` SET `usps_digest` = 1
WHERE lower(`from_address`) = 'uspsinformeddelivery@email.informeddelivery.usps.com'
  AND `sender_authenticated` = 1 AND `subject` LIKE 'Your Daily Digest for %';

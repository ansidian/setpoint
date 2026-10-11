CREATE TABLE `pattern_prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organisation_key` text NOT NULL,
	`organisation` text NOT NULL,
	`type` text NOT NULL,
	`kind` text NOT NULL,
	`count` integer NOT NULL,
	`message_ids` text NOT NULL,
	`answer` text,
	`rule_id` integer,
	`created_at` text NOT NULL,
	`answered_at` text,
	FOREIGN KEY (`rule_id`) REFERENCES `triage_rules`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pattern_prompts_answer" CHECK("pattern_prompts"."answer" is null or "pattern_prompts"."answer" in ('yes', 'no')),
	CONSTRAINT "pattern_prompts_answered" CHECK(("pattern_prompts"."answer" is null) = ("pattern_prompts"."answered_at" is null)),
	CONSTRAINT "pattern_prompts_type" CHECK("pattern_prompts"."type" in ('confirmation', 'rejection', 'receipt', 'shipping', 'deadline', 'reminder', 'verification_code', 'alert', 'newsletter', 'statement')),
	CONSTRAINT "pattern_prompts_kind" CHECK("pattern_prompts"."kind" in ('deliveries', 'money', 'career', 'security', 'updates', 'people', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pattern_prompts_key` ON `pattern_prompts` (`organisation_key`,`type`);--> statement-breakpoint
CREATE TABLE `triage_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`organisation_key` text NOT NULL,
	`organisation` text NOT NULL,
	`type` text,
	`from_address` text NOT NULL,
	`subject` text NOT NULL,
	`from_lane` text NOT NULL,
	`to_lane` text NOT NULL,
	`at` text NOT NULL,
	`dedupe` text NOT NULL,
	CONSTRAINT "triage_evidence_source" CHECK("triage_evidence"."source" in ('v1_correction')),
	CONSTRAINT "triage_evidence_type" CHECK("triage_evidence"."type" is null or "triage_evidence"."type" in ('confirmation', 'rejection', 'receipt', 'shipping', 'deadline', 'reminder', 'verification_code', 'alert', 'newsletter', 'statement')),
	CONSTRAINT "triage_evidence_lanes" CHECK("triage_evidence"."from_lane" in ('attention', 'fyi', 'noise') and "triage_evidence"."to_lane" in ('attention', 'fyi', 'noise'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `triage_evidence_dedupe_unique` ON `triage_evidence` (`dedupe`);--> statement-breakpoint
CREATE INDEX `triage_evidence_key` ON `triage_evidence` (`organisation_key`,`type`);--> statement-breakpoint
CREATE TABLE `triage_health` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_success_at` text,
	`last_failure_at` text,
	`last_error` text,
	CONSTRAINT "triage_health_singleton" CHECK("triage_health"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `triage_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text NOT NULL,
	`match` text NOT NULL,
	`lane` text NOT NULL,
	`kind` text,
	`position` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`imported_from` text,
	`created_at` text NOT NULL,
	CONSTRAINT "triage_rules_origin" CHECK("triage_rules"."origin" in ('written', 'learned')),
	CONSTRAINT "triage_rules_lane" CHECK("triage_rules"."lane" in ('attention', 'fyi', 'noise')),
	CONSTRAINT "triage_rules_kind" CHECK("triage_rules"."kind" is null or "triage_rules"."kind" in ('deliveries', 'money', 'career', 'security', 'updates', 'people', 'other')),
	CONSTRAINT "triage_rules_noise" CHECK("triage_rules"."lane" <> 'noise' or "triage_rules"."kind" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `triage_rules_imported_from_unique` ON `triage_rules` (`imported_from`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`source_id` integer,
	`command_id` integer,
	`message_id` integer,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_at` text NOT NULL,
	`lease_until` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_kind" CHECK("__new_jobs"."kind" in ('sync', 'sweep', 'push', 'command', 'triage', 'extract')),
	CONSTRAINT "jobs_state" CHECK("__new_jobs"."state" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "kind", "key", "source_id", "command_id", "message_id", "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at") SELECT "id", "kind", "key", "source_id", "command_id", NULL, "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_key` ON `jobs` (`key`) WHERE "jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX `jobs_due` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
ALTER TABLE `messages` ADD `triage_source` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `triage_rule_id` integer REFERENCES triage_rules(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `triaged_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `extracted_at` text;--> statement-breakpoint
CREATE INDEX `messages_triage_rule` ON `messages` (`triage_rule_id`);
-- Hand-edited (B3), two drizzle-kit faults, nothing else: the jobs copy selected `message_id` from the
-- old `jobs`, which has no such column (now NULL); and the added `messages.triage_rule_id` lost its
-- ON DELETE SET NULL (restored, so deleting a rule keeps the emails it sorted). If this migration is
-- regenerated, make both edits again. Adding columns to `messages` keeps the table, so the FTS
-- triggers from 0002_mail stay; the jobs rebuild has no triggers to lose.

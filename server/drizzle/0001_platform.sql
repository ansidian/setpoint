CREATE TABLE `ai_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`purpose` text NOT NULL,
	`message_id` integer,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_usage_provider" CHECK("ai_usage"."provider" in ('anthropic', 'openai')),
	CONSTRAINT "ai_usage_purpose" CHECK("ai_usage"."purpose" in ('triage', 'alfred'))
);
--> statement-breakpoint
CREATE INDEX `ai_usage_at` ON `ai_usage` (`at`);--> statement-breakpoint
CREATE TABLE `commands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text NOT NULL,
	`target_id` integer NOT NULL,
	`kind` text NOT NULL,
	`source_id` integer,
	`state` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`previous` text,
	`previous_when` text,
	`provider_message` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "commands_target" CHECK("commands"."target" in ('message', 'item', 'account')),
	CONSTRAINT "commands_kind" CHECK("commands"."kind" in ('open', 'mark_read', 'mark_unread', 'done', 'trash', 'untrash', 'pin', 'unpin', 'mark_all_read', 'item_create', 'item_update', 'item_delete', 'item_complete', 'item_reopen')),
	CONSTRAINT "commands_state" CHECK("commands"."state" in ('pending', 'confirmed', 'failed', 'reverted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commands_one_active` ON `commands` (`target`,`target_id`) WHERE "commands"."state" in ('pending', 'failed');--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`source_id` integer,
	`command_id` integer,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_at` text NOT NULL,
	`lease_until` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_kind" CHECK("jobs"."kind" in ('sync', 'sweep', 'push', 'command')),
	CONSTRAINT "jobs_state" CHECK("jobs"."state" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_key` ON `jobs` (`key`) WHERE "jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX `jobs_due` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`topic` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`click` text,
	`dedupe` text,
	`state` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	CONSTRAINT "notifications_kind" CHECK("notifications"."kind" in ('reminder', 'time_to_leave', 'reconnect', 'mail', 'test')),
	CONSTRAINT "notifications_topic" CHECK("notifications"."topic" in ('reminders', 'mail')),
	CONSTRAINT "notifications_state" CHECK("notifications"."state" in ('sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_unique` ON `notifications` (`dedupe`);--> statement-breakpoint
CREATE TABLE `owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`auth_mode` text DEFAULT 'password_or_passkey' NOT NULL,
	`security_generation` integer DEFAULT 1 NOT NULL,
	`password_attempts` integer DEFAULT 0 NOT NULL,
	`password_window_ends_at` text,
	`claimed_at` text NOT NULL,
	CONSTRAINT "owner_singleton" CHECK("owner"."id" = 1),
	CONSTRAINT "owner_auth_mode" CHECK("owner"."auth_mode" in ('password_or_passkey', 'password_plus_passkey'))
);
--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`credential_id` text NOT NULL,
	`label` text NOT NULL,
	`public_key` text NOT NULL,
	`sign_count` integer DEFAULT 0 NOT NULL,
	`transports` text NOT NULL,
	`backed_up` integer,
	`device_type` text,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_id_unique` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE TABLE `pending_sign_ins` (
	`hash` text PRIMARY KEY NOT NULL,
	`security_generation` integer NOT NULL,
	`password_at` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`generated_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "secrets_name" CHECK("secrets"."name" in ('anthropic_api_key', 'openai_api_key', 'places_api_key', 'ntfy_token'))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hash` text NOT NULL,
	`security_generation` integer NOT NULL,
	`method` text NOT NULL,
	`password_at` text,
	`created_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT "sessions_method" CHECK("sessions"."method" in ('password', 'passkey', 'password_plus_passkey', 'recovery', 'claim'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_hash_unique` ON `sessions` (`hash`);--> statement-breakpoint
CREATE TABLE `settings` (
	`section` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setup_tokens` (
	`hash` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`account_id` integer,
	`credentials` text,
	`dev` integer DEFAULT false NOT NULL,
	`sync_mode` text NOT NULL,
	`interval_seconds` integer NOT NULL,
	`push_renews_at` text,
	`last_check_at` text,
	`last_success_at` text,
	`last_error_at` text,
	`last_error` text,
	`needs_reconnect_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sources_provider" CHECK("sources"."provider" in ('gmail', 'icloud', 'google_calendar', 'todoist', 'weather')),
	CONSTRAINT "sources_sync_mode" CHECK("sources"."sync_mode" in ('push', 'poll')),
	CONSTRAINT "sources_dev_credentials" CHECK(not ("sources"."dev" and "sources"."credentials" is not null)),
	CONSTRAINT "sources_interval" CHECK("sources"."interval_seconds" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_account_provider` ON `sources` (`account_id`,`provider`);--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`source_id` integer NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`cursor` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_cursors_scope` ON `sync_cursors` (`source_id`,`scope`);--> statement-breakpoint
CREATE TABLE `trusted_domains` (
	`domain` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`hash` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`pending_hash` text,
	`session_id` integer,
	`security_generation` integer NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "webauthn_purpose" CHECK("webauthn_challenges"."purpose" in ('sign_in', 'register')),
	CONSTRAINT "webauthn_binding" CHECK(("webauthn_challenges"."purpose" = 'sign_in') = ("webauthn_challenges"."pending_hash" is not null))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calendar_id` integer NOT NULL,
	`provider_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`start_date` text,
	`end_date` text,
	`due_date` text,
	`due_at` text,
	`time_zone` text,
	`recurrence` text,
	`place` text,
	`address` text,
	`attendees` text,
	`reminders` text,
	`project` text,
	`done_at` text,
	`recurring_item_id` integer,
	`original_start` text,
	`cancelled` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "items_exception" CHECK(("__new_items"."recurring_item_id" is null) = ("__new_items"."original_start" is null)),
	CONSTRAINT "items_kind" CHECK("__new_items"."kind" in ('event', 'task')),
	CONSTRAINT "items_when" CHECK(case "__new_items"."kind"
    when 'task' then "__new_items"."due_date" is not null and "__new_items"."starts_at" is null and "__new_items"."start_date" is null
    else ("__new_items"."all_day" and "__new_items"."start_date" is not null and "__new_items"."end_date" is not null)
      or (not "__new_items"."all_day" and "__new_items"."starts_at" is not null and "__new_items"."ends_at" is not null) end)
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit's copy selected the three new columns from the old table, which
-- doesn't have them; they start empty (NULL, NULL, not cancelled).
INSERT INTO `__new_items`("id", "calendar_id", "provider_id", "kind", "title", "all_day", "starts_at", "ends_at", "start_date", "end_date", "due_date", "due_at", "time_zone", "recurrence", "place", "address", "attendees", "reminders", "project", "done_at", "recurring_item_id", "original_start", "cancelled") SELECT "id", "calendar_id", "provider_id", "kind", "title", "all_day", "starts_at", "ends_at", "start_date", "end_date", "due_date", "due_at", "time_zone", "recurrence", "place", "address", "attendees", "reminders", "project", "done_at", NULL, NULL, 0 FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `items_calendar_provider` ON `items` (`calendar_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `items_starts` ON `items` (`starts_at`);--> statement-breakpoint
CREATE INDEX `items_due` ON `items` (`due_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_occurrence` ON `items` (`recurring_item_id`,`original_start`);--> statement-breakpoint
ALTER TABLE `messages` ADD `opened_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `trashed_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `sender_authenticated` integer;
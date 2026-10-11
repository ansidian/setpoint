PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "secrets_name" CHECK("__new_secrets"."name" in ('anthropic_api_key', 'openai_api_key', 'places_api_key', 'ntfy_token', 'airnow_api_key'))
);
--> statement-breakpoint
INSERT INTO `__new_secrets`("name", "ciphertext", "updated_at") SELECT "name", "ciphertext", "updated_at" FROM `secrets`;--> statement-breakpoint
DROP TABLE `secrets`;--> statement-breakpoint
ALTER TABLE `__new_secrets` RENAME TO `secrets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
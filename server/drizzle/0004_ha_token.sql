CREATE TABLE `ha_token` (
	`id` integer PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "ha_token_singleton" CHECK("ha_token"."id" = 1)
);

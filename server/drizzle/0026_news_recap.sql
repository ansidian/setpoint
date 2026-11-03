CREATE TABLE `news_recap` (
	`id` integer PRIMARY KEY NOT NULL,
	`put_away_at` text,
	`shown_at` text,
	`story_ids` text,
	`here_at` text,
	CONSTRAINT "news_recap_singleton" CHECK("news_recap"."id" = 1)
);

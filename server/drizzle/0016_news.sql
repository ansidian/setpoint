CREATE TABLE `news_articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`outlet` text NOT NULL,
	`outlet_short` text,
	`byline` text,
	`headline` text NOT NULL,
	`feed_summary` text,
	`extracted_text` text,
	`summary_only` integer DEFAULT false NOT NULL,
	`metered` integer DEFAULT false NOT NULL,
	`discovery` integer DEFAULT false NOT NULL,
	`published_at` text NOT NULL,
	`image_url` text,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `news_sources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "news_articles_readable" CHECK(not ("news_articles"."discovery" and "news_articles"."extracted_text" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_articles_canonical` ON `news_articles` (`source_id`,`canonical_url`);--> statement-breakpoint
CREATE INDEX `news_articles_fetched` ON `news_articles` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `news_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` integer NOT NULL,
	`section` text NOT NULL,
	`name` text NOT NULL,
	`starts_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `news_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "news_events_section" CHECK("news_events"."section" in ('local', 'tech', 'ai', 'general'))
);
--> statement-breakpoint
CREATE INDEX `news_events_starts` ON `news_events` (`starts_at`);--> statement-breakpoint
CREATE TABLE `news_facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` integer NOT NULL,
	`at` text NOT NULL,
	`text` text NOT NULL,
	`article_id` integer,
	FOREIGN KEY (`story_id`) REFERENCES `news_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `news_articles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `news_facts_story` ON `news_facts` (`story_id`,`at`);--> statement-breakpoint
CREATE TABLE `news_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` integer NOT NULL,
	`variant` text NOT NULL,
	`file` text NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `news_articles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "news_images_variant" CHECK("news_images"."variant" in ('large', 'thumb')),
	CONSTRAINT "news_images_size" CHECK("news_images"."width" > 0 and "news_images"."height" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_images_file_unique` ON `news_images` (`file`);--> statement-breakpoint
CREATE UNIQUE INDEX `news_images_article` ON `news_images` (`article_id`,`variant`);--> statement-breakpoint
CREATE TABLE `news_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`section` text NOT NULL,
	`kind` text NOT NULL,
	`adapter` text NOT NULL,
	`url` text,
	`reads` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`origin` text NOT NULL,
	`dev` integer DEFAULT false NOT NULL,
	`summary_only` integer DEFAULT false NOT NULL,
	`metered` integer DEFAULT false NOT NULL,
	`interval_seconds` integer NOT NULL,
	`position` integer NOT NULL,
	`cursor` text,
	`last_check_at` text,
	`last_success_at` text,
	`last_error_at` text,
	`last_error` text,
	`failing_since` text,
	`retired_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "news_sources_section" CHECK("news_sources"."section" in ('local', 'tech', 'ai', 'general')),
	CONSTRAINT "news_sources_kind" CHECK("news_sources"."kind" in ('feed', 'official_api', 'page_read', 'discovery')),
	CONSTRAINT "news_sources_adapter" CHECK("news_sources"."adapter" in ('feed', 'nws', 'usgs', 'cal_fire', 'airnow', 'hn_algolia', 'page_read', 'google_news')),
	CONSTRAINT "news_sources_origin" CHECK("news_sources"."origin" in ('default', 'local')),
	CONSTRAINT "news_sources_interval" CHECK("news_sources"."interval_seconds" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_sources_key_unique` ON `news_sources` (`key`);--> statement-breakpoint
CREATE TABLE `news_stories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`headline` text NOT NULL,
	`one_line` text,
	`summary` text,
	`score` integer DEFAULT 0 NOT NULL,
	`lead_article_id` integer,
	`image_article_id` integer,
	`first_reported_at` text NOT NULL,
	`last_new_fact_at` text NOT NULL,
	`seen_at` text,
	`expired_at` text,
	`expired_unseen` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lead_article_id`) REFERENCES `news_articles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_article_id`) REFERENCES `news_articles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "news_stories_unseen" CHECK(not "news_stories"."expired_unseen" or "news_stories"."expired_at" is not null)
);
--> statement-breakpoint
CREATE INDEX `news_stories_live` ON `news_stories` (`expired_at`,`score`);--> statement-breakpoint
CREATE INDEX `news_stories_fact` ON `news_stories` (`last_new_fact_at`);--> statement-breakpoint
CREATE TABLE `news_story_articles` (
	`story_id` integer NOT NULL,
	`article_id` integer NOT NULL,
	`linked_at` text NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `news_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `news_articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_story_articles_article_id_unique` ON `news_story_articles` (`article_id`);--> statement-breakpoint
CREATE INDEX `news_story_articles_story` ON `news_story_articles` (`story_id`);--> statement-breakpoint
CREATE TABLE `news_story_sections` (
	`story_id` integer NOT NULL,
	`section` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `news_stories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "news_story_sections_section" CHECK("news_story_sections"."section" in ('local', 'tech', 'ai', 'general'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_story_sections_key` ON `news_story_sections` (`story_id`,`section`);--> statement-breakpoint
CREATE INDEX `news_story_sections_section` ON `news_story_sections` (`section`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`source_id` integer,
	`command_id` integer,
	`message_id` integer,
	`news_source_id` integer,
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
	FOREIGN KEY (`news_source_id`) REFERENCES `news_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_kind" CHECK("__new_jobs"."kind" in ('sync', 'sweep', 'push', 'command', 'triage', 'extract', 'news')),
	CONSTRAINT "jobs_state" CHECK("__new_jobs"."state" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "kind", "key", "source_id", "command_id", "message_id", "news_source_id", "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at") SELECT "id", "kind", "key", "source_id", "command_id", "message_id", NULL, "state", "attempts", "run_at", "lease_until", "last_error", "created_at", "finished_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_key` ON `jobs` (`key`) WHERE "jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX `jobs_due` ON `jobs` (`state`,`run_at`);
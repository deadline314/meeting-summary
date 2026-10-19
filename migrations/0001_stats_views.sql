CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_views_user` ON `saved_views` (`user_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `stale_days` integer DEFAULT 7 NOT NULL;
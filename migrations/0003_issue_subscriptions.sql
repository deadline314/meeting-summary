CREATE TABLE `issue_subscriptions` (
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`issue_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `issue_subscriptions_user` ON `issue_subscriptions` (`user_id`);--> statement-breakpoint
-- Existing issues: creators and assignees start subscribed, matching new issues.
INSERT OR IGNORE INTO `issue_subscriptions` (`issue_id`, `user_id`) SELECT `id`, `created_by` FROM `issues`;--> statement-breakpoint
INSERT OR IGNORE INTO `issue_subscriptions` (`issue_id`, `user_id`) SELECT `issue_id`, `user_id` FROM `issue_assignees`;

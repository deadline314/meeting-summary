ALTER TABLE `notifications` ADD `email_at` integer;--> statement-breakpoint
CREATE INDEX `notifications_created` ON `notifications` (`created_at`);
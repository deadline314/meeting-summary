CREATE TABLE `issue_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`owner_id` text,
	`project_id` text,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `issue_templates_owner` ON `issue_templates` (`owner_id`);--> statement-breakpoint
CREATE INDEX `issue_templates_project` ON `issue_templates` (`project_id`);
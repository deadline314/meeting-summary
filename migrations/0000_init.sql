CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`project_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activities_entity` ON `activities` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activities_actor` ON `activities` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activities_created` ON `activities` (`created_at`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`scope` text NOT NULL,
	`project_ids` text,
	`expires_at` integer,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`kind` text NOT NULL,
	`parent_type` text NOT NULL,
	`parent_id` text NOT NULL,
	`drive_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `files_parent` ON `files` (`parent_type`,`parent_id`);--> statement-breakpoint
CREATE INDEX `files_owner` ON `files` (`owner_id`);--> statement-breakpoint
CREATE TABLE `idempotency` (
	`key` text PRIMARY KEY NOT NULL,
	`response` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issue_assignees` (
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`issue_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `issue_assignees_user` ON `issue_assignees` (`user_id`);--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`parent_id` text,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `issue_comments_issue` ON `issue_comments` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `issue_labels` (
	`issue_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`issue_id`, `label_id`)
);
--> statement-breakpoint
CREATE INDEX `issue_labels_label` ON `issue_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `issue_relations` (
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`from_id`, `to_id`, `type`)
);
--> statement-breakpoint
CREATE INDEX `issue_relations_to` ON `issue_relations` (`to_id`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`sort_order` real NOT NULL,
	`parent_id` text,
	`due_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`status_changed_at` integer NOT NULL,
	`completed_at` integer,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_number` ON `issues` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `issues_status` ON `issues` (`project_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `issues_parent` ON `issues` (`parent_id`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_name` ON `labels` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `note_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`parent_id` text,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`anchor` text,
	`quote` text,
	`resolved_at` integer,
	`resolved_by` text,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `note_comments_note` ON `note_comments` (`note_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `note_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`author_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`inserted` integer NOT NULL,
	`deleted` integer NOT NULL,
	`content` text NOT NULL,
	`restored_from` text
);
--> statement-breakpoint
CREATE INDEX `note_versions_note` ON `note_versions` (`note_id`,`ended_at`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`location` text DEFAULT '' NOT NULL,
	`recorder_id` text NOT NULL,
	`attendee_ids` text DEFAULT '[]' NOT NULL,
	`absentees` text DEFAULT '[]' NOT NULL,
	`project_id` text,
	`visibility` text DEFAULT 'site' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_starts` ON `notes` (`starts_at`);--> statement-breakpoint
CREATE INDEX `notes_project` ON `notes` (`project_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`actor_id` text,
	`type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_user` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `project_members_user` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`parent_id` text,
	`reviewer_id` text,
	`target_date` integer,
	`state` text DEFAULT 'active' NOT NULL,
	`hidden_from_admins` integer DEFAULT false NOT NULL,
	`issue_seq` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_key` ON `projects` (`key`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `references` (
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`source_type`, `source_id`, `target_type`, `target_id`)
);
--> statement-breakpoint
CREATE INDEX `references_target` ON `references` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`file_id` text NOT NULL,
	`is_trial` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`score` real,
	`message` text,
	`details` text,
	`log` text,
	`run_id` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `submissions_task_user` ON `submissions` (`task_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `submissions_status` ON `submissions` (`status`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`opens_at` integer,
	`due_at` integer,
	`project_id` text,
	`submit_kind` text DEFAULT 'file' NOT NULL,
	`accept` text DEFAULT '' NOT NULL,
	`max_bytes` integer DEFAULT 10485760 NOT NULL,
	`daily_limit` integer DEFAULT 10 NOT NULL,
	`leaderboard` integer DEFAULT true NOT NULL,
	`higher_is_better` integer DEFAULT true NOT NULL,
	`grader_file_id` text,
	`data_file_id` text,
	`image` text DEFAULT 'python:3.12-slim' NOT NULL,
	`requirements` text DEFAULT '' NOT NULL,
	`timeout_sec` integer DEFAULT 300 NOT NULL,
	`memory_mb` integer DEFAULT 2048 NOT NULL,
	`trial_passed_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`google_sub` text,
	`name` text NOT NULL,
	`google_name` text NOT NULL,
	`avatar_url` text,
	`role` text DEFAULT 'student' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`prefs` text DEFAULT '{}' NOT NULL,
	`onboarded_at` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub` ON `users` (`google_sub`);
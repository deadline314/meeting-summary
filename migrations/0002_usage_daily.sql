CREATE TABLE `usage_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL
);

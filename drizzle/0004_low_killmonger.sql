CREATE TABLE `waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`company` text,
	`role` text,
	`company_size` text,
	`interest` text,
	`hear_about` text,
	`phone` text,
	`ip_hash` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_email_idx` ON `waitlist` (`email`);--> statement-breakpoint
CREATE INDEX `waitlist_ip_created_idx` ON `waitlist` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `waitlist_created_idx` ON `waitlist` (`created_at`);
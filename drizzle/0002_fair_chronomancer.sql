CREATE TABLE `login_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`user_id` text,
	`success` integer NOT NULL,
	`reason` text,
	`status` integer,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `login_audit_created_idx` ON `login_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `login_audit_email_created_idx` ON `login_audit` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_audit_ip_created_idx` ON `login_audit` (`ip_address`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_audit_user_idx` ON `login_audit` (`user_id`);
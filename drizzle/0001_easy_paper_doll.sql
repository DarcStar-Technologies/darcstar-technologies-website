ALTER TABLE `contact_submission` ADD `user_id` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `contact_user_idx` ON `contact_submission` (`user_id`);
ALTER TABLE `waitlist` ADD `country_region` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `consent_updates` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `primary_application` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `evaluation_timeline` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `current_approach` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `economic_impact` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `budget_range` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `adoption_evidence` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `pilot_interest` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `deployment_scale` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `contact_permission` integer;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `contact_method` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `research_preferences` text;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `qualification_step` integer;
CREATE TABLE `waitlist_funnel_event` (
	`flow_id` text NOT NULL,
	`event` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`flow_id`, `event`)
);
--> statement-breakpoint
CREATE INDEX `waitlist_funnel_event_idx` ON `waitlist_funnel_event` (`event`);
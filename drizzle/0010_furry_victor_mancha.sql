-- DAR-88: split the collapsed `waitlist` row into an append-only submission log plus a collated lead.
--
-- HAND-ORDERED. drizzle-kit generates this as create-create-DROP (it has no way to know the two new
-- tables are fed by the old one), which would take the existing signups with it. The two INSERT …
-- SELECT statements below are inserted before the drop; everything else is exactly as generated, and
-- drizzle/meta/0010_snapshot.json is untouched, so `pnpm db:generate` still produces no diff and the
-- `migrations in sync` CI check stays meaningful.
--
-- Today's rows are ALREADY one-per-email (the `lower(email)` unique index on `waitlist` enforced it),
-- so the backfill is 1:1 and needs no grouping or conflict resolution: each existing row becomes one
-- lead, pre-merged, and one submission under it. If that invariant were somehow false, the unique
-- index on `waitlist_lead` makes the first INSERT fail — loudly, and BEFORE the DROP, which under the
-- migrate-before-deploy Action means the deploy is blocked rather than data being silently merged.
CREATE TABLE `waitlist_lead` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`invited_at` integer,
	`invited_by` text,
	`activated_at` integer,
	`reviewed_at` integer,
	`reviewed_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_lead_email_idx` ON `waitlist_lead` (lower("email"));--> statement-breakpoint
CREATE INDEX `waitlist_lead_created_idx` ON `waitlist_lead` (`created_at`);--> statement-breakpoint
CREATE TABLE `waitlist_submission` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`company` text,
	`role` text,
	`company_size` text,
	`interest` text,
	`hear_about` text,
	`phone` text,
	`country_region` text,
	`consent_updates` integer DEFAULT false NOT NULL,
	`consent_updates_at` integer,
	`primary_application` text,
	`evaluation_timeline` text,
	`current_approach` text,
	`economic_impact` text,
	`budget_range` text,
	`adoption_evidence` text,
	`pilot_interest` text,
	`deployment_scale` text,
	`contact_permission` integer,
	`contact_method` text,
	`research_preferences` text,
	`qualification_step` integer,
	`step_write_count` integer,
	`step_write_window_at` integer,
	`ip_hash` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `waitlist_lead`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `waitlist_submission_lead_created_idx` ON `waitlist_submission` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `waitlist_submission_ip_created_idx` ON `waitlist_submission` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `waitlist_submission_created_idx` ON `waitlist_submission` (`created_at`);--> statement-breakpoint
CREATE INDEX `waitlist_submission_interest_idx` ON `waitlist_submission` (`interest`);--> statement-breakpoint
-- One lead per existing signup, carrying DAR-67's invite state (which describes the PERSON, so it
-- moves here) and the original `created_at` (when we first heard from them, not when this migration
-- ran). `reviewed_at` stays null: no human has reconciled anything yet, which is the truth.
--
-- The id is a fresh v4 UUID built from randomblob(), matching the shape crypto.randomUUID() writes at
-- runtime so the column holds one format forever. It is NOT reused from the signup row, because that
-- id stays with the SUBMISSION below — live continuation tokens embed it, and reassigning it would
-- silently point them at the wrong table.
INSERT INTO `waitlist_lead` (`id`, `email`, `invited_at`, `invited_by`, `activated_at`, `created_at`)
SELECT
	lower(
		substr(hex(randomblob(4)), 1, 8) || '-' ||
		substr(hex(randomblob(2)), 1, 4) || '-4' ||
		substr(hex(randomblob(2)), 2, 3) || '-' ||
		substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
		substr(hex(randomblob(6)), 1, 12)
	),
	lower(`email`),
	`invited_at`,
	`invited_by`,
	`activated_at`,
	`created_at`
FROM `waitlist`;--> statement-breakpoint
-- Each existing row becomes the lead's FIRST submission, keeping its own id (see above), its answers,
-- its provenance (ip_hash / user_agent), its step-write budget counters and both timestamps. The join
-- is on the lead's already-lowercased email against lower(the row's), so a legacy mixed-case value
-- still finds its lead.
INSERT INTO `waitlist_submission` (
	`id`, `lead_id`, `email`, `name`, `company`, `role`, `company_size`, `interest`, `hear_about`,
	`phone`, `country_region`, `consent_updates`, `consent_updates_at`, `primary_application`,
	`evaluation_timeline`, `current_approach`, `economic_impact`, `budget_range`, `adoption_evidence`,
	`pilot_interest`, `deployment_scale`, `contact_permission`, `contact_method`,
	`research_preferences`, `qualification_step`, `step_write_count`, `step_write_window_at`,
	`ip_hash`, `user_agent`, `created_at`, `updated_at`
)
SELECT
	w.`id`, l.`id`, w.`email`, w.`name`, w.`company`, w.`role`, w.`company_size`, w.`interest`,
	w.`hear_about`, w.`phone`, w.`country_region`, w.`consent_updates`, w.`consent_updates_at`,
	w.`primary_application`, w.`evaluation_timeline`, w.`current_approach`, w.`economic_impact`,
	w.`budget_range`, w.`adoption_evidence`, w.`pilot_interest`, w.`deployment_scale`,
	w.`contact_permission`, w.`contact_method`, w.`research_preferences`, w.`qualification_step`,
	w.`step_write_count`, w.`step_write_window_at`, w.`ip_hash`, w.`user_agent`, w.`created_at`,
	w.`updated_at`
FROM `waitlist` w
JOIN `waitlist_lead` l ON l.`email` = lower(w.`email`);--> statement-breakpoint
DROP TABLE `waitlist`;

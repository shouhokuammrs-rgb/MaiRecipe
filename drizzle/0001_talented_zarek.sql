CREATE TABLE `import_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`url` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_reports_url_uq` ON `import_reports` (`group_id`,`url`);
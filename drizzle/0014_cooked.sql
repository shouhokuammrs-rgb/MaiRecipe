CREATE TABLE `cook_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`version_id` text,
	`version_seq` integer,
	`servings` integer NOT NULL,
	`cooked_on` text NOT NULL,
	`cooked_by` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cooked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cook_logs_recipe_idx` ON `cook_logs` (`recipe_id`,`cooked_on`);--> statement-breakpoint
CREATE INDEX `cook_logs_group_idx` ON `cook_logs` (`group_id`,`cooked_on`);--> statement-breakpoint
CREATE TABLE `cook_ratings` (
	`cook_log_id` text NOT NULL,
	`user_id` text NOT NULL,
	`rating` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`cook_log_id`, `user_id`),
	FOREIGN KEY (`cook_log_id`) REFERENCES `cook_logs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meal_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`cook_log_id` text,
	`title` text NOT NULL,
	`portion` real DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cook_log_id`) REFERENCES `cook_logs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meal_logs_user_idx` ON `meal_logs` (`user_id`,`date`);
CREATE TABLE `pantry_zone_prefs` (
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`zone` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`group_id`, `name`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);

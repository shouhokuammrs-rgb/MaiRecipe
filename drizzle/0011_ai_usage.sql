CREATE TABLE `ai_usage` (
	`day` text NOT NULL,
	`key` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `key`)
);

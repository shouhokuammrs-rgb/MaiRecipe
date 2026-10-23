ALTER TABLE `groups` ADD `servings` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `recipe_versions` ADD `servings` integer;
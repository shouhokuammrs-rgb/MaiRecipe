DROP INDEX `meal_plans_slot_uq`;--> statement-breakpoint
ALTER TABLE `meal_plans` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `meal_plans_item_uq` ON `meal_plans` (`group_id`,`date`,`meal`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `meal_plans_slot_idx` ON `meal_plans` (`group_id`,`date`,`meal`);
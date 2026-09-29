CREATE TABLE `pantry_items` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`amount` text,
	`expires_on` text,
	`added_on` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_items_name_uq` ON `pantry_items` (`group_id`,`name`);
--> statement-breakpoint
-- #38: 「家にある」「買った」が付いていた食材を冷蔵庫へ移す（入れた日は移行した日、JST）
INSERT INTO `pantry_items` (`id`, `group_id`, `name`, `added_on`)
SELECT lower(hex(randomblob(16))), `group_id`, `name`, date('now', '+9 hours')
FROM (
  SELECT DISTINCT `group_id`,
    CASE WHEN instr(`key`, '|') > 0 THEN substr(`key`, 1, instr(`key`, '|') - 1) ELSE `key` END AS `name`
  FROM `shopping_marks`
  WHERE `value` = 1
)
WHERE `name` <> '';--> statement-breakpoint
-- 「家にない」でも「買った」が付いていたら、今は家にある
DELETE FROM `shopping_marks`
WHERE `kind` = 'home' AND `value` = 0 AND EXISTS (
  SELECT 1 FROM `shopping_marks` b
  WHERE b.`group_id` = `shopping_marks`.`group_id` AND b.`key` = `shopping_marks`.`key`
    AND b.`kind` = 'bought' AND b.`value` = 1
);--> statement-breakpoint
DELETE FROM `shopping_marks` WHERE `value` = 1 OR `kind` = 'bought';--> statement-breakpoint
-- 残った「家にない」印のキーを「名前|単位」から「名前」にする（単位違いは1つにまとまる）
INSERT OR IGNORE INTO `shopping_marks` (`group_id`, `key`, `kind`, `value`, `updated_at`)
SELECT `group_id`, substr(`key`, 1, instr(`key`, '|') - 1), 'home', 0, `updated_at`
FROM `shopping_marks`
WHERE instr(`key`, '|') > 1;--> statement-breakpoint
DELETE FROM `shopping_marks` WHERE instr(`key`, '|') > 0;
-- DEC-020：カテゴリの「丼」を「主食」（ご飯・麺・パン）にまとめる。消す行は無い（件数は変わらない）
UPDATE `recipes` SET `category` = '主食' WHERE `category` = '丼';--> statement-breakpoint
UPDATE `recipe_versions` SET `category` = '主食' WHERE `category` = '丼';

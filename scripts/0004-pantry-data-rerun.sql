-- #38 本番用：0004 の移行からデプロイまでの間に古い画面が書いた印を、デプロイ直後に拾い直す。
-- 0004 のデータ部分と同じ。冷蔵庫にすでにある名前は飛ばす（INSERT OR IGNORE）。何度流しても安全。
-- #38: 「家にある」「買った」が付いていた食材を冷蔵庫へ移す（入れた日は移行した日、JST）
INSERT OR IGNORE INTO `pantry_items` (`id`, `group_id`, `name`, `added_on`)
SELECT lower(hex(randomblob(16))), `group_id`, `name`, date('now', '+9 hours')
FROM (
  SELECT DISTINCT `group_id`,
    CASE WHEN instr(`key`, '|') > 0 THEN substr(`key`, 1, instr(`key`, '|') - 1) ELSE `key` END AS `name`
  FROM `shopping_marks`
  WHERE `value` = 1
)
WHERE `name` <> '';
-- 「家にない」でも「買った」が付いていたら、今は家にある
DELETE FROM `shopping_marks`
WHERE `kind` = 'home' AND `value` = 0 AND EXISTS (
  SELECT 1 FROM `shopping_marks` b
  WHERE b.`group_id` = `shopping_marks`.`group_id` AND b.`key` = `shopping_marks`.`key`
    AND b.`kind` = 'bought' AND b.`value` = 1
);
DELETE FROM `shopping_marks` WHERE `value` = 1 OR `kind` = 'bought';
-- 残った「家にない」印のキーを「名前|単位」から「名前」にする（単位違いは1つにまとまる）
INSERT OR IGNORE INTO `shopping_marks` (`group_id`, `key`, `kind`, `value`, `updated_at`)
SELECT `group_id`, substr(`key`, 1, instr(`key`, '|') - 1), 'home', 0, `updated_at`
FROM `shopping_marks`
WHERE instr(`key`, '|') > 1;
DELETE FROM `shopping_marks` WHERE instr(`key`, '|') > 0;
ALTER TABLE `import_jobs` ADD `recipe_id` text REFERENCES recipes(id) ON DELETE cascade;

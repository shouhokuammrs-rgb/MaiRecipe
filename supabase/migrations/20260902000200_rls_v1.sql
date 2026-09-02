-- ============================================================
-- MaiRecipe RLS v1 (M0-5)
--  方針: group_members に自分が含まれる group_id の行だけ全操作可
--  ヘルパー is_group_member(group_id) は security definer で
--  group_members 自身の RLS を迂回する（ポリシーの再帰を防ぐ）
-- ============================================================

-- ------------------------------------------------------------
-- ヘルパー関数
-- ------------------------------------------------------------
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
  );
$$;

-- レシピ配下（材料/手順/タグ）用: レシピの所属グループのメンバーか
create or replace function public.is_recipe_member(p_recipe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.recipes r
    join public.group_members gm on gm.group_id = r.group_id
    where r.id = p_recipe_id
      and gm.user_id = auth.uid()
  );
$$;

-- 買い物リスト配下用: リストの所属グループのメンバーか
create or replace function public.is_shopping_list_member(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shopping_lists l
    join public.group_members gm on gm.group_id = l.group_id
    where l.id = p_list_id
      and gm.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.is_recipe_member(uuid) from public, anon;
revoke execute on function public.is_shopping_list_member(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated, service_role;
grant execute on function public.is_recipe_member(uuid) to authenticated, service_role;
grant execute on function public.is_shopping_list_member(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- RLS 有効化（全テーブル）
-- ------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.groups             enable row level security;
alter table public.group_members      enable row level security;
alter table public.recipes            enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps       enable row level security;
alter table public.recipe_tags        enable row level security;
alter table public.meal_plans         enable row level security;
alter table public.shopping_lists     enable row level security;
alter table public.shopping_items     enable row level security;

-- ------------------------------------------------------------
-- profiles: 本人のみ参照/更新（作成はサインアップトリガー）
-- ------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ------------------------------------------------------------
-- groups / group_members: メンバーは参照可。グループ作成は
-- サインアップトリガー、招待/脱退は M4 で追加する
-- ------------------------------------------------------------
create policy "groups_select_member" on public.groups
  for select to authenticated
  using (public.is_group_member(id));

create policy "groups_update_member" on public.groups
  for update to authenticated
  using (public.is_group_member(id))
  with check (public.is_group_member(id));

create policy "group_members_select_member" on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));

-- ------------------------------------------------------------
-- recipes
-- ------------------------------------------------------------
create policy "recipes_all_member" on public.recipes
  for all to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

-- ------------------------------------------------------------
-- recipe_ingredients / recipe_steps / recipe_tags
-- ------------------------------------------------------------
create policy "recipe_ingredients_all_member" on public.recipe_ingredients
  for all to authenticated
  using (public.is_recipe_member(recipe_id))
  with check (public.is_recipe_member(recipe_id));

create policy "recipe_steps_all_member" on public.recipe_steps
  for all to authenticated
  using (public.is_recipe_member(recipe_id))
  with check (public.is_recipe_member(recipe_id));

create policy "recipe_tags_all_member" on public.recipe_tags
  for all to authenticated
  using (public.is_recipe_member(recipe_id))
  with check (public.is_recipe_member(recipe_id));

-- ------------------------------------------------------------
-- meal_plans
-- ------------------------------------------------------------
create policy "meal_plans_all_member" on public.meal_plans
  for all to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id) and public.is_recipe_member(recipe_id));

-- ------------------------------------------------------------
-- shopping_lists / shopping_items
-- ------------------------------------------------------------
create policy "shopping_lists_all_member" on public.shopping_lists
  for all to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy "shopping_items_all_member" on public.shopping_items
  for all to authenticated
  using (public.is_shopping_list_member(list_id))
  with check (public.is_shopping_list_member(list_id));

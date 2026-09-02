-- ============================================================
-- MaiRecipe schema v1 (M0-5)
--  - 全テーブル uuid PK / created_at / updated_at(トリガー更新)
--  - ユーザー所有物は group_id で持つ（個人利用時は1人グループ）
--  - サインアップ時に profiles + 個人用 groups + group_members(owner) を自動作成
-- ============================================================

-- ------------------------------------------------------------
-- 共通: updated_at 自動更新トリガー関数
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- profiles: auth.users 1:1
-- ------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- groups: データの所有単位（個人利用時は1人グループ）
-- ------------------------------------------------------------
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default '',
  plan       text not null default 'free' check (plan in ('free', 'premium', 'pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_groups_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- group_members
-- ------------------------------------------------------------
create table public.group_members (
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_id_idx on public.group_members (user_id);

create trigger set_group_members_updated_at
  before update on public.group_members
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- recipes
-- ------------------------------------------------------------
create table public.recipes (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  title       text not null,
  source_url  text,
  source_type text not null default 'manual' check (source_type in ('web', 'photo', 'manual')),
  image_path  text,
  servings    integer check (servings is null or servings > 0),
  memo        text,
  category    text,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index recipes_group_id_idx on public.recipes (group_id);
create index recipes_group_id_updated_at_idx on public.recipes (group_id, updated_at desc);

create trigger set_recipes_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- recipe_ingredients
-- ------------------------------------------------------------
create table public.recipe_ingredients (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  name       text not null,
  amount     text,
  unit       text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id, sort_order);

create trigger set_recipe_ingredients_updated_at
  before update on public.recipe_ingredients
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- recipe_steps
-- ------------------------------------------------------------
create table public.recipe_steps (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  body       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipe_steps_recipe_id_idx on public.recipe_steps (recipe_id, sort_order);

create trigger set_recipe_steps_updated_at
  before update on public.recipe_steps
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- recipe_tags
-- ------------------------------------------------------------
create table public.recipe_tags (
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  tag        text not null check (length(trim(tag)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (recipe_id, tag)
);

create index recipe_tags_tag_idx on public.recipe_tags (tag);

create trigger set_recipe_tags_updated_at
  before update on public.recipe_tags
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- meal_plans: 日付 × 枠 にレシピを紐付け
-- ------------------------------------------------------------
create table public.meal_plans (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  date       date not null,
  slot       text not null check (slot in ('breakfast', 'lunch', 'dinner', 'other')),
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meal_plans_group_id_date_idx on public.meal_plans (group_id, date);

create trigger set_meal_plans_updated_at
  before update on public.meal_plans
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- shopping_lists
-- ------------------------------------------------------------
create table public.shopping_lists (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  name       text not null default '買い物リスト',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shopping_lists_group_id_idx on public.shopping_lists (group_id);

create trigger set_shopping_lists_updated_at
  before update on public.shopping_lists
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- shopping_items
-- ------------------------------------------------------------
create table public.shopping_items (
  id               uuid primary key default gen_random_uuid(),
  list_id          uuid not null references public.shopping_lists (id) on delete cascade,
  name             text not null,
  amount           text,
  checked          boolean not null default false,
  source_recipe_id uuid references public.recipes (id) on delete set null,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index shopping_items_list_id_idx on public.shopping_items (list_id, sort_order);

create trigger set_shopping_items_updated_at
  before update on public.shopping_items
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- サインアップ時トリガー: profiles + 個人用 groups + group_members(owner)
--   display_name は signUp 時の options.data.display_name → メールのローカル部 の順で採用
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
  v_group_id     uuid;
begin
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'ユーザー'
  );

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name);

  insert into public.groups (name)
  values (v_display_name || 'のグループ')
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

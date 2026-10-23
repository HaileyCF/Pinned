create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 200),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index tasks_user_id_idx on public.tasks (user_id);

alter table public.tasks enable row level security;

create policy "Read own tasks"   on public.tasks for select to authenticated using (auth.uid() = user_id);
create policy "Insert own tasks" on public.tasks for insert to authenticated with check (auth.uid() = user_id);
create policy "Update own tasks" on public.tasks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own tasks" on public.tasks for delete to authenticated using (auth.uid() = user_id);

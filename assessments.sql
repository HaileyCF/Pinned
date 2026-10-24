create table public.assessments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index assessments_user_id_idx on public.assessments (user_id);

alter table public.assessments enable row level security;

create policy "Own assessments: select" on public.assessments for select to authenticated using (auth.uid() = user_id);
create policy "Own assessments: insert" on public.assessments for insert to authenticated with check (auth.uid() = user_id);
create policy "Own assessments: update" on public.assessments for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Own assessments: delete" on public.assessments for delete to authenticated using (auth.uid() = user_id);

-- One isolated workspace (including its branches) per authenticated owner.
create table public.shop_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and jsonb_typeof(payload->'stores') = 'array' and jsonb_typeof(payload->'storeData') = 'object'),
  revision bigint not null default 1 check (revision > 0),
  write_id uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.shop_workspaces enable row level security;
revoke all on public.shop_workspaces from anon, authenticated;
grant select, insert, update on public.shop_workspaces to authenticated;
create policy workspace_select on public.shop_workspaces for select to authenticated using ((select auth.uid()) = user_id);
create policy workspace_insert on public.shop_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy workspace_update on public.shop_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Atomic compare-and-swap and idempotent retries prevent stale devices overwriting data.
create function public.save_shop_workspace(expected_revision bigint, new_payload jsonb, request_id uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare current_row public.shop_workspaces; result_revision bigint; caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if request_id is null or expected_revision < 0 then raise exception 'Invalid save request'; end if;
  if pg_column_size(new_payload) > 10485760 then raise exception 'Workspace exceeds 10 MB. Export and archive older records.'; end if;
  if expected_revision = 0 then
    insert into public.shop_workspaces(user_id, payload, write_id)
      values(caller, new_payload, request_id) on conflict(user_id) do nothing;
  end if;
  select * into current_row from public.shop_workspaces where user_id = caller for update;
  if current_row.write_id = request_id then return current_row.revision; end if;
  if current_row.user_id is null or current_row.revision <> expected_revision then
    raise exception 'Workspace changed on another device. Reload before saving.' using errcode = '40001';
  end if;
  update public.shop_workspaces set payload = new_payload, revision = revision + 1, write_id = request_id, updated_at = now()
    where user_id = caller returning revision into result_revision;
  return result_revision;
end;
$$;
revoke all on function public.save_shop_workspace(bigint,jsonb,uuid) from public, anon;
grant execute on function public.save_shop_workspace(bigint,jsonb,uuid) to authenticated;

-- Authentication foundation for RankHarbour.
-- Supabase Auth owns credentials and sessions in auth.users. Application data
-- lives in public and is protected with explicit grants plus RLS policies.

create type public.app_role as enum ('client', 'staff', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  avatar_url text check (char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

comment on table public.profiles is
  'Non-sensitive application profile data for Supabase Auth users.';
comment on table public.user_roles is
  'Server-controlled application roles. Never derive roles from user metadata.';

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

-- SECURITY DEFINER prevents recursive RLS checks when policies test roles.
create function public.has_role(requested_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = requested_role
  );
$$;

revoke all on function public.has_role(public.app_role) from public;
grant execute on function public.has_role(public.app_role) to authenticated;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- This function only copies presentation data from signup metadata. A role is
-- always assigned by trusted SQL, never from raw_user_meta_data.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name'), 100),
    left(new.raw_user_meta_data ->> 'avatar_url', 2048)
  );

  insert into public.user_roles (user_id, role)
  values (new.id, 'client');

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Browser clients receive no access unless explicitly granted here and allowed
-- by a matching policy below.
revoke all on public.profiles from anon, authenticated;
revoke all on public.user_roles from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;

create policy "users can read their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "admins can read all profiles"
on public.profiles for select
to authenticated
using ((select public.has_role('admin')));

create policy "users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "users can read their own roles"
on public.user_roles for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "admins can read all roles"
on public.user_roles for select
to authenticated
using ((select public.has_role('admin')));


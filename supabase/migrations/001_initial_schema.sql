-- Multi-Reader Support Schema
-- Run this in Supabase SQL Editor

-- Stories table (multi-story support)
create table stories (
  id uuid primary key default gen_random_uuid(),
  title varchar(200) not null,
  slug varchar(100) unique not null,
  description text,
  created_at timestamptz default now()
);

-- Users table
create table users (
  id uuid primary key default gen_random_uuid(),
  pin varchar(6) unique not null,
  role varchar(10) not null check (role in ('player', 'reader', 'admin')),
  name varchar(100),
  current_story_id uuid references stories(id),
  created_at timestamptz default now(),
  last_active timestamptz default now()
);

-- Story events (audit trail of all player actions)
create table story_events (
  id serial primary key,
  story_id uuid not null references stories(id),
  node_id varchar(100) not null,
  choice_id varchar(100),
  choice_text text,
  answer text,
  collected_items text[],
  created_at timestamptz default now(),
  created_by uuid references users(id)
);

-- Reader positions (where each reader is in each story)
create table reader_positions (
  user_id uuid references users(id),
  story_id uuid references stories(id),
  history_index int not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, story_id)
);

-- Current story state per story (denormalized for fast reads)
create table story_state (
  story_id uuid primary key references stories(id),
  current_node_id varchar(100) not null,
  collected_items text[] default '{}',
  updated_at timestamptz default now()
);

-- Enable real-time for story_events and story_state
alter publication supabase_realtime add table story_events;
alter publication supabase_realtime add table story_state;

-- Indexes for common queries
create index idx_story_events_story_id on story_events(story_id);
create index idx_users_pin on users(pin);

-- ============================================
-- RPC Functions
-- ============================================

-- Validate PIN and return user + story state
create or replace function auth_with_pin(p_pin varchar(6))
returns json as $$
declare
  v_user users%rowtype;
  v_story stories%rowtype;
  v_state story_state%rowtype;
  v_events json;
  v_position int;
begin
  -- Find user
  select * into v_user from users where pin = p_pin;
  if not found then
    return json_build_object('success', false, 'error', 'Invalid PIN');
  end if;

  -- Update last active
  update users set last_active = now() where id = v_user.id;

  -- Get user's current story
  select * into v_story from stories where id = v_user.current_story_id;

  -- Get story state
  select * into v_state from story_state where story_id = v_story.id;

  -- Get story events for this story
  select json_agg(row_to_json(e) order by e.created_at)
  into v_events
  from story_events e
  where e.story_id = v_story.id;

  -- Get reader position if reader
  if v_user.role = 'reader' then
    select coalesce(history_index, 0) into v_position
    from reader_positions
    where user_id = v_user.id and story_id = v_story.id;
  end if;

  return json_build_object(
    'success', true,
    'user', json_build_object(
      'id', v_user.id,
      'role', v_user.role,
      'name', v_user.name
    ),
    'story', json_build_object(
      'id', v_story.id,
      'title', v_story.title,
      'slug', v_story.slug
    ),
    'state', json_build_object(
      'currentNodeId', v_state.current_node_id,
      'collectedItems', v_state.collected_items
    ),
    'events', coalesce(v_events, '[]'::json),
    'readerPosition', v_position
  );
end;
$$ language plpgsql security definer;

-- Generate a new reader PIN (admin only)
create or replace function generate_reader_pin(p_admin_pin varchar(6), p_name varchar(100), p_story_id uuid)
returns json as $$
declare
  v_admin users%rowtype;
  v_new_pin varchar(6);
  v_new_user users%rowtype;
begin
  -- Verify admin
  select * into v_admin from users where pin = p_admin_pin and role = 'admin';
  if not found then
    return json_build_object('success', false, 'error', 'Unauthorized');
  end if;

  -- Generate unique 6-digit PIN
  loop
    v_new_pin := lpad(floor(random() * 1000000)::text, 6, '0');
    exit when not exists (select 1 from users where pin = v_new_pin);
  end loop;

  -- Create user
  insert into users (pin, role, name, current_story_id)
  values (v_new_pin, 'reader', p_name, p_story_id)
  returning * into v_new_user;

  -- Initialize reader position
  insert into reader_positions (user_id, story_id, history_index)
  values (v_new_user.id, p_story_id, 0);

  return json_build_object(
    'success', true,
    'user', json_build_object(
      'id', v_new_user.id,
      'pin', v_new_user.pin,
      'name', v_new_user.name
    )
  );
end;
$$ language plpgsql security definer;

-- Get all users (admin only)
create or replace function get_all_users(p_admin_pin varchar(6))
returns json as $$
declare
  v_admin users%rowtype;
  v_users json;
begin
  -- Verify admin
  select * into v_admin from users where pin = p_admin_pin and role = 'admin';
  if not found then
    return json_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select json_agg(json_build_object(
    'id', u.id,
    'pin', u.pin,
    'role', u.role,
    'name', u.name,
    'lastActive', u.last_active,
    'createdAt', u.created_at
  ) order by u.created_at)
  into v_users
  from users u;

  return json_build_object(
    'success', true,
    'users', coalesce(v_users, '[]'::json)
  );
end;
$$ language plpgsql security definer;

-- Delete a user (admin only)
create or replace function delete_user(p_admin_pin varchar(6), p_user_id uuid)
returns json as $$
declare
  v_admin users%rowtype;
  v_target users%rowtype;
begin
  -- Verify admin
  select * into v_admin from users where pin = p_admin_pin and role = 'admin';
  if not found then
    return json_build_object('success', false, 'error', 'Unauthorized');
  end if;

  -- Get target user
  select * into v_target from users where id = p_user_id;
  if not found then
    return json_build_object('success', false, 'error', 'User not found');
  end if;

  -- Prevent deleting self or other admins
  if v_target.role = 'admin' then
    return json_build_object('success', false, 'error', 'Cannot delete admin users');
  end if;

  -- Delete reader position first (FK constraint)
  delete from reader_positions where user_id = p_user_id;

  -- Delete user
  delete from users where id = p_user_id;

  return json_build_object('success', true);
end;
$$ language plpgsql security definer;

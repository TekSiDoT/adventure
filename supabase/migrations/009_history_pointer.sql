-- Switch reader progress tracking from array index to event id pointer.
-- - Adds reader_positions.last_seen_event_id (timeline pointer).
-- - Migrates existing history_index -> last_seen_event_id.
-- - Updates RPCs to stop returning full events on auth, and to use the new pointer.

-- ============================================
-- reader_positions schema
-- ============================================

alter table reader_positions
  add column if not exists last_seen_event_id int not null default 0;

-- Migrate existing history_index (0-based) to last_seen_event_id, if the old column exists.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reader_positions'
      and column_name = 'history_index'
  ) then
    update reader_positions rp
    set last_seen_event_id = coalesce(
      (
        select e.id
        from story_events e
        where e.story_id = rp.story_id
        order by e.id asc
        offset rp.history_index
        limit 1
      ),
      0
    )
    where rp.last_seen_event_id = 0;
  end if;
end$$;

-- Drop the old index-based column once migrated.
alter table reader_positions
  drop column if exists history_index;

-- ============================================
-- auth_with_pin: remove full events payload + return reader pointer
-- ============================================

create or replace function auth_with_pin(p_pin varchar(6))
returns json as $$
declare
  v_user users%rowtype;
  v_story stories%rowtype;
  v_state story_state%rowtype;
  v_last_seen_event_id int;
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

  -- Get reader pointer if reader
  if v_user.role = 'reader' then
    select coalesce(last_seen_event_id, 0) into v_last_seen_event_id
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
    'readerLastSeenEventId', v_last_seen_event_id
  );
end;
$$ language plpgsql security definer;

-- ============================================
-- generate_reader_pin: initialize reader pointer row
-- ============================================

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
  insert into reader_positions (user_id, story_id, last_seen_event_id)
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

-- ============================================
-- update_reader_position RPC: now stores last_seen_event_id
-- (kept for compatibility and admin tooling)
-- ============================================

drop function if exists update_reader_position(varchar(6), uuid, int);

create or replace function update_reader_position(
  p_pin varchar(6),
  p_story_id uuid,
  -- Kept parameter name for backwards compatibility with older callers.
  -- Semantics: this is the last seen story_events.id.
  p_history_index int
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user users%rowtype;
begin
  select * into v_user from users where pin = p_pin;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN');
  end if;

  if v_user.role <> 'reader' and v_user.role <> 'admin' then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_user.role <> 'admin' and v_user.current_story_id is distinct from p_story_id then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  insert into reader_positions (user_id, story_id, last_seen_event_id, updated_at)
  values (v_user.id, p_story_id, p_history_index, now())
  on conflict (user_id, story_id) do update set
    last_seen_event_id = excluded.last_seen_event_id,
    updated_at = excluded.updated_at;

  return jsonb_build_object('success', true);
end;
$$;

-- ============================================
-- Admin-only: list reader positions (include resolved node_id)
-- ============================================

create or replace function admin_get_reader_positions(
  p_admin_pin varchar(6),
  p_story_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_admin users%rowtype;
  v_positions jsonb;
begin
  select * into v_admin from users where pin = p_admin_pin and role = 'admin';
  if not found then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'name', u.name,
      'lastSeenEventId', rp.last_seen_event_id,
      'nodeId', e.node_id
    )
    order by rp.updated_at desc
  )
  into v_positions
  from reader_positions rp
  join users u on u.id = rp.user_id
  left join story_events e
    on e.story_id = rp.story_id
   and e.id = rp.last_seen_event_id
  where rp.story_id = p_story_id;

  return jsonb_build_object('success', true, 'positions', coalesce(v_positions, '[]'::jsonb));
end;
$$;

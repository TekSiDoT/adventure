-- Enable Row Level Security and lock down direct table access.
-- This project uses custom PIN auth via SECURITY DEFINER RPCs (no Supabase Auth/JWT).
-- Strategy:
--   - Enable RLS on all public tables.
--   - Revoke direct privileges from anon/authenticated/public.
--   - Allow anon/authenticated SELECT only on story_events/story_state for realtime reads.
--   - Provide SECURITY DEFINER RPCs for all writes and sensitive reads.

-- ============================================
-- RLS + Grants
-- ============================================

alter table stories enable row level security;
alter table users enable row level security;
alter table story_events enable row level security;
alter table reader_positions enable row level security;
alter table story_state enable row level security;
alter table story_nodes enable row level security;
alter table story_choices enable row level security;
alter table story_items enable row level security;

-- Revoke all direct access from public/anon/authenticated.
revoke all on table stories from public, anon, authenticated;
revoke all on table users from public, anon, authenticated;
revoke all on table story_events from public, anon, authenticated;
revoke all on table reader_positions from public, anon, authenticated;
revoke all on table story_state from public, anon, authenticated;
revoke all on table story_nodes from public, anon, authenticated;
revoke all on table story_choices from public, anon, authenticated;
revoke all on table story_items from public, anon, authenticated;

-- Revoke sequence usage for anon/authenticated.
revoke all on sequence story_events_id_seq from public, anon, authenticated;

-- Ensure service_role retains full table privileges.
grant all on table stories to service_role;
grant all on table users to service_role;
grant all on table story_events to service_role;
grant all on table reader_positions to service_role;
grant all on table story_state to service_role;
grant all on table story_nodes to service_role;
grant all on table story_choices to service_role;
grant all on table story_items to service_role;
grant all on sequence story_events_id_seq to service_role;

-- Allow reads of events/state for realtime + reader UI.
grant select on table story_events to anon, authenticated;
grant select on table story_state to anon, authenticated;

-- RLS read-only policies for anon/authenticated.
drop policy if exists "public read story events" on story_events;
create policy "public read story events"
  on story_events
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public read story state" on story_state;
create policy "public read story state"
  on story_state
  for select
  to anon, authenticated
  using (true);

-- Service role full access (defense-in-depth; service_role may bypass RLS anyway).
do $$
declare
  t text;
begin
  foreach t in array array[
    'stories','users','story_events','reader_positions',
    'story_state','story_nodes','story_choices','story_items'
  ]
  loop
    execute format('drop policy if exists "service role full access" on %I;', t);
    execute format(
      'create policy "service role full access" on %I for all to service_role using (true) with check (true);',
      t
    );
  end loop;
end$$;

-- ============================================
-- PIN-gated RPCs for writes / sensitive reads
-- ============================================

-- Record a story event (player/admin only).
create or replace function record_story_event(
  p_pin varchar(6),
  p_story_id uuid,
  p_node_id varchar(100),
  p_choice_id varchar(100) default null,
  p_choice_text text default null,
  p_answer text default null,
  p_collected_items text[] default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user users%rowtype;
  v_event_id int;
begin
  select * into v_user from users where pin = p_pin;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN');
  end if;

  if v_user.role = 'reader' then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_user.role <> 'admin' and v_user.current_story_id is distinct from p_story_id then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  insert into story_events (
    story_id, node_id, choice_id, choice_text, answer, collected_items, created_by
  )
  values (
    p_story_id, p_node_id, p_choice_id, p_choice_text, p_answer, p_collected_items, v_user.id
  )
  returning id into v_event_id;

  return jsonb_build_object('success', true, 'event_id', v_event_id);
end;
$$;

-- Update story state (player/admin only).
create or replace function update_story_state(
  p_pin varchar(6),
  p_story_id uuid,
  p_current_node_id varchar(100),
  p_collected_items text[]
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

  if v_user.role = 'reader' then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_user.role <> 'admin' and v_user.current_story_id is distinct from p_story_id then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  insert into story_state (story_id, current_node_id, collected_items, updated_at)
  values (p_story_id, p_current_node_id, coalesce(p_collected_items, '{}'::text[]), now())
  on conflict (story_id) do update set
    current_node_id = excluded.current_node_id,
    collected_items = excluded.collected_items,
    updated_at = excluded.updated_at;

  return jsonb_build_object('success', true);
end;
$$;

-- Update reader position (reader/admin only).
create or replace function update_reader_position(
  p_pin varchar(6),
  p_story_id uuid,
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

  insert into reader_positions (user_id, story_id, history_index, updated_at)
  values (v_user.id, p_story_id, p_history_index, now())
  on conflict (user_id, story_id) do update set
    history_index = excluded.history_index,
    updated_at = excluded.updated_at;

  return jsonb_build_object('success', true);
end;
$$;

-- Admin-only: list reader positions for a story.
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
      'historyIndex', rp.history_index
    )
    order by rp.updated_at desc
  )
  into v_positions
  from reader_positions rp
  join users u on u.id = rp.user_id
  where rp.story_id = p_story_id;

  return jsonb_build_object('success', true, 'positions', coalesce(v_positions, '[]'::jsonb));
end;
$$;

-- Admin-only: list all nodes with lock status.
create or replace function admin_get_all_nodes_lock_status(
  p_admin_pin varchar(6),
  p_story_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_admin users%rowtype;
  v_nodes jsonb;
begin
  select * into v_admin from users where pin = p_admin_pin and role = 'admin';
  if not found then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'title', n.title,
      'is_locked', n.is_locked,
      'locked_until', n.locked_until
    )
    order by n.sort_order
  )
  into v_nodes
  from story_nodes n
  where n.story_id = p_story_id;

  return jsonb_build_object('success', true, 'nodes', coalesce(v_nodes, '[]'::jsonb));
end;
$$;

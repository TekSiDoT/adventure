-- JWT-based admin RPCs (no PIN required).
-- These functions authorize via auth.uid() + users.role = 'admin'.

create or replace function admin_get_all_users()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin users%rowtype;
  v_story_id uuid;
  v_users jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select * into v_admin from users where id = auth.uid() and role = 'admin';
  if not found then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  v_story_id := v_admin.current_story_id;
  if v_story_id is null then
    return jsonb_build_object('success', false, 'error', 'Admin has no current story');
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'pin', u.pin,
      'role', u.role,
      'name', u.name,
      'current_story_id', u.current_story_id,
      'created_at', u.created_at,
      'last_active', u.last_active
    )
    order by u.created_at
  )
  into v_users
  from users u
  where u.current_story_id = v_story_id;

  return jsonb_build_object('success', true, 'users', coalesce(v_users, '[]'::jsonb));
end;
$$;

revoke all on function admin_get_all_users() from public;
grant execute on function admin_get_all_users() to authenticated;

create or replace function admin_generate_reader_pin(
  p_name varchar(100),
  p_story_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin users%rowtype;
  v_new_pin varchar(6);
  v_new_user users%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select * into v_admin from users where id = auth.uid() and role = 'admin';
  if not found then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_admin.current_story_id is null or p_story_id is distinct from v_admin.current_story_id then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  loop
    v_new_pin := lpad(floor(random() * 1000000)::text, 6, '0');
    exit when not exists (select 1 from users where pin = v_new_pin);
  end loop;

  insert into users (pin, role, name, current_story_id)
  values (v_new_pin, 'reader', p_name, p_story_id)
  returning * into v_new_user;

  insert into reader_positions (user_id, story_id, last_seen_event_id)
  values (v_new_user.id, p_story_id, 0);

  return jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id', v_new_user.id,
      'pin', v_new_user.pin,
      'name', v_new_user.name
    )
  );
end;
$$;

revoke all on function admin_generate_reader_pin(varchar, uuid) from public;
grant execute on function admin_generate_reader_pin(varchar, uuid) to authenticated;

create or replace function admin_delete_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin users%rowtype;
  v_target users%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select * into v_admin from users where id = auth.uid() and role = 'admin';
  if not found then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  select * into v_target from users where id = p_user_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  if v_target.role = 'admin' then
    return jsonb_build_object('success', false, 'error', 'Cannot delete admin users');
  end if;

  if v_admin.current_story_id is null or v_target.current_story_id is distinct from v_admin.current_story_id then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  delete from reader_positions where user_id = p_user_id;
  delete from users where id = p_user_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function admin_delete_user(uuid) from public;
grant execute on function admin_delete_user(uuid) to authenticated;

create or replace function admin_get_reader_positions_jwt(
  p_story_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin users%rowtype;
  v_positions jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select * into v_admin from users where id = auth.uid() and role = 'admin';
  if not found then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_admin.current_story_id is null or p_story_id is distinct from v_admin.current_story_id then
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

revoke all on function admin_get_reader_positions_jwt(uuid) from public;
grant execute on function admin_get_reader_positions_jwt(uuid) to authenticated;

create or replace function admin_get_all_nodes_lock_status_jwt(
  p_story_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin users%rowtype;
  v_nodes jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select * into v_admin from users where id = auth.uid() and role = 'admin';
  if not found then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_admin.current_story_id is null or p_story_id is distinct from v_admin.current_story_id then
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

revoke all on function admin_get_all_nodes_lock_status_jwt(uuid) from public;
grant execute on function admin_get_all_nodes_lock_status_jwt(uuid) to authenticated;

create or replace function admin_set_node_lock_jwt(
  p_story_id uuid,
  p_node_id varchar(100),
  p_is_locked boolean,
  p_locked_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin users%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select * into v_admin from users where id = auth.uid() and role = 'admin';
  if not found then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_admin.current_story_id is null or p_story_id is distinct from v_admin.current_story_id then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  update story_nodes
  set
    is_locked = p_is_locked,
    locked_until = case
      when p_is_locked = false then null
      else coalesce(p_locked_until, locked_until)
    end
  where story_id = p_story_id and id = p_node_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Node not found');
  end if;

  return jsonb_build_object('success', true, 'node_id', p_node_id, 'is_locked', p_is_locked);
end;
$$;

revoke all on function admin_set_node_lock_jwt(uuid, varchar, boolean, timestamptz) from public;
grant execute on function admin_set_node_lock_jwt(uuid, varchar, boolean, timestamptz) to authenticated;

create or replace function admin_get_locked_nodes_jwt(
  p_story_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin users%rowtype;
  v_nodes jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select * into v_admin from users where id = auth.uid() and role = 'admin';
  if not found then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if v_admin.current_story_id is null or p_story_id is distinct from v_admin.current_story_id then
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
  where n.story_id = p_story_id
    and (n.is_locked = true or n.locked_until is not null);

  return jsonb_build_object('success', true, 'nodes', coalesce(v_nodes, '[]'::jsonb));
end;
$$;

revoke all on function admin_get_locked_nodes_jwt(uuid) from public;
grant execute on function admin_get_locked_nodes_jwt(uuid) to authenticated;


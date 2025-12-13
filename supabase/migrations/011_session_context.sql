-- Session restoration for PIN-minted JWTs.
-- Provides a JWT-only RPC to fetch the same context as auth_with_pin without requiring a PIN.

create or replace function get_session_context()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user users%rowtype;
  v_story stories%rowtype;
  v_state story_state%rowtype;
  v_last_seen_event_id int := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select * into v_user from users where id = auth.uid();
  if not found then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  select * into v_story from stories where id = v_user.current_story_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Story not found');
  end if;

  select * into v_state from story_state where story_id = v_story.id;
  if not found then
    -- Defensive: story_state should exist; provide a reasonable default.
    v_state.story_id := v_story.id;
    v_state.current_node_id := coalesce(v_story.start_node_id, 'start');
    v_state.collected_items := '{}'::text[];
    v_state.updated_at := now();
  end if;

  if v_user.role = 'reader' then
    select coalesce(last_seen_event_id, 0) into v_last_seen_event_id
    from reader_positions
    where user_id = v_user.id and story_id = v_story.id;
  end if;

  return jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id', v_user.id,
      'role', v_user.role,
      'name', v_user.name
    ),
    'story', jsonb_build_object(
      'id', v_story.id,
      'title', v_story.title,
      'slug', v_story.slug
    ),
    'state', jsonb_build_object(
      'currentNodeId', v_state.current_node_id,
      'collectedItems', v_state.collected_items
    ),
    'readerLastSeenEventId', v_last_seen_event_id
  );
end;
$$;

revoke all on function get_session_context() from public;
grant execute on function get_session_context() to authenticated;


-- Ensure auth_with_pin always returns a numeric readerLastSeenEventId (0 when not applicable).

create or replace function auth_with_pin(p_pin varchar(6))
returns json as $$
declare
  v_user users%rowtype;
  v_story stories%rowtype;
  v_state story_state%rowtype;
  v_last_seen_event_id int := 0;
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


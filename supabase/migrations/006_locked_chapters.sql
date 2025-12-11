-- Add lock columns for chapter visibility control
-- Lock state is managed in DB only (not in story.json)
ALTER TABLE story_nodes ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
ALTER TABLE story_nodes ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;

-- Migrate existing pending nodes to locked
UPDATE story_nodes SET is_locked = is_pending WHERE is_pending = TRUE;

-- Index for efficient lock queries
CREATE INDEX IF NOT EXISTS idx_story_nodes_lock_status
  ON story_nodes(story_id, is_locked, locked_until);

-- Drop existing function first (required when changing return type/structure)
DROP FUNCTION IF EXISTS get_story_content(UUID);

-- Recreate the get_story_content function with lock logic
-- Locked nodes appear as "pending" to players (teaser shown, text hidden)
CREATE OR REPLACE FUNCTION get_story_content(p_story_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_story RECORD;
  v_nodes JSONB;
  v_items JSONB;
  v_result JSONB;
BEGIN
  -- Get story metadata
  SELECT id, title, slug, start_node_id INTO v_story
  FROM stories
  WHERE id = p_story_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Story not found');
  END IF;

  -- Build nodes object
  -- Locked nodes: pending=true, text hidden
  -- Unlocked nodes: pending=false (unless is_pending was true), full text shown
  SELECT jsonb_object_agg(
    n.id,
    jsonb_build_object(
      'id', n.id,
      'title', n.title,
      'text', CASE
        WHEN n.is_locked = TRUE OR (n.locked_until IS NOT NULL AND n.locked_until > NOW())
        THEN ''
        ELSE n.text
      END,
      'media', CASE
        WHEN n.media_image IS NOT NULL OR n.media_audio IS NOT NULL THEN
          jsonb_build_object(
            'image', n.media_image,
            'imagePosition', n.media_image_position,
            'audio', n.media_audio
          )
        ELSE NULL
      END,
      'choices', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'text', c.text,
            'nextNode', c.next_node,
            'grantsItems', c.grants_items,
            'returnsTo', c.returns_to
          ) ORDER BY c.sort_order
        )
        FROM story_choices c
        WHERE c.story_id = n.story_id AND c.node_id = n.id
      ), '[]'::jsonb),
      'openQuestion', CASE
        WHEN n.open_question_prompt IS NOT NULL THEN
          jsonb_build_object('prompt', n.open_question_prompt)
        ELSE NULL
      END,
      'explorationHub', CASE
        WHEN n.exploration_hub_required_nodes IS NOT NULL THEN
          jsonb_build_object(
            'requiredNodes', n.exploration_hub_required_nodes,
            'summaryNodeId', n.exploration_hub_summary_node_id
          )
        ELSE NULL
      END,
      'pending', CASE
        WHEN n.is_locked = TRUE OR (n.locked_until IS NOT NULL AND n.locked_until > NOW())
        THEN TRUE
        ELSE FALSE
      END,
      'teaser', n.teaser,
      'grantsItems', n.grants_items,
      'akt', n.akt,
      'teil', n.teil,
      'kapitel', n.kapitel,
      'mistRevealText', CASE
        WHEN n.is_locked = TRUE OR (n.locked_until IS NOT NULL AND n.locked_until > NOW())
        THEN NULL
        ELSE n.mist_reveal_text
      END
    )
  ) INTO v_nodes
  FROM story_nodes n
  WHERE n.story_id = p_story_id;

  -- Build items object
  SELECT jsonb_object_agg(
    i.id,
    jsonb_build_object(
      'id', i.id,
      'name', i.name,
      'description', i.description,
      'image', i.image
    )
  ) INTO v_items
  FROM story_items i
  WHERE i.story_id = p_story_id;

  -- Build final result
  v_result := jsonb_build_object(
    'success', true,
    'story', jsonb_build_object(
      'currentNode', COALESCE(v_story.start_node_id, 'start'),
      'nodes', COALESCE(v_nodes, '{}'::jsonb),
      'items', COALESCE(v_items, '{}'::jsonb)
    )
  );

  RETURN v_result;
END;
$$;

-- Admin function to lock/unlock a node
CREATE OR REPLACE FUNCTION admin_set_node_lock(
  p_admin_pin VARCHAR(6),
  p_story_id UUID,
  p_node_id VARCHAR(100),
  p_is_locked BOOLEAN,
  p_locked_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin users%rowtype;
BEGIN
  -- Verify admin
  SELECT * INTO v_admin FROM users WHERE pin = p_admin_pin AND role = 'admin';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Update the node
  UPDATE story_nodes
  SET
    is_locked = p_is_locked,
    locked_until = CASE
      WHEN p_is_locked = FALSE THEN NULL  -- Clear schedule when unlocking
      ELSE COALESCE(p_locked_until, locked_until)
    END
  WHERE story_id = p_story_id AND id = p_node_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Node not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'node_id', p_node_id, 'is_locked', p_is_locked);
END;
$$;

-- Admin function to list locked nodes
CREATE OR REPLACE FUNCTION admin_get_locked_nodes(
  p_admin_pin VARCHAR(6),
  p_story_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin users%rowtype;
  v_nodes JSONB;
BEGIN
  -- Verify admin
  SELECT * INTO v_admin FROM users WHERE pin = p_admin_pin AND role = 'admin';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', n.id,
    'title', n.title,
    'is_locked', n.is_locked,
    'locked_until', n.locked_until
  ) ORDER BY n.sort_order)
  INTO v_nodes
  FROM story_nodes n
  WHERE n.story_id = p_story_id
    AND (n.is_locked = TRUE OR n.locked_until IS NOT NULL);

  RETURN jsonb_build_object('success', true, 'nodes', COALESCE(v_nodes, '[]'::jsonb));
END;
$$;

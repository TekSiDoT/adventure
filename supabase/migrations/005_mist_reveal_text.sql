-- Add mist_reveal_text column for Elvish text reveal animation
ALTER TABLE story_nodes ADD COLUMN IF NOT EXISTS mist_reveal_text TEXT;

-- Drop existing function first (required when changing return type/structure)
DROP FUNCTION IF EXISTS get_story_content(UUID);

-- Recreate the get_story_content function with mist_reveal_text field
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
  SELECT jsonb_object_agg(
    n.id,
    jsonb_build_object(
      'id', n.id,
      'title', n.title,
      'text', n.text,
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
      'pending', n.is_pending,
      'teaser', n.teaser,
      'grantsItems', n.grants_items,
      'akt', n.akt,
      'teil', n.teil,
      'kapitel', n.kapitel,
      'mistRevealText', n.mist_reveal_text
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

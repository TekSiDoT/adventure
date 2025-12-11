-- Reconstruct missing story_events for the linear path from start to durch-den-spalt
-- Run this against your Supabase database
-- IMPORTANT: Replace 'YOUR_STORY_ID' with your actual story ID from the stories table

-- First, let's see what story_id we need:
-- SELECT id, title FROM stories;

-- Set the story_id variable (replace with your actual ID)
-- Example: If your story_id is 'abc-123', use that value

DO $$
DECLARE
    v_story_id UUID;
    v_base_time TIMESTAMP;
BEGIN
    -- Get the story_id (assuming there's only one story, or adjust the WHERE clause)
    SELECT id INTO v_story_id FROM stories LIMIT 1;

    -- Get the earliest existing event time to insert before it
    SELECT MIN(created_at) - INTERVAL '1 hour' INTO v_base_time
    FROM story_events
    WHERE story_id = v_story_id;

    -- If no events exist, use current time minus 2 hours
    IF v_base_time IS NULL THEN
        v_base_time := NOW() - INTERVAL '2 hours';
    END IF;

    -- Insert the missing chapter 1 events (in order)
    -- These are all "Weiter" (continue) choices until "entdeckung"

    INSERT INTO story_events (story_id, node_id, choice_id, choice_text, created_at)
    VALUES
        (v_story_id, 'start', 'continue', NULL, v_base_time + INTERVAL '1 minute'),
        (v_story_id, 'hobbits', 'continue', NULL, v_base_time + INTERVAL '2 minutes'),
        (v_story_id, 'tuks', 'continue', NULL, v_base_time + INTERVAL '3 minutes'),
        (v_story_id, 'tuckberge', 'continue', NULL, v_base_time + INTERVAL '4 minutes'),
        (v_story_id, 'familie', 'continue', NULL, v_base_time + INTERVAL '5 minutes'),
        (v_story_id, 'odo', 'continue', NULL, v_base_time + INTERVAL '6 minutes'),
        (v_story_id, 'gabe', 'continue', NULL, v_base_time + INTERVAL '7 minutes'),
        (v_story_id, 'taschen', 'continue', NULL, v_base_time + INTERVAL '8 minutes'),
        (v_story_id, 'herbst', 'continue', NULL, v_base_time + INTERVAL '9 minutes'),
        (v_story_id, 'zimmer', 'continue', NULL, v_base_time + INTERVAL '10 minutes'),
        -- At "entdeckung" there's a real choice - "durch-den-spalt" was chosen
        (v_story_id, 'entdeckung', 'durch-den-spalt', 'Das Regal zur Seite schieben und die Wand untersuchen', v_base_time + INTERVAL '11 minutes'),
        (v_story_id, 'durch-den-spalt', 'continue', NULL, v_base_time + INTERVAL '12 minutes')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Inserted missing events for story_id: %', v_story_id;
END $$;

-- Verify the events are now in order:
-- SELECT node_id, choice_id, choice_text, created_at
-- FROM story_events
-- WHERE story_id = (SELECT id FROM stories LIMIT 1)
-- ORDER BY created_at;

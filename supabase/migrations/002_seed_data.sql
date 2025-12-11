-- Seed Data
-- Run this AFTER 001_initial_schema.sql
-- Replace PIN values with your own secure 6-digit codes

-- Create the first story
insert into stories (id, title, slug, description)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Das Abenteuer',
  'abenteuer',
  'Ein interaktives Abenteuer'
);

-- Create admin/player user (CHANGE THIS PIN!)
insert into users (pin, role, name, current_story_id)
values (
  '140923',  -- CHANGE THIS to your secure admin PIN
  'admin',
  'Spielleiter',
  'a0000000-0000-0000-0000-000000000001'
);

-- Initialize story state (set to your current node)
insert into story_state (story_id, current_node_id, collected_items)
values (
  'a0000000-0000-0000-0000-000000000001',
  'start',  -- CHANGE THIS to your current node ID
  '{}'      -- CHANGE THIS to current collected items if any
);

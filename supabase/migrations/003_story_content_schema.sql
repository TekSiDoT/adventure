-- Story Content Schema Migration
-- Adds tables for storing story content (nodes, choices, items)
-- Previously stored in static JSON files

-- ============================================
-- Alter existing stories table
-- ============================================
alter table stories add column if not exists start_node_id varchar(100) default 'start';

-- ============================================
-- New Tables
-- ============================================

-- Story nodes (the content of each page/scene)
create table story_nodes (
  id varchar(100) not null,
  story_id uuid not null references stories(id) on delete cascade,
  title varchar(200),
  text text not null default '',

  -- Media fields (flattened from Media interface)
  media_image varchar(500),
  media_image_position varchar(10) check (media_image_position in ('top', 'middle', 'bottom')),
  media_audio varchar(500),

  -- Open question (nullable, flattened)
  open_question_prompt text,

  -- Exploration hub (nullable, flattened)
  exploration_hub_required_nodes varchar(100)[],
  exploration_hub_summary_node_id varchar(100),

  -- State flags
  is_pending boolean default false,
  teaser text,

  -- Items granted when visiting this node
  grants_items varchar(100)[] default '{}',

  -- Ordering/metadata
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  primary key (story_id, id)
);

-- Choices available from each node
create table story_choices (
  id varchar(100) not null,
  story_id uuid not null references stories(id) on delete cascade,
  node_id varchar(100) not null,

  text text not null,
  next_node varchar(100) not null,

  -- Optional fields
  grants_items varchar(100)[] default '{}',
  returns_to varchar(100),  -- For exploration hub pattern

  -- Ordering
  sort_order int default 0,
  created_at timestamptz default now(),

  primary key (story_id, node_id, id),
  foreign key (story_id, node_id) references story_nodes(story_id, id) on delete cascade
);

-- Collectible items catalog
create table story_items (
  id varchar(100) not null,
  story_id uuid not null references stories(id) on delete cascade,

  name varchar(200) not null,
  description text not null,
  image varchar(500),

  created_at timestamptz default now(),

  primary key (story_id, id)
);

-- ============================================
-- Indexes
-- ============================================
create index idx_story_nodes_story_id on story_nodes(story_id);
create index idx_story_choices_node on story_choices(story_id, node_id);
create index idx_story_items_story_id on story_items(story_id);

-- ============================================
-- RPC Function: Get Full Story Content
-- ============================================
create or replace function get_story_content(p_story_id uuid)
returns json as $$
declare
  v_story stories%rowtype;
  v_nodes json;
  v_items json;
begin
  -- Get story metadata
  select * into v_story from stories where id = p_story_id;
  if not found then
    return json_build_object('success', false, 'error', 'Story not found');
  end if;

  -- Get nodes with their choices
  select json_object_agg(
    n.id,
    json_build_object(
      'id', n.id,
      'title', n.title,
      'text', n.text,
      'media', case
        when n.media_image is not null or n.media_audio is not null then
          json_build_object(
            'image', n.media_image,
            'imagePosition', n.media_image_position,
            'audio', n.media_audio
          )
        else null
      end,
      'choices', coalesce((
        select json_agg(
          json_build_object(
            'id', c.id,
            'text', c.text,
            'nextNode', c.next_node,
            'grantsItems', case when array_length(c.grants_items, 1) > 0 then c.grants_items else null end,
            'returnsTo', c.returns_to
          ) order by c.sort_order
        )
        from story_choices c
        where c.story_id = n.story_id and c.node_id = n.id
      ), '[]'::json),
      'openQuestion', case
        when n.open_question_prompt is not null then
          json_build_object('prompt', n.open_question_prompt)
        else null
      end,
      'pending', case when n.is_pending then true else null end,
      'teaser', n.teaser,
      'grantsItems', case when array_length(n.grants_items, 1) > 0 then n.grants_items else null end,
      'explorationHub', case
        when n.exploration_hub_required_nodes is not null then
          json_build_object(
            'requiredNodes', n.exploration_hub_required_nodes,
            'summaryNodeId', n.exploration_hub_summary_node_id
          )
        else null
      end
    )
  )
  into v_nodes
  from story_nodes n
  where n.story_id = p_story_id;

  -- Get items
  select json_object_agg(
    i.id,
    json_build_object(
      'id', i.id,
      'name', i.name,
      'description', i.description,
      'image', i.image
    )
  )
  into v_items
  from story_items i
  where i.story_id = p_story_id;

  return json_build_object(
    'success', true,
    'story', json_build_object(
      'currentNode', v_story.start_node_id,
      'nodes', coalesce(v_nodes, '{}'::json),
      'items', v_items
    )
  );
end;
$$ language plpgsql security definer;

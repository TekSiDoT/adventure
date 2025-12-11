/**
 * Seed script to populate Supabase with story content from story.json
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=xxx npx ts-node scripts/seed-story-content.ts
 *
 * Or with .env file:
 *   npx ts-node scripts/seed-story-content.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Types matching story.json structure
interface Story {
  currentNode: string;
  nodes: Record<string, StoryNode>;
  items?: Record<string, InventoryItem>;
}

interface StoryNode {
  id: string;
  title?: string;
  text: string;
  media?: {
    image: string | null;
    imagePosition?: 'top' | 'middle' | 'bottom';
    audio: string | null;
  };
  choices: Choice[];
  openQuestion?: { prompt: string };
  teaser?: string;
  grantsItems?: string[];
  explorationHub?: {
    requiredNodes: string[];
    summaryNodeId: string;
  };
  mistRevealText?: string;
  // Note: lock state (is_locked, locked_until) is managed in DB only, not in story.json
}

interface Choice {
  id: string;
  text: string;
  nextNode: string;
  grantsItems?: string[];
  returnsTo?: string;
}

interface InventoryItem {
  id: string;
  name: string;
  description: string;
  image?: string;
}

// Node to chapter mapping based on story/ folder structure
// Akt 1, Teil "Prolog"
const nodeChapterMap: Record<string, { akt: number; teil: string; kapitel: number }> = {
  // Prolog-1: start through entdeckung (11 pages)
  'start': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'hobbits': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'tuks': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'tuckberge': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'familie': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'odo': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'gabe': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'taschen': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'herbst': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'zimmer': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'entdeckung': { akt: 1, teil: 'Prolog', kapitel: 1 },

  // Prolog-2: durch-den-spalt through die-alte-lampe (5 pages)
  'durch-den-spalt': { akt: 1, teil: 'Prolog', kapitel: 2 },
  'der-verborgene-raum': { akt: 1, teil: 'Prolog', kapitel: 2 },
  'die-alte-lampe': { akt: 1, teil: 'Prolog', kapitel: 2 },
  'weiter-erkunden': { akt: 1, teil: 'Prolog', kapitel: 2 },
  'zurueck-ins-zimmer': { akt: 1, teil: 'Prolog', kapitel: 2 },

  // Prolog-3: lampe-anzuenden through erkunden-zusammenfassung (9 pages)
  'lampe-anzuenden': { akt: 1, teil: 'Prolog', kapitel: 3 },
  'licht-im-raum': { akt: 1, teil: 'Prolog', kapitel: 3 },
  'erkunden-hub': { akt: 1, teil: 'Prolog', kapitel: 3 },
  'erkunden-werkzeuge': { akt: 1, teil: 'Prolog', kapitel: 3 },
  'erkunden-faesser': { akt: 1, teil: 'Prolog', kapitel: 3 },
  'erkunden-kruege': { akt: 1, teil: 'Prolog', kapitel: 3 },
  'erkunden-boden': { akt: 1, teil: 'Prolog', kapitel: 3 },
  'erkunden-zusammenfassung': { akt: 1, teil: 'Prolog', kapitel: 3 },
  'regal-loesen': { akt: 1, teil: 'Prolog', kapitel: 3 },

  // Pending/future content (still part of Prolog structure - branches from entdeckung)
  'zwillinge': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'mutter': { akt: 1, teil: 'Prolog', kapitel: 1 },
  'nacht': { akt: 1, teil: 'Prolog', kapitel: 1 },

  // Prolog-4: der-durchbruch through die-ausrede (9 pages + 3 pending)
  'der-durchbruch': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'die-zweite-kammer': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'das-kaestchen': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'der-fund': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'der-fund-zeichen': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'der-fund-2': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'die-tuer': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'die-ausrede': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'ausrede-rezept': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'ausrede-maus': { akt: 1, teil: 'Prolog', kapitel: 4 },
  'ausrede-wahrheit': { akt: 1, teil: 'Prolog', kapitel: 4 },
};

async function seedStoryContent() {
  // Get config from environment
  const supabaseUrl = process.env['SUPABASE_URL'];
  const supabaseKey = process.env['SUPABASE_SERVICE_KEY'];
  const storyId = process.env['STORY_ID'] || 'a0000000-0000-0000-0000-000000000001';

  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required');
    console.error('Usage: SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx npx ts-node scripts/seed-story-content.ts');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Read story.json
  const storyPath = path.join(__dirname, '../src/assets/story.json');
  if (!fs.existsSync(storyPath)) {
    console.error(`Error: story.json not found at ${storyPath}`);
    process.exit(1);
  }

  const storyData: Story = JSON.parse(fs.readFileSync(storyPath, 'utf-8'));

  console.log(`\nSeeding story content for story ${storyId}...`);
  console.log(`Found ${Object.keys(storyData.nodes).length} nodes`);

  // Check if story exists
  const { data: existingStory, error: storyError } = await supabase
    .from('stories')
    .select('id')
    .eq('id', storyId)
    .single();

  if (storyError || !existingStory) {
    console.error(`Error: Story with ID ${storyId} not found in database`);
    console.error('Make sure to run 002_seed_data.sql first to create the story record');
    process.exit(1);
  }

  // Update story start node
  const { error: updateError } = await supabase
    .from('stories')
    .update({ start_node_id: storyData.currentNode })
    .eq('id', storyId);

  if (updateError) {
    console.error('Error updating story start node:', updateError);
    process.exit(1);
  }
  console.log(`Updated start_node_id to "${storyData.currentNode}"`);

  // Save existing lock states before clearing (lock state is preserved across re-seeds)
  console.log('\nSaving existing lock states...');
  const { data: existingLocks } = await supabase
    .from('story_nodes')
    .select('id, is_locked, locked_until')
    .eq('story_id', storyId);

  const lockStateMap = new Map<string, { is_locked: boolean; locked_until: string | null }>();
  if (existingLocks) {
    existingLocks.forEach(node => {
      if (node.is_locked || node.locked_until) {
        lockStateMap.set(node.id, {
          is_locked: node.is_locked,
          locked_until: node.locked_until
        });
      }
    });
    console.log(`  Found ${lockStateMap.size} nodes with lock state to preserve`);
  }

  // Clear existing content for this story (fresh seed)
  console.log('\nClearing existing story content...');

  await supabase.from('story_choices').delete().eq('story_id', storyId);
  await supabase.from('story_nodes').delete().eq('story_id', storyId);
  await supabase.from('story_items').delete().eq('story_id', storyId);

  // Insert nodes
  console.log('\nInserting nodes...');
  const nodeEntries = Object.entries(storyData.nodes);
  const nodes = nodeEntries.map(([_, node], index) => {
    const hierarchy = nodeChapterMap[node.id];
    // Restore lock state if it existed before
    const existingLock = lockStateMap.get(node.id);
    return {
      id: node.id,
      story_id: storyId,
      title: node.title || null,
      text: node.text || '',
      media_image: node.media?.image || null,
      media_image_position: node.media?.imagePosition || null,
      media_audio: node.media?.audio || null,
      open_question_prompt: node.openQuestion?.prompt || null,
      exploration_hub_required_nodes: node.explorationHub?.requiredNodes || null,
      exploration_hub_summary_node_id: node.explorationHub?.summaryNodeId || null,
      teaser: node.teaser || null,
      grants_items: node.grantsItems || [],
      sort_order: index,
      // Hierarchy fields
      akt: hierarchy?.akt || 1,
      teil: hierarchy?.teil || null,
      kapitel: hierarchy?.kapitel || null,
      // Mist reveal text (Elvish)
      mist_reveal_text: node.mistRevealText || null,
      // Lock state (preserved from previous seed, or default unlocked)
      is_locked: existingLock?.is_locked || false,
      locked_until: existingLock?.locked_until || null,
    };
  });

  const { error: nodesError } = await supabase
    .from('story_nodes')
    .insert(nodes);

  if (nodesError) {
    console.error('Error inserting nodes:', nodesError);
    process.exit(1);
  }
  console.log(`  Inserted ${nodes.length} nodes`);

  // Insert choices
  console.log('\nInserting choices...');
  const choices: Array<{
    id: string;
    story_id: string;
    node_id: string;
    text: string;
    next_node: string;
    grants_items: string[];
    returns_to: string | null;
    sort_order: number;
  }> = [];

  Object.values(storyData.nodes).forEach(node => {
    node.choices.forEach((choice, index) => {
      choices.push({
        id: choice.id,
        story_id: storyId,
        node_id: node.id,
        text: choice.text,
        next_node: choice.nextNode,
        grants_items: choice.grantsItems || [],
        returns_to: choice.returnsTo || null,
        sort_order: index
      });
    });
  });

  if (choices.length > 0) {
    const { error: choicesError } = await supabase
      .from('story_choices')
      .insert(choices);

    if (choicesError) {
      console.error('Error inserting choices:', choicesError);
      process.exit(1);
    }
    console.log(`  Inserted ${choices.length} choices`);
  } else {
    console.log('  No choices to insert');
  }

  // Insert items
  if (storyData.items && Object.keys(storyData.items).length > 0) {
    console.log('\nInserting items...');
    const items = Object.values(storyData.items).map(item => ({
      id: item.id,
      story_id: storyId,
      name: item.name,
      description: item.description,
      image: item.image || null
    }));

    const { error: itemsError } = await supabase
      .from('story_items')
      .insert(items);

    if (itemsError) {
      console.error('Error inserting items:', itemsError);
      process.exit(1);
    }
    console.log(`  Inserted ${items.length} items`);
  } else {
    console.log('\nNo items to insert');
  }

  // Verify by calling the RPC function
  console.log('\nVerifying seed by calling get_story_content...');
  const { data: contentData, error: contentError } = await supabase.rpc('get_story_content', {
    p_story_id: storyId
  });

  if (contentError) {
    console.error('Error calling get_story_content:', contentError);
    process.exit(1);
  }

  if (!contentData?.success) {
    console.error('get_story_content returned error:', contentData?.error);
    process.exit(1);
  }

  const returnedNodeCount = Object.keys(contentData.story?.nodes || {}).length;
  console.log(`  RPC returns ${returnedNodeCount} nodes`);

  if (returnedNodeCount !== nodes.length) {
    console.warn(`  Warning: Expected ${nodes.length} nodes, got ${returnedNodeCount}`);
  }

  console.log('\n✓ Story content seeded successfully!');
}

// Run the script
seedStoryContent().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

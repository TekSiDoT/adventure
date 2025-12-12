-- JWT-claim based RLS for PIN-minted sessions.
-- Edge function pin-login signs JWTs with:
--   role = 'authenticated'
--   sub = users.id
--   app_role = 'player' | 'reader' | 'admin'
--   story_id = users.current_story_id
--
-- We keep story content tables locked to SECURITY DEFINER RPCs (get_story_content)
-- to avoid leaking locked node text via direct selects.

-- ============================================
-- Grants
-- ============================================

-- Stop anonymous reads now that clients authenticate via JWT.
revoke select on table story_events from anon;
revoke select on table story_state from anon;

-- Ensure authenticated has required privileges for reads/writes.
grant select, insert on table story_events to authenticated;
grant select, insert, update on table story_state to authenticated;
grant select, insert, update on table reader_positions to authenticated;
grant usage on sequence story_events_id_seq to authenticated;

-- ============================================
-- Helper expressions
-- ============================================
-- claim_story_id := (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
-- claim_app_role := current_setting('request.jwt.claims', true)::jsonb->>'app_role'

-- ============================================
-- story_events
-- ============================================

drop policy if exists "public read story events" on story_events;
drop policy if exists "jwt read story events" on story_events;
create policy "jwt read story events"
  on story_events
  for select
  to authenticated
  using (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
  );

drop policy if exists "jwt insert story events" on story_events;
create policy "jwt insert story events"
  on story_events
  for insert
  to authenticated
  with check (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
    and created_by = auth.uid()
    and (current_setting('request.jwt.claims', true)::jsonb->>'app_role') in ('player', 'admin')
  );

-- ============================================
-- story_state
-- ============================================

drop policy if exists "public read story state" on story_state;
drop policy if exists "jwt read story state" on story_state;
create policy "jwt read story state"
  on story_state
  for select
  to authenticated
  using (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
  );

drop policy if exists "jwt insert story state" on story_state;
create policy "jwt insert story state"
  on story_state
  for insert
  to authenticated
  with check (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
    and (current_setting('request.jwt.claims', true)::jsonb->>'app_role') in ('player', 'admin')
  );

drop policy if exists "jwt update story state" on story_state;
create policy "jwt update story state"
  on story_state
  for update
  to authenticated
  using (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
    and (current_setting('request.jwt.claims', true)::jsonb->>'app_role') in ('player', 'admin')
  )
  with check (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
    and (current_setting('request.jwt.claims', true)::jsonb->>'app_role') in ('player', 'admin')
  );

-- ============================================
-- reader_positions
-- ============================================

drop policy if exists "jwt read own reader position" on reader_positions;
create policy "jwt read own reader position"
  on reader_positions
  for select
  to authenticated
  using (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
    and user_id = auth.uid()
  );

drop policy if exists "jwt insert own reader position" on reader_positions;
create policy "jwt insert own reader position"
  on reader_positions
  for insert
  to authenticated
  with check (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
    and user_id = auth.uid()
    and (current_setting('request.jwt.claims', true)::jsonb->>'app_role') in ('reader', 'admin')
  );

drop policy if exists "jwt update own reader position" on reader_positions;
create policy "jwt update own reader position"
  on reader_positions
  for update
  to authenticated
  using (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
    and user_id = auth.uid()
    and (current_setting('request.jwt.claims', true)::jsonb->>'app_role') in ('reader', 'admin')
  )
  with check (
    story_id = (current_setting('request.jwt.claims', true)::jsonb->>'story_id')::uuid
    and user_id = auth.uid()
    and (current_setting('request.jwt.claims', true)::jsonb->>'app_role') in ('reader', 'admin')
  );


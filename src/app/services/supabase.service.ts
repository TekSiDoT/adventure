import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { Story } from '../models/story.model';

// Database types
export interface DbStory {
  id: string;
  title: string;
  slug: string;
  description?: string;
  created_at: string;
}

export interface DbUser {
  id: string;
  pin: string;
  role: 'player' | 'reader' | 'admin';
  name?: string;
  current_story_id?: string;
  created_at: string;
  last_active: string;
}

export interface DbStoryEvent {
  id: number;
  story_id: string;
  node_id: string;
  choice_id?: string;
  choice_text?: string;
  answer?: string;
  collected_items?: string[];
  created_at: string;
  created_by?: string;
}

export interface DbStoryState {
  story_id: string;
  current_node_id: string;
  collected_items: string[];
  updated_at: string;
}

export interface DbReaderPosition {
  user_id: string;
  story_id: string;
  history_index: number;
  updated_at: string;
}

// API Response types
export interface AuthResponse {
  success: boolean;
  error?: string;
  user?: {
    id: string;
    role: 'player' | 'reader' | 'admin';
    name?: string;
  };
  story?: {
    id: string;
    title: string;
    slug: string;
  };
  state?: {
    currentNodeId: string;
    collectedItems: string[];
  };
  events?: DbStoryEvent[];
  readerPosition?: number;
}

export interface GeneratePinResponse {
  success: boolean;
  error?: string;
  user?: {
    id: string;
    pin: string;
    name: string;
  };
}

export interface GetUsersResponse {
  success: boolean;
  error?: string;
  users?: DbUser[];
}

export interface ReaderPositionInfo {
  name: string;
  id: string;
  historyIndex: number;
}

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;
  private realtimeChannel: RealtimeChannel | null = null;

  // Current session state
  private currentUser = signal<AuthResponse['user'] | null>(null);
  private currentStory = signal<AuthResponse['story'] | null>(null);
  private currentPin = signal<string | null>(null);
  private currentAccessToken = signal<string | null>(null);

  readonly user = this.currentUser.asReadonly();
  readonly story = this.currentStory.asReadonly();
  readonly accessToken = this.currentAccessToken.asReadonly();

  constructor() {
    this.supabase = createClient(
      environment.supabaseUrl,
      environment.supabaseAnonKey
    );
  }

  /**
   * Authenticate with 6-digit PIN
   */
  async authWithPin(pin: string): Promise<AuthResponse> {
    // Prefer Edge Function login (mints JWT for RLS/realtime). Fall back to RPC for local/dev.
    let data: any;
    let error: any;
    try {
      const res = await this.supabase.functions.invoke('pin-login', {
        body: { pin }
      });
      data = res.data;
      error = res.error;
    } catch (err) {
      error = err;
    }

    if (error) {
      console.warn('pin-login failed, falling back to auth_with_pin RPC:', error);
      const rpcRes = await this.supabase.rpc('auth_with_pin', { p_pin: pin });
      data = rpcRes.data;
      error = rpcRes.error;
    }

    if (error) {
      console.error('Auth error:', error);
      return { success: false, error: error.message || String(error) };
    }

    const response = data as AuthResponse & {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    if (response.success && response.user && response.story) {
      this.currentUser.set(response.user);
      this.currentStory.set(response.story);
      this.currentPin.set(pin);

      if (response.access_token) {
        this.currentAccessToken.set(response.access_token);
        try {
          await this.supabase.auth.setSession({
            access_token: response.access_token,
            refresh_token: ''
          });
        } catch (err) {
          console.warn('Failed to set Supabase session:', err);
        }
      }
    }

    return response;
  }

  /**
   * Get current story state and events
   */
  async getStoryState(storyId: string): Promise<{
    state: DbStoryState | null;
    events: DbStoryEvent[];
  }> {
    const [stateResult, eventsResult] = await Promise.all([
      this.supabase
        .from('story_state')
        .select('*')
        .eq('story_id', storyId)
        .single(),
      this.supabase
        .from('story_events')
        .select('*')
        .eq('story_id', storyId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
    ]);

    return {
      state: stateResult.data,
      events: eventsResult.data || []
    };
  }

  /**
   * Record a story event (player only)
   */
  async recordEvent(event: {
    storyId: string;
    nodeId: string;
    choiceId?: string;
    choiceText?: string;
    answer?: string;
    collectedItems?: string[];
  }): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    if (!user || user.role === 'reader') {
      return { success: false, error: 'Unauthorized' };
    }

    const { error } = await this.supabase.from('story_events').insert({
      story_id: event.storyId,
      node_id: event.nodeId,
      choice_id: event.choiceId ?? null,
      choice_text: event.choiceText ?? null,
      answer: event.answer ?? null,
      collected_items: event.collectedItems ?? null,
      created_by: user.id
    });

    if (error) {
      console.error('Record event error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  /**
   * Update story state (player only)
   */
  async updateStoryState(
    storyId: string,
    currentNodeId: string,
    collectedItems: string[]
  ): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    if (!user || user.role === 'reader') {
      return { success: false, error: 'Unauthorized' };
    }

    const { error } = await this.supabase
      .from('story_state')
      .upsert({
        story_id: storyId,
        current_node_id: currentNodeId,
        collected_items: collectedItems,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error('Update reader position error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  /**
   * Update reader position
   */
  async updateReaderPosition(
    storyId: string,
    historyIndex: number
  ): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    if (!user || (user.role !== 'reader' && user.role !== 'admin')) {
      return { success: false, error: 'Not authenticated' };
    }

    const { error } = await this.supabase
      .from('reader_positions')
      .upsert({
        user_id: user.id,
        story_id: storyId,
        history_index: historyIndex,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error('Update reader position error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  /**
   * Deprecated PIN-based reader position update (kept for backward compatibility)
   */
  async updateReaderPositionWithPin(
    storyId: string,
    historyIndex: number
  ): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    const pin = this.currentPin();
    if (!user || !pin) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.rpc('update_reader_position', {
      p_pin: pin,
      p_story_id: storyId,
      p_history_index: historyIndex
    });

    if (error) {
      console.error('Update state error:', error);
      return { success: false, error: error.message };
    }

    const response = data as { success: boolean; error?: string } | null;
    if (!response?.success) {
      return { success: false, error: response?.error || 'Update reader position failed' };
    }

    return { success: true };
  }

  /**
   * Subscribe to real-time story events
   */
  subscribeToEvents(
    storyId: string,
    onNewEvent: (event: DbStoryEvent) => void,
    onStateChange: (state: DbStoryState) => void
  ): void {
    // Unsubscribe from previous channel if exists
    this.unsubscribeFromEvents();

    this.realtimeChannel = this.supabase
      .channel(`story:${storyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'story_events',
          filter: `story_id=eq.${storyId}`
        },
        (payload) => {
          onNewEvent(payload.new as DbStoryEvent);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'story_state',
          filter: `story_id=eq.${storyId}`
        },
        (payload) => {
          onStateChange(payload.new as DbStoryState);
        }
      )
      .subscribe();
  }

  /**
   * Unsubscribe from real-time events
   */
  unsubscribeFromEvents(): void {
    if (this.realtimeChannel) {
      this.supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
  }

  /**
   * Generate a new reader PIN (admin only)
   */
  async generateReaderPin(name: string, storyId: string): Promise<GeneratePinResponse> {
    const pin = this.currentPin();
    if (!pin) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.rpc('generate_reader_pin', {
      p_admin_pin: pin,
      p_name: name,
      p_story_id: storyId
    });

    if (error) {
      console.error('Generate PIN error:', error);
      return { success: false, error: error.message };
    }

    return data as GeneratePinResponse;
  }

  /**
   * Get all users (admin only)
   */
  async getUsers(): Promise<GetUsersResponse> {
    const pin = this.currentPin();
    if (!pin) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.rpc('get_all_users', {
      p_admin_pin: pin
    });

    if (error) {
      console.error('Get users error:', error);
      return { success: false, error: error.message };
    }

    return data as GetUsersResponse;
  }

  /**
   * Get reader positions for a story (admin only)
   */
  async getReaderPositions(storyId: string): Promise<ReaderPositionInfo[]> {
    const user = this.currentUser();
    const pin = this.currentPin();
    if (!user || user.role !== 'admin' || !pin) return [];

    const { data, error } = await this.supabase.rpc('admin_get_reader_positions', {
      p_admin_pin: pin,
      p_story_id: storyId
    });

    if (error) {
      console.error('Get reader positions error:', error);
      return [];
    }

    const response = data as { success: boolean; error?: string; positions?: ReaderPositionInfo[] } | null;
    if (!response?.success) {
      console.error('Get reader positions failed:', response?.error);
      return [];
    }

    return (response.positions || []).map(p => ({
      id: p.id,
      name: p.name || 'Unbenannt',
      historyIndex: p.historyIndex
    }));
  }

  /**
   * Delete a user (admin only)
   */
  async deleteUser(userId: string): Promise<{ success: boolean; error?: string }> {
    const pin = this.currentPin();
    if (!pin) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.rpc('delete_user', {
      p_admin_pin: pin,
      p_user_id: userId
    });

    if (error) {
      console.error('Delete user error:', error);
      return { success: false, error: error.message };
    }

    return data as { success: boolean; error?: string };
  }

  // ==========================================
  // Lock Management (Admin only)
  // ==========================================

  /**
   * Get all locked nodes for a story
   */
  async getLockedNodes(storyId: string): Promise<{
    success: boolean;
    error?: string;
    nodes?: Array<{ id: string; title: string; is_locked: boolean; locked_until: string | null }>;
  }> {
    const pin = this.currentPin();
    if (!pin) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.rpc('admin_get_locked_nodes', {
      p_admin_pin: pin,
      p_story_id: storyId
    });

    if (error) {
      console.error('Get locked nodes error:', error);
      return { success: false, error: error.message };
    }

    return data as any;
  }

  /**
   * Get all nodes with their lock status
   */
  async getAllNodesLockStatus(storyId: string): Promise<Array<{
    id: string;
    title: string;
    is_locked: boolean;
    locked_until: string | null;
  }>> {
    const user = this.currentUser();
    const pin = this.currentPin();
    if (!user || user.role !== 'admin' || !pin) return [];

    const { data, error } = await this.supabase.rpc('admin_get_all_nodes_lock_status', {
      p_admin_pin: pin,
      p_story_id: storyId
    });

    if (error) {
      console.error('Get all nodes lock status error:', error);
      return [];
    }

    const response = data as {
      success: boolean;
      error?: string;
      nodes?: Array<{ id: string; title: string; is_locked: boolean; locked_until: string | null }>;
    } | null;

    if (!response?.success) {
      console.error('Get all nodes lock status failed:', response?.error);
      return [];
    }

    return response.nodes || [];
  }

  /**
   * Set lock status for a node (admin only)
   */
  async setNodeLock(
    storyId: string,
    nodeId: string,
    isLocked: boolean,
    lockedUntil?: string | null
  ): Promise<{ success: boolean; error?: string }> {
    const pin = this.currentPin();
    if (!pin) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.rpc('admin_set_node_lock', {
      p_admin_pin: pin,
      p_story_id: storyId,
      p_node_id: nodeId,
      p_is_locked: isLocked,
      p_locked_until: lockedUntil || null
    });

    if (error) {
      console.error('Set node lock error:', error);
      return { success: false, error: error.message };
    }

    return data as { success: boolean; error?: string };
  }

  /**
   * Logout - clear session state
   */
  logout(): void {
    this.unsubscribeFromEvents();
    this.supabase.auth.signOut().catch(err => console.warn('Sign out failed:', err));
    this.currentUser.set(null);
    this.currentStory.set(null);
    this.currentPin.set(null);
    this.currentAccessToken.set(null);
  }

  /**
   * Check if user is admin
   */
  isAdmin(): boolean {
    return this.currentUser()?.role === 'admin';
  }

  /**
   * Check if user is player (admin or player role)
   */
  isPlayer(): boolean {
    const role = this.currentUser()?.role;
    return role === 'admin' || role === 'player';
  }

  /**
   * Check if user is reader
   */
  isReader(): boolean {
    return this.currentUser()?.role === 'reader';
  }

  /**
   * Get full story content from database
   * Returns the story in the same shape as story.json
   */
  async getStoryContent(storyId: string): Promise<Story | null> {
    const { data, error } = await this.supabase.rpc('get_story_content', {
      p_story_id: storyId
    });

    if (error) {
      console.error('Get story content error:', error);
      return null;
    }

    if (!data?.success) {
      console.error('Get story content failed:', data?.error);
      return null;
    }

    return data.story as Story;
  }
}

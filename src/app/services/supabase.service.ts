import { Injectable, signal } from '@angular/core';
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
  last_seen_event_id: number;
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
  readerLastSeenEventId?: number;
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
  lastSeenEventId: number;
  nodeId?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  // Current session state
  private currentUser = signal<AuthResponse['user'] | null>(null);
  private currentStory = signal<AuthResponse['story'] | null>(null);
  private currentAccessToken = signal<string | null>(null);
  private readonly tokenStorageKey = 'adventure.access_token.v3';
  private readonly deprecatedKeys = [
    'adventure.access_token',
    'adventure.access_token.v1',
    'adventure.access_token.v2',
  ];
  private tokenExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  readonly user = this.currentUser.asReadonly();
  readonly story = this.currentStory.asReadonly();
  readonly accessToken = this.currentAccessToken.asReadonly();

  constructor() {
    this.cleanupDeprecatedKeys();

    const restored = this.readStoredAccessToken();
    if (restored && this.isJwtValidAndNotExpired(restored)) {
      this.currentAccessToken.set(restored);
      this.scheduleTokenExpiry(restored);
    } else if (restored) {
      this.clearStoredAccessToken();
    }
  }

  // ==========================================
  // Proxy Helper
  // ==========================================

  private async proxy<T>(endpoint: string, method = 'GET', body?: any): Promise<{ data: T | null; error: any }> {
    try {
      const response = await fetch('/.netlify/functions/supabase-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.currentAccessToken() || ''}`,
        },
        body: JSON.stringify({ endpoint, method, body }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { data: null, error: { message: data.error || `HTTP ${response.status}` } };
      }

      return { data, error: null };
    } catch (error: any) {
      return { data: null, error: { message: error.message || 'Network error' } };
    }
  }

  private async rpc<T>(functionName: string, params?: Record<string, any>): Promise<{ data: T | null; error: any }> {
    return this.proxy<T>(`/rest/v1/rpc/${functionName}`, 'POST', params);
  }

  private async query<T>(
    table: string,
    options: {
      select?: string;
      eq?: Record<string, any>;
      gt?: Record<string, any>;
      order?: { column: string; ascending?: boolean };
      limit?: number;
      single?: boolean;
    } = {}
  ): Promise<{ data: T | null; error: any }> {
    const params = new URLSearchParams();

    if (options.select) {
      params.set('select', options.select);
    }

    if (options.eq) {
      for (const [key, value] of Object.entries(options.eq)) {
        params.set(key, `eq.${value}`);
      }
    }

    if (options.gt) {
      for (const [key, value] of Object.entries(options.gt)) {
        params.set(key, `gt.${value}`);
      }
    }

    if (options.order) {
      params.set('order', `${options.order.column}.${options.order.ascending ? 'asc' : 'desc'}`);
    }

    if (options.limit) {
      params.set('limit', String(options.limit));
    }

    const endpoint = `/rest/v1/${table}?${params.toString()}`;
    const result = await this.proxy<T[]>(endpoint, 'GET');

    if (options.single && result.data) {
      const arr = result.data as unknown as T[];
      return { data: arr.length > 0 ? arr[0] : null, error: result.error };
    }

    return result as { data: T | null; error: any };
  }

  private async insert<T>(table: string, data: Record<string, any>, returnData = true): Promise<{ data: T | null; error: any }> {
    const params = new URLSearchParams();
    if (returnData) {
      params.set('select', '*');
    }

    const endpoint = `/rest/v1/${table}?${params.toString()}`;
    const result = await this.proxy<T[]>(endpoint, 'POST', data);

    if (result.data && Array.isArray(result.data) && result.data.length > 0) {
      return { data: result.data[0], error: null };
    }

    return { data: null, error: result.error };
  }

  private async upsert(table: string, data: Record<string, any>): Promise<{ error: any }> {
    const endpoint = `/rest/v1/${table}?on_conflict=*`;
    const result = await this.proxy(endpoint, 'POST', data);
    return { error: result.error };
  }

  // ==========================================
  // Authentication
  // ==========================================

  async authWithPin(pin: string): Promise<AuthResponse> {
    try {
      const response = await fetch('/.netlify/functions/pin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || `HTTP ${response.status}` };
      }

      return this.handleAuthSuccess(data);
    } catch (error: any) {
      console.error('Auth error:', error);
      return { success: false, error: 'Verbindungsfehler. Prüfe deine Internetverbindung.' };
    }
  }

  private handleAuthSuccess(data: any): AuthResponse {
    const response = data as AuthResponse & {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    if (response.success && (!response.user || !response.story || !response.access_token)) {
      return { success: false, error: 'Login did not return an access token' };
    }

    if (response.success && response.user && response.story && response.access_token) {
      this.currentUser.set(response.user);
      this.currentStory.set(response.story);
      this.currentAccessToken.set(response.access_token);
      this.storeAccessToken(response.access_token);
      this.scheduleTokenExpiry(response.access_token);
    }

    return response;
  }

  async getSessionContext(): Promise<AuthResponse> {
    const { data, error } = await this.rpc<AuthResponse>('get_session_context');
    if (error) {
      return { success: false, error: error.message };
    }
    return data as AuthResponse;
  }

  // ==========================================
  // Story State & Events
  // ==========================================

  async getStoryState(storyId: string): Promise<{ state: DbStoryState | null }> {
    const { data } = await this.query<DbStoryState>('story_state', {
      select: '*',
      eq: { story_id: storyId },
      single: true,
    });
    return { state: data };
  }

  async getMyReaderLastSeenEventId(storyId: string): Promise<number> {
    const user = this.currentUser();
    if (!user) return 0;

    const { data, error } = await this.query<{ last_seen_event_id: number }>('reader_positions', {
      select: 'last_seen_event_id',
      eq: { story_id: storyId },
      single: true,
    });

    if (error) return 0;
    return data?.last_seen_event_id || 0;
  }

  async getStoryEventsPage(storyId: string, afterId: number, limit = 500): Promise<DbStoryEvent[]> {
    const { data, error } = await this.query<DbStoryEvent[]>('story_events', {
      select: '*',
      eq: { story_id: storyId },
      gt: { id: afterId },
      order: { column: 'id', ascending: true },
      limit,
    });

    if (error) {
      console.error('Get story events page error:', error);
      return [];
    }

    return (data as unknown as DbStoryEvent[]) || [];
  }

  async getStoryEventById(storyId: string, eventId: number): Promise<DbStoryEvent | null> {
    if (!eventId) return null;

    const { data, error } = await this.query<DbStoryEvent>('story_events', {
      select: '*',
      eq: { story_id: storyId, id: eventId },
      single: true,
    });

    if (error) return null;
    return data;
  }

  async recordEvent(event: {
    storyId: string;
    nodeId: string;
    choiceId?: string;
    choiceText?: string;
    answer?: string;
    collectedItems?: string[];
  }): Promise<{ success: boolean; error?: string; event?: DbStoryEvent }> {
    const user = this.currentUser();
    if (!user || user.role === 'reader') {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await this.insert<DbStoryEvent>('story_events', {
      story_id: event.storyId,
      node_id: event.nodeId,
      choice_id: event.choiceId ?? null,
      choice_text: event.choiceText ?? null,
      answer: event.answer ?? null,
      collected_items: event.collectedItems ?? null,
      created_by: user.id,
    });

    if (error) {
      console.error('Record event error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, event: data ?? undefined };
  }

  async updateStoryState(
    storyId: string,
    currentNodeId: string,
    collectedItems: string[]
  ): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    if (!user || user.role === 'reader') {
      return { success: false, error: 'Unauthorized' };
    }

    const { error } = await this.upsert('story_state', {
      story_id: storyId,
      current_node_id: currentNodeId,
      collected_items: collectedItems,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Update story state error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  async updateReaderPosition(
    storyId: string,
    lastSeenEventId: number
  ): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    if (!user || (user.role !== 'reader' && user.role !== 'admin')) {
      return { success: false, error: 'Not authenticated' };
    }

    const { error } = await this.upsert('reader_positions', {
      user_id: user.id,
      story_id: storyId,
      last_seen_event_id: lastSeenEventId,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Update reader position error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  // ==========================================
  // Admin Functions
  // ==========================================

  async generateReaderPin(name: string, storyId: string): Promise<GeneratePinResponse> {
    const user = this.currentUser();
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await this.rpc<GeneratePinResponse>('admin_generate_reader_pin', {
      p_name: name,
      p_story_id: storyId,
    });

    if (error) {
      console.error('Generate PIN error:', error);
      return { success: false, error: error.message };
    }

    return data as GeneratePinResponse;
  }

  async getUsers(): Promise<GetUsersResponse> {
    const user = this.currentUser();
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await this.rpc<GetUsersResponse>('admin_get_all_users');

    if (error) {
      console.error('Get users error:', error);
      return { success: false, error: error.message };
    }

    return data as GetUsersResponse;
  }

  async getReaderPositions(storyId: string): Promise<ReaderPositionInfo[]> {
    const user = this.currentUser();
    if (!user || user.role !== 'admin') return [];

    const { data, error } = await this.rpc<{ success: boolean; error?: string; positions?: ReaderPositionInfo[] }>(
      'admin_get_reader_positions_jwt',
      { p_story_id: storyId }
    );

    if (error) {
      console.error('Get reader positions error:', error);
      return [];
    }

    if (!data?.success) {
      console.error('Get reader positions failed:', data?.error);
      return [];
    }

    return (data.positions || []).map(p => ({
      id: p.id,
      name: p.name || 'Unbenannt',
      lastSeenEventId: p.lastSeenEventId || 0,
      nodeId: p.nodeId ?? null,
    }));
  }

  async deleteUser(userId: string): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await this.rpc<{ success: boolean; error?: string }>('admin_delete_user', {
      p_user_id: userId,
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

  async getLockedNodes(storyId: string): Promise<{
    success: boolean;
    error?: string;
    nodes?: Array<{ id: string; title: string; is_locked: boolean; locked_until: string | null }>;
  }> {
    const user = this.currentUser();
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await this.rpc<any>('admin_get_locked_nodes_jwt', {
      p_story_id: storyId,
    });

    if (error) {
      console.error('Get locked nodes error:', error);
      return { success: false, error: error.message };
    }

    return data;
  }

  async getAllNodesLockStatus(storyId: string): Promise<Array<{
    id: string;
    title: string;
    is_locked: boolean;
    locked_until: string | null;
  }>> {
    const user = this.currentUser();
    if (!user || user.role !== 'admin') return [];

    const { data, error } = await this.rpc<{
      success: boolean;
      error?: string;
      nodes?: Array<{ id: string; title: string; is_locked: boolean; locked_until: string | null }>;
    }>('admin_get_all_nodes_lock_status_jwt', { p_story_id: storyId });

    if (error) {
      console.error('Get all nodes lock status error:', error);
      return [];
    }

    if (!data?.success) {
      console.error('Get all nodes lock status failed:', data?.error);
      return [];
    }

    return data.nodes || [];
  }

  async setNodeLock(
    storyId: string,
    nodeId: string,
    isLocked: boolean,
    lockedUntil?: string | null
  ): Promise<{ success: boolean; error?: string }> {
    const user = this.currentUser();
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Unauthorized' };
    }

    const { data, error } = await this.rpc<{ success: boolean; error?: string }>('admin_set_node_lock_jwt', {
      p_story_id: storyId,
      p_node_id: nodeId,
      p_is_locked: isLocked,
      p_locked_until: lockedUntil || null,
    });

    if (error) {
      console.error('Set node lock error:', error);
      return { success: false, error: error.message };
    }

    return data as { success: boolean; error?: string };
  }

  // ==========================================
  // Story Content
  // ==========================================

  async getStoryContent(storyId: string): Promise<Story | null> {
    const { data, error } = await this.rpc<{ success: boolean; error?: string; story?: Story }>('get_story_content', {
      p_story_id: storyId,
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

  // ==========================================
  // Session Management
  // ==========================================

  logout(): void {
    if (this.tokenExpiryTimer) {
      clearTimeout(this.tokenExpiryTimer);
      this.tokenExpiryTimer = null;
    }
    this.currentUser.set(null);
    this.currentStory.set(null);
    this.currentAccessToken.set(null);
    this.clearStoredAccessToken();
  }

  private scheduleTokenExpiry(token: string): void {
    const expMs = this.getJwtExpiryMs(token);
    if (!expMs) return;

    if (this.tokenExpiryTimer) {
      clearTimeout(this.tokenExpiryTimer);
      this.tokenExpiryTimer = null;
    }

    const delayMs = Math.max(0, expMs - Date.now());
    const safeDelayMs = Math.max(1000, delayMs);

    this.tokenExpiryTimer = setTimeout(() => {
      this.logout();
    }, safeDelayMs);
  }

  private isJwtValidAndNotExpired(token: string): boolean {
    const expMs = this.getJwtExpiryMs(token);
    if (!expMs) return false;
    return Date.now() < expMs - 30_000;
  }

  private getJwtExpiryMs(token: string): number | null {
    const payload = this.parseJwtPayload(token);
    const exp = payload?.['exp'];
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
    return exp * 1000;
  }

  private parseJwtPayload(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payloadB64Url = parts[1]!;
      const payloadB64 = payloadB64Url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = payloadB64.padEnd(payloadB64.length + ((4 - (payloadB64.length % 4)) % 4), '=');
      const json = atob(padded);
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private readStoredAccessToken(): string | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      return window.localStorage.getItem(this.tokenStorageKey);
    } catch {
      return null;
    }
  }

  private storeAccessToken(token: string): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(this.tokenStorageKey, token);
    } catch {
      // ignore
    }
  }

  private clearStoredAccessToken(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.removeItem(this.tokenStorageKey);
    } catch {
      // ignore
    }
  }

  private cleanupDeprecatedKeys(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      for (const key of this.deprecatedKeys) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }

  // ==========================================
  // Role Checks
  // ==========================================

  isAdmin(): boolean {
    return this.currentUser()?.role === 'admin';
  }

  isPlayer(): boolean {
    const role = this.currentUser()?.role;
    return role === 'admin' || role === 'player';
  }

  isReader(): boolean {
    return this.currentUser()?.role === 'reader';
  }
}

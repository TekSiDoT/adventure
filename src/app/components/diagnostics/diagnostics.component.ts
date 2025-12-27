import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';

interface TestResult {
  name: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
  timeMs?: number;
}

@Component({
  selector: 'app-diagnostics',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="diagnostics">
      <h1>Verbindungstest</h1>
      <p class="subtitle">Prüft die Verbindung zu allen Diensten</p>

      <button (click)="runTests()" [disabled]="isRunning()">
        {{ isRunning() ? 'Läuft...' : 'Tests starten' }}
      </button>

      <div class="results">
        @for (test of tests(); track test.name) {
          <div class="test" [class]="test.status">
            <span class="icon">
              @switch (test.status) {
                @case ('pending') { ⏳ }
                @case ('success') { ✅ }
                @case ('error') { ❌ }
              }
            </span>
            <span class="name">{{ test.name }}</span>
            @if (test.timeMs) {
              <span class="time">{{ test.timeMs }}ms</span>
            }
            @if (test.message) {
              <span class="message">{{ test.message }}</span>
            }
          </div>
        }
      </div>

      <div class="info">
        <h2>Geräteinformationen</h2>
        <dl>
          <dt>User Agent</dt>
          <dd>{{ userAgent }}</dd>
          <dt>Online Status</dt>
          <dd>{{ navigator.onLine ? 'Online' : 'Offline' }}</dd>
          <dt>Sprache</dt>
          <dd>{{ navigator.language }}</dd>
        </dl>
      </div>

      <a href="/" class="back">← Zurück</a>
    </div>
  `,
  styles: [`
    .diagnostics {
      max-width: 600px;
      margin: 2rem auto;
      padding: 1rem;
      font-family: system-ui, sans-serif;
    }
    h1 { margin: 0 0 0.5rem; }
    .subtitle { color: #666; margin: 0 0 1.5rem; }
    button {
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      background: #4a7c59;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
    }
    button:disabled {
      background: #999;
      cursor: wait;
    }
    .results {
      margin: 1.5rem 0;
    }
    .test {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem;
      border-radius: 8px;
      margin: 0.5rem 0;
      background: #f5f5f5;
    }
    .test.success { background: #e8f5e9; }
    .test.error { background: #ffebee; }
    .icon { font-size: 1.2rem; }
    .name { font-weight: 500; flex: 1; }
    .time { color: #666; font-size: 0.9rem; }
    .message {
      color: #666;
      font-size: 0.85rem;
      display: block;
      width: 100%;
      margin-top: 0.25rem;
    }
    .info {
      margin-top: 2rem;
      padding: 1rem;
      background: #f0f0f0;
      border-radius: 8px;
    }
    .info h2 { margin: 0 0 1rem; font-size: 1rem; }
    dl { margin: 0; }
    dt { font-weight: 500; margin-top: 0.5rem; }
    dd { margin: 0; color: #666; word-break: break-all; font-size: 0.85rem; }
    .back {
      display: inline-block;
      margin-top: 1.5rem;
      color: #4a7c59;
      text-decoration: none;
    }
  `]
})
export class DiagnosticsComponent {
  tests = signal<TestResult[]>([]);
  isRunning = signal(false);
  userAgent = navigator.userAgent;
  navigator = navigator;

  async runTests() {
    this.isRunning.set(true);
    this.tests.set([
      { name: 'Netlify Funktion (Login-Proxy)', status: 'pending' },
      { name: 'Supabase API', status: 'pending' },
      { name: 'Supabase Edge Functions', status: 'pending' },
    ]);

    // Test 1: Netlify function
    await this.runTest(0, async () => {
      const res = await fetch('/.netlify/functions/ping');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return 'OK';
    });

    // Test 2: Supabase main API
    await this.runTest(1, async () => {
      const res = await fetch(`${environment.supabaseUrl}/rest/v1/`, {
        headers: { 'apikey': environment.supabaseAnonKey }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return 'OK';
    });

    // Test 3: Supabase Edge Functions
    await this.runTest(2, async () => {
      const res = await fetch(`${environment.supabaseUrl}/functions/v1/pin-login`, {
        method: 'OPTIONS'
      });
      // OPTIONS should return 200 with CORS headers
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return 'OK';
    });

    this.isRunning.set(false);
  }

  private async runTest(index: number, testFn: () => Promise<string>) {
    const start = Date.now();
    try {
      const message = await testFn();
      this.updateTest(index, {
        status: 'success',
        message,
        timeMs: Date.now() - start
      });
    } catch (error: any) {
      this.updateTest(index, {
        status: 'error',
        message: error.message || String(error),
        timeMs: Date.now() - start
      });
    }
  }

  private updateTest(index: number, update: Partial<TestResult>) {
    this.tests.update(tests => {
      const newTests = [...tests];
      newTests[index] = { ...newTests[index], ...update };
      return newTests;
    });
  }
}

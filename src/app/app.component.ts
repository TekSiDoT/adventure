import { Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router } from '@angular/router';
import { StoryService } from './services/story.service';
import { PinGateComponent } from './components/pin-gate/pin-gate.component';
import { StoryViewComponent } from './components/story-view/story-view.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, PinGateComponent, StoryViewComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  @ViewChild(PinGateComponent) pinGate!: PinGateComponent;

  private storyService = inject(StoryService);
  private router = inject(Router);

  readonly isPinVerified = this.storyService.isPinVerified;
  readonly isAuthLoading = this.storyService.isAuthLoading;

  get isTestRoute(): boolean {
    return this.router.url.startsWith('/mist-test');
  }

  async onPinSubmit(pin: string): Promise<void> {
    const result = await this.storyService.verifyPin(pin);
    if (!result.success) {
      this.pinGate.showError(this.translateError(result.error));
    }
  }

  private translateError(error?: string): string | undefined {
    if (!error) return undefined;
    const translations: Record<string, string> = {
      'Invalid PIN': 'Das war leider falsch. Versuch es nochmal!',
      'No story assigned to this account': 'Diesem Account ist kein Abenteuer zugewiesen.',
      'Story not found': 'Das Abenteuer wurde nicht gefunden.',
      'Too many attempts': 'Zu viele Versuche. Bitte warte einen Moment.',
      'Server not configured': 'Server-Fehler. Bitte später erneut versuchen.',
      'Verbindungsfehler. Prüfe deine Internetverbindung.': 'Verbindungsfehler. Prüfe deine Internetverbindung.',
      'Netzwerkfehler beim Verbinden mit dem Server': 'Netzwerkfehler. Prüfe deine Internetverbindung.',
      'Zeitüberschreitung - Server antwortet nicht': 'Zeitüberschreitung. Bitte versuche es erneut.',
      'Konnte Anfrage nicht senden': 'Verbindungsfehler. Prüfe deine Internetverbindung.',
    };
    return translations[error] || error;
  }
}

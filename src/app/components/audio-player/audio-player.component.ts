import { Component, Input, signal, OnChanges, SimpleChanges, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-audio-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './audio-player.component.html',
  styleUrl: './audio-player.component.scss'
})
export class AudioPlayerComponent implements OnChanges {
  @Input() src: string | null = null;
  @ViewChild('audioElement') audioRef!: ElementRef<HTMLAudioElement>;

  isPlaying = signal<boolean>(false);
  isLoaded = signal<boolean>(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['src']) {
      this.isPlaying.set(false);
      this.isLoaded.set(false);
    }
  }

  onLoaded(): void {
    this.isLoaded.set(true);
  }

  togglePlay(): void {
    const audio = this.audioRef?.nativeElement;
    if (!audio) return;

    if (this.isPlaying()) {
      audio.pause();
      this.isPlaying.set(false);
    } else {
      audio.play();
      this.isPlaying.set(true);
    }
  }

  onEnded(): void {
    this.isPlaying.set(false);
  }
}

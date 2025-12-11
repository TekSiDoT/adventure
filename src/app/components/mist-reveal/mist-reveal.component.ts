import { Component, ElementRef, ViewChild, AfterViewInit, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-mist-reveal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mist-reveal.component.html',
  styleUrl: './mist-reveal.component.scss'
})
export class MistRevealComponent implements AfterViewInit, OnDestroy {
  @ViewChild('turbulence') turbulenceRef!: ElementRef<SVGFETurbulenceElement>;
  @ViewChild('displacement') displacementRef!: ElementRef<SVGFEDisplacementMapElement>;
  @ViewChild('blur') blurRef!: ElementRef<SVGFEGaussianBlurElement>;
  @ViewChild('chantAudio') chantAudioRef!: ElementRef<HTMLAudioElement>;

  @Input() text = '';
  @Output() revealed = new EventEmitter<void>();

  isAnimating = false;
  isRevealed = false;
  isMuted = false;

  ngAfterViewInit(): void {
    // Start with text hidden, then auto-start the reveal
    this.resetAnimation();
    // Auto-start the reveal after a short delay
    setTimeout(() => this.startReveal(), 500);
  }

  resetAnimation(): void {
    this.isRevealed = false;
    this.isAnimating = false;
    if (this.turbulenceRef?.nativeElement) {
      this.turbulenceRef.nativeElement.setAttribute('baseFrequency', '0.08');
    }
    if (this.displacementRef?.nativeElement) {
      this.displacementRef.nativeElement.setAttribute('scale', '80');
    }
    if (this.blurRef?.nativeElement) {
      this.blurRef.nativeElement.setAttribute('stdDeviation', '4');
    }
  }

  ngOnDestroy(): void {
    // Stop audio when component is destroyed
    if (this.chantAudioRef?.nativeElement) {
      this.chantAudioRef.nativeElement.pause();
    }
  }

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    if (this.chantAudioRef?.nativeElement) {
      this.chantAudioRef.nativeElement.muted = this.isMuted;
    }
  }

  startReveal(): void {
    if (this.isAnimating) return;

    this.resetAnimation();
    this.isAnimating = true;

    // Start playing the chant
    if (this.chantAudioRef?.nativeElement) {
      this.chantAudioRef.nativeElement.currentTime = 0;
      this.chantAudioRef.nativeElement.play().catch(() => {
        // Autoplay blocked, user needs to interact first
      });
    }

    const duration = 8000; // 8 seconds
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function (ease-out cubic)
      const eased = 1 - Math.pow(1 - progress, 3);

      // Animate turbulence baseFrequency: 0.08 -> 0.001
      const baseFreq = 0.08 - (0.079 * eased);
      this.turbulenceRef.nativeElement.setAttribute('baseFrequency', baseFreq.toFixed(4));

      // Animate displacement scale: 80 -> 0
      const scale = 80 - (80 * eased);
      this.displacementRef.nativeElement.setAttribute('scale', scale.toFixed(1));

      // Animate blur: 4 -> 0 (faster, in first half)
      const blurProgress = Math.min(progress * 2, 1);
      const blur = 4 - (4 * blurProgress);
      this.blurRef.nativeElement.setAttribute('stdDeviation', blur.toFixed(2));

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.isAnimating = false;
        this.isRevealed = true;
        this.revealed.emit();
      }
    };

    requestAnimationFrame(animate);
  }
}

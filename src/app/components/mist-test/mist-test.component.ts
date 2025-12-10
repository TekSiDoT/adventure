import { Component, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-mist-test',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mist-test.component.html',
  styleUrl: './mist-test.component.scss'
})
export class MistTestComponent implements AfterViewInit {
  @ViewChild('turbulence') turbulenceRef!: ElementRef<SVGFETurbulenceElement>;
  @ViewChild('displacement') displacementRef!: ElementRef<SVGFEDisplacementMapElement>;
  @ViewChild('blur') blurRef!: ElementRef<SVGFEGaussianBlurElement>;

  isAnimating = false;
  isRevealed = false;

  ngAfterViewInit(): void {
    // Start with text hidden
    this.resetAnimation();
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

  startReveal(): void {
    if (this.isAnimating) return;

    this.resetAnimation();
    this.isAnimating = true;

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
      }
    };

    requestAnimationFrame(animate);
  }
}

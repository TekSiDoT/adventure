import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoryService } from '../../services/story.service';
import { InventoryItem } from '../../models/story.model';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.scss'
})
export class InventoryComponent {
  private storyService = inject(StoryService);

  readonly inventory = this.storyService.inventory;
  readonly inventoryCount = this.storyService.inventoryCount;

  isOpen = signal<boolean>(false);
  selectedItem = signal<InventoryItem | null>(null);

  toggle(): void {
    this.isOpen.set(!this.isOpen());
    if (!this.isOpen()) {
      this.selectedItem.set(null);
    }
  }

  close(): void {
    this.isOpen.set(false);
    this.selectedItem.set(null);
  }

  selectItem(item: InventoryItem): void {
    this.selectedItem.set(item);
  }

  clearSelection(): void {
    this.selectedItem.set(null);
  }
}

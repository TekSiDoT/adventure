import { Routes } from '@angular/router';
import { MistTestComponent } from './components/mist-test/mist-test.component';
import { DiagnosticsComponent } from './components/diagnostics/diagnostics.component';

export const routes: Routes = [
  {
    path: 'mist-test',
    component: MistTestComponent
  },
  {
    path: 'diagnostics',
    component: DiagnosticsComponent
  }
];

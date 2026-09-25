import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Routes } from '@angular/router';

import { DashboardComponent } from './components/dashboard/dashboard.component';
import { MetricsComponent } from './components/metrics/metrics.component';
import { DatacheckComponent } from './components/datacheck/datacheck.component';
import { AnalysisComponent } from './components/analysis/analysis.component';

const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'metrics', component: MetricsComponent },
  { path: 'datacheck', component: DatacheckComponent },
  { path: 'analysis', component: AnalysisComponent },
  { path: '**', redirectTo: '' },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideRouter(routes),
  ],
};

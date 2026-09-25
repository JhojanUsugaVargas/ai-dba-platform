import { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, Routes } from '@angular/router';

import { DashboardComponent } from './components/dashboard/dashboard.component';
import { MetricsComponent } from './components/metrics/metrics.component';
import { DatacheckComponent } from './components/datacheck/datacheck.component';
import { AnalysisComponent } from './components/analysis/analysis.component';
import { ChatComponent } from './components/chat/chat.component';
import { LoginComponent } from './components/login/login.component';
import { SettingsComponent } from './components/settings/settings.component';
import { authGuard } from './guards/auth.guard';
import { authInterceptor } from './interceptors/auth.interceptor';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'metrics', component: MetricsComponent, canActivate: [authGuard] },
  { path: 'datacheck', component: DatacheckComponent, canActivate: [authGuard] },
  { path: 'analysis', component: AnalysisComponent, canActivate: [authGuard] },
  { path: 'chat', component: ChatComponent, canActivate: [authGuard] },
  { path: 'settings', component: SettingsComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
  ],
};

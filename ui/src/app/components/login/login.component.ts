import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="logo">
          <h2>🗄️ AI DBA</h2>
          <span>Platform</span>
        </div>
        <h3>Welcome Back</h3>
        <p class="subtitle">Log in to manage your databases</p>

        <form (ngSubmit)="onLogin()">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" name="username" [(ngModel)]="username" required>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" [(ngModel)]="password" required>
          </div>
          <div *ngIf="error" class="error-msg">{{ error }}</div>
          <button type="submit" [disabled]="loading" class="btn-login">
            {{ loading ? 'Logging in...' : 'Log In' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .login-wrapper {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #f0f4ff;
    }
    .login-card {
      background: #fff;
      padding: 40px;
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.1);
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    .logo { margin-bottom: 24px; }
    .logo h2 { color: #0f3460; margin: 0; font-size: 2rem; display: inline-block; }
    .logo span { color: #28a745; font-weight: bold; margin-left: 8px; }
    h3 { margin: 0 0 8px; color: #1a1a2e; }
    .subtitle { color: #666; margin-bottom: 24px; font-size: 14px; }
    .form-group { text-align: left; margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; color: #333; margin-bottom: 6px; font-weight: bold; }
    .form-group input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; box-sizing: border-box; }
    .form-group input:focus { outline: none; border-color: #0f3460; }
    .error-msg { color: #e94560; font-size: 13px; margin-bottom: 16px; text-align: left; }
    .btn-login { width: 100%; padding: 12px; background: #0f3460; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
    .btn-login:hover:not(:disabled) { background: #1a4a7a; }
    .btn-login:disabled { opacity: 0.7; cursor: not-allowed; }
  `]
})
export class LoginComponent {
  username = '';
  password = '';
  loading = false;
  error = '';

  constructor(private api: ApiService, private router: Router) {}

  onLogin() {
    if (!this.username || !this.password) {
      this.error = 'Please enter both username and password';
      return;
    }
    this.loading = true;
    this.error = '';
    this.api.login(this.username, this.password).subscribe({
      next: (res) => {
        localStorage.setItem('token', res.token);
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.loading = false;
        this.error = 'Invalid credentials or server error';
      }
    });
  }
}

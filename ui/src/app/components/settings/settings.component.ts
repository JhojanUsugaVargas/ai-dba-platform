import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-container">
      <h1>⚙️ Configuración / Servers</h1>
      
      <div class="layout-grid">
        <div class="card">
          <h2>Existing Servers</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let server of servers">
                <td>{{ server.name }}</td>
                <td>{{ server.type }}</td>
                <td>
                  <button class="btn btn-danger btn-sm" (click)="deleteServer(server.id || server._id)">Delete</button>
                </td>
              </tr>
              <tr *ngIf="servers.length === 0">
                <td colspan="3">No servers configured.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>Add New Server</h2>
          <form (ngSubmit)="testConnection()" #f="ngForm">
            <div class="form-group">
              <label>Name</label>
              <input type="text" class="form-control" name="name" [(ngModel)]="newServer.name" required>
            </div>
            <div class="form-group">
              <label>Type</label>
              <select class="form-control" name="type" [(ngModel)]="newServer.type" required>
                <option value="postgres">PostgreSQL</option>
                <option value="mssql">MSSQL</option>
                <option value="mongodb">MongoDB</option>
                <option value="redis">Redis</option>
                <option value="dynamodb">DynamoDB</option>
              </select>
            </div>

            <ng-container *ngIf="newServer.type !== 'dynamodb'">
              <div class="form-group">
                <label>Connection String</label>
                <input type="text" class="form-control" name="connectionString" [(ngModel)]="newServer.connectionString" required>
              </div>
              <div class="form-group checkbox" *ngIf="newServer.type === 'mssql'">
                <label>
                  <input type="checkbox" name="windowsAuth" [(ngModel)]="newServer.windowsAuth"> Windows Authentication
                </label>
              </div>
            </ng-container>

            <ng-container *ngIf="newServer.type === 'dynamodb'">
              <div class="form-group">
                <label>AWS Access Key</label>
                <input type="text" class="form-control" name="accessKey" [(ngModel)]="newServer.accessKey" required>
              </div>
              <div class="form-group">
                <label>AWS Secret Key</label>
                <input type="password" class="form-control" name="secretKey" [(ngModel)]="newServer.secretKey" required>
              </div>
              <div class="form-group">
                <label>Region</label>
                <input type="text" class="form-control" name="region" [(ngModel)]="newServer.region" required>
              </div>
            </ng-container>

            <div class="alert alert-info" *ngIf="testResult">{{ testResult }}</div>
            
            <div class="actions">
              <button type="submit" class="btn btn-secondary" [disabled]="!f.valid || testing">
                {{ testing ? 'Testing...' : 'Test Connection' }}
              </button>
              <button type="button" class="btn btn-primary" [disabled]="!testSuccess" (click)="saveServer()">
                Save Server
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .settings-container { padding: 20px; }
    .layout-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
    .card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .table th, .table td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    .form-group { margin-bottom: 15px; }
    .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
    .form-control { width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; }
    .actions { display: flex; gap: 10px; margin-top: 20px; }
    .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; color: white; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-primary { background: #007bff; }
    .btn-secondary { background: #6c757d; }
    .btn-danger { background: #dc3545; }
    .btn-sm { padding: 4px 8px; font-size: 12px; }
    .alert { padding: 10px; border-radius: 4px; margin-top: 15px; }
    .alert-info { background: #e2e3e5; }
    .checkbox label { font-weight: normal; display: flex; align-items: center; gap: 5px; }
    @media (max-width: 768px) { .layout-grid { grid-template-columns: 1fr; } }
  `]
})
export class SettingsComponent implements OnInit {
  servers: any[] = [];
  newServer: any = { type: 'postgres', connectionString: '' };
  
  testing = false;
  testResult = '';
  testSuccess = false;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadServers();
  }

  loadServers() {
    this.api.getServers().subscribe({
      next: (data) => this.servers = data || [],
      error: (err) => console.error('Failed to load servers', err)
    });
  }

  deleteServer(id: string) {
    if(confirm('Are you sure you want to delete this server?')) {
      this.api.deleteServer(id).subscribe({
        next: () => this.loadServers(),
        error: (err) => alert('Failed to delete: ' + err.message)
      });
    }
  }

  getPayload() {
    let payload = { ...this.newServer };
    if (payload.type === 'dynamodb') {
      payload.connectionString = JSON.stringify({
        accessKey: payload.accessKey,
        secretKey: payload.secretKey,
        region: payload.region
      });
    } else if (payload.type === 'mssql' && payload.windowsAuth) {
      if (!payload.connectionString.includes('Integrated Security=')) {
        payload.connectionString += ';Integrated Security=true';
      }
    }
    return payload;
  }

  testConnection() {
    this.testing = true;
    this.testResult = 'Testing...';
    this.testSuccess = false;
    
    this.api.testServer(this.getPayload()).subscribe({
      next: (res) => {
        this.testing = false;
        this.testResult = 'Connection successful!';
        this.testSuccess = true;
      },
      error: (err) => {
        this.testing = false;
        this.testResult = 'Connection failed: ' + (err.error?.message || err.message);
        this.testSuccess = false;
      }
    });
  }

  saveServer() {
    this.api.addServer(this.getPayload()).subscribe({
      next: () => {
        alert('Server added successfully!');
        this.loadServers();
        this.newServer = { type: 'postgres', connectionString: '' };
        this.testResult = '';
        this.testSuccess = false;
      },
      error: (err) => {
        alert('Failed to save server: ' + err.message);
      }
    });
  }
}

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ServerMetric } from '../../services/api.service';

@Component({
  selector: 'app-email-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './email-form.component.html',
  styleUrls: ['./email-form.component.css']
})
export class EmailFormComponent {
  @Input() metrics: ServerMetric[] = [];
  @Output() emailSent = new EventEmitter<void>();

  recipient: string = '';
  smtpServer: string = 'smtp.gmail.com';
  port: number = 587;
  senderEmail: string = '';
  appPassword: string = '';

  isSending: boolean = false;
  successMessage: string = '';
  errorMessage: string = '';

  constructor(private apiService: ApiService) {}

  sendEmail() {
    if (!this.recipient || !this.smtpServer || !this.port || !this.senderEmail || !this.appPassword) {
      this.errorMessage = 'Please fill in all fields.';
      return;
    }

    this.isSending = true;
    this.successMessage = '';
    this.errorMessage = '';

    const smtpConfig = {
      recipient: this.recipient,
      smtpServer: this.smtpServer,
      port: this.port,
      senderEmail: this.senderEmail,
      appPassword: this.appPassword
    };

    this.apiService.sendManualEmail(smtpConfig, this.metrics).subscribe({
      next: () => {
        this.isSending = false;
        this.successMessage = 'Email sent successfully!';
        this.emailSent.emit();
      },
      error: (err) => {
        this.isSending = false;
        this.errorMessage = 'Failed to send email. Check console for details.';
        console.error(err);
      }
    });
  }
}

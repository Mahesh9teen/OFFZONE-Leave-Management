import { Component, inject, output, PendingTasks, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AccountProfile, ProfileInput } from '@leave/contracts';
import { Api } from './api';
import { errorMessage } from './ui-model';
import { ProfileAvatar } from './profile-avatar';
import { Icon } from './icon';

@Component({
  selector: 'app-account',
  imports: [FormsModule, ProfileAvatar, Icon],
  templateUrl: './account.html',
})
export class Account implements OnInit {
  private readonly api = inject(Api);
  private readonly tasks = inject(PendingTasks);
  readonly changed = output<string>();
  readonly profile = signal<AccountProfile | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  draft: ProfileInput = { name: '', phone: '', jobTitle: '' };
  password = { currentPassword: '', newPassword: '', confirmation: '' };

  ngOnInit() { this.tasks.run(() => this.load()); }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const profile = await this.api.profile();
      this.profile.set(profile);
      this.draft = { name: profile.user.name, phone: profile.phone, jobTitle: profile.jobTitle };
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.loading.set(false); }
  }

  async save() {
    await this.perform(async () => {
      const profile = await this.api.updateProfile({ ...this.draft });
      this.profile.set(profile);
      this.draft = { name: profile.user.name, phone: profile.phone, jobTitle: profile.jobTitle };
    }, 'Your profile has been updated.');
  }

  async changePassword() {
    if (this.password.newPassword !== this.password.confirmation) { this.error.set('The new passwords do not match.'); return; }
    await this.perform(async () => {
      await this.api.changePassword({ currentPassword: this.password.currentPassword, newPassword: this.password.newPassword });
      this.password = { currentPassword: '', newPassword: '', confirmation: '' };
    }, 'Password changed. Other sessions have been signed out.');
  }

  private async perform(work: () => Promise<void>, message: string) {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try { await work(); this.success.set(message); this.changed.emit(message); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}

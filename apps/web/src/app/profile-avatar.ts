import { Component, effect, input, signal } from '@angular/core';
import type { User } from '@leave/contracts';
import { initials } from './ui-model';

@Component({
  selector: 'app-profile-avatar',
  template: `
    <span class="avatar profile-avatar" [class.large]="large()" [title]="failed() ? 'Profile photo unavailable. Refresh or upload it again.' : user().name">
      @if (user().photoVersion !== null && !failed()) {
        <img [src]="'/api/profile/photo?v=' + user().photoVersion" [alt]="user().name + ' profile photo'" (error)="failed.set(true)">
      } @else { {{ initials(user().name) }} }
    </span>
    @if (failed()) { <span class="photo-load-error" role="status">{{ large() ? 'Photo could not load. Try refreshing.' : '!' }}</span> }`,
})
export class ProfileAvatar {
  readonly user = input.required<User>();
  readonly large = input(false);
  readonly failed = signal(false);
  protected readonly initials = initials;

  constructor() {
    effect(() => { this.user(); this.failed.set(false); });
  }
}

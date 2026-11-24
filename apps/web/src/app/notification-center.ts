import { Component, effect, inject, input, output, PendingTasks, signal } from '@angular/core';
import type { Notification, NotificationFeed } from '@leave/contracts';
import { Api } from './api';
import { dateLabel, errorMessage } from './ui-model';
import { Icon } from './icon';
import { Modal } from './modal';

@Component({
  selector: 'app-notifications',
  imports: [Icon, Modal],
  template: `
    <button class="notification-trigger icon-button" type="button" aria-label="Notifications" [attr.title]="error() || 'Notifications'" (click)="open()"><app-icon name="bell" />@if (feed()?.unreadCount; as count) { <span class="notification-count">{{ count > 99 ? '99+' : count }}</span> }@if (error()) { <span class="notification-count">!</span> }</button>
    @if (opened()) {
      <app-modal label="Notifications" [busy]="busy()" (dismissed)="opened.set(false)">
        <div class="modal-heading"><div><span class="eyebrow">STAY IN THE LOOP</span><h2>Notifications</h2></div><button type="button" class="icon-button" aria-label="Close notifications" [disabled]="busy()" (click)="opened.set(false)"><app-icon name="close" /></button></div>
        <p class="muted small">Your latest 100 updates. Refreshed when opened or when you refresh the workspace.</p>
        @if (error()) { <div class="alert error" role="alert">{{ error() }}<button class="text-button" (click)="load()">Retry</button></div> }
        <div class="notification-tools"><button class="text-button" [disabled]="busy() || !feed()?.unreadCount" (click)="readAll()">Mark all as read</button></div>
        @if (feed(); as notifications) {
          <div class="notification-list">@for (notice of notifications.items; track notice.id) {
            <button type="button" class="notification-item" [class.unread]="!notice.readAt" [disabled]="busy()" (click)="visit(notice)"><span class="notification-dot"></span><span><strong>{{ notice.title }}</strong><span>{{ notice.message }}</span><small>{{ dateLabel(notice.createdAt) }}</small></span><app-icon name="right" /></button>
          } @empty { <div class="empty-state"><app-icon name="bell" /><p>No notifications yet.</p></div> }</div>
        } @else if (busy()) { <p class="muted">Loading updates...</p> }
      </app-modal>
    }`,
})
export class NotificationCenter {
  private readonly api = inject(Api);
  private readonly tasks = inject(PendingTasks);
  readonly revision = input(0);
  readonly requestOpened = output<{ requestId: string; year: number }>();
  readonly feed = signal<NotificationFeed | null>(null);
  readonly opened = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  protected readonly dateLabel = dateLabel;

  constructor() { effect(() => { this.revision(); this.tasks.run(() => this.load()); }); }

  async load() {
    this.busy.set(true);
    this.error.set('');
    try { this.feed.set(await this.api.notifications()); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  async open() { this.opened.set(true); await this.load(); }

  async visit(notice: Notification) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.readNotification(notice.id);
      this.opened.set(false);
      this.requestOpened.emit({ requestId: notice.requestId, year: notice.requestYear });
      await this.load();
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  async readAll() {
    this.busy.set(true);
    this.error.set('');
    try { await this.api.readNotifications(); await this.load(); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}

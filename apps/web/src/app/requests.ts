import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PERIOD_LABELS, requestDays, type LeaveRequest, type RequestAction, type RequestStatus, type Workspace } from '@leave/contracts';
import { Api } from './api';
import { dateLabel, errorMessage, initials, requestMatches } from './ui-model';
import { Icon } from './icon';
import { Modal } from './modal';
import { RequestDocuments } from './request-documents';
import { ExportCsv, requestsCsv } from './reports';

@Component({
  selector: 'app-requests',
  imports: [FormsModule, Icon, Modal, RequestDocuments, ExportCsv],
  templateUrl: './requests.html',
})
export class Requests {
  private readonly api = inject(Api);
  readonly data = input.required<Workspace>();
  readonly focusRequestId = input('');
  readonly changed = output<string>();
  readonly editRequested = output<LeaveRequest>();
  readonly search = signal('');
  readonly status = signal<RequestStatus | 'all'>('all');
  readonly filtered = computed(() => this.data().requests.filter((request) => requestMatches(request, this.search(), this.status())));
  readonly csv = computed(() => requestsCsv(this.filtered()));
  readonly documentRequest = signal<LeaveRequest | null>(null);
  readonly selection = signal<{ request: LeaveRequest; action: RequestAction } | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  protected readonly dateLabel = dateLabel;
  protected readonly initials = initials;
  protected readonly requestDays = requestDays;
  protected readonly periodLabels = PERIOD_LABELS;
  note = '';

  constructor() { effect(() => { this.search.set(this.focusRequestId()); this.status.set('all'); }); }

  begin(request: LeaveRequest, action: RequestAction) {
    this.note = '';
    this.error.set('');
    this.selection.set({ request, action });
  }

  async confirm() {
    const selection = this.selection();
    if (!selection) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.transition(selection.request.id, selection.action, this.note.trim(), selection.request.version ?? 1);
      this.selection.set(null);
      this.changed.emit(`Request ${selection.action}. Balances and team capacity have been updated.`);
    } catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}

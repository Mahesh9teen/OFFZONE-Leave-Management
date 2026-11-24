import { Component, computed, inject, input, output, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CreateRequestInput, LeaveRequest, RequestPreview, Workspace } from '@leave/contracts';
import { Api } from './api';
import { errorMessage, minimumLeaveDate, type LeaveDateRange } from './ui-model';
import { Icon } from './icon';
import { Modal } from './modal';

@Component({
  selector: 'app-request-form',
  imports: [FormsModule, Icon, Modal],
  template: `
    <app-modal [label]="existingRequest() ? 'Edit leave request' : 'Request leave'" [busy]="busy()" (dismissed)="closed.emit()">
      <div class="modal-heading"><div><span class="eyebrow">MAKE A LITTLE SPACE</span><h2>{{ existingRequest() ? 'Edit leave request' : 'Request leave' }}</h2></div><button class="icon-button" type="button" aria-label="Close request form" [disabled]="busy()" (click)="closed.emit()"><app-icon name="close" /></button></div>
      <p class="muted">Weekends and public holidays are on us.</p>
      @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
      <form #requestForm="ngForm" (ngSubmit)="submit()">
        <fieldset [disabled]="busy()">
          <label>Leave type<select name="leaveType" [(ngModel)]="draft.leaveTypeId" (ngModelChange)="invalidate()" required autofocus>@for (type of data().leaveTypes; track type.id) { <option [value]="type.id">{{ type.name }}</option> }</select></label>
          <label>Day portion<select name="period" [ngModel]="draft.period || 'full'" (ngModelChange)="draft.period = $event; datesChanged()" required><option value="full">Full day</option><option value="am">Morning (AM) - 0.5 day</option><option value="pm">Afternoon (PM) - 0.5 day</option></select></label>
          <div class="form-grid"><label>Start date<input type="date" name="startDate" [(ngModel)]="draft.startDate" (ngModelChange)="datesChanged()" [min]="minimumDate()" max="2100-12-31" required></label>
            <label>End date<input type="date" name="endDate" [(ngModel)]="draft.endDate" (ngModelChange)="invalidate()" [readOnly]="(draft.period || 'full') !== 'full'" [min]="draft.startDate || minimumDate()" max="2100-12-31" required></label></div>
          <label>Reason<textarea name="reason" [(ngModel)]="draft.reason" (ngModelChange)="invalidate()" minlength="3" maxlength="1000" rows="3" placeholder="Let your manager know a little about your plans." required></textarea></label>
          <p class="small muted">Minimum notice: {{ data().settings.minNoticeDays }} calendar days. Pending requests reserve both balance and team capacity.</p>
          @if (preview()) {
            <div class="preview-box"><app-icon name="check" /><div><strong>{{ previewDays() }} working {{ previewDays() === 1 ? 'day' : 'days' }}</strong><p>@for (part of yearBreakdown(); track part[0]) { <span>{{ part[0] }}: {{ part[1] }} days. </span> }Your balance and team coverage currently allow this request.</p><small>Availability is checked again when you submit.</small></div></div>
          }
          <div class="modal-actions"><button class="button secondary" type="button" (click)="check()" [disabled]="requestForm.invalid || busy()">Check availability</button><button class="button primary" type="submit" [disabled]="requestForm.invalid || busy()">{{ busy() ? 'Working...' : existingRequest() ? 'Save changes' : 'Submit request' }}<app-icon name="right" /></button></div>
        </fieldset>
      </form>
    </app-modal>`,
})
export class RequestForm implements OnInit {
  private readonly api = inject(Api);
  readonly data = input.required<Workspace>();
  readonly initialDates = input<LeaveDateRange | null>(null);
  readonly existingRequest = input<LeaveRequest | null>(null);
  readonly saved = output<void>();
  readonly closed = output<void>();
  readonly busy = signal(false);
  readonly error = signal('');
  readonly preview = signal<RequestPreview | null>(null);
  readonly yearBreakdown = computed(() => Object.entries(this.preview()?.daysByYear ?? {}));
  readonly previewDays = computed(() => Object.values(this.preview()?.daysByYear ?? {}).reduce((total, days) => total + days, 0));
  readonly minimumDate = computed(() => {
    const minimum = minimumLeaveDate(this.data());
    const previous = this.existingRequest();
    return previous && previous.startDate < minimum ? previous.startDate : minimum;
  });
  draft: CreateRequestInput = { leaveTypeId: '', startDate: '', endDate: '', reason: '', period: 'full' };

  ngOnInit() {
    const previous = this.existingRequest();
    if (previous) {
      this.draft = { leaveTypeId: previous.leaveTypeId, startDate: previous.startDate, endDate: previous.endDate, reason: previous.reason, period: previous.period ?? 'full' };
      return;
    }
    this.draft.leaveTypeId = this.data().leaveTypes[0]?.id ?? '';
    const dates = this.initialDates();
    if (dates) {
      this.draft.startDate = dates.startDate;
      this.draft.endDate = dates.endDate;
      this.draft.period = dates.period ?? 'full';
    }
  }
  invalidate() { this.preview.set(null); this.error.set(''); }
  datesChanged() { if ((this.draft.period ?? 'full') !== 'full') this.draft.endDate = this.draft.startDate; this.invalidate(); }
  async check() {
    this.busy.set(true);
    this.error.set('');
    this.preview.set(null);
    try {
      const previous = this.existingRequest();
      this.preview.set(previous
        ? await this.api.previewEdit(previous.id, { ...this.draft, version: previous.version ?? 1 })
        : await this.api.preview({ ...this.draft }));
    }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      const previous = this.existingRequest();
      if (previous) await this.api.edit(previous.id, { ...this.draft, version: previous.version ?? 1 });
      else await this.api.create({ ...this.draft });
      this.saved.emit();
    }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}

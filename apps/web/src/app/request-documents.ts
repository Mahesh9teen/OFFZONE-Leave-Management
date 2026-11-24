import { Component, computed, inject, input, output, PendingTasks, signal, type OnInit } from '@angular/core';
import { UPLOAD_LIMITS, type LeaveRequest, type RequestDocument, type User } from '@leave/contracts';
import { Api } from './api';
import { dateLabel, errorMessage } from './ui-model';
import { downloadFile } from './reports';
import { Icon } from './icon';
import { Modal } from './modal';

@Component({
  selector: 'app-request-documents',
  imports: [Icon, Modal],
  template: `
    <app-modal label="Supporting documents" [busy]="busy()" (dismissed)="closed.emit()">
      <div class="modal-heading"><div><span class="eyebrow">LEAVE REQUEST DETAILS</span><h2>Supporting documents</h2></div><button type="button" class="icon-button" aria-label="Close documents" [disabled]="busy()" (click)="closed.emit()"><app-icon name="close" /></button></div>
      <p>{{ request().employeeName }} &middot; {{ request().leaveTypeName }} &middot; {{ dateLabel(request().startDate) }}</p>
      <div class="alert info small">Use sample files in shared demo accounts. Do not upload real medical or identity records. Documents are visible only to the account owner, their manager, and admins.</div>
      @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
      @if (documents(); as items) {
        <div class="document-list">@for (document of items; track document.id) {
          <div class="document-item"><app-icon name="attachment" /><div><strong>{{ document.filename }}</strong><small>{{ sizeLabel(document.size) }} &middot; {{ dateLabel(document.createdAt) }}</small></div><button class="icon-button" [attr.aria-label]="'Download ' + document.filename" [disabled]="busy()" (click)="download(document)"><app-icon name="download" /></button>@if (canEdit()) { <button class="icon-button danger-text" [attr.aria-label]="'Remove ' + document.filename" [disabled]="busy()" (click)="remove(document)"><app-icon name="close" /></button> }</div>
        } @empty { <div class="empty-state small"><app-icon name="attachment" /><p>No supporting documents attached.</p></div> }</div>
      } @else if (busy()) { <p class="muted">Loading documents...</p> }
      @if (canEdit()) {
        <label class="document-upload">Add supporting files<input type="file" multiple accept="application/pdf,image/jpeg,image/png" [disabled]="busy()" (change)="chooseFiles($event)"></label>
        <p class="muted small">PDF, JPEG, or PNG; up to 5 MB each and 3 documents per request. Attach files while the request is pending.</p>
        @if (files().length) { <ul class="selected-files">@for (file of files(); track $index) { <li>{{ file.name }}</li> }</ul> }
        <div class="modal-actions"><button class="button primary" type="button" [disabled]="!files().length || busy()" (click)="upload()"><app-icon name="upload" />Upload documents</button></div>
      } @else { <p class="muted small">Only the employee can add or remove documents, and only while the request is pending.</p> }
      <p class="small muted section-copy">Files are validated but not virus-scanned. Download only documents you trust.</p>
    </app-modal>`,
})
export class RequestDocuments implements OnInit {
  private readonly api = inject(Api);
  private readonly tasks = inject(PendingTasks);
  readonly request = input.required<LeaveRequest>();
  readonly user = input.required<User>();
  readonly closed = output<void>();
  readonly documents = signal<RequestDocument[] | null>(null);
  readonly files = signal<File[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly canEdit = computed(() => this.user().role === 'employee' && this.user().id === this.request().employeeId && this.request().status === 'pending');
  protected readonly dateLabel = dateLabel;

  ngOnInit() { this.tasks.run(() => this.load()); }
  sizeLabel(size: number) { return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`; }

  async load() { await this.update(() => this.api.documents(this.request().id)); }

  chooseFiles(event: Event) {
    this.files.set([]);
    this.error.set('');
    if (!(event.target instanceof HTMLInputElement)) return;
    const files = Array.from(event.target.files ?? []);
    if (files.length + (this.documents()?.length ?? 0) > UPLOAD_LIMITS.documentsPerRequest
      || files.some((file) => file.size > UPLOAD_LIMITS.documentBytes || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))) {
      this.error.set('Choose PDF, JPEG, or PNG files up to 5 MB each. A request can have at most 3 documents.');
      event.target.value = '';
      return;
    }
    this.files.set(files);
  }

  async upload() {
    await this.update(async () => {
      const documents = await this.api.uploadDocuments(this.request().id, this.files());
      this.files.set([]);
      return documents;
    });
  }

  async remove(document: RequestDocument) { await this.update(() => this.api.deleteDocument(this.request().id, document.id)); }

  async download(document: RequestDocument) {
    this.busy.set(true);
    this.error.set('');
    try { downloadFile(await this.api.downloadDocument(this.request().id, document.id), document.filename); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  private async update(work: () => Promise<RequestDocument[]>) {
    this.busy.set(true);
    this.error.set('');
    try { this.documents.set(await work()); }
    catch (error) { this.error.set(errorMessage(error)); }
    finally { this.busy.set(false); }
  }
}

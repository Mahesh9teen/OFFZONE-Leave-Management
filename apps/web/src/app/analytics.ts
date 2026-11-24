import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Workspace } from '@leave/contracts';
import { ExportCsv, monthlyCsv, monthlyLeaveTotals } from './reports';

@Component({
  selector: 'app-leave-analytics',
  imports: [FormsModule, ExportCsv],
  template: `
    <section class="card analytics-card">
      <div class="section-header analytics-tools"><div><h2>Leave, month by month</h2><p class="muted small">Charged working dates in {{ data().year }}. Half-days count as 0.5. Only records available to your role are included.</p></div>
        <div class="filter-controls"><label>Analytics leave type<select [ngModel]="leaveType()" (ngModelChange)="leaveType.set($event)"><option value="all">All leave types</option>@for (type of data().leaveTypes; track type.id) { <option [value]="type.id">{{ type.name }}</option> }</select></label><app-export-csv [content]="csv()" [filename]="'offzone-monthly-' + data().year + '.csv'" label="Export analytics" /></div>
      </div>
      <div class="analytics-summary"><span><strong>{{ approved() }}</strong> approved days</span><span><strong>{{ pending() }}</strong> pending days</span><span><strong>{{ selectedRequests().length }}</strong> requests in view</span></div>
      <div class="table-scroll"><table><thead><tr><th>Month</th><th>Approved + pending</th><th>Approved</th><th>Pending</th><th>Rejected</th><th>Cancelled</th><th>Requests</th></tr></thead>
        <tbody>@for (row of rows(); track row.month) {
          <tr><th scope="row">{{ row.label }}</th><td><div class="analytics-bar" role="img" [attr.aria-label]="row.label + ': ' + row.approved + ' approved days, ' + row.pending + ' pending days'"><span class="approved-segment" [style.width.%]="row.approved / maximum() * 100"></span><span class="pending-segment" [style.width.%]="row.pending / maximum() * 100"></span></div></td><td>{{ row.approved }}</td><td>{{ row.pending }}</td><td>{{ row.rejected }}</td><td>{{ row.cancelled }}</td><td>{{ row.requests }}</td></tr>
        }</tbody></table></div>
      <p class="small muted analytics-note">A request spanning months appears in each affected month's request count. Day totals are allocated only to their charged dates; rejected/cancelled days do not reserve balance.</p>
    </section>`,
})
export class LeaveAnalytics {
  readonly data = input.required<Workspace>();
  readonly leaveType = signal('all');
  readonly selectedRequests = computed(() => this.data().requests.filter((request) =>
    request.workingDates.some((date) => date.startsWith(`${this.data().year}-`))
    && (this.leaveType() === 'all' || request.leaveTypeId === this.leaveType())));
  readonly rows = computed(() => monthlyLeaveTotals(this.selectedRequests(), this.data().year));
  readonly approved = computed(() => this.rows().reduce((sum, row) => sum + row.approved, 0));
  readonly pending = computed(() => this.rows().reduce((sum, row) => sum + row.pending, 0));
  readonly maximum = computed(() => Math.max(1, ...this.rows().map((row) => row.approved + row.pending)));
  readonly csv = computed(() => monthlyCsv(this.rows(), this.data().year));
}

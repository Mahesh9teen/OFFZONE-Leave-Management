import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Workspace } from '@leave/contracts';
import { BalanceCards } from './balance-cards';
import { initials } from './ui-model';
import { balancesCsv, ExportCsv } from './reports';

@Component({
  selector: 'app-balances',
  imports: [FormsModule, BalanceCards, ExportCsv],
  template: `
    <section class="card section-header balance-toolbar"><div><h2>Every day, accounted for.</h2><p class="muted small">Calendar-year allowances for {{ data().year }}. Pending requests are already deducted.</p></div><app-export-csv [content]="csv()" [filename]="'offzone-balances-' + data().year + '.csv'" [label]="data().user.role === 'employee' ? 'Export balances' : 'Export all balances'" />
      @if (data().user.role !== 'employee') { <label>Employee<select [ngModel]="selected()?.employee?.id" (ngModelChange)="employeeId.set($event)">@for (summary of data().employees; track summary.employee.id) { <option [value]="summary.employee.id">{{ summary.employee.name }}</option> }</select></label> }
    </section>
    @if (selected(); as summary) { <div class="balance-person"><span class="avatar">{{ initials(summary.employee.name) }}</span><div><h3>{{ summary.employee.name }}</h3><span class="muted small">{{ summary.employee.email }}</span></div></div><app-balance-cards [balances]="summary.balances" /> }
    @if (data().user.role !== 'employee') {
      <section class="card team-balance-table"><div class="section-header"><h2>Team balance overview</h2></div><div class="table-scroll"><table><thead><tr><th>Employee</th>@for (type of data().leaveTypes; track type.id) { <th>{{ type.name }} remaining</th> }</tr></thead><tbody>@for (summary of data().employees; track summary.employee.id) { <tr><td><button class="text-button" (click)="employeeId.set(summary.employee.id)">{{ summary.employee.name }}</button></td>@for (balance of summary.balances; track balance.leaveTypeId) { <td [class.negative]="balance.remaining < 0"><strong>{{ balance.remaining }}</strong> / {{ balance.allowance + (balance.carryoverGranted || 0) }} days</td> }</tr> }</tbody></table></div></section>
    }
    <div class="policy-footnote"><strong>How your balance works</strong><p>Approved and pending leave reserve days; AM/PM requests use 0.5 day. Rejected and cancelled requests release their original funding. From 2027, eligible leave can carry up to 5 unused base days into the next year until March 31. Carry-over is used first for eligible dates and does not renew after expiry.</p></div>`,
})
export class Balances {
  readonly data = input.required<Workspace>();
  readonly employeeId = signal('');
  readonly selected = computed(() => this.data().employees.find((summary) => summary.employee.id === this.employeeId()) ?? this.data().employees[0]);
  readonly csv = computed(() => balancesCsv(this.data().employees, this.data().year));
  protected readonly initials = initials;
}

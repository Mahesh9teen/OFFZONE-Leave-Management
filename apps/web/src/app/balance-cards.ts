import { Component, input } from '@angular/core';
import type { Balance } from '@leave/contracts';
import { balanceWidths, dateLabel } from './ui-model';

@Component({
  selector: 'app-balance-cards',
  template: `
    <div class="balance-grid">
      @for (balance of balances(); track balance.leaveTypeId; let index = $index) {
        <article class="card balance-card">
          <div class="row"><span class="type-mark" [class.secondary]="index === 1" [class.tertiary]="index > 1">{{ balance.leaveTypeName.slice(0, 1) }}</span><h3>{{ balance.leaveTypeName }} leave</h3></div>
          <div class="balance-number" [class.negative]="balance.remaining < 0">{{ balance.remaining }}<span> / {{ balance.allowance + (balance.carryoverGranted || 0) }} days available</span></div>
          <div class="balance-chart" role="img" [attr.aria-label]="balance.leaveTypeName + ': ' + balance.approved + ' approved, ' + balance.pending + ' pending, ' + balance.remaining + ' remaining'">
            <span class="approved-segment" [style.width.%]="widths(balance).approved"></span><span class="pending-segment" [style.width.%]="widths(balance).pending"></span>
            @if (balance.carryoverExpired) { <span class="expired-segment" [style.width.%]="widths(balance).expired"></span> }
          </div>
          <div class="chart-legend"><span><i class="legend-dot approved"></i>{{ balance.approved }} approved</span><span><i class="legend-dot pending"></i>{{ balance.pending }} pending</span></div>
          @if (balance.carryoverGranted) {
            <div class="carryover-note"><strong>{{ balance.carryoverRemaining || 0 }} carry-over days remaining</strong><span>{{ balance.carryoverGranted }} granted &middot; {{ balance.carryoverUsed || 0 }} reserved/used</span>@if (balance.carryoverExpiresOn) { <small>Valid through {{ dateLabel(balance.carryoverExpiresOn) }}. Unused carry-over expires, not the base allowance.</small> }@if (balance.carryoverExpired) { <small>{{ balance.carryoverExpired }} unused carry-over days expired.</small> }</div>
          }
          @if (balance.remaining < 0 || (balance.baseRemaining ?? balance.remaining) < 0) { <p class="small negative">Allowance was reduced below existing reservations.</p> }
        </article>
      }
    </div>`,
})
export class BalanceCards {
  readonly balances = input.required<Balance[]>();
  protected readonly widths = balanceWidths;
  protected readonly dateLabel = dateLabel;
}

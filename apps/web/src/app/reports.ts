import { Component, input, signal } from '@angular/core';
import { PERIOD_LABELS, periodDays, requestDays, type CalendarEntry, type EmployeeSummary, type LeaveRequest } from '@leave/contracts';
import { Icon } from './icon';
import { errorMessage } from './ui-model';

function csv(rows: (string | number)[][]): string {
  return '\uFEFF' + rows.map((row) => row.map((value) => {
    const text = String(value);
    const safe = typeof value === 'string' && /^\s*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}

export function requestsCsv(requests: LeaveRequest[]): string {
  return csv([
    ['Employee', 'Team', 'Leave type', 'Start date', 'End date', 'Working days', 'Reason', 'Status', 'Decision note', 'Day portion'],
    ...requests.map((request) => [request.employeeName, request.teamName, request.leaveTypeName, request.startDate,
      request.endDate, requestDays(request), request.reason, request.status, request.decisionNote, PERIOD_LABELS[request.period ?? 'full']]),
  ]);
}

export function balancesCsv(employees: EmployeeSummary[], year: number): string {
  return csv([
    ['Employee', 'Year', 'Leave type', 'Allowance', 'Approved', 'Pending', 'Remaining', 'Carry-over granted', 'Carry-over remaining', 'Carry-over expired'],
    ...employees.flatMap(({ employee, balances }) => balances.map((balance) =>
      [employee.name, year, balance.leaveTypeName, balance.allowance, balance.approved, balance.pending, balance.remaining,
        balance.carryoverGranted ?? 0, balance.carryoverRemaining ?? 0, balance.carryoverExpired ?? 0])),
  ]);
}

export interface MonthlyLeaveTotal {
  month: number;
  label: string;
  approved: number;
  pending: number;
  rejected: number;
  cancelled: number;
  requests: number;
}

export function monthlyLeaveTotals(requests: LeaveRequest[], year: number): MonthlyLeaveTotal[] {
  const rows = Array.from({ length: 12 }, (_, month) => ({
    month, label: new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1))),
    approved: 0, pending: 0, rejected: 0, cancelled: 0, requests: 0,
  }));
  for (const request of requests) {
    const months = new Set<number>();
    for (const date of request.workingDates.filter((day) => day.startsWith(`${year}-`))) {
      const month = Number(date.slice(5, 7)) - 1;
      if (!rows[month]) throw new Error('A request contains an invalid working date.');
      rows[month][request.status] += periodDays(request.period);
      months.add(month);
    }
    for (const month of months) rows[month].requests++;
  }
  return rows;
}

export function monthlyCsv(rows: MonthlyLeaveTotal[], year: number): string {
  return csv([['Year', 'Month', 'Approved days', 'Pending days', 'Rejected days', 'Cancelled days', 'Requests'],
    ...rows.map((row) => [year, row.label, row.approved, row.pending, row.rejected, row.cancelled, row.requests])]);
}

const calendarText = (value: string) => value.replaceAll('\\', '\\\\').replace(/\r\n|\r|\n/g, '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
const calendarTime = (value: Date) => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function foldCalendarLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const length = encoder.encode(character).length;
    if (bytes + length > 75) { parts.push(current); current = ' '; bytes = 1; }
    current += character;
    bytes += length;
  }
  parts.push(current);
  return parts.join('\r\n');
}

export function calendarIcs(entries: CalendarEntry[], teamId: string, year: number, month: number, generatedAt: Date): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error('Select a valid calendar year and month.');
  }
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OFFZONE//Leave Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const entry of entries.filter((item) => item.teamId === teamId && (item.status === 'approved' || item.status === 'pending'))) {
    for (const date of [...new Set(entry.workingDates)].filter((day) => day.startsWith(prefix)).sort()) {
      const day = date.replaceAll('-', '');
      const period = entry.period ?? 'full';
      lines.push('BEGIN:VEVENT', `UID:${calendarText(`${entry.id}-${date}@offzone.local`)}`,
        `DTSTAMP:${calendarTime(generatedAt)}`, `SEQUENCE:${entry.version ?? 1}`,
        `LAST-MODIFIED:${calendarTime(new Date(entry.updatedAt ?? generatedAt))}`);
      if (period === 'full') {
        const end = new Date(`${date}T00:00:00.000Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replaceAll('-', '')}`);
      } else {
        lines.push(`DTSTART:${day}T${period === 'am' ? '090000' : '130000'}Z`, `DTEND:${day}T${period === 'am' ? '130000' : '170000'}Z`);
      }
      lines.push(`SUMMARY:${calendarText(`${entry.employeeName} - ${entry.leaveTypeName} (${PERIOD_LABELS[period]})`)}`,
        `STATUS:${entry.status === 'approved' ? 'CONFIRMED' : 'TENTATIVE'}`, 'TRANSP:OPAQUE', 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldCalendarLine).join('\r\n') + '\r\n';
}

export function downloadFile(content: Blob, filename: string): void {
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

@Component({
  selector: 'app-export-csv',
  imports: [Icon],
  template: `<button type="button" class="button secondary compact" (click)="save()"><app-icon name="download" />{{ label() }}</button>@if (error()) { <p class="negative small" role="alert">{{ error() }}</p> }`,
})
export class ExportCsv {
  readonly content = input.required<string>();
  readonly filename = input.required<string>();
  readonly label = input('Export CSV');
  readonly error = signal('');

  save() {
    this.error.set('');
    try { downloadFile(new Blob([this.content()], { type: 'text/csv;charset=utf-8' }), this.filename()); }
    catch (error) { this.error.set(errorMessage(error)); }
  }
}

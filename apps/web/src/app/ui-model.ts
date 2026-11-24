import { HttpErrorResponse } from '@angular/common/http';
import { periodDays, periodsOverlap, type Balance, type CalendarEntry, type CreateRequestInput, type Holiday, type LeavePeriod, type LeaveRequest, type RequestStatus, type Workspace } from '@leave/contracts';

export type View = 'overview' | 'requests' | 'calendar' | 'balances' | 'settings' | 'profile' | 'people' | 'insights' | 'analytics';
export type LeaveDateRange = Pick<CreateRequestInput, 'startDate' | 'endDate' | 'period'>;

export interface LeaveDayAvailability {
  state: 'available' | 'excluded' | 'blocked';
  label: string;
  detail: string;
}

export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(date));
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function peopleOff(entries: CalendarEntry[], date: string, period: LeavePeriod = 'full'): number {
  return new Set(entries.filter((entry) => (entry.status === 'approved' || entry.status === 'pending')
    && entry.workingDates.includes(date) && periodsOverlap(entry.period, period)).map((entry) => entry.employeeId)).size;
}

export function balanceWidths(balance: Balance): { approved: number; pending: number; expired?: number } {
  const expired = balance.carryoverExpired ?? 0;
  const total = Math.max(balance.allowance + (balance.carryoverGranted ?? 0), balance.approved + balance.pending + expired, 1);
  return { approved: balance.approved / total * 100, pending: balance.pending / total * 100,
    ...(expired > 0 ? { expired: expired / total * 100 } : {}) };
}

export function requestMatches(request: LeaveRequest, search: string, status: RequestStatus | 'all'): boolean {
  const text = `${request.id} ${request.employeeName} ${request.leaveTypeName} ${request.reason}`.toLowerCase();
  return (status === 'all' || request.status === status) && text.includes(search.trim().toLowerCase());
}

export function calendarCells(
  year: number, month: number, today: string, holidays: Holiday[], entries: CalendarEntry[], teamId: string,
) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const holidayNames = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
  const reserved = entries.filter((entry) => entry.teamId === teamId && (entry.status === 'pending' || entry.status === 'approved'));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, 1 - offset + index));
    const key = date.toISOString().slice(0, 10);
    return {
      date: key, day: date.getUTCDate(), inMonth: date.getUTCMonth() === month,
      weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
      isToday: key === today, holiday: holidayNames.get(key) ?? null,
      entries: reserved.filter((entry) => entry.workingDates.includes(key)),
    };
  });
}

export function minimumLeaveDate(data: Pick<Workspace, 'today' | 'settings'>): string {
  const date = new Date(`${data.today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + data.settings.minNoticeDays);
  return date.toISOString().slice(0, 10);
}

function overlapsOwnLeave(range: LeaveDateRange, data: Workspace, period: LeavePeriod = 'full'): boolean {
  return data.requests.some((request) => request.employeeId === data.user.id
    && (request.status === 'pending' || request.status === 'approved')
    && request.startDate <= range.endDate && request.endDate >= range.startDate && periodsOverlap(request.period, period));
}

export function leaveDayAvailability(date: string, data: Workspace, teamId: string, period: LeavePeriod = 'full'): LeaveDayAvailability {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return { state: 'excluded', label: 'Weekend', detail: 'Weekends do not count as leave days. Select a working day.' };
  }
  const holiday = data.holidays.find((item) => item.date === date);
  if (holiday) return { state: 'excluded', label: 'Holiday', detail: `${holiday.name} is a public holiday and does not count as leave.` };
  if (date < data.today) return { state: 'blocked', label: 'Past date', detail: 'New leave cannot start in the past.' };
  if (date < minimumLeaveDate(data)) {
    return { state: 'blocked', label: 'Too soon', detail: `Leave needs ${data.settings.minNoticeDays} calendar days of notice. Choose ${dateLabel(minimumLeaveDate(data))} or later.` };
  }
  if (overlapsOwnLeave({ startDate: date, endDate: date }, data, period)) {
    return { state: 'blocked', label: 'Your leave', detail: 'You already have pending or approved leave covering this date and period.' };
  }
  const team = data.calendar.filter((entry) => entry.teamId === teamId);
  const count = period === 'full' ? Math.max(peopleOff(team, date, 'am'), peopleOff(team, date, 'pm')) : peopleOff(team, date, period);
  if (count >= data.settings.maxTeamOff) {
    return { state: 'blocked', label: 'Team full', detail: `The team has reached its limit of ${data.settings.maxTeamOff} people off in the selected period.` };
  }
  return { state: 'available', label: 'Available', detail: 'Available in the current team calendar, subject to your leave balance and a final server check.' };
}

export function summarizeLeaveSelection(range: LeaveDateRange, data: Workspace, teamId: string, period: LeavePeriod = range.period ?? 'full'): { workingDays: number; error: string } {
  if (period !== 'full' && range.startDate !== range.endDate) return { workingDays: 0, error: 'Half-day leave must use a single working date.' };
  let workingDays = 0;
  let error = overlapsOwnLeave(range, data, period) ? 'This selection overlaps your pending or approved leave.' : '';
  const end = Date.parse(`${range.endDate}T00:00:00.000Z`);
  for (let cursor = Date.parse(`${range.startDate}T00:00:00.000Z`); cursor <= end; cursor += 86_400_000) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const availability = leaveDayAvailability(date, data, teamId, period);
    if (availability.state === 'excluded') continue;
    workingDays += periodDays(period);
    if (!error && availability.state === 'blocked') error = `${dateLabel(date)}: ${availability.detail}`;
  }
  return { workingDays, error: error || (workingDays ? '' : 'Select at least one working day.') };
}

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Cannot reach the server. Check your connection and try again.';
    const body: unknown = error.error;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      if (typeof body.message === 'string') return body.message;
      if (Array.isArray(body.message) && body.message.every((message) => typeof message === 'string')) return body.message.join('. ');
    }
  }
  return 'The operation could not be completed. Please try again.';
}

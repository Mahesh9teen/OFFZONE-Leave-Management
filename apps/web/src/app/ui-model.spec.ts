import { HttpErrorResponse } from '@angular/common/http';
import { balanceWidths, calendarCells, dateLabel, errorMessage, initials, leaveDayAvailability, peopleOff, requestMatches, summarizeLeaveSelection } from './ui-model';
import { fixtureRequest, fixtureWorkspace } from './testing/fixtures';

describe('UI view models', () => {
  it('builds a Monday-first calendar with leap days and stable UTC dates', () => {
    const cells = calendarCells(2028, 1, '2028-02-29', [], [], 'team-1');
    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe('2028-01-31');
    expect(cells.find((cell) => cell.date === '2028-02-29')).toMatchObject({ inMonth: true, isToday: true, weekend: false });
    expect(cells.find((cell) => cell.date === '2028-02-05')?.weekend).toBe(true);
  });

  it('shows only reserved working dates for the selected team and labels holidays', () => {
    const data = fixtureWorkspace();
    const entries = [
      fixtureRequest(), fixtureRequest({ id: 'other-team', teamId: 'team-2' }),
      fixtureRequest({ id: 'cancelled', status: 'cancelled' }),
    ];
    const cells = calendarCells(2026, 0, data.today, data.holidays, entries, 'team-1');
    expect(cells.find((cell) => cell.date === '2026-01-05')?.entries).toHaveLength(1);
    expect(cells.find((cell) => cell.date === '2026-01-01')?.holiday).toBe('New Year');
    expect(cells.find((cell) => cell.date === '2026-01-04')?.entries).toHaveLength(0);
  });

  it('counts unique people, excluding cancelled requests', () => {
    expect(peopleOff([fixtureRequest(), fixtureRequest({ id: 'duplicate' }), fixtureRequest({ employeeId: 'other', status: 'cancelled' })], '2026-01-05')).toBe(1);
  });

  it.each([
    ['2025-12-31', 'Past date', 'blocked'],
    ['2026-01-01', 'Holiday', 'excluded'],
    ['2026-01-02', 'Too soon', 'blocked'],
    ['2026-01-03', 'Weekend', 'excluded'],
    ['2026-01-05', 'Your leave', 'blocked'],
    ['2026-01-07', 'Available', 'available'],
  ])('explains calendar availability on %s', (date, label, state) => {
    expect(leaveDayAvailability(date, fixtureWorkspace(), 'team-1')).toMatchObject({ label, state });
  });

  it('respects current notice and distinct pending/approved teammates, not other teams or cancelled leave', () => {
    const data = fixtureWorkspace();
    const other = fixtureRequest({ id: 'other', employeeId: 'employee-2', workingDates: ['2026-01-07'] });
    data.calendar = [
      other, { ...other, id: 'duplicate' },
      { ...other, id: 'cancelled', employeeId: 'employee-3', status: 'cancelled' },
      { ...other, id: 'other-team', employeeId: 'employee-4', teamId: 'team-2' },
    ];
    expect(leaveDayAvailability('2026-01-07', data, 'team-1').state).toBe('available');
    data.calendar.push({ ...other, id: 'approved', employeeId: 'employee-3', status: 'approved' });
    expect(leaveDayAvailability('2026-01-07', data, 'team-1')).toMatchObject({ label: 'Team full', state: 'blocked' });
    data.settings.maxTeamOff = 3;
    expect(leaveDayAvailability('2026-01-07', data, 'team-1').state).toBe('available');
    data.settings.minNoticeDays = 7;
    expect(leaveDayAvailability('2026-01-07', data, 'team-1').label).toBe('Too soon');
    expect(leaveDayAvailability('2026-01-08', data, 'team-1').state).toBe('available');
  });

  it('counts only working dates in a selection and handles month boundaries', () => {
    const data = fixtureWorkspace();
    data.holidays.push({ date: '2026-02-02', name: 'Team holiday' });
    expect(summarizeLeaveSelection({ startDate: '2026-01-30', endDate: '2026-02-03' }, data, 'team-1'))
      .toEqual({ workingDays: 2, error: '' });
    expect(summarizeLeaveSelection({ startDate: '2026-01-03', endDate: '2026-01-04' }, data, 'team-1').error)
      .toContain('working day');
  });

  it('does not overlook an own-request overlap when its charged date later becomes a holiday', () => {
    const data = fixtureWorkspace();
    data.requests = [fixtureRequest({ startDate: '2026-01-08', endDate: '2026-01-08', workingDates: ['2026-01-08'] })];
    data.holidays.push({ date: '2026-01-08', name: 'New holiday' });
    expect(summarizeLeaveSelection({ startDate: '2026-01-07', endDate: '2026-01-09' }, data, 'team-1').error).toContain('overlaps');
    data.requests[0].status = 'cancelled';
    expect(summarizeLeaveSelection({ startDate: '2026-01-07', endDate: '2026-01-09' }, data, 'team-1'))
      .toEqual({ workingDays: 2, error: '' });
  });

  it('keeps charts meaningful for zero and overdrawn allowances', () => {
    const balance = fixtureWorkspace().employees[0].balances[0];
    expect(balanceWidths(balance)).toEqual({ approved: 25, pending: 10 });
    expect(balanceWidths({ ...balance, allowance: 0, approved: 0, pending: 0 })).toEqual({ approved: 0, pending: 0 });
    expect(balanceWidths({ ...balance, allowance: 1, approved: 1, pending: 1 })).toEqual({ approved: 50, pending: 50 });
  });

  it('filters requests by status and case-insensitive search', () => {
    expect(requestMatches(fixtureRequest(), 'annual', 'pending')).toBe(true);
    expect(requestMatches(fixtureRequest(), '  ALEX  ', 'all')).toBe(true);
    expect(requestMatches(fixtureRequest(), '', 'approved')).toBe(false);
    expect(requestMatches(fixtureRequest(), 'missing', 'all')).toBe(false);
    expect(initials('Alex Rivera')).toBe('AR');
    expect(dateLabel('2026-01-05')).toBe('5 Jan 2026');
  });

  it('presents server validation, offline, and unexpected failures explicitly', () => {
    expect(errorMessage(new HttpErrorResponse({ status: 400, error: { message: ['Date is invalid', 'Reason is required'] } }))).toBe('Date is invalid. Reason is required');
    expect(errorMessage(new HttpErrorResponse({ status: 409, error: { message: 'Team is full' } }))).toBe('Team is full');
    expect(errorMessage(new HttpErrorResponse({ status: 0 }))).toContain('Cannot reach');
    expect(errorMessage(new Error('Internal detail'))).toContain('could not be completed');
  });
});

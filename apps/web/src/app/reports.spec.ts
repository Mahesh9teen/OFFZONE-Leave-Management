import { TestBed } from '@angular/core/testing';
import { balancesCsv, calendarIcs, ExportCsv, monthlyLeaveTotals, requestsCsv } from './reports';
import { teamOutlook } from './team-insights';
import { fixtureRequest, fixtureWorkspace } from './testing/fixtures';
import { TeamCalendar } from './calendar';
import { LeaveAnalytics } from './analytics';
import { BalanceCards } from './balance-cards';

describe('OFFZONE reports and availability', () => {
  it('exports half-day request charges rather than counting the date as a full day', () => {
    const csv = requestsCsv([fixtureRequest({ period: 'am', workingDates: ['2026-01-05'] })]);
    expect(csv).toContain('"0.5"');
  });

  it('offers calendar export in the team calendar', async () => {
    TestBed.configureTestingModule({ imports: [TeamCalendar] });
    const fixture = TestBed.createComponent(TeamCalendar);
    fixture.componentRef.setInput('data', fixtureWorkspace());
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-action="export-calendar"]')).not.toBeNull();
  });

  it('exports only selected-team working dates, with UTC half-days and safe calendar text', () => {
    const full = fixtureRequest({ id: 'full', status: 'approved', workingDates: ['2026-01-30', '2026-02-02'] });
    const half = fixtureRequest({ id: 'half', period: 'pm', employeeName: 'Name,\nATTENDEE:other', workingDates: ['2026-01-05'], version: 3 });
    const content = calendarIcs([full, half, { ...full, id: 'other', teamId: 'other-team' }, { ...full, id: 'cancelled', status: 'cancelled' }],
      'team-1', 2026, 0, new Date('2026-01-01T10:00:00Z'));
    expect(content).toContain('DTSTART;VALUE=DATE:20260130\r\nDTEND;VALUE=DATE:20260131');
    expect(content).toContain('DTSTART:20260105T130000Z\r\nDTEND:20260105T170000Z');
    expect(content).toContain('SEQUENCE:3');
    expect(content).toContain('STATUS:TENTATIVE');
    expect(content).toContain('Name\\,\\nATTENDEE:other');
    expect(content).not.toContain('\r\nATTENDEE:');
    expect(content).not.toContain('20260202');
    expect(content).not.toContain('UID:other');
    expect(content).not.toContain('Family time');
    expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('folds long UTF-8 calendar lines and allocates monthly half-day totals without cross-year leakage', () => {
    const content = calendarIcs([fixtureRequest({ employeeName: 'Ren\u00e9 \u{1F642} '.repeat(30) })], 'team-1', 2026, 0, new Date('2026-01-01'));
    expect(content.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    const rows = monthlyLeaveTotals([
      fixtureRequest({ status: 'approved', workingDates: ['2026-01-30', '2026-02-02', '2027-01-04'] }),
      fixtureRequest({ id: 'half', period: 'am', workingDates: ['2026-02-03'] }),
      fixtureRequest({ id: 'cancelled', status: 'cancelled', workingDates: ['2026-02-04'] }),
    ], 2026);
    expect(rows[0]).toMatchObject({ approved: 1, pending: 0, requests: 1 });
    expect(rows[1]).toMatchObject({ approved: 1, pending: 0.5, cancelled: 1, requests: 3 });
    expect(rows.slice(2).every((row) => row.requests === 0)).toBe(true);
  });

  it('renders analytics from authorized requests, not the wider team calendar, and filters leave types', async () => {
    const data = fixtureWorkspace();
    data.requests = [
      fixtureRequest({ status: 'approved', workingDates: ['2026-01-05'] }),
      fixtureRequest({ id: 'half', period: 'pm', workingDates: ['2026-01-06'] }),
      fixtureRequest({ id: 'sick', leaveTypeId: 'sick', workingDates: ['2026-01-07'] }),
    ];
    data.calendar.push(fixtureRequest({ id: 'teammate', employeeId: 'another-employee', workingDates: ['2026-01-05'] }));
    TestBed.configureTestingModule({ imports: [LeaveAnalytics] });
    const fixture = TestBed.createComponent(LeaveAnalytics);
    fixture.componentRef.setInput('data', data);
    await fixture.whenStable();
    expect(fixture.componentInstance.approved()).toBe(1);
    expect(fixture.componentInstance.pending()).toBe(1.5);
    expect(fixture.componentInstance.selectedRequests()).toHaveLength(3);
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    select.value = 'annual';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.pending()).toBe(0.5);
    expect(fixture.componentInstance.csv()).toContain('"2026","January","1","0.5"');
    fixture.componentRef.setInput('data', { ...data, year: 2027 });
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedRequests()).toHaveLength(0);
    expect(fixture.componentInstance.maximum()).toBe(1);
  });

  it('distinguishes expired carry-over from available base allowance', async () => {
    const balance = { ...fixtureWorkspace().employees[0].balances[0], approved: 4, pending: 0, remaining: 18,
      baseRemaining: 18, carryoverGranted: 5, carryoverUsed: 2, carryoverRemaining: 0,
      carryoverExpired: 3, carryoverExpiresOn: '2027-03-31' };
    TestBed.configureTestingModule({ imports: [BalanceCards] });
    const fixture = TestBed.createComponent(BalanceCards);
    fixture.componentRef.setInput('balances', [balance]);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('3 unused carry-over days expired');
    expect(fixture.nativeElement.querySelector('.expired-segment').style.width).toBe('12%');
    fixture.componentRef.setInput('balances', [{ ...balance, baseRemaining: -1, remaining: 1 }]);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Allowance was reduced');
  });

  it('exports selected requests with quotes, line breaks, and spreadsheet formulas safely escaped', () => {
    const data = fixtureWorkspace();
    const csv = requestsCsv([fixtureRequest({ employeeName: '=1+1', reason: 'A "family" event,\naway' })]);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"A ""family"" event,\naway"');
    expect(csv).toContain('"pending"');
    expect(requestsCsv([])).not.toContain('Alex Rivera');
    expect(balancesCsv(data.employees, data.year)).toContain('"Alex Rivera","2026","Annual","20","5","2","13"');
  });

  it('summarizes unique people and upcoming working dates for only the selected team', () => {
    const data = fixtureWorkspace();
    data.today = '2026-01-05';
    data.calendar.push(fixtureRequest({ id: 'other', employeeId: 'employee-2', employeeName: 'Sam Taylor', status: 'approved' }));
    data.calendar.push(fixtureRequest({ id: 'other-team', teamId: 'team-2' }));
    data.calendar.push(fixtureRequest({ id: 'cancelled', status: 'cancelled' }));
    const outlook = teamOutlook(data, 'team-1');
    expect(outlook.days[0]).toMatchObject({ date: '2026-01-05', approved: 1, pending: 1, off: 2, slots: 0 });
    expect(outlook.upcoming).toHaveLength(2);
    expect(outlook.days.find((day) => day.date === '2026-01-10')?.nonWorking).toBe(true);
    expect(outlook.summary).toContain('2 people');
  });

  it('uses the selected calendar year and flags over-capacity policy changes', () => {
    const data = fixtureWorkspace();
    data.today = '2026-01-05';
    data.settings.maxTeamOff = 1;
    data.calendar.push(fixtureRequest({ id: 'other', employeeId: 'other', status: 'approved' }));
    expect(teamOutlook(data, 'team-1').days[0].overCapacity).toBe(true);
    data.year = 2027;
    expect(teamOutlook(data, 'team-1').days[0].date).toBe('2027-01-01');
  });

  it('does not report opposite half-days as a team-capacity violation', () => {
    const data = fixtureWorkspace();
    data.today = '2026-01-05';
    data.settings.maxTeamOff = 1;
    data.calendar = [
      fixtureRequest({ period: 'am', workingDates: ['2026-01-05'] }),
      fixtureRequest({ id: 'afternoon', employeeId: 'other', period: 'pm', workingDates: ['2026-01-05'] }),
    ];
    expect(teamOutlook(data, 'team-1').days[0]).toMatchObject({ off: 2, morning: 1, afternoon: 1, overCapacity: false, slots: 0 });
  });

  it('downloads CSV through a temporary link, releases its URL, and reports browser failures', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue('blob:offzone-report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('report.csv');
    });
    try {
      TestBed.configureTestingModule({ imports: [ExportCsv] });
      const fixture = TestBed.createComponent(ExportCsv);
      fixture.componentRef.setInput('content', requestsCsv([fixtureRequest()]));
      fixture.componentRef.setInput('filename', 'report.csv');
      fixture.detectChanges();
      fixture.componentInstance.save();
      expect(click).toHaveBeenCalledOnce();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:offzone-report');
      expect(document.querySelector('a[download="report.csv"]')).toBeNull();
      createObjectURL.mockImplementation(() => { throw new Error('Browser refused download'); });
      fixture.componentInstance.save();
      expect(fixture.componentInstance.error()).toContain('could not be completed');
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});

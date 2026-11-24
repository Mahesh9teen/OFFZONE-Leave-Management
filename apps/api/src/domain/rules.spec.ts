import type { LeaveRequest, LeaveType, Policy, User } from '@leave/contracts';
import {
  assertTransition,
  balancesFor,
  daysByYear,
  fundReservation,
  validateReservation,
  workingDates,
} from './rules.js';

const employee: User = {
  id: 'employee-1', name: 'Employee One', email: 'one@example.test',
  role: 'employee', teamId: 'team-1', photoVersion: null,
};
const annual: LeaveType = { id: 'annual', name: 'Annual', yearlyAllowance: 5 };
const policy: Policy = {
  settings: { minNoticeDays: 2, maxTeamOff: 2, version: 1 },
  leaveTypes: [annual],
  holidays: [{ date: '2026-01-07', name: 'Demo holiday' }],
};

function request(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'request-1', employeeId: employee.id, employeeName: employee.name,
    teamId: 'team-1', teamName: 'Product', leaveTypeId: annual.id, leaveTypeName: annual.name,
    startDate: '2026-01-05', endDate: '2026-01-06', workingDates: ['2026-01-05', '2026-01-06'],
    reason: 'Family time', status: 'pending', createdAt: '2026-01-01T10:00:00.000Z',
    decidedAt: null, decidedBy: null, decisionNote: '', ...overrides,
  };
}

function validate(candidate = request(), existing: LeaveRequest[] = [], selectedPolicy = policy) {
  return validateReservation(candidate, existing, selectedPolicy, '2026-01-01', true);
}

describe('working-day calculation', () => {
  it('counts both endpoints and excludes weekends and configured holidays', () => {
    expect(workingDates('2026-01-02', '2026-01-08', policy.holidays))
      .toEqual(['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-08']);
  });

  it.each([
    ['2026-02-30', '2026-03-02', /valid calendar date/],
    ['not-a-date', '2026-03-02', /valid calendar date/],
    ['2026-01-06', '2026-01-05', /end date/i],
    ['2026-01-01', '2027-01-02', /366/],
    ['2026-01-03', '2026-01-04', /working day/],
    ['2026-01-07', '2026-01-07', /working day/],
  ])('rejects invalid or unchargeable range %s to %s', (start, end, message) => {
    expect(() => workingDates(start, end, policy.holidays)).toThrow(message);
  });

  it('handles leap days without local-time or daylight-saving shifts', () => {
    expect(workingDates('2028-02-28', '2028-03-01', []))
      .toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('allocates a cross-year request to the corresponding calendar years', () => {
    expect(daysByYear(['2026-12-31', '2027-01-01', '2027-01-04']))
      .toEqual({ '2026': 1, '2027': 2 });
  });
});

describe('balances and reservations', () => {
  it('uses eligible carry-over first but never spends it before the grant year or after expiry', () => {
    const type = { ...annual, yearlyAllowance: 20 };
    const grant = { employeeId: employee.id, leaveTypeId: annual.id, year: 2027, days: 1.5, expiresOn: '2027-03-31' };
    const candidate = request({ startDate: '2027-01-04', endDate: '2027-01-05', workingDates: ['2027-01-04', '2027-01-05'] });
    const selected = { ...policy, leaveTypes: [type] };
    expect(fundReservation(candidate, [], selected, '2027-01-01', [grant]).carryoverByYear).toEqual({ '2027': 1.5 });
    expect(fundReservation(candidate, [], selected, '2026-12-01', [grant]).carryoverByYear).toEqual({});
    expect(fundReservation(candidate, [], selected, '2027-04-01', [grant]).carryoverByYear).toEqual({});
  });
  it('charges half a day for a single morning or afternoon reservation', () => {
    const half = request({ period: 'am', startDate: '2026-01-05', endDate: '2026-01-05', workingDates: ['2026-01-05'] });
    expect(balancesFor(employee.id, 2026, [annual], [half])[0]).toMatchObject({ pending: 0.5, remaining: 4.5 });
    expect(daysByYear(half.workingDates, 'am')).toEqual({ '2026': 0.5 });
  });

  it('keeps carry-over funding separate when unused carry-over expires or a carried request is cancelled', () => {
    const type = { ...annual, yearlyAllowance: 20, carryoverEnabled: true };
    const grant = { employeeId: employee.id, leaveTypeId: annual.id, year: 2027, days: 5, expiresOn: '2027-03-31' };
    const carried = request({
      status: 'approved', startDate: '2027-01-04', endDate: '2027-01-05',
      workingDates: ['2027-01-04', '2027-01-05'], carryoverByYear: { '2027': 2 },
    });
    expect(balancesFor(employee.id, 2027, [type], [carried], [grant], '2027-02-01')[0])
      .toMatchObject({ remaining: 23, carryoverRemaining: 3, carryoverUsed: 2 });
    expect(balancesFor(employee.id, 2027, [type], [carried], [grant], '2027-04-01')[0])
      .toMatchObject({ remaining: 20, carryoverExpired: 3 });
    expect(balancesFor(employee.id, 2027, [type], [{ ...carried, status: 'cancelled' }], [grant], '2027-04-01')[0])
      .toMatchObject({ remaining: 20, carryoverExpired: 5 });
  });

  it('reserves pending and approved days, but not rejected or cancelled days', () => {
    const requests = [
      request(),
      request({ id: 'approved', status: 'approved', workingDates: ['2026-02-02'] }),
      request({ id: 'rejected', status: 'rejected' }),
      request({ id: 'cancelled', status: 'cancelled' }),
      request({ id: 'other-person', employeeId: 'someone-else' }),
      request({ id: 'other-type', leaveTypeId: 'sick' }),
      request({ id: 'other-year', workingDates: ['2027-01-04'] }),
    ];
    expect(balancesFor(employee.id, 2026, [annual], requests)[0])
      .toMatchObject({ allowance: 5, approved: 1, pending: 2, remaining: 2 });
  });

  it('restores the full reservation when a request is cancelled', () => {
    expect(balancesFor(employee.id, 2026, [annual], [request()])[0].remaining).toBe(3);
    expect(balancesFor(employee.id, 2026, [annual], [request({ status: 'cancelled' })])[0].remaining).toBe(5);
  });

  it('allows exactly the remaining allowance', () => {
    const candidate = request({ workingDates: ['2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09', '2026-01-12'] });
    expect(() => validate(candidate)).not.toThrow();
  });

  it('rejects a request exceeding balance after pending reservations', () => {
    const prior = request({ id: 'prior', startDate: '2026-01-12', endDate: '2026-01-15', workingDates: ['2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15'] });
    expect(() => validate(request(), [prior])).toThrow(/balance.*2026/i);
  });

  it('checks both yearly balances for a cross-year request', () => {
    const candidate = request({ startDate: '2026-12-31', endDate: '2027-01-01', workingDates: ['2026-12-31', '2027-01-01'] });
    const prior = request({ id: 'prior', startDate: '2027-02-01', endDate: '2027-02-05', workingDates: ['2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04', '2027-02-05'] });
    expect(() => validate(candidate, [prior])).toThrow(/balance.*2027/i);
  });

  it('uses a changed yearly allowance immediately, including negative balances', () => {
    const updated = { ...policy, leaveTypes: [{ ...annual, yearlyAllowance: 1 }] };
    expect(() => validate(request(), [], updated)).toThrow(/balance/i);
    expect(balancesFor(employee.id, 2026, updated.leaveTypes, [request()])[0].remaining).toBe(-1);
  });

  it('rejects unknown leave types', () => {
    expect(() => validate(request({ leaveTypeId: 'unknown' }))).toThrow(/leave type/i);
  });
});

describe('overlap, coverage, and notice', () => {
  it('allows opposite halves while rejecting a duplicate half or a full-day overlap', () => {
    const morning = request({ id: 'morning', period: 'am', startDate: '2026-01-05', endDate: '2026-01-05', workingDates: ['2026-01-05'] });
    const afternoon = { ...morning, id: 'afternoon', period: 'pm' as const };
    expect(() => validate(afternoon, [morning])).not.toThrow();
    expect(() => validate({ ...afternoon, period: 'am' }, [morning])).toThrow(/overlap/i);
    expect(() => validate({ ...afternoon, period: 'full' }, [morning])).toThrow(/overlap/i);
  });

  it('applies team coverage separately to morning and afternoon slots', () => {
    const morning = request({ id: 'other', employeeId: 'employee-2', period: 'am', startDate: '2026-01-05', endDate: '2026-01-05', workingDates: ['2026-01-05'] });
    const afternoon = request({ period: 'pm', startDate: morning.startDate, endDate: morning.endDate, workingDates: morning.workingDates });
    const limited = { ...policy, settings: { ...policy.settings, maxTeamOff: 1 } };
    expect(() => validate(afternoon, [morning], limited)).not.toThrow();
    expect(() => validate({ ...afternoon, period: 'full' }, [morning], limited)).toThrow(/coverage/i);
  });

  it.each(['pending', 'approved'] as const)('rejects an overlapping %s request, even with another leave type', (status) => {
    expect(() => validate(request(), [request({ id: 'other', status, leaveTypeId: 'sick' })]))
      .toThrow(/overlap/i);
  });

  it('allows overlap with cancelled and rejected requests and ignores the current request at approval', () => {
    expect(() => validate(request(), [
      request(), request({ id: 'cancelled', status: 'cancelled' }), request({ id: 'rejected', status: 'rejected' }),
    ])).not.toThrow();
  });

  it('checks each day, counts pending people, and permits exactly the team limit', () => {
    const other = request({ id: 'other', employeeId: 'employee-2' });
    expect(() => validate(request(), [other])).not.toThrow();
    expect(() => validate(request(), [other, request({ id: 'third', employeeId: 'employee-3', status: 'approved' })]))
      .toThrow(/team.*2026-01-05/i);
  });

  it('does not count another team or non-working dates against capacity', () => {
    const existing = [
      request({ id: 'other-team', employeeId: 'employee-2', teamId: 'team-2' }),
      request({ id: 'other-date', employeeId: 'employee-3', workingDates: ['2026-01-08'] }),
    ];
    expect(() => validate(request(), existing, { ...policy, settings: { ...policy.settings, maxTeamOff: 1 } })).not.toThrow();
  });

  it('counts unique team members rather than duplicate reservations', () => {
    expect(() => validate(request(), [
      request({ id: 'a', employeeId: 'employee-2' }),
      request({ id: 'b', employeeId: 'employee-2' }),
    ])).not.toThrow();
  });

  it('uses a changed coverage limit without a code change', () => {
    expect(() => validate(request(), [request({ id: 'other', employeeId: 'employee-2' })],
      { ...policy, settings: { ...policy.settings, maxTeamOff: 1 } })).toThrow(/team/i);
  });

  it('enforces calendar-day notice inclusively and honors a changed setting', () => {
    const candidate = request({ startDate: '2026-01-02', endDate: '2026-01-02', workingDates: ['2026-01-02'] });
    expect(() => validate(candidate)).toThrow(/notice/i);
    expect(() => validate(candidate, [], { ...policy, settings: { ...policy.settings, minNoticeDays: 1 } })).not.toThrow();
  });

  it('rejects past starts even when notice is zero', () => {
    const candidate = request({ startDate: '2025-12-31', endDate: '2025-12-31', workingDates: ['2025-12-31'] });
    expect(() => validate(candidate, [], { ...policy, settings: { ...policy.settings, minNoticeDays: 0 } })).toThrow(/notice/i);
  });

  it('does not reapply submission notice when deciding a reserved request', () => {
    expect(() => validateReservation(request(), [], policy, '2026-01-10', false)).not.toThrow();
  });
});

describe('server-side workflow permissions', () => {
  const manager: User = { ...employee, id: 'manager-1', role: 'manager' };

  it.each(['approved', 'rejected'] as const)('allows the reporting manager to move pending to %s', (action) => {
    expect(() => assertTransition(manager, request(), action)).not.toThrow();
  });

  it.each([
    { ...employee },
    { ...manager, teamId: 'team-2' },
    { ...employee, role: 'admin' as const, teamId: null },
  ])('denies decisions by unauthorized actors ($role, $teamId)', (actor) => {
    expect(() => assertTransition(actor, request(), 'approved')).toThrow(/permission/i);
  });

  it.each(['pending', 'approved'] as const)('allows the owner to cancel a %s request', (status) => {
    expect(() => assertTransition(employee, request({ status }), 'cancelled')).not.toThrow();
  });

  it('denies cancelling someone else\'s request', () => {
    expect(() => assertTransition({ ...employee, id: 'other' }, request(), 'cancelled')).toThrow(/permission/i);
  });

  it.each(['cancelled', 'rejected', 'approved'] as const)('does not allow a second decision on a %s request', (status) => {
    expect(() => assertTransition(manager, request({ status }), 'rejected')).toThrow(/pending/i);
  });

  it.each(['cancelled', 'rejected'] as const)('does not cancel a terminal %s request again', (status) => {
    expect(() => assertTransition(employee, request({ status }), 'cancelled')).toThrow(/pending or approved/i);
  });
});

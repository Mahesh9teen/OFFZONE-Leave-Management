import type { AccountProfile, LeaveRequest, PeopleWorkspace, Role, User, Workspace } from '@leave/contracts';

export function fixtureRequest(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'request-1', employeeId: 'employee-1', employeeName: 'Alex Rivera',
    teamId: 'team-1', teamName: 'Product & Design', leaveTypeId: 'annual', leaveTypeName: 'Annual',
    startDate: '2026-01-05', endDate: '2026-01-06', workingDates: ['2026-01-05', '2026-01-06'],
    reason: 'Family time', status: 'pending', createdAt: '2026-01-01T10:00:00.000Z',
    decidedAt: null, decidedBy: null, decisionNote: '', ...overrides,
  };
}

export function fixtureWorkspace(role: Role = 'employee'): Workspace {
  const employee: User = { id: 'employee-1', name: 'Alex Rivera', email: 'employee1@example.test', role: 'employee', teamId: 'team-1', photoVersion: null };
  const user: User = role === 'employee' ? employee : { ...employee, id: `${role}-1`, name: role === 'manager' ? 'Jordan Lee' : 'Workspace Admin', role, teamId: role === 'admin' ? null : 'team-1' };
  return {
    user, year: 2026, today: '2026-01-01',
    settings: { minNoticeDays: 2, maxTeamOff: 2, version: 1 },
    leaveTypes: [{ id: 'annual', name: 'Annual', yearlyAllowance: 20 }],
    holidays: [{ date: '2026-01-01', name: 'New Year' }],
    teams: [{ id: 'team-1', name: 'Product & Design' }],
    employees: [{ employee, balances: [{ leaveTypeId: 'annual', leaveTypeName: 'Annual', allowance: 20, approved: 5, pending: 2, remaining: 13 }] }],
    requests: [fixtureRequest()], calendar: [fixtureRequest()],
  };
}

export function fixtureProfile(role: Role = 'employee'): AccountProfile {
  return { user: fixtureWorkspace(role).user, phone: '', jobTitle: '', teamName: 'Product & Design', demoSession: false, sharedDemo: true };
}

export function fixturePeople(): PeopleWorkspace {
  const employee = fixtureWorkspace().user;
  const manager = fixtureWorkspace('manager').user;
  return {
    users: [employee, manager].map((user) => ({ ...user, phone: '', jobTitle: '', active: true, hasLeaveHistory: user.role === 'employee' })),
    teams: [{ id: 'team-1', name: 'Product & Design', employeeCount: 1, managerId: manager.id, managerName: manager.name }],
  };
}

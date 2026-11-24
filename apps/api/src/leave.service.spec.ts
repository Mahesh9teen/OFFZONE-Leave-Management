import type { CreateRequestInput, LeaveRequest, Policy, User } from '@leave/contracts';
import { LeaveService } from './leave.service.js';
import type { LeaveStore, TeamTransaction } from './leave.store.js';

const employee: User = { id: 'employee-1', name: 'Employee', email: 'employee@example.test', role: 'employee', teamId: 'team-1', photoVersion: null };
const manager: User = { ...employee, id: 'manager-1', role: 'manager' };
const input: CreateRequestInput = { leaveTypeId: 'annual', startDate: '2026-01-05', endDate: '2026-01-06', reason: 'Family time' };
const policy: Policy = { settings: { minNoticeDays: 2, maxTeamOff: 2, version: 1 }, leaveTypes: [{ id: 'annual', name: 'Annual', yearlyAllowance: 20 }], holidays: [] };

function harness() {
  const requests: LeaveRequest[] = [];
  const tx: TeamTransaction = {
    policy: structuredClone(policy), requests, team: { id: 'team-1', name: 'Product' }, employeeIds: [employee.id],
    insert: vi.fn(async (request: LeaveRequest) => {
      const saved = { ...request, id: `request-${requests.length + 1}` };
      requests.push(saved);
      return saved;
    }),
    update: vi.fn(async (request: LeaveRequest) => {
      const index = requests.findIndex((item) => item.id === request.id);
      requests[index] = request;
      return request;
    }),
  };
  const store: LeaveStore = {
    transaction: async <T>(_teamId: string, work: (context: TeamTransaction) => Promise<T>) => work(tx),
    findRequest: vi.fn(async (id: string) => requests.find((request) => request.id === id) ?? null),
    workspace: vi.fn(),
    configure: vi.fn(),
    addLeaveType: vi.fn(),
  };
  vi.spyOn(store, 'transaction');
  const service = new LeaveService(store, { now: () => new Date('2026-01-01T10:00:00.000Z') });
  return { service, store, tx, requests };
}

describe('LeaveService workflow', () => {
  it('edits a future pending request and prevents approval of the stale version', async () => {
    const { service, requests } = harness();
    const created = await service.create(employee, input);
    const edited = await service.edit(employee, created.id, {
      ...input, startDate: '2026-01-12', endDate: '2026-01-12', period: 'pm', version: 1,
    });
    expect(edited).toMatchObject({ id: created.id, status: 'pending', period: 'pm', version: 2, createdAt: created.createdAt });
    expect(requests[0].workingDates).toEqual(['2026-01-12']);
    await expect(service.transition(manager, created.id, 'approved', '', 1)).rejects.toThrow(/changed|version/i);
    await expect(service.transition(manager, created.id, 'approved', '', 2)).resolves.toMatchObject({ status: 'approved' });
  });

  it('rejects half-day date ranges and edits by another employee', async () => {
    const { service } = harness();
    await expect(service.create(employee, { ...input, period: 'am' })).rejects.toThrow(/single|same date/i);
    const created = await service.create(employee, input);
    await expect(service.edit({ ...employee, id: 'other' }, created.id, { ...input, version: 1 }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('creates a pending reservation using only the authenticated employee identity', async () => {
    const { service, store } = harness();
    const result = await service.create(employee, input);
    expect(result).toMatchObject({ employeeId: employee.id, teamId: employee.teamId, status: 'pending', workingDates: ['2026-01-05', '2026-01-06'] });
    expect(store.transaction).toHaveBeenCalledWith('team-1', expect.any(Function));
  });

  it('previews the actual business rules without saving a reservation', async () => {
    const { service, tx } = harness();
    expect(await service.preview(employee, input)).toEqual({ workingDates: ['2026-01-05', '2026-01-06'], daysByYear: { '2026': 2 } });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it.each(['manager', 'admin'] as const)('forbids %s from submitting employee requests', async (role) => {
    const { service, store } = harness();
    await expect(service.create({ ...employee, role }, input)).rejects.toMatchObject({ status: 403 });
    expect(store.transaction).not.toHaveBeenCalled();
  });

  it('does not save a failed reservation', async () => {
    const { service, tx } = harness();
    tx.policy.leaveTypes[0].yearlyAllowance = 1;
    await expect(service.create(employee, input)).rejects.toThrow(/balance/i);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('rejects a stale employee identity after an admin moves or deactivates the account', async () => {
    const { service, tx } = harness();
    tx.employeeIds = [];
    await expect(service.create(employee, input)).rejects.toMatchObject({ status: 403 });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('revalidates configuration at approval but does not apply notice again', async () => {
    const { service, tx } = harness();
    const request = await service.create(employee, input);
    tx.policy.settings.minNoticeDays = 30;
    tx.policy.leaveTypes[0].yearlyAllowance = 1;
    await expect(service.transition(manager, request.id, 'approved', '')).rejects.toThrow(/balance/i);
    tx.policy.leaveTypes[0].yearlyAllowance = 20;
    expect(await service.transition(manager, request.id, 'approved', 'Enjoy your break')).toMatchObject({
      status: 'approved', decidedBy: manager.id, decisionNote: 'Enjoy your break',
    });
  });

  it('cancels an approved reservation and permits the days to be requested again', async () => {
    const { service } = harness();
    const request = await service.create(employee, input);
    await service.transition(manager, request.id, 'approved', '');
    await service.transition(employee, request.id, 'cancelled', '');
    await expect(service.create(employee, input)).resolves.toMatchObject({ status: 'pending' });
  });

  it('allows rejection to release a reservation even after configuration was reduced', async () => {
    const { service, tx } = harness();
    const request = await service.create(employee, input);
    tx.policy.leaveTypes[0].yearlyAllowance = 0;
    await expect(service.transition(manager, request.id, 'rejected', 'Coverage')).resolves.toMatchObject({ status: 'rejected' });
  });

  it('rejects unknown requests and cross-team managers', async () => {
    const { service } = harness();
    await expect(service.transition(manager, 'missing', 'approved', '')).rejects.toMatchObject({ status: 404 });
    const request = await service.create(employee, input);
    await expect(service.transition({ ...manager, teamId: 'other' }, request.id, 'approved', '')).rejects.toMatchObject({ status: 403 });
  });

  it('rechecks the state inside the transaction rather than trusting a stale read', async () => {
    const { service, store, requests } = harness();
    const request = await service.create(employee, input);
    vi.mocked(store.findRequest).mockResolvedValue({ ...request });
    requests[0] = { ...request, status: 'cancelled' };
    await expect(service.transition(manager, request.id, 'approved', '')).rejects.toThrow(/pending/i);
  });

  it('reports a request removed before the transaction explicitly', async () => {
    const { service, store, requests } = harness();
    const request = await service.create(employee, input);
    vi.mocked(store.findRequest).mockResolvedValue({ ...request });
    requests.length = 0;
    await expect(service.transition(manager, request.id, 'approved', '')).rejects.toMatchObject({ status: 404 });
  });

  it('uses the server year by default and passes an explicit year through', async () => {
    const { service, store } = harness();
    await service.workspace(employee);
    expect(store.workspace).toHaveBeenLastCalledWith(employee, 2026, '2026-01-01');
    await service.workspace(manager, 2027);
    expect(store.workspace).toHaveBeenLastCalledWith(manager, 2027, '2026-01-01');
  });

  it('restricts all configuration writes to admins', async () => {
    const { service, store } = harness();
    await expect(service.configure(manager, policy)).rejects.toMatchObject({ status: 403 });
    await expect(service.addLeaveType(employee, { name: 'Sick', yearlyAllowance: 10 })).rejects.toMatchObject({ status: 403 });
    const admin: User = { ...employee, role: 'admin', teamId: null };
    await service.configure(admin, policy);
    await service.addLeaveType(admin, { name: 'Sick', yearlyAllowance: 10 });
    expect(store.configure).toHaveBeenCalledWith(policy);
    expect(store.addLeaveType).toHaveBeenCalledWith({ name: 'Sick', yearlyAllowance: 10 });
  });
});

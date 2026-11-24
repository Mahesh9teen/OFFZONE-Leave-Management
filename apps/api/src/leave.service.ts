import { Inject, Injectable } from '@nestjs/common';
import type {
  ConfigurationInput, CreateRequestInput, EditRequestInput, LeaveRequest, LeaveType, RequestAction, User,
} from '@leave/contracts';
import { Clock } from './clock.js';
import { LeaveStore, type TeamTransaction } from './leave.store.js';
import { assertTransition, daysByYear, fundReservation, RuleError, validateReservation, workingDates } from './domain/rules.js';

@Injectable()
export class LeaveService {
  constructor(
    @Inject(LeaveStore) private readonly store: LeaveStore,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  workspace(actor: User, year?: number) {
    const today = this.clock.now().toISOString().slice(0, 10);
    return this.store.workspace(actor, year ?? Number(today.slice(0, 4)), today);
  }

  async create(actor: User, input: CreateRequestInput) {
    this.requireEmployee(actor);
    return this.store.transaction(actor.teamId, async (tx) => {
      const request = this.candidate(actor, input, tx);
      return tx.insert(request);
    });
  }

  async preview(actor: User, input: CreateRequestInput, id?: string, version?: number) {
    this.requireEmployee(actor);
    return this.store.transaction(actor.teamId, async (tx) => {
      const previous = id ? this.editable(actor, id, version, tx) : undefined;
      const request = this.candidate(actor, input, tx, previous);
      return { workingDates: request.workingDates, daysByYear: daysByYear(request.workingDates, request.period) };
    });
  }

  async edit(actor: User, id: string, input: EditRequestInput) {
    this.requireEmployee(actor);
    return this.store.transaction(actor.teamId, async (tx) => {
      const previous = this.editable(actor, id, input.version, tx);
      return tx.update(this.candidate(actor, input, tx, previous));
    });
  }

  async transition(actor: User, id: string, action: RequestAction, note: string, version?: number) {
    const previous = await this.store.findRequest(id);
    if (!previous) throw new RuleError(404, 'Request not found.');
    assertTransition(actor, previous, action);
    return this.store.transaction(previous.teamId, async (tx) => {
      const current = tx.requests.find((request) => request.id === id);
      if (!current) throw new RuleError(404, 'Request not found.');
      assertTransition(actor, current, action);
      const now = tx.now ?? this.clock.now().toISOString();
      if ((version !== undefined && version !== (current.version ?? 1))
        || (action !== 'cancelled' && version === undefined && (current.version ?? 1) > 1)) {
        throw new RuleError(409, 'This request changed. Refresh and review the latest version before deciding.');
      }
      if (action === 'approved') validateReservation(current, tx.requests, tx.policy, now.slice(0, 10), false, tx.carryovers);
      return tx.update({ ...current, status: action, decidedAt: now, decidedBy: actor.id, decisionNote: note,
        version: (current.version ?? 1) + 1, updatedAt: now });
    });
  }

  async configure(actor: User, input: ConfigurationInput) {
    this.requireAdmin(actor);
    return this.store.configure(input);
  }

  async addLeaveType(actor: User, input: Omit<LeaveType, 'id'>) {
    this.requireAdmin(actor);
    return this.store.addLeaveType(input);
  }

  private editable(actor: User, id: string, version: number | undefined, tx: TeamTransaction): LeaveRequest {
    const current = tx.requests.find((item) => item.id === id);
    if (!current) throw new RuleError(404, 'Request not found.');
    if (current.employeeId !== actor.id) throw new RuleError(403, 'You can only edit your own requests.');
    if (current.status !== 'pending') throw new RuleError(409, 'Only pending requests can be edited.');
    if (current.startDate <= (tx.now ?? this.clock.now().toISOString()).slice(0, 10)) throw new RuleError(409, 'Only future pending requests can be edited.');
    if (version !== (current.version ?? 1)) throw new RuleError(409, 'This request changed. Refresh before editing.');
    return current;
  }

  private candidate(actor: User, input: CreateRequestInput, tx: TeamTransaction, previous?: LeaveRequest): LeaveRequest {
    if (!tx.employeeIds.includes(actor.id)) throw new RuleError(403, 'Your account or team assignment changed. Refresh the workspace before requesting leave.');
    const now = tx.now ?? this.clock.now().toISOString();
    const type = tx.policy.leaveTypes.find((item) => item.id === input.leaveTypeId);
    if (!type) throw new RuleError(400, 'Select an existing leave type.');
    const period = input.period ?? 'full';
    const financialChange = !previous || previous.startDate !== input.startDate || previous.endDate !== input.endDate
      || previous.leaveTypeId !== input.leaveTypeId || (previous.period ?? 'full') !== period;
    let request: LeaveRequest = {
      leaveTypeId: input.leaveTypeId, startDate: input.startDate, endDate: input.endDate, reason: input.reason, period,
      id: previous?.id ?? '', employeeId: actor.id, employeeName: actor.name,
      teamId: tx.team.id, teamName: tx.team.name, leaveTypeName: type.name,
      workingDates: financialChange ? workingDates(input.startDate, input.endDate, tx.policy.holidays, period) : previous.workingDates,
      status: 'pending', createdAt: previous?.createdAt ?? now, updatedAt: now,
      version: previous ? (previous.version ?? 1) + 1 : 1, carryoverByYear: previous?.carryoverByYear ?? {},
      decidedAt: null, decidedBy: null, decisionNote: '',
    };
    if (financialChange) request = fundReservation(request, tx.requests, tx.policy, now.slice(0, 10), tx.carryovers);
    validateReservation(request, tx.requests, tx.policy, now.slice(0, 10), financialChange, tx.carryovers);
    return request;
  }

  private requireEmployee(actor: User): asserts actor is User & { teamId: string } {
    if (actor.role !== 'employee' || !actor.teamId) throw new RuleError(403, 'Only employees with a team can request leave.');
  }

  private requireAdmin(actor: User) {
    if (actor.role !== 'admin') throw new RuleError(403, 'Only admins can change configuration.');
  }
}

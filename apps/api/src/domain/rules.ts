import {
  periodDays, leaveSlots, periodsOverlap,
  type CarryoverGrant, type Holiday, type LeavePeriod, type LeaveRequest, type LeaveType, type Policy, type RequestAction, type User,
} from '@leave/contracts';

const DAY = 86_400_000;

export class RuleError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

export function dateNumber(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed)
    || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new RuleError(400, 'Enter a valid calendar date (YYYY-MM-DD).');
  }
  return parsed;
}

export function workingDates(start: string, end: string, holidays: Holiday[], period: LeavePeriod = 'full'): string[] {
  const first = dateNumber(start);
  const last = dateNumber(end);
  if (period !== 'full' && start !== end) throw new RuleError(400, 'Half-day leave must use a single working date.');
  if (last < first) throw new RuleError(400, 'The end date must not be before the start date.');
  if ((last - first) / DAY >= 366) throw new RuleError(400, 'A request can span at most 366 calendar days.');

  const excluded = new Set(holidays.map((holiday) => holiday.date));
  const dates: string[] = [];
  for (let cursor = first; cursor <= last; cursor += DAY) {
    const date = new Date(cursor);
    const key = date.toISOString().slice(0, 10);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !excluded.has(key)) dates.push(key);
  }
  if (!dates.length) throw new RuleError(400, 'Select at least one working day.');
  return dates;
}

export function daysByYear(dates: string[], period: LeavePeriod = 'full'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const date of dates) {
    const year = date.slice(0, 4);
    counts[year] = (counts[year] ?? 0) + periodDays(period);
  }
  return counts;
}

export function isReserved(request: LeaveRequest): boolean {
  return request.status === 'pending' || request.status === 'approved';
}

export function balancesFor(
  employeeId: string, year: number, leaveTypes: LeaveType[], requests: LeaveRequest[],
  grants: CarryoverGrant[] = [], today = `${year}-01-01`,
) {
  const own = requests.filter((request) => request.employeeId === employeeId && isReserved(request));
  return leaveTypes.map((type) => {
    let approved = 0;
    let pending = 0;
    let carryoverUsed = 0;
    for (const request of own) {
      if (request.leaveTypeId !== type.id) continue;
      const count = request.workingDates.filter((date) => date.startsWith(`${year}-`)).length * periodDays(request.period);
      carryoverUsed += request.carryoverByYear?.[String(year)] ?? 0;
      if (request.status === 'approved') approved += count;
      else pending += count;
    }
    const grant = grants.find((item) => item.employeeId === employeeId && item.leaveTypeId === type.id && item.year === year);
    const carryoverGranted = grant?.days ?? 0;
    const unusedCarryover = Math.max(0, carryoverGranted - carryoverUsed);
    const expired = grant !== undefined && today > grant.expiresOn;
    const available = grant !== undefined && today >= `${year}-01-01` && !expired;
    const baseRemaining = type.yearlyAllowance - approved - pending + carryoverUsed;
    const carryoverRemaining = available ? unusedCarryover : 0;
    return {
      leaveTypeId: type.id, leaveTypeName: type.name, allowance: type.yearlyAllowance,
      approved, pending, baseRemaining, remaining: baseRemaining + carryoverRemaining,
      carryoverGranted, carryoverUsed, carryoverRemaining,
      carryoverExpired: expired ? unusedCarryover : 0, carryoverExpiresOn: grant?.expiresOn ?? null,
    };
  });
}

export function fundReservation(
  candidate: LeaveRequest, requests: LeaveRequest[], policy: Policy, today: string, grants: CarryoverGrant[] = [],
): LeaveRequest {
  const type = policy.leaveTypes.find((item) => item.id === candidate.leaveTypeId);
  if (!type) throw new RuleError(400, 'Select an existing leave type.');
  const existing = requests.filter((request) => request.id !== candidate.id);
  const carryoverByYear: Record<string, number> = {};
  for (const year of Object.keys(daysByYear(candidate.workingDates, candidate.period))) {
    const grant = grants.find((item) => item.employeeId === candidate.employeeId && item.leaveTypeId === type.id && item.year === Number(year));
    if (!grant || today < `${year}-01-01` || today > grant.expiresOn) continue;
    const [balance] = balancesFor(candidate.employeeId, Number(year), [type], existing, grants, today);
    if (balance.baseRemaining < 0) throw new RuleError(409, `The ${type.name} base balance in ${year} is below existing reservations. Resolve the deficit before reserving or approving more leave.`);
    const eligible = candidate.workingDates.filter((date) => date.startsWith(`${year}-`) && date <= grant.expiresOn).length * periodDays(candidate.period);
    const amount = Math.min(eligible, balance.carryoverRemaining);
    if (amount > 0) carryoverByYear[year] = amount;
  }
  return { ...candidate, carryoverByYear };
}

export function validateReservation(
  candidate: LeaveRequest,
  requests: LeaveRequest[],
  policy: Policy,
  today: string,
  checkNotice: boolean,
  grants: CarryoverGrant[] = [],
): void {
  const type = policy.leaveTypes.find((item) => item.id === candidate.leaveTypeId);
  if (!type) throw new RuleError(400, 'Select an existing leave type.');
  if (checkNotice && (dateNumber(candidate.startDate) - dateNumber(today)) / DAY < policy.settings.minNoticeDays) {
    throw new RuleError(400, `A request needs at least ${policy.settings.minNoticeDays} calendar days of notice and cannot start in the past.`);
  }

  const existing = requests.filter((request) => request.id !== candidate.id && isReserved(request));
  if (existing.some((request) => request.employeeId === candidate.employeeId
    && request.startDate <= candidate.endDate && request.endDate >= candidate.startDate
    && periodsOverlap(request.period, candidate.period))) {
    throw new RuleError(409, 'This request overlaps an existing pending or approved request.');
  }

  for (const [year, count] of Object.entries(daysByYear(candidate.workingDates, candidate.period))) {
    const [balance] = balancesFor(candidate.employeeId, Number(year), [type], existing, grants, today);
    const carry = candidate.carryoverByYear?.[year] ?? 0;
    if (carry < 0 || carry > count || !Number.isInteger(carry * 2)) throw new RuleError(400, 'Invalid carry-over allocation.');
    if (count - carry > balance.baseRemaining || carry > balance.carryoverGranted - balance.carryoverUsed) {
      throw new RuleError(409, `Insufficient ${type.name} balance in ${year}: ${balance.remaining} days remaining, ${count} requested.`);
    }
  }

  const teamRequests = existing.filter((request) => request.teamId === candidate.teamId);
  for (const date of candidate.workingDates) {
    for (const slot of leaveSlots(candidate.period)) {
      const peopleOff = new Set(teamRequests.filter((request) => request.workingDates.includes(date) && periodsOverlap(request.period, slot)).map((request) => request.employeeId));
      peopleOff.add(candidate.employeeId);
      if (peopleOff.size > policy.settings.maxTeamOff) {
        throw new RuleError(409, `The team coverage limit of ${policy.settings.maxTeamOff} people off would be exceeded on ${date} (${slot.toUpperCase()}).`);
      }
    }
  }
}

export function assertTransition(actor: User, request: LeaveRequest, action: RequestAction): void {
  if (action === 'cancelled') {
    if (actor.role !== 'employee' || actor.id !== request.employeeId) {
      throw new RuleError(403, 'You do not have permission to cancel this request.');
    }
    if (!isReserved(request)) throw new RuleError(409, 'Only pending or approved requests can be cancelled.');
    return;
  }
  if (actor.role !== 'manager' || actor.teamId !== request.teamId || actor.id === request.employeeId) {
    throw new RuleError(403, 'You do not have permission to decide this request.');
  }
  if (request.status !== 'pending') throw new RuleError(409, 'Only pending requests can be approved or rejected.');
}

import type {
  CarryoverGrant, ConfigurationInput, LeaveRequest, LeaveType, Policy, Team, User, Workspace,
} from '@leave/contracts';

export interface TeamTransaction {
  policy: Policy;
  team: Team;
  requests: LeaveRequest[];
  employeeIds: string[];
  carryovers?: CarryoverGrant[];
  now?: string;
  insert(request: LeaveRequest): Promise<LeaveRequest>;
  update(request: LeaveRequest): Promise<LeaveRequest>;
}

export abstract class LeaveStore {
  abstract transaction<T>(teamId: string, work: (context: TeamTransaction) => Promise<T>): Promise<T>;
  abstract findRequest(id: string): Promise<LeaveRequest | null>;
  abstract workspace(actor: User, year: number, today: string): Promise<Workspace>;
  abstract configure(input: ConfigurationInput): Promise<Policy>;
  abstract addLeaveType(input: Omit<LeaveType, 'id'>): Promise<LeaveType>;
}

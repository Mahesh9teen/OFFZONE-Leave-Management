export type Role = 'employee' | 'manager' | 'admin';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type RequestAction = Exclude<RequestStatus, 'pending'>;
export type LeavePeriod = 'full' | 'am' | 'pm';
export const CARRYOVER_POLICY = { firstYear: 2027, maxDays: 5, expiryMonth: 3, expiryDay: 31 } as const;
export const REMINDER_POLICY = { afterHours: 48, repeatHours: 24 } as const;
export const PERIOD_LABELS: Record<LeavePeriod, string> = { full: 'Full day', am: 'Morning (AM)', pm: 'Afternoon (PM)' };
export function periodDays(period: LeavePeriod = 'full'): number { return period === 'full' ? 1 : 0.5; }
export function leaveSlots(period: LeavePeriod = 'full'): ('am' | 'pm')[] { return period === 'full' ? ['am', 'pm'] : [period]; }
export function periodsOverlap(first: LeavePeriod = 'full', second: LeavePeriod = 'full'): boolean {
  return first === 'full' || second === 'full' || first === second;
}
export function requestDays(request: Pick<LeaveRequest, 'workingDates' | 'period'>): number {
  return request.workingDates.length * periodDays(request.period);
}
export const UPLOAD_LIMITS = { photoBytes: 2 * 1024 * 1024, documentBytes: 5 * 1024 * 1024, documentsPerRequest: 3 } as const;

export interface AuthOptions {
  demoLoginEnabled: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string | null;
  photoVersion: number | null;
}

export interface ProfileInput {
  name: string;
  phone: string;
  jobTitle: string;
}

export interface AccountProfile {
  user: User;
  phone: string;
  jobTitle: string;
  teamName: string | null;
  demoSession: boolean;
  sharedDemo: boolean;
}

export interface PasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ManagedUser extends User, Omit<ProfileInput, 'name'> {
  active: boolean;
  hasLeaveHistory: boolean;
}

export interface ManagedTeam extends Team {
  employeeCount: number;
  managerId: string | null;
  managerName: string | null;
}

export interface PeopleWorkspace {
  users: ManagedUser[];
  teams: ManagedTeam[];
}

export interface CreatePersonInput extends ProfileInput {
  email: string;
  password: string;
  role: 'employee' | 'manager';
  teamId: string;
}

export interface UpdatePersonInput extends ProfileInput {
  teamId: string | null;
  active: boolean;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  requestId: string;
  requestYear: number;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationFeed {
  items: Notification[];
  unreadCount: number;
}

export interface RequestDocument {
  id: string;
  requestId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
}

export interface LeaveType {
  id: string;
  name: string;
  yearlyAllowance: number;
  carryoverEnabled?: boolean;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface Settings {
  minNoticeDays: number;
  maxTeamOff: number;
  version: number;
}

export interface Policy {
  settings: Settings;
  leaveTypes: LeaveType[];
  holidays: Holiday[];
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  teamId: string;
  teamName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  workingDates: string[];
  reason: string;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string;
  period?: LeavePeriod;
  version?: number;
  updatedAt?: string;
  carryoverByYear?: Record<string, number>;
}

export type CalendarEntry = Pick<
  LeaveRequest,
  | 'id'
  | 'employeeId'
  | 'employeeName'
  | 'teamId'
  | 'leaveTypeName'
  | 'startDate'
  | 'endDate'
  | 'workingDates'
  | 'status'
  | 'period'
  | 'version'
  | 'updatedAt'
>;

export interface CarryoverGrant {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  days: number;
  expiresOn: string;
}

export interface Balance {
  leaveTypeId: string;
  leaveTypeName: string;
  allowance: number;
  approved: number;
  pending: number;
  remaining: number;
  baseRemaining?: number;
  carryoverGranted?: number;
  carryoverUsed?: number;
  carryoverRemaining?: number;
  carryoverExpired?: number;
  carryoverExpiresOn?: string | null;
}

export interface EmployeeSummary {
  employee: User;
  balances: Balance[];
}

export interface Workspace extends Policy {
  user: User;
  year: number;
  today: string;
  teams: Team[];
  employees: EmployeeSummary[];
  requests: LeaveRequest[];
  calendar: CalendarEntry[];
  automation?: { scheduled: boolean; email: boolean; queuedEmails?: number; failedEmails?: number };
}

export interface CreateRequestInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  period?: LeavePeriod;
}

export interface EditRequestInput extends CreateRequestInput {
  version: number;
}

export interface ConfigurationInput {
  settings: Settings;
  leaveTypes: LeaveType[];
  holidays: Holiday[];
}

export interface RequestPreview {
  workingDates: string[];
  daysByYear: Record<string, number>;
}

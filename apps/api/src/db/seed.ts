import type { Pool } from 'pg';
import type { LeaveRequest, Policy, RequestStatus, Team, User } from '@leave/contracts';
import { Passwords } from '../auth/passwords.js';
import { seededUserIdentity } from '../auth/demo-identity.js';
import { dateNumber, workingDates } from '../domain/rules.js';
import { inTransaction } from './database.js';

const id = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
const offsetDate = (date: string, days: number) => new Date(dateNumber(date) + days * 86_400_000).toISOString().slice(0, 10);

export function demoData(today: string): { teams: Team[]; users: User[]; policy: Policy; requests: LeaveRequest[] } {
  const year = Number(today.slice(0, 4));
  const teams: Team[] = [{ id: id(30), name: 'Product & Design' }, { id: id(31), name: 'Engineering' }];
  const policy: Policy = {
    settings: { minNoticeDays: 2, maxTeamOff: 2, version: 1 },
    leaveTypes: [
      { id: id(20), name: 'Annual', yearlyAllowance: 20, carryoverEnabled: true },
      { id: id(21), name: 'Sick', yearlyAllowance: 10 },
      { id: id(22), name: 'Unpaid', yearlyAllowance: 30 },
    ],
    holidays: [year - 1, year, year + 1].flatMap((value) => [
      { date: `${value}-01-01`, name: 'Demo New Year holiday' },
      { date: `${value}-03-20`, name: 'Demo spring holiday' },
      { date: `${value}-07-03`, name: 'Demo summer holiday' },
      { date: `${value}-12-25`, name: 'Demo year-end holiday' },
    ]),
  };
  const users: User[] = [
    { ...seededUserIdentity('admin'), name: 'Workspace Admin', role: 'admin', teamId: null },
    { ...seededUserIdentity('manager'), name: 'Jordan Lee', role: 'manager', teamId: teams[0].id },
    { ...seededUserIdentity('manager', 2), name: 'Morgan Chen', role: 'manager', teamId: teams[1].id },
    ...['Alex Rivera', 'Sam Taylor', 'Riley Park', 'Casey Morgan', 'Jamie Brooks', 'Taylor Kim', 'Drew Martin', 'Robin Shah'].map((name, index): User => ({
      ...seededUserIdentity('employee', index + 1), name, role: 'employee', teamId: teams[Math.floor(index / 4)].id,
    })),
  ];
  const past = workingDates(offsetDate(today, -60), offsetDate(today, -1), policy.holidays);
  const future = workingDates(offsetDate(today, 2), offsetDate(today, 120), policy.holidays);
  const requests: LeaveRequest[] = [];
  const statuses: RequestStatus[] = ['approved', 'pending', 'rejected', 'cancelled', 'approved'];
  const reasons = ['Family time', 'A planned break to recharge', 'Personal appointment', 'Travel plans have changed', 'Health appointment'];
  users.filter((user) => user.role === 'employee').forEach((employee, index) => {
    const member = index % 4;
    const team = teams[Math.floor(index / 4)];
    const ranges = [
      past.slice(member * 3, member * 3 + 2),
      future.slice(10 + member * 4, 13 + member * 4),
      future.slice(25 + member * 2, 26 + member * 2),
      future.slice(35 + member * 2, 37 + member * 2),
      future.slice(member * 2, member * 2 + 1),
    ];
    ranges.forEach((dates, sequence) => {
      const type = policy.leaveTypes[[0, 0, 1, 2, 1][sequence]];
      const status = statuses[sequence];
      const earliest = offsetDate(dates[0], -10);
      const createdDate = earliest < today ? earliest : offsetDate(today, -1);
      const createdAt = `${createdDate}T09:00:00.000Z`;
      requests.push({
        id: id(100 + index * 5 + sequence),
        employeeId: employee.id, employeeName: employee.name, teamId: team.id, teamName: team.name,
        leaveTypeId: type.id, leaveTypeName: type.name,
        startDate: dates[0], endDate: dates[dates.length - 1], workingDates: dates,
        reason: reasons[sequence], status, createdAt,
        decidedAt: status === 'pending' ? null : `${offsetDate(createdDate, 1)}T10:00:00.000Z`,
        decidedBy: status === 'pending' ? null : status === 'cancelled' ? employee.id : id(2 + Math.floor(index / 4)),
        decisionNote: status === 'rejected' ? 'Please choose alternative dates.' : status === 'cancelled' ? 'Plans changed.' : '',
      });
    });
  });
  return { teams, users, policy, requests };
}

export async function seedDemo(pool: Pool, password: string, today: string): Promise<boolean> {
  if (password.length < 12 || password.length > 256) throw new Error('SEED_PASSWORD must contain between 12 and 256 characters.');
  const data = demoData(today);
  const passwords = new Passwords();
  const establishedAt = data.requests.reduce((earliest, request) => request.createdAt < earliest ? request.createdAt : earliest, `${today}T00:00:00.000Z`);
  return inTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(1175081)');
    await client.query('SELECT singleton FROM settings FOR UPDATE');
    const { rows } = await client.query<{ populated: boolean }>('SELECT EXISTS (SELECT 1 FROM users) AS populated');
    if (rows[0].populated) return false;
    for (const team of data.teams) await client.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [team.id, team.name]);
    for (const user of data.users) {
      await client.query('INSERT INTO users (id, name, email, password_hash, role, team_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [user.id, user.name, user.email, await passwords.hash(password), user.role, user.teamId, establishedAt]);
    }
    for (const type of data.policy.leaveTypes) {
      await client.query('INSERT INTO leave_types (id, name, yearly_allowance, carryover_enabled, created_at) VALUES ($1, $2, $3, $4, $5)',
        [type.id, type.name, type.yearlyAllowance, type.carryoverEnabled ?? false, establishedAt]);
    }
    for (const holiday of data.policy.holidays) {
      await client.query('INSERT INTO holidays (date, name) VALUES ($1, $2)', [holiday.date, holiday.name]);
    }
    for (const request of data.requests) {
      await client.query(`INSERT INTO leave_requests
        (id, employee_id, leave_type_id, start_date, end_date, working_dates, reason, status, created_at, decided_at, decided_by, decision_note, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::date[], $7, $8, $9, $10, $11, $12, $13)`,
      [request.id, request.employeeId, request.leaveTypeId, request.startDate, request.endDate, request.workingDates,
        request.reason, request.status, request.createdAt, request.decidedAt, request.decidedBy, request.decisionNote, request.decidedAt ?? request.createdAt]);
    }
    return true;
  });
}

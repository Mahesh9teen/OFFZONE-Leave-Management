import { demoData } from './seed.js';
import { validateReservation, workingDates } from '../domain/rules.js';

describe('demo fixtures', () => {
  it.each(['2026-01-01', '2026-11-20', '2026-12-29', '2028-02-28'])('creates valid mixed-state data around %s', (today) => {
    const data = demoData(today);
    expect(data.users.filter((user) => user.role === 'employee')).toHaveLength(8);
    expect(data.users.filter((user) => user.role === 'manager')).toHaveLength(2);
    expect(data.users.filter((user) => user.role === 'admin')).toHaveLength(1);
    expect(data.policy.leaveTypes).toHaveLength(3);
    expect(data.requests).toHaveLength(40);
    expect(new Set(data.requests.map((request) => request.status))).toEqual(new Set(['pending', 'approved', 'rejected', 'cancelled']));
    expect(data.policy.holidays.length).toBeGreaterThan(0);
    for (const request of data.requests) {
      expect(request.createdAt.slice(0, 10) <= today).toBe(true);
      if (request.decidedAt) expect(request.decidedAt.slice(0, 10) <= today).toBe(true);
      expect(request.workingDates).toEqual(workingDates(request.startDate, request.endDate, data.policy.holidays));
      if (request.status === 'approved' || request.status === 'pending') {
        expect(() => validateReservation(request, data.requests, data.policy, today, false)).not.toThrow();
      }
    }
  });
});

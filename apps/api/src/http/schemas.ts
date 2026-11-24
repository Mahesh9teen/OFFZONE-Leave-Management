import { z } from 'zod';

const name = z.string().trim().min(1).max(80);
const date = z.iso.date().refine((value) => value >= '2000-01-01' && value <= '2100-12-31', 'Use a date between 2000 and 2100');
const newPassword = z.string().min(12).max(256).refine((value) => value.trim().length > 0, 'Use a non-blank password');
export const profileSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(32).regex(/^[+\d()\s.-]*$/, 'Use a valid phone number'),
  jobTitle: z.string().trim().max(100),
});
export const passwordSchema = z.strictObject({ currentPassword: z.string().min(1).max(256), newPassword })
  .refine((input) => input.currentPassword !== input.newPassword, 'Choose a different new password');
export const createPersonSchema = profileSchema.extend({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: newPassword,
  role: z.enum(['employee', 'manager']),
  teamId: z.uuid(),
});
export const updatePersonSchema = profileSchema.extend({ teamId: z.uuid().nullable(), active: z.boolean() });
export const teamSchema = z.strictObject({ name: z.string().trim().min(2).max(100) });
export const loginSchema = z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(256) });
export const demoLoginSchema = z.strictObject({ role: z.enum(['employee', 'manager', 'admin']) });
export const requestSchema = z.strictObject({
  leaveTypeId: z.uuid(), startDate: date, endDate: date, reason: z.string().trim().min(3).max(1000),
  period: z.enum(['full', 'am', 'pm']).default('full'),
});
export const editRequestSchema = requestSchema.extend({ version: z.number().int().min(1) });
export const transitionSchema = z.strictObject({
  status: z.enum(['approved', 'rejected', 'cancelled']),
  note: z.string().trim().max(500).default(''),
  version: z.number().int().min(1).optional(),
});
export const yearSchema = z.strictObject({ year: z.coerce.number().int().min(2000).max(2100).optional() });
export const leaveTypeSchema = z.strictObject({
  name, yearlyAllowance: z.number().int().min(0).max(366), carryoverEnabled: z.boolean().optional(),
});
export const configurationSchema = z.strictObject({
  settings: z.strictObject({
    minNoticeDays: z.number().int().min(0).max(365),
    maxTeamOff: z.number().int().min(1).max(100),
    version: z.number().int().min(1),
  }),
  leaveTypes: z.array(leaveTypeSchema.extend({ id: z.uuid() })).min(1).max(50),
  holidays: z.array(z.strictObject({ date, name: z.string().trim().min(1).max(100) })).max(500),
}).superRefine((value, context) => {
  const unique = (values: string[], path: string, label: string) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [path], message: `${label} must be unique.` });
  };
  unique(value.leaveTypes.map((type) => type.id), 'leaveTypes', 'Leave type IDs');
  unique(value.leaveTypes.map((type) => type.name.toLowerCase()), 'leaveTypes', 'Leave type names');
  unique(value.holidays.map((holiday) => holiday.date), 'holidays', 'Holiday dates');
});

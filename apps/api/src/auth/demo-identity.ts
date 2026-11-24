import type { Role, User } from '@leave/contracts';

export function seededUserIdentity(role: Role, index = 1): Pick<User, 'id' | 'email' | 'photoVersion'> {
  const number = role === 'admin' ? 1 : role === 'manager' ? index + 1 : index + 9;
  return {
    id: `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`,
    email: `${role}${role === 'admin' ? '' : index}@example.test`,
    photoVersion: null,
  };
}

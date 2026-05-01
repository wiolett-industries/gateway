import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';

vi.mock('./live-session-user.js', () => ({
  resolveEffectiveGroupAccess: vi.fn().mockResolvedValue({
    groupName: 'admin',
    scopes: ['nodes:details'],
  }),
  computeEffectiveGroupAccess: vi.fn(),
  fetchGroupScopeMap: vi.fn(),
}));

describe('AuthService.blockUser', () => {
  it('keeps sessions available so blocked users can reach status and logout endpoints', async () => {
    const dbUser = {
      id: '11111111-1111-4111-8111-111111111111',
      oidcSubject: 'oidc-user',
      email: 'user@example.com',
      name: 'User',
      avatarUrl: null,
      groupId: 'group-1',
      isBlocked: true,
    };
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([dbUser]),
          })),
        })),
      })),
    };
    const sessionService = {
      destroyAllUserSessions: vi.fn(),
    };
    const eventBus = {
      publish: vi.fn(),
    };
    const service = new AuthService(db as any, sessionService as any, {} as any, {} as any, {} as any);
    service.setEventBus(eventBus as any);

    const user = await service.blockUser(dbUser.id);

    expect(user.isBlocked).toBe(true);
    expect(sessionService.destroyAllUserSessions).not.toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith('user.changed', { id: dbUser.id, action: 'updated' });
    expect(eventBus.publish).toHaveBeenCalledWith(`permissions.changed.${dbUser.id}`, {
      scopes: [],
      groupId: null,
    });
  });
});

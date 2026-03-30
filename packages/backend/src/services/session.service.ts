import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import { getEnv } from '@/config/env.js';
import type { SessionData, User } from '@/types.js';
import type { CacheService } from './cache.service.js';

const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user_sessions:';

@injectable()
export class SessionService {
  constructor(private readonly cache: CacheService) {}

  async createSession(
    user: User,
    accessToken: string,
    refreshToken?: string
  ): Promise<{ sessionId: string; expiresAt: number }> {
    const env = getEnv();
    const sessionId = nanoid(32);
    const expiresAt = Date.now() + env.SESSION_EXPIRY * 1000;

    const sessionData: SessionData = {
      userId: user.id,
      user,
      accessToken,
      refreshToken,
      createdAt: Date.now(),
      expiresAt,
    };

    await this.cache.set(`${SESSION_PREFIX}${sessionId}`, sessionData, env.SESSION_EXPIRY);

    await this.cache.sadd(`${USER_SESSIONS_PREFIX}${user.id}`, sessionId);
    await this.cache.expire(`${USER_SESSIONS_PREFIX}${user.id}`, env.SESSION_EXPIRY + 86400);

    return { sessionId, expiresAt };
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const session = await this.cache.get<SessionData>(`${SESSION_PREFIX}${sessionId}`);

    if (!session) return null;

    if (session.expiresAt < Date.now()) {
      await this.destroySession(sessionId);
      return null;
    }

    return session;
  }

  async updateSession(sessionId: string, updates: Partial<SessionData>): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const updatedSession: SessionData = {
      ...session,
      ...updates,
    };

    const remainingTtl = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));

    await this.cache.set(`${SESSION_PREFIX}${sessionId}`, updatedSession, remainingTtl);
  }

  async refreshSession(sessionId: string, session?: SessionData | null): Promise<boolean> {
    const resolved = session ?? (await this.getSession(sessionId));
    if (!resolved) return false;

    const env = getEnv();
    const halfTtl = (env.SESSION_EXPIRY * 1000) / 2;
    const remaining = resolved.expiresAt - Date.now();

    if (remaining > halfTtl) return false;

    const newExpiresAt = Date.now() + env.SESSION_EXPIRY * 1000;
    resolved.expiresAt = newExpiresAt;

    await this.cache.set(`${SESSION_PREFIX}${sessionId}`, resolved, env.SESSION_EXPIRY);

    return true;
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = await this.cache.get<SessionData>(`${SESSION_PREFIX}${sessionId}`);

    if (session) {
      await this.cache.srem(`${USER_SESSIONS_PREFIX}${session.userId}`, sessionId);
    }

    await this.cache.delete(`${SESSION_PREFIX}${sessionId}`);
  }

  async destroyAllUserSessions(userId: string): Promise<void> {
    const sessionIds = await this.cache.smembers(`${USER_SESSIONS_PREFIX}${userId}`);

    for (const sessionId of sessionIds) {
      await this.cache.delete(`${SESSION_PREFIX}${sessionId}`);
    }

    await this.cache.delete(`${USER_SESSIONS_PREFIX}${userId}`);
  }

  async getUserSessions(userId: string): Promise<SessionData[]> {
    const sessionIds = await this.cache.smembers(`${USER_SESSIONS_PREFIX}${userId}`);
    const sessions: SessionData[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  async validateSession(sessionId: string): Promise<User | null> {
    const session = await this.getSession(sessionId);
    return session?.user || null;
  }
}

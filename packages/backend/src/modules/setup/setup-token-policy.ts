import { count, like, not } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { users } from '@/db/schema/index.js';

export class SetupTokenPolicyService {
  constructor(private readonly db: DrizzleClient) {}

  async isGatewayConfigured(): Promise<boolean> {
    const [{ count: userCount }] = await this.db
      .select({ count: count() })
      .from(users)
      .where(not(like(users.oidcSubject, 'system:%')));

    return Number(userCount) > 0;
  }

  async isSetupApiEnabled(): Promise<boolean> {
    return !(await this.isGatewayConfigured());
  }
}

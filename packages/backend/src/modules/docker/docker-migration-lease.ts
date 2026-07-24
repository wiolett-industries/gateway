import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerMigrationNodeLocks, dockerMigrations } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';

export const DOCKER_MIGRATION_LEASE_HEARTBEAT_MS = 15_000;
export const DOCKER_MIGRATION_LEASE_EXPIRY_MS = 60_000;

export class DockerMigrationLease {
  readonly owner = randomUUID();

  constructor(private db: DrizzleClient) {}

  async claim(id: string): Promise<boolean> {
    const now = new Date();
    const [row] = await this.db
      .update(dockerMigrations)
      .set({
        leaseOwner: this.owner,
        leaseHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + DOCKER_MIGRATION_LEASE_EXPIRY_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(dockerMigrations.id, id),
          or(
            isNull(dockerMigrations.leaseOwner),
            eq(dockerMigrations.leaseOwner, this.owner),
            lt(dockerMigrations.leaseExpiresAt, now)
          )
        )
      )
      .returning({ id: dockerMigrations.id });
    return !!row;
  }

  async acquireNodeLocks(row: typeof dockerMigrations.$inferSelect): Promise<void> {
    const expires = new Date(Date.now() + DOCKER_MIGRATION_LEASE_EXPIRY_MS);
    await this.db.transaction(async (tx) => {
      await tx.delete(dockerMigrationNodeLocks).where(lt(dockerMigrationNodeLocks.leaseExpiresAt, new Date()));
      for (const nodeId of [row.sourceNodeId, row.targetNodeId]) {
        const [lock] = await tx
          .insert(dockerMigrationNodeLocks)
          .values({ nodeId, migrationId: row.id, leaseExpiresAt: expires })
          .onConflictDoNothing()
          .returning();
        if (lock) continue;
        const [owned] = await tx
          .select({ migrationId: dockerMigrationNodeLocks.migrationId })
          .from(dockerMigrationNodeLocks)
          .where(and(eq(dockerMigrationNodeLocks.nodeId, nodeId), eq(dockerMigrationNodeLocks.migrationId, row.id)));
        if (!owned) throw new AppError(409, 'MIGRATION_NODE_BUSY', 'A Docker node is locked by another migration');
      }
    });
  }

  async heartbeat(id: string): Promise<void> {
    const now = new Date();
    const expires = new Date(now.getTime() + DOCKER_MIGRATION_LEASE_EXPIRY_MS);
    const [migration] = await Promise.all([
      this.db
        .update(dockerMigrations)
        .set({ leaseHeartbeatAt: now, leaseExpiresAt: expires, updatedAt: now })
        .where(and(eq(dockerMigrations.id, id), eq(dockerMigrations.leaseOwner, this.owner)))
        .returning({ id: dockerMigrations.id }),
      this.db
        .update(dockerMigrationNodeLocks)
        .set({ leaseExpiresAt: expires, updatedAt: now })
        .where(eq(dockerMigrationNodeLocks.migrationId, id)),
    ]);
    if (!migration.length) this.lost();
  }

  async assertOwnership(id: string): Promise<void> {
    const [row] = await this.db
      .select({ leaseOwner: dockerMigrations.leaseOwner, leaseExpiresAt: dockerMigrations.leaseExpiresAt })
      .from(dockerMigrations)
      .where(eq(dockerMigrations.id, id))
      .limit(1);
    const locks = await this.db
      .select({ nodeId: dockerMigrationNodeLocks.nodeId })
      .from(dockerMigrationNodeLocks)
      .where(eq(dockerMigrationNodeLocks.migrationId, id));
    if (
      row?.leaseOwner !== this.owner ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt <= new Date() ||
      locks.length !== 2
    ) {
      this.lost();
    }
  }

  async release(id: string): Promise<void> {
    await Promise.all([
      this.db.delete(dockerMigrationNodeLocks).where(eq(dockerMigrationNodeLocks.migrationId, id)),
      this.db
        .update(dockerMigrations)
        .set({ leaseOwner: null, leaseExpiresAt: null, leaseHeartbeatAt: null, updatedAt: new Date() })
        .where(eq(dockerMigrations.id, id)),
    ]);
  }

  private lost(): never {
    throw new AppError(409, 'MIGRATION_LEASE_LOST', 'Docker migration lease was lost');
  }
}

import { randomUUID } from 'node:crypto';

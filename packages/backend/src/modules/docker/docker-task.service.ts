import { and, desc, eq, lt } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerTasks } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { EventBusService } from '@/services/event-bus.service.js';

const logger = createChildLogger('DockerTaskService');

export class DockerTaskService {
  constructor(private db: DrizzleClient) {}

  private eventBus?: EventBusService;
  setEventBus(bus: EventBusService) { this.eventBus = bus; }
  private emit(task: { id: string; nodeId: string; status: string; progress?: string | null; error?: string | null }) {
    this.eventBus?.publish('docker.task.changed', {
      taskId: task.id,
      nodeId: task.nodeId,
      status: task.status,
      progress: task.progress ?? null,
      error: task.error ?? null,
    });
  }

  async list(filters?: { nodeId?: string; status?: string; type?: string }) {
    const conditions = [];
    if (filters?.nodeId) conditions.push(eq(dockerTasks.nodeId, filters.nodeId));
    if (filters?.status) conditions.push(eq(dockerTasks.status, filters.status));
    if (filters?.type) conditions.push(eq(dockerTasks.type, filters.type));

    return this.db
      .select()
      .from(dockerTasks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(dockerTasks.createdAt));
  }

  async get(id: string) {
    const [row] = await this.db.select().from(dockerTasks).where(eq(dockerTasks.id, id)).limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Docker task not found');
    return row;
  }

  async create(input: { nodeId: string; containerId?: string; containerName?: string; type: string }) {
    const [row] = await this.db
      .insert(dockerTasks)
      .values({
        nodeId: input.nodeId,
        containerId: input.containerId ?? null,
        containerName: input.containerName ?? null,
        type: input.type,
        status: 'pending',
      })
      .returning();

    this.emit(row);
    return row;
  }

  async update(
    id: string,
    updates: {
      status?: string;
      progress?: string;
      error?: string;
      completedAt?: Date;
    }
  ) {
    const values: Record<string, unknown> = {};
    if (updates.status !== undefined) values.status = updates.status;
    if (updates.progress !== undefined) values.progress = updates.progress;
    if (updates.error !== undefined) values.error = updates.error;
    if (updates.completedAt !== undefined) values.completedAt = updates.completedAt;

    const [row] = await this.db.update(dockerTasks).set(values).where(eq(dockerTasks.id, id)).returning();

    if (!row) throw new AppError(404, 'NOT_FOUND', 'Docker task not found');
    this.emit(row);
    return row;
  }

  /**
   * Handle a task progress/status update from a daemon CommandResult.
   * The detail field is expected to be a JSON string with task information.
   */
  async handleTaskUpdate(nodeId: string, detail: string) {
    try {
      const data = JSON.parse(detail) as {
        taskId?: string;
        containerId?: string;
        containerName?: string;
        type?: string;
        status?: string;
        progress?: string;
        error?: string;
      };

      if (data.taskId) {
        // Update existing task
        const updates: Record<string, unknown> = {};
        if (data.status) updates.status = data.status;
        if (data.progress) updates.progress = data.progress;
        if (data.error) updates.error = data.error;
        if (data.status === 'completed' || data.status === 'failed') {
          updates.completedAt = new Date();
        }

        await this.db.update(dockerTasks).set(updates).where(eq(dockerTasks.id, data.taskId));
      } else if (data.type) {
        // Create a new task from the update
        await this.create({
          nodeId,
          containerId: data.containerId,
          containerName: data.containerName,
          type: data.type,
        });
      }
    } catch (error) {
      logger.error('Failed to handle task update', { nodeId, error });
    }
  }

  /**
   * Delete tasks that were completed more than 24 hours ago.
   */
  async cleanup() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.db
      .delete(dockerTasks)
      .where(and(eq(dockerTasks.status, 'completed'), lt(dockerTasks.completedAt, cutoff)))
      .returning({ id: dockerTasks.id });

    if (result.length > 0) {
      logger.info(`Cleaned up ${result.length} completed docker tasks`);
    }
    return result.length;
  }
}

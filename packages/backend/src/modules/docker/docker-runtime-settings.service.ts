import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import {
  dockerRuntimeSettings,
  type DockerRuntimeSettingsConfig,
} from '@/db/schema/index.js';

export class DockerRuntimeSettingsService {
  constructor(private db: DrizzleClient) {}

  async get(nodeId: string, containerName: string): Promise<DockerRuntimeSettingsConfig | null> {
    const [row] = await this.db
      .select()
      .from(dockerRuntimeSettings)
      .where(
        and(
          eq(dockerRuntimeSettings.nodeId, nodeId),
          eq(dockerRuntimeSettings.containerName, containerName)
        )
      )
      .limit(1);

    return (row?.config ?? null) as DockerRuntimeSettingsConfig | null;
  }

  async replace(
    nodeId: string,
    containerName: string,
    config: DockerRuntimeSettingsConfig
  ): Promise<void> {
    if (Object.keys(config).length === 0) {
      await this.delete(nodeId, containerName);
      return;
    }

    await this.db
      .insert(dockerRuntimeSettings)
      .values({ nodeId, containerName, config })
      .onConflictDoUpdate({
        target: [dockerRuntimeSettings.nodeId, dockerRuntimeSettings.containerName],
        set: { config, updatedAt: new Date() },
      });
  }

  async rename(nodeId: string, fromName: string, toName: string): Promise<void> {
    await this.db
      .update(dockerRuntimeSettings)
      .set({ containerName: toName, updatedAt: new Date() })
      .where(
        and(
          eq(dockerRuntimeSettings.nodeId, nodeId),
          eq(dockerRuntimeSettings.containerName, fromName)
        )
      );
  }

  async copy(nodeId: string, fromName: string, toName: string): Promise<void> {
    const config = await this.get(nodeId, fromName);
    if (!config) return;
    await this.replace(nodeId, toName, config);
  }

  async delete(nodeId: string, containerName: string): Promise<void> {
    await this.db
      .delete(dockerRuntimeSettings)
      .where(
        and(
          eq(dockerRuntimeSettings.nodeId, nodeId),
          eq(dockerRuntimeSettings.containerName, containerName)
        )
      );
  }
}

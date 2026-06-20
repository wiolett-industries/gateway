import type {
  ContainerCreateConfig,
  DockerContainer,
  DockerContainerFolder,
  DockerDeployment,
  DockerFolderTreeNode,
  DockerHealthCheck,
  DockerImage,
  DockerImageCleanupSettings,
  DockerNetwork,
  DockerRegistry,
  DockerSecret,
  DockerTask,
  DockerVolume,
  DockerWebhook,
  FileEntry,
} from "@/types";
import type { ApiClientBaseConstructor } from "./api-mixins";

type DockerListEnvelope<T> = {
  data: T[];
  total?: number;
  limit?: number;
  truncated?: boolean;
};

type DockerListQuery = {
  search?: string;
};

function dockerListQuery(params?: DockerListQuery & { noCache?: boolean }) {
  const query = new URLSearchParams();
  if (params?.search?.trim()) query.set("search", params.search.trim());
  if (params?.noCache) query.set("_t", String(Date.now()));
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

function withDockerListMeta<T extends object>(response: DockerListEnvelope<T>): T[] {
  return (response.data ?? []).map((item) => ({
    ...item,
    _listTotal: response.total ?? response.data.length,
    _listLimit: response.limit ?? response.data.length,
    _listTruncated: response.truncated === true,
  })) as T[];
}

export function withDockerApi<TBase extends ApiClientBaseConstructor>(Base: TBase) {
  return class DockerApiClient extends Base {
    // ── Docker Folders ─────────────────────────────────────────────

    async listDockerFolders(): Promise<DockerFolderTreeNode[]> {
      return this.unwrapData(this.request<{ data: DockerFolderTreeNode[] }>("/docker/folders"));
    }

    async createDockerFolder(data: {
      name: string;
      parentId?: string;
    }): Promise<DockerContainerFolder> {
      return this.unwrapData(
        this.request<{ data: DockerContainerFolder }>("/docker/folders", {
          method: "POST",
          body: JSON.stringify(data),
        })
      );
    }

    async updateDockerFolder(id: string, data: { name: string }): Promise<DockerContainerFolder> {
      return this.unwrapData(
        this.request<{ data: DockerContainerFolder }>(`/docker/folders/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        })
      );
    }

    async deleteDockerFolder(id: string): Promise<void> {
      return this.request<void>(`/docker/folders/${id}`, { method: "DELETE" });
    }

    async reorderDockerFolders(items: { id: string; sortOrder: number }[]): Promise<void> {
      return this.request<void>("/docker/folders/reorder", {
        method: "PUT",
        body: JSON.stringify({ items }),
      });
    }

    async moveDockerContainersToFolder(
      items: Array<{ nodeId: string; containerName: string }>,
      folderId: string | null
    ): Promise<void> {
      return this.request<void>("/docker/folders/move-containers", {
        method: "POST",
        body: JSON.stringify({ items, folderId }),
      });
    }

    async reorderDockerContainers(
      items: Array<{ nodeId: string; containerName: string; sortOrder: number }>
    ): Promise<void> {
      return this.request<void>("/docker/folders/reorder-containers", {
        method: "PUT",
        body: JSON.stringify({ items }),
      });
    }

    // ── Docker Containers ─────────────────────────────────────────────

    async listDockerContainers(
      nodeId: string,
      options: boolean | (DockerListQuery & { noCache?: boolean }) = false
    ): Promise<DockerContainer[]> {
      const params = typeof options === "boolean" ? { noCache: options } : options;
      const url = `/docker/nodes/${nodeId}/containers${dockerListQuery(params)}`;
      return withDockerListMeta(await this.request<DockerListEnvelope<DockerContainer>>(url));
    }

    async inspectContainer(
      nodeId: string,
      containerId: string,
      noCache = false
    ): Promise<Record<string, unknown>> {
      const url = noCache
        ? `/docker/nodes/${nodeId}/containers/${containerId}?_t=${Date.now()}`
        : `/docker/nodes/${nodeId}/containers/${containerId}`;
      return this.unwrapData(this.request<{ data: Record<string, unknown> }>(url));
    }

    async createContainer(
      nodeId: string,
      config: ContainerCreateConfig
    ): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/containers`, {
          method: "POST",
          body: JSON.stringify(config),
        })
      );
    }

    async listDockerDeployments(
      nodeId: string,
      params?: DockerListQuery
    ): Promise<DockerDeployment[]> {
      return withDockerListMeta(
        await this.request<DockerListEnvelope<DockerDeployment>>(
          `/docker/nodes/${nodeId}/deployments${dockerListQuery(params)}`
        )
      );
    }

    async getDockerDeployment(nodeId: string, deploymentId: string): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}`
        )
      );
    }

    async createDockerDeployment(
      nodeId: string,
      config: Record<string, unknown>
    ): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(`/docker/nodes/${nodeId}/deployments`, {
          method: "POST",
          body: JSON.stringify(config),
        })
      );
    }

    async updateDockerDeployment(
      nodeId: string,
      deploymentId: string,
      config: Record<string, unknown>
    ): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}`,
          { method: "PUT", body: JSON.stringify(config) }
        )
      );
    }

    async deployDockerDeployment(
      nodeId: string,
      deploymentId: string,
      config: { image?: string; tag?: string; env?: Record<string, string> }
    ): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/deploy`,
          { method: "POST", body: JSON.stringify(config) }
        )
      );
    }

    async switchDockerDeployment(
      nodeId: string,
      deploymentId: string,
      slot: "blue" | "green",
      force = false
    ): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/switch`,
          { method: "POST", body: JSON.stringify({ slot, force }) }
        )
      );
    }

    async rollbackDockerDeployment(
      nodeId: string,
      deploymentId: string,
      force = false
    ): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/rollback`,
          { method: "POST", body: JSON.stringify({ force }) }
        )
      );
    }

    async stopDockerDeploymentSlot(
      nodeId: string,
      deploymentId: string,
      slot: "blue" | "green"
    ): Promise<void> {
      await this.request<void>(
        `/docker/nodes/${nodeId}/deployments/${deploymentId}/slots/${slot}/stop`,
        { method: "POST" }
      );
    }

    async startDockerDeployment(nodeId: string, deploymentId: string): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/start`,
          { method: "POST" }
        )
      );
    }

    async stopDockerDeployment(nodeId: string, deploymentId: string): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/stop`,
          { method: "POST" }
        )
      );
    }

    async restartDockerDeployment(nodeId: string, deploymentId: string): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/restart`,
          { method: "POST" }
        )
      );
    }

    async killDockerDeployment(nodeId: string, deploymentId: string): Promise<DockerDeployment> {
      return this.unwrapData(
        this.request<{ data: DockerDeployment }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/kill`,
          { method: "POST" }
        )
      );
    }

    async deleteDockerDeployment(nodeId: string, deploymentId: string): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/deployments/${deploymentId}`, {
        method: "DELETE",
      });
    }

    async getContainerHealthCheck(
      nodeId: string,
      containerName: string
    ): Promise<DockerHealthCheck> {
      return this.unwrapData(
        this.request<{ data: DockerHealthCheck }>(
          `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/health-check`
        )
      );
    }

    async updateContainerHealthCheck(
      nodeId: string,
      containerName: string,
      data: Partial<DockerHealthCheck>
    ): Promise<DockerHealthCheck> {
      return this.unwrapData(
        this.request<{ data: DockerHealthCheck }>(
          `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/health-check`,
          { method: "PUT", body: JSON.stringify(data) }
        )
      );
    }

    async testContainerHealthCheck(
      nodeId: string,
      containerName: string,
      data: Partial<DockerHealthCheck>
    ): Promise<{ ok: boolean; status: string; httpStatus?: number; responseMs?: number }> {
      return this.unwrapData(
        this.request<{
          data: { ok: boolean; status: string; httpStatus?: number; responseMs?: number };
        }>(
          `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/health-check/test`,
          { method: "POST", body: JSON.stringify(data) }
        )
      );
    }

    async getDeploymentHealthCheck(
      nodeId: string,
      deploymentId: string
    ): Promise<DockerHealthCheck> {
      return this.unwrapData(
        this.request<{ data: DockerHealthCheck }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/health-check`
        )
      );
    }

    async updateDeploymentHealthCheck(
      nodeId: string,
      deploymentId: string,
      data: Partial<DockerHealthCheck>
    ): Promise<DockerHealthCheck> {
      return this.unwrapData(
        this.request<{ data: DockerHealthCheck }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/health-check`,
          { method: "PUT", body: JSON.stringify(data) }
        )
      );
    }

    async testDeploymentHealthCheck(
      nodeId: string,
      deploymentId: string,
      data: Partial<DockerHealthCheck>
    ): Promise<{ ok: boolean; status: string; httpStatus?: number; responseMs?: number }> {
      return this.unwrapData(
        this.request<{
          data: { ok: boolean; status: string; httpStatus?: number; responseMs?: number };
        }>(`/docker/nodes/${nodeId}/deployments/${deploymentId}/health-check/test`, {
          method: "POST",
          body: JSON.stringify(data),
        })
      );
    }

    async startContainer(nodeId: string, containerId: string): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/start`, {
        method: "POST",
      });
    }

    async stopContainer(nodeId: string, containerId: string, timeout?: number): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/stop`, {
        method: "POST",
        body: JSON.stringify(timeout === undefined ? {} : { timeout }),
      });
    }

    async restartContainer(nodeId: string, containerId: string, timeout?: number): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/restart`, {
        method: "POST",
        body: JSON.stringify(timeout === undefined ? {} : { timeout }),
      });
    }

    async killContainer(nodeId: string, containerId: string, signal = "SIGKILL"): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/kill`, {
        method: "POST",
        body: JSON.stringify({ signal }),
      });
    }

    async removeContainer(nodeId: string, containerId: string, force = false): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}`, {
        method: "DELETE",
        body: JSON.stringify({ force }),
      });
    }

    async renameContainer(nodeId: string, containerId: string, name: string): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/rename`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    }

    async duplicateContainer(
      nodeId: string,
      containerId: string,
      name: string
    ): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/duplicate`,
          { method: "POST", body: JSON.stringify({ name }) }
        )
      );
    }

    async updateContainer(
      nodeId: string,
      containerId: string,
      config: { tag?: string; env?: Record<string, string>; removeEnv?: string[] }
    ): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/update`,
          { method: "POST", body: JSON.stringify(config) }
        )
      );
    }

    async getContainerLogs(
      nodeId: string,
      containerId: string,
      params?: { tail?: number; timestamps?: boolean }
    ): Promise<string[]> {
      const qs = new URLSearchParams();
      if (params?.tail) qs.set("tail", String(params.tail));
      if (params?.timestamps) qs.set("timestamps", "true");
      const query = qs.toString();
      return this.unwrapData(
        this.request<{ data: string[] }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/logs${query ? `?${query}` : ""}`
        )
      );
    }

    async getContainerStats(nodeId: string, containerId: string): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/stats`
        )
      );
    }

    async getContainerTop(
      nodeId: string,
      containerId: string
    ): Promise<{
      Titles: string[];
      Processes: string[][];
      truncated?: boolean;
      totalProcesses?: number;
      limit?: number;
    }> {
      return this.unwrapData(
        this.request<{
          data: {
            Titles: string[];
            Processes: string[][];
            truncated?: boolean;
            totalProcesses?: number;
            limit?: number;
          };
        }>(`/docker/nodes/${nodeId}/containers/${containerId}/top`)
      );
    }

    async getContainerStatsHistory(
      nodeId: string,
      containerId: string
    ): Promise<Record<string, unknown>[]> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown>[] }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/stats/history`
        )
      );
    }

    async getContainerEnv(nodeId: string, containerId: string): Promise<string[]> {
      return this.unwrapData(
        this.request<{ data: string[] }>(`/docker/nodes/${nodeId}/containers/${containerId}/env`)
      );
    }

    async updateContainerEnv(
      nodeId: string,
      containerId: string,
      env: Record<string, string>,
      removeEnv?: string[]
    ): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/env`,
          { method: "PUT", body: JSON.stringify({ env, removeEnv }) }
        )
      );
    }

    async liveUpdateContainer(
      nodeId: string,
      containerId: string,
      config: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/live-update`,
          { method: "POST", body: JSON.stringify(config) }
        )
      );
    }

    async recreateWithConfig(
      nodeId: string,
      containerId: string,
      config: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/recreate`,
          { method: "POST", body: JSON.stringify(config) }
        )
      );
    }

    // ── Docker Secrets ────────────────────────────────────────────────

    async listDockerSecrets(nodeId: string, containerId: string): Promise<DockerSecret[]> {
      return this.unwrapData(
        this.request<{ data: DockerSecret[] }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/secrets`
        )
      );
    }

    async createDockerSecret(
      nodeId: string,
      containerId: string,
      key: string,
      value: string
    ): Promise<DockerSecret> {
      return this.unwrapData(
        this.request<{ data: DockerSecret }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/secrets`,
          {
            method: "POST",
            body: JSON.stringify({ key, value }),
          }
        )
      );
    }

    async updateDockerSecret(
      nodeId: string,
      containerId: string,
      secretId: string,
      value: string
    ): Promise<DockerSecret> {
      return this.unwrapData(
        this.request<{ data: DockerSecret }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/secrets/${secretId}`,
          {
            method: "PUT",
            body: JSON.stringify({ value }),
          }
        )
      );
    }

    async deleteDockerSecret(nodeId: string, containerId: string, secretId: string): Promise<void> {
      await this.request(`/docker/nodes/${nodeId}/containers/${containerId}/secrets/${secretId}`, {
        method: "DELETE",
      });
    }

    async listDockerDeploymentSecrets(
      nodeId: string,
      deploymentId: string
    ): Promise<DockerSecret[]> {
      return this.unwrapData(
        this.request<{ data: DockerSecret[] }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/secrets`
        )
      );
    }

    async createDockerDeploymentSecret(
      nodeId: string,
      deploymentId: string,
      key: string,
      value: string
    ): Promise<DockerSecret> {
      return this.unwrapData(
        this.request<{ data: DockerSecret }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/secrets`,
          {
            method: "POST",
            body: JSON.stringify({ key, value }),
          }
        )
      );
    }

    async updateDockerDeploymentSecret(
      nodeId: string,
      deploymentId: string,
      secretId: string,
      value: string
    ): Promise<DockerSecret> {
      return this.unwrapData(
        this.request<{ data: DockerSecret }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/secrets/${secretId}`,
          {
            method: "PUT",
            body: JSON.stringify({ value }),
          }
        )
      );
    }

    async deleteDockerDeploymentSecret(
      nodeId: string,
      deploymentId: string,
      secretId: string
    ): Promise<void> {
      await this.request(
        `/docker/nodes/${nodeId}/deployments/${deploymentId}/secrets/${secretId}`,
        {
          method: "DELETE",
        }
      );
    }

    // ── Docker Images ─────────────────────────────────────────────────

    async listDockerImages(nodeId: string, params?: DockerListQuery): Promise<DockerImage[]> {
      return withDockerListMeta(
        await this.request<DockerListEnvelope<DockerImage>>(
          `/docker/nodes/${nodeId}/images${dockerListQuery(params)}`
        )
      );
    }

    async pullImage(
      nodeId: string,
      imageRef: string,
      registryId?: string
    ): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/images/pull`, {
          method: "POST",
          body: JSON.stringify({ imageRef, registryId }),
        })
      );
    }

    async removeImage(nodeId: string, imageId: string): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/images/${encodeURIComponent(imageId)}`, {
        method: "DELETE",
      });
    }

    async pruneImages(nodeId: string): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/images/prune`, {
          method: "POST",
        })
      );
    }

    // ── Docker Volumes ────────────────────────────────────────────────

    async listDockerVolumes(nodeId: string, params?: DockerListQuery): Promise<DockerVolume[]> {
      return withDockerListMeta(
        await this.request<DockerListEnvelope<DockerVolume>>(
          `/docker/nodes/${nodeId}/volumes${dockerListQuery(params)}`
        )
      );
    }

    async createVolume(
      nodeId: string,
      config: { name: string; driver?: string; labels?: Record<string, string> }
    ): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/volumes`, {
          method: "POST",
          body: JSON.stringify(config),
        })
      );
    }

    async removeVolume(nodeId: string, name: string): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/volumes/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
    }

    // ── Docker Networks ───────────────────────────────────────────────

    async listDockerNetworks(nodeId: string, params?: DockerListQuery): Promise<DockerNetwork[]> {
      return withDockerListMeta(
        await this.request<DockerListEnvelope<DockerNetwork>>(
          `/docker/nodes/${nodeId}/networks${dockerListQuery(params)}`
        )
      );
    }

    async createNetwork(
      nodeId: string,
      config: { name: string; driver?: string; subnet?: string; gateway?: string }
    ): Promise<Record<string, unknown>> {
      return this.unwrapData(
        this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/networks`, {
          method: "POST",
          body: JSON.stringify(config),
        })
      );
    }

    async removeNetwork(nodeId: string, networkId: string): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/networks/${networkId}`, {
        method: "DELETE",
      });
    }

    async connectContainerToNetwork(
      nodeId: string,
      networkId: string,
      containerId: string
    ): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/networks/${networkId}/connect`, {
        method: "POST",
        body: JSON.stringify({ containerId }),
      });
    }

    async disconnectContainerFromNetwork(
      nodeId: string,
      networkId: string,
      containerId: string
    ): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/networks/${networkId}/disconnect`, {
        method: "POST",
        body: JSON.stringify({ containerId }),
      });
    }

    // ── Docker File Browser ───────────────────────────────────────────

    async listContainerDir(
      nodeId: string,
      containerId: string,
      path: string
    ): Promise<FileEntry[]> {
      const response = await this.request<DockerListEnvelope<FileEntry>>(
        `/docker/nodes/${nodeId}/containers/${containerId}/files?path=${encodeURIComponent(path)}`
      );
      return withDockerListMeta(response);
    }

    async readContainerFile(nodeId: string, containerId: string, path: string): Promise<string> {
      return this.unwrapData(
        this.request<{ data: string }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/files/read?path=${encodeURIComponent(path)}`
        )
      );
    }

    async writeContainerFile(nodeId: string, containerId: string, path: string, content: string) {
      return this.unwrapData(
        this.request<{ data: unknown }>(
          `/docker/nodes/${nodeId}/containers/${containerId}/files/write`,
          { method: "PUT", body: JSON.stringify({ path, content }) }
        )
      );
    }

    // ── Docker Registries ─────────────────────────────────────────────

    async listDockerRegistries(): Promise<DockerRegistry[]> {
      return this.unwrapData(this.request<{ data: DockerRegistry[] }>("/docker/registries"));
    }

    async createRegistry(config: {
      name: string;
      url: string;
      username?: string;
      password?: string;
      trustedAuthRealm?: string;
      scope?: string;
      nodeId?: string;
    }): Promise<DockerRegistry> {
      return this.unwrapData(
        this.request<{ data: DockerRegistry }>("/docker/registries", {
          method: "POST",
          body: JSON.stringify(config),
        })
      );
    }

    async updateRegistry(
      id: string,
      config: Partial<{
        name: string;
        url: string;
        username?: string;
        password?: string;
        trustedAuthRealm?: string;
        scope?: string;
        nodeId?: string;
      }>
    ): Promise<DockerRegistry> {
      return this.unwrapData(
        this.request<{ data: DockerRegistry }>(`/docker/registries/${id}`, {
          method: "PUT",
          body: JSON.stringify(config),
        })
      );
    }

    async deleteRegistry(id: string): Promise<void> {
      await this.request<void>(`/docker/registries/${id}`, { method: "DELETE" });
    }

    async testRegistry(id: string): Promise<{ ok: boolean; error?: string }> {
      const result = await this.unwrapData(
        this.request<{
          data: { success?: boolean; ok?: boolean; error?: string; statusText?: string };
        }>(`/docker/registries/${id}/test`, { method: "POST" })
      );
      return { ok: result.success ?? result.ok ?? false, error: result.error || result.statusText };
    }

    async testRegistryDirect(creds: {
      url: string;
      username?: string;
      password?: string;
      trustedAuthRealm?: string;
    }): Promise<{ ok: boolean; error?: string }> {
      const result = await this.unwrapData(
        this.request<{ data: { success?: boolean; error?: string; statusText?: string } }>(
          `/docker/registries/test`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(creds),
          }
        )
      );
      return { ok: result.success ?? false, error: result.error || result.statusText };
    }

    // ── Docker Tasks ──────────────────────────────────────────────────

    async listDockerTasks(params?: {
      nodeId?: string;
      status?: string;
      type?: string;
    }): Promise<DockerTask[]> {
      const qs = new URLSearchParams();
      if (params?.nodeId) qs.set("nodeId", params.nodeId);
      if (params?.status) qs.set("status", params.status);
      if (params?.type) qs.set("type", params.type);
      const query = qs.toString();
      return this.unwrapData(
        this.request<{ data: DockerTask[] }>(`/docker/tasks${query ? `?${query}` : ""}`)
      );
    }

    async getDockerTask(id: string): Promise<DockerTask> {
      return this.unwrapData(this.request<{ data: DockerTask }>(`/docker/tasks/${id}`));
    }

    // ── Docker Exec WebSocket ─────────────────────────────────────────

    createExecWebSocket(nodeId: string, containerId: string, shell = "/bin/sh"): WebSocket {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/docker/nodes/${nodeId}/containers/${containerId}/exec?shell=${encodeURIComponent(shell)}`;
      return new WebSocket(url);
    }

    // ── Node Console WebSocket ─────────────────────────────────────

    createNodeExecWebSocket(nodeId: string, shell = "auto"): WebSocket {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/nodes/${nodeId}/exec?shell=${encodeURIComponent(shell)}`;
      return new WebSocket(url);
    }

    // ── Docker Webhooks ────────────────────────────────────────────

    async getContainerWebhook(
      nodeId: string,
      containerName: string
    ): Promise<DockerWebhook | null> {
      const result = await this.request<{ data: DockerWebhook | null }>(
        `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/webhook`
      );
      return result.data;
    }

    async upsertContainerWebhook(
      nodeId: string,
      containerName: string,
      input: { enabled?: boolean }
    ): Promise<DockerWebhook> {
      return this.unwrapData(
        this.request<{ data: DockerWebhook }>(
          `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/webhook`,
          { method: "PUT", body: JSON.stringify(input) }
        )
      );
    }

    async deleteContainerWebhook(nodeId: string, containerName: string): Promise<void> {
      await this.request<void>(
        `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/webhook`,
        { method: "DELETE" }
      );
    }

    async regenerateWebhookToken(nodeId: string, containerName: string): Promise<DockerWebhook> {
      return this.unwrapData(
        this.request<{ data: DockerWebhook }>(
          `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/webhook/regenerate`,
          { method: "POST" }
        )
      );
    }

    async getContainerImageCleanup(
      nodeId: string,
      containerName: string
    ): Promise<DockerImageCleanupSettings> {
      return this.unwrapData(
        this.request<{ data: DockerImageCleanupSettings }>(
          `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/image-cleanup`
        )
      );
    }

    async upsertContainerImageCleanup(
      nodeId: string,
      containerName: string,
      input: { enabled?: boolean; retentionCount?: number }
    ): Promise<DockerImageCleanupSettings> {
      return this.unwrapData(
        this.request<{ data: DockerImageCleanupSettings }>(
          `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/image-cleanup`,
          { method: "PUT", body: JSON.stringify(input) }
        )
      );
    }

    async getDeploymentWebhook(
      nodeId: string,
      deploymentId: string
    ): Promise<DockerWebhook | null> {
      const result = await this.request<{ data: DockerWebhook | null }>(
        `/docker/nodes/${nodeId}/deployments/${deploymentId}/webhook`
      );
      return result.data;
    }

    async upsertDeploymentWebhook(
      nodeId: string,
      deploymentId: string,
      input: { enabled?: boolean }
    ): Promise<DockerWebhook> {
      return this.unwrapData(
        this.request<{ data: DockerWebhook }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/webhook`,
          { method: "PUT", body: JSON.stringify(input) }
        )
      );
    }

    async deleteDeploymentWebhook(nodeId: string, deploymentId: string): Promise<void> {
      await this.request<void>(`/docker/nodes/${nodeId}/deployments/${deploymentId}/webhook`, {
        method: "DELETE",
      });
    }

    async regenerateDeploymentWebhookToken(
      nodeId: string,
      deploymentId: string
    ): Promise<DockerWebhook> {
      return this.unwrapData(
        this.request<{ data: DockerWebhook }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/webhook/regenerate`,
          { method: "POST" }
        )
      );
    }

    async getDeploymentImageCleanup(
      nodeId: string,
      deploymentId: string
    ): Promise<DockerImageCleanupSettings> {
      return this.unwrapData(
        this.request<{ data: DockerImageCleanupSettings }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/image-cleanup`
        )
      );
    }

    async upsertDeploymentImageCleanup(
      nodeId: string,
      deploymentId: string,
      input: { enabled?: boolean; retentionCount?: number }
    ): Promise<DockerImageCleanupSettings> {
      return this.unwrapData(
        this.request<{ data: DockerImageCleanupSettings }>(
          `/docker/nodes/${nodeId}/deployments/${deploymentId}/image-cleanup`,
          { method: "PUT", body: JSON.stringify(input) }
        )
      );
    }

    async pullImageSync(
      nodeId: string,
      imageRef: string,
      registryId?: string
    ): Promise<{ success: boolean; imageRef: string }> {
      return this.unwrapData(
        this.request<{ data: { success: boolean; imageRef: string } }>(
          `/docker/nodes/${nodeId}/images/pull-sync`,
          { method: "POST", body: JSON.stringify({ imageRef, registryId }) }
        )
      );
    }

    // ── Docker Log Stream WebSocket ─────────────────────────────────

    createLogStreamWebSocket(nodeId: string, containerId: string, tail = 100): WebSocket {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/docker/nodes/${nodeId}/containers/${containerId}/logs/stream?tail=${tail}`;
      return new WebSocket(url);
    }
  };
}

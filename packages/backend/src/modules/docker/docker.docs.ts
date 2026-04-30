import { z } from '@hono/zod-openapi';
import {
  appRoute,
  createdJson,
  jsonBody,
  okJson,
  optionalJsonBody,
  pathParamSchema,
  successJson,
  UnknownDataResponseSchema,
} from '@/lib/openapi.js';
import {
  ContainerCreateSchema,
  ContainerDuplicateSchema,
  ContainerKillSchema,
  ContainerLiveUpdateSchema,
  ContainerRecreateSchema,
  ContainerRenameSchema,
  ContainerStopSchema,
  ContainerUpdateSchema,
  DockerHealthCheckUpsertSchema,
  EnvUpdateSchema,
  FileBrowseSchema,
  FileWriteSchema,
  ImagePullSchema,
  LogQuerySchema,
  NetworkConnectSchema,
  NetworkCreateSchema,
  RegistryCreateSchema,
  RegistryUpdateSchema,
  SecretCreateSchema,
  SecretUpdateSchema,
  VolumeCreateSchema,
} from './docker.schemas.js';
import {
  DockerDeploymentCreateSchema,
  DockerDeploymentDeploySchema,
  DockerDeploymentSwitchSchema,
  DockerDeploymentUpdateSchema,
} from './docker-deployment.schemas.js';
import {
  CreateDockerFolderSchema,
  MoveDockerContainersToFolderSchema,
  ReorderDockerContainersSchema,
  ReorderDockerFoldersSchema,
  UpdateDockerFolderSchema,
} from './docker-folder.schemas.js';
import { WebhookTriggerSchema, WebhookUpsertSchema } from './docker-webhook.schemas.js';

export const nodeParams = pathParamSchema('nodeId');
export const containerParams = pathParamSchema('nodeId', 'containerId');
export const containerNameParams = pathParamSchema('nodeId', 'containerName');
export const deploymentParams = pathParamSchema('nodeId', 'deploymentId');

const imageParams = pathParamSchema('nodeId', 'imageId');
const volumeParams = pathParamSchema('nodeId', 'name');
const networkParams = pathParamSchema('nodeId', 'networkId');
const registryParams = pathParamSchema('id');
const taskParams = pathParamSchema('id');
const containerSecretParams = pathParamSchema('nodeId', 'containerId', 'secretId');
const deploymentSecretParams = pathParamSchema('nodeId', 'deploymentId', 'secretId');
const dockerListQuery = z.object({ search: z.string().trim().optional() });

export const listContainersRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers',
  tags: ['Docker Containers'],
  summary: 'List containers',
  request: { params: nodeParams, query: dockerListQuery },
  responses: okJson(UnknownDataResponseSchema),
});
export const createContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers',
  tags: ['Docker Containers'],
  summary: 'Create a container',
  request: { params: nodeParams, ...jsonBody(ContainerCreateSchema) },
  responses: createdJson(UnknownDataResponseSchema),
});
export const inspectContainerRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerId}',
  tags: ['Docker Containers'],
  summary: 'Inspect a container',
  request: { params: containerParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const startContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/start',
  tags: ['Docker Containers'],
  summary: 'Start a container',
  request: { params: containerParams },
  responses: successJson,
});
export const stopContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/stop',
  tags: ['Docker Containers'],
  summary: 'Stop a container',
  request: { params: containerParams, ...optionalJsonBody(ContainerStopSchema) },
  responses: successJson,
});
export const restartContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/restart',
  tags: ['Docker Containers'],
  summary: 'Restart a container',
  request: { params: containerParams, ...optionalJsonBody(ContainerStopSchema) },
  responses: successJson,
});
export const killContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/kill',
  tags: ['Docker Containers'],
  summary: 'Kill a container',
  request: { params: containerParams, ...optionalJsonBody(ContainerKillSchema) },
  responses: successJson,
});
export const removeContainerRoute = appRoute({
  method: 'delete',
  path: '/nodes/{nodeId}/containers/{containerId}',
  tags: ['Docker Containers'],
  summary: 'Remove a container',
  request: { params: containerParams, query: z.object({ force: z.coerce.boolean().optional() }) },
  responses: successJson,
});
export const renameContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/rename',
  tags: ['Docker Containers'],
  summary: 'Rename a container',
  request: { params: containerParams, ...jsonBody(ContainerRenameSchema) },
  responses: successJson,
});
export const duplicateContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/duplicate',
  tags: ['Docker Containers'],
  summary: 'Duplicate a container',
  request: { params: containerParams, ...jsonBody(ContainerDuplicateSchema) },
  responses: createdJson(UnknownDataResponseSchema),
});
export const updateContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/update',
  tags: ['Docker Containers'],
  summary: 'Pull and redeploy a container image',
  request: { params: containerParams, ...jsonBody(ContainerUpdateSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const liveUpdateContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/live-update',
  tags: ['Docker Containers'],
  summary: 'Update runtime settings without recreation',
  request: { params: containerParams, ...jsonBody(ContainerLiveUpdateSchema) },
  responses: successJson,
});
export const recreateContainerRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/recreate',
  tags: ['Docker Containers'],
  summary: 'Recreate a container with new settings',
  request: { params: containerParams, ...jsonBody(ContainerRecreateSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const containerLogsRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerId}/logs',
  tags: ['Docker Containers'],
  summary: 'Get container logs',
  request: { params: containerParams, query: LogQuerySchema },
  responses: okJson(UnknownDataResponseSchema),
});
export const containerStatsRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerId}/stats',
  tags: ['Docker Containers'],
  summary: 'Get container stats',
  request: { params: containerParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const containerStatsHistoryRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerId}/stats/history',
  tags: ['Docker Containers'],
  summary: 'Get container stats history',
  request: { params: containerParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const containerTopRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerId}/top',
  tags: ['Docker Containers'],
  summary: 'Get container process list',
  request: { params: containerParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const containerEnvRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerId}/env',
  tags: ['Docker Containers'],
  summary: 'Get container environment',
  request: { params: containerParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const updateContainerEnvRoute = appRoute({
  method: 'put',
  path: '/nodes/{nodeId}/containers/{containerId}/env',
  tags: ['Docker Containers'],
  summary: 'Update container environment',
  request: { params: containerParams, ...jsonBody(EnvUpdateSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const listContainerSecretsRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerId}/secrets',
  tags: ['Docker Secrets'],
  summary: 'List container secrets',
  request: { params: containerParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const createContainerSecretRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerId}/secrets',
  tags: ['Docker Secrets'],
  summary: 'Create a container secret',
  request: { params: containerParams, ...jsonBody(SecretCreateSchema) },
  responses: createdJson(UnknownDataResponseSchema),
});
export const updateContainerSecretRoute = appRoute({
  method: 'put',
  path: '/nodes/{nodeId}/containers/{containerId}/secrets/{secretId}',
  tags: ['Docker Secrets'],
  summary: 'Update a container secret',
  request: { params: containerSecretParams, ...jsonBody(SecretUpdateSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteContainerSecretRoute = appRoute({
  method: 'delete',
  path: '/nodes/{nodeId}/containers/{containerId}/secrets/{secretId}',
  tags: ['Docker Secrets'],
  summary: 'Delete a container secret',
  request: { params: containerSecretParams },
  responses: successJson,
});
export const listContainerFilesRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerId}/files',
  tags: ['Docker Files'],
  summary: 'List container directory',
  request: { params: containerParams, query: FileBrowseSchema },
  responses: okJson(UnknownDataResponseSchema),
});
export const readContainerFileRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerId}/files/read',
  tags: ['Docker Files'],
  summary: 'Read a container file',
  request: { params: containerParams, query: FileBrowseSchema },
  responses: okJson(UnknownDataResponseSchema),
});
export const writeContainerFileRoute = appRoute({
  method: 'put',
  path: '/nodes/{nodeId}/containers/{containerId}/files/write',
  tags: ['Docker Files'],
  summary: 'Write a container file',
  request: { params: containerParams, ...jsonBody(FileWriteSchema) },
  responses: successJson,
});

export const listDeploymentsRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/deployments',
  tags: ['Docker Deployments'],
  summary: 'List blue/green deployments',
  request: { params: nodeParams, query: dockerListQuery },
  responses: okJson(UnknownDataResponseSchema),
});
export const createDeploymentRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/deployments',
  tags: ['Docker Deployments'],
  summary: 'Create a blue/green deployment',
  request: { params: nodeParams, ...jsonBody(DockerDeploymentCreateSchema) },
  responses: createdJson(UnknownDataResponseSchema),
});
export const getDeploymentRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/deployments/{deploymentId}',
  tags: ['Docker Deployments'],
  summary: 'Get a deployment',
  request: { params: deploymentParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const updateDeploymentRoute = appRoute({
  method: 'put',
  path: '/nodes/{nodeId}/deployments/{deploymentId}',
  tags: ['Docker Deployments'],
  summary: 'Update a deployment',
  request: { params: deploymentParams, ...jsonBody(DockerDeploymentUpdateSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteDeploymentRoute = appRoute({
  method: 'delete',
  path: '/nodes/{nodeId}/deployments/{deploymentId}',
  tags: ['Docker Deployments'],
  summary: 'Delete a deployment',
  request: { params: deploymentParams },
  responses: successJson,
});
export const deploymentActionRoute = (action: 'start' | 'stop' | 'restart' | 'kill') =>
  appRoute({
    method: 'post',
    path: `/nodes/{nodeId}/deployments/{deploymentId}/${action}`,
    tags: ['Docker Deployments'],
    summary: `${action[0].toUpperCase()}${action.slice(1)} a deployment`,
    request: { params: deploymentParams },
    responses: okJson(UnknownDataResponseSchema),
  });
export const deployDeploymentRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/deploy',
  tags: ['Docker Deployments'],
  summary: 'Deploy a new inactive slot',
  request: { params: deploymentParams, ...optionalJsonBody(DockerDeploymentDeploySchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const switchDeploymentRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/switch',
  tags: ['Docker Deployments'],
  summary: 'Switch deployment slot',
  request: { params: deploymentParams, ...jsonBody(DockerDeploymentSwitchSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const rollbackDeploymentRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/rollback',
  tags: ['Docker Deployments'],
  summary: 'Rollback a deployment',
  request: { params: deploymentParams, ...optionalJsonBody(z.object({ force: z.boolean().optional() })) },
  responses: okJson(UnknownDataResponseSchema),
});
export const stopDeploymentSlotRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/slots/{slot}/stop',
  tags: ['Docker Deployments'],
  summary: 'Stop a deployment slot',
  request: { params: pathParamSchema('nodeId', 'deploymentId', 'slot') },
  responses: successJson,
});
export const deploymentWebhookRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/webhook',
  tags: ['Docker Deployments'],
  summary: 'Get deployment webhook config',
  request: { params: deploymentParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const upsertDeploymentWebhookRoute = appRoute({
  method: 'put',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/webhook',
  tags: ['Docker Deployments'],
  summary: 'Configure deployment webhook',
  request: { params: deploymentParams, ...jsonBody(WebhookUpsertSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteDeploymentWebhookRoute = appRoute({
  method: 'delete',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/webhook',
  tags: ['Docker Deployments'],
  summary: 'Delete deployment webhook',
  request: { params: deploymentParams },
  responses: successJson,
});
export const regenerateDeploymentWebhookRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/webhook/regenerate',
  tags: ['Docker Deployments'],
  summary: 'Regenerate deployment webhook token',
  request: { params: deploymentParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const listDeploymentSecretsRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/secrets',
  tags: ['Docker Secrets'],
  summary: 'List deployment secrets',
  request: { params: deploymentParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const createDeploymentSecretRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/secrets',
  tags: ['Docker Secrets'],
  summary: 'Create a deployment secret',
  request: { params: deploymentParams, ...jsonBody(SecretCreateSchema) },
  responses: createdJson(UnknownDataResponseSchema),
});
export const updateDeploymentSecretRoute = appRoute({
  method: 'put',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/secrets/{secretId}',
  tags: ['Docker Secrets'],
  summary: 'Update a deployment secret',
  request: { params: deploymentSecretParams, ...jsonBody(SecretUpdateSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteDeploymentSecretRoute = appRoute({
  method: 'delete',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/secrets/{secretId}',
  tags: ['Docker Secrets'],
  summary: 'Delete a deployment secret',
  request: { params: deploymentSecretParams },
  responses: successJson,
});

export const containerHealthCheckRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerName}/health-check',
  tags: ['Docker Health Checks'],
  summary: 'Get a container health check',
  request: { params: containerNameParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const upsertContainerHealthCheckRoute = appRoute({
  method: 'put',
  path: '/nodes/{nodeId}/containers/{containerName}/health-check',
  tags: ['Docker Health Checks'],
  summary: 'Configure a container health check',
  request: { params: containerNameParams, ...jsonBody(DockerHealthCheckUpsertSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const testContainerHealthCheckRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerName}/health-check/test',
  tags: ['Docker Health Checks'],
  summary: 'Test a container health check',
  request: { params: containerNameParams, ...optionalJsonBody(DockerHealthCheckUpsertSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deploymentHealthCheckRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/health-check',
  tags: ['Docker Health Checks'],
  summary: 'Get a deployment health check',
  request: { params: deploymentParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const upsertDeploymentHealthCheckRoute = appRoute({
  method: 'put',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/health-check',
  tags: ['Docker Health Checks'],
  summary: 'Configure a deployment health check',
  request: { params: deploymentParams, ...jsonBody(DockerHealthCheckUpsertSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const testDeploymentHealthCheckRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/deployments/{deploymentId}/health-check/test',
  tags: ['Docker Health Checks'],
  summary: 'Test a deployment health check',
  request: { params: deploymentParams, ...optionalJsonBody(DockerHealthCheckUpsertSchema) },
  responses: okJson(UnknownDataResponseSchema),
});

export const listImagesRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/images',
  tags: ['Docker Images'],
  summary: 'List images',
  request: { params: nodeParams, query: dockerListQuery },
  responses: okJson(UnknownDataResponseSchema),
});
export const pullImageRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/images/pull',
  tags: ['Docker Images'],
  summary: 'Pull an image asynchronously',
  request: { params: nodeParams, ...jsonBody(ImagePullSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const pullImageSyncRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/images/pull-sync',
  tags: ['Docker Images'],
  summary: 'Pull an image synchronously',
  request: { params: nodeParams, ...jsonBody(ImagePullSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const removeImageRoute = appRoute({
  method: 'delete',
  path: '/nodes/{nodeId}/images/{imageId}',
  tags: ['Docker Images'],
  summary: 'Remove an image',
  request: { params: imageParams, query: z.object({ force: z.coerce.boolean().optional() }) },
  responses: successJson,
});
export const pruneImagesRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/images/prune',
  tags: ['Docker Images'],
  summary: 'Prune unused images',
  request: { params: nodeParams },
  responses: okJson(UnknownDataResponseSchema),
});

export const listVolumesRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/volumes',
  tags: ['Docker Volumes'],
  summary: 'List volumes',
  request: { params: nodeParams, query: dockerListQuery },
  responses: okJson(UnknownDataResponseSchema),
});
export const createVolumeRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/volumes',
  tags: ['Docker Volumes'],
  summary: 'Create a volume',
  request: { params: nodeParams, ...jsonBody(VolumeCreateSchema) },
  responses: createdJson(UnknownDataResponseSchema),
});
export const removeVolumeRoute = appRoute({
  method: 'delete',
  path: '/nodes/{nodeId}/volumes/{name}',
  tags: ['Docker Volumes'],
  summary: 'Remove a volume',
  request: { params: volumeParams, query: z.object({ force: z.coerce.boolean().optional() }) },
  responses: successJson,
});

export const listNetworksRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/networks',
  tags: ['Docker Networks'],
  summary: 'List networks',
  request: { params: nodeParams, query: dockerListQuery },
  responses: okJson(UnknownDataResponseSchema),
});
export const createNetworkRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/networks',
  tags: ['Docker Networks'],
  summary: 'Create a network',
  request: { params: nodeParams, ...jsonBody(NetworkCreateSchema) },
  responses: createdJson(UnknownDataResponseSchema),
});
export const removeNetworkRoute = appRoute({
  method: 'delete',
  path: '/nodes/{nodeId}/networks/{networkId}',
  tags: ['Docker Networks'],
  summary: 'Remove a network',
  request: { params: networkParams },
  responses: successJson,
});
export const connectNetworkRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/networks/{networkId}/connect',
  tags: ['Docker Networks'],
  summary: 'Connect a container to a network',
  request: { params: networkParams, ...jsonBody(NetworkConnectSchema) },
  responses: successJson,
});
export const disconnectNetworkRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/networks/{networkId}/disconnect',
  tags: ['Docker Networks'],
  summary: 'Disconnect a container from a network',
  request: { params: networkParams, ...jsonBody(NetworkConnectSchema) },
  responses: successJson,
});

export const listRegistriesRoute = appRoute({
  method: 'get',
  path: '/registries',
  tags: ['Docker Registries'],
  summary: 'List registries',
  request: { query: z.object({ nodeId: z.string().optional() }) },
  responses: okJson(UnknownDataResponseSchema),
});
export const createRegistryRoute = appRoute({
  method: 'post',
  path: '/registries',
  tags: ['Docker Registries'],
  summary: 'Create a registry',
  request: jsonBody(RegistryCreateSchema),
  responses: createdJson(UnknownDataResponseSchema),
});
export const updateRegistryRoute = appRoute({
  method: 'put',
  path: '/registries/{id}',
  tags: ['Docker Registries'],
  summary: 'Update a registry',
  request: { params: registryParams, ...jsonBody(RegistryUpdateSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteRegistryRoute = appRoute({
  method: 'delete',
  path: '/registries/{id}',
  tags: ['Docker Registries'],
  summary: 'Delete a registry',
  request: { params: registryParams },
  responses: successJson,
});
export const testRegistryDirectRoute = appRoute({
  method: 'post',
  path: '/registries/test',
  tags: ['Docker Registries'],
  summary: 'Test registry credentials',
  request: jsonBody(RegistryCreateSchema.partial()),
  responses: okJson(UnknownDataResponseSchema),
});
export const testRegistryRoute = appRoute({
  method: 'post',
  path: '/registries/{id}/test',
  tags: ['Docker Registries'],
  summary: 'Test a saved registry',
  request: { params: registryParams },
  responses: okJson(UnknownDataResponseSchema),
});

export const listTasksRoute = appRoute({
  method: 'get',
  path: '/tasks',
  tags: ['Docker Tasks'],
  summary: 'List background tasks',
  request: {
    query: z.object({ nodeId: z.string().optional(), status: z.string().optional(), type: z.string().optional() }),
  },
  responses: okJson(UnknownDataResponseSchema),
});
export const getTaskRoute = appRoute({
  method: 'get',
  path: '/tasks/{id}',
  tags: ['Docker Tasks'],
  summary: 'Get a background task',
  request: { params: taskParams },
  responses: okJson(UnknownDataResponseSchema),
});

export const listDockerFoldersRoute = appRoute({
  method: 'get',
  path: '/folders',
  tags: ['Docker Folders'],
  summary: 'List Docker folders',
  responses: okJson(UnknownDataResponseSchema),
});
export const createDockerFolderRoute = appRoute({
  method: 'post',
  path: '/folders',
  tags: ['Docker Folders'],
  summary: 'Create a Docker folder',
  request: jsonBody(CreateDockerFolderSchema),
  responses: createdJson(UnknownDataResponseSchema),
});
export const reorderDockerFoldersRoute = appRoute({
  method: 'put',
  path: '/folders/reorder',
  tags: ['Docker Folders'],
  summary: 'Reorder Docker folders',
  request: jsonBody(ReorderDockerFoldersSchema),
  responses: successJson,
});
export const reorderDockerContainersRoute = appRoute({
  method: 'put',
  path: '/folders/reorder-containers',
  tags: ['Docker Folders'],
  summary: 'Reorder containers inside Docker folders',
  request: jsonBody(ReorderDockerContainersSchema),
  responses: successJson,
});
export const updateDockerFolderRoute = appRoute({
  method: 'put',
  path: '/folders/{id}',
  tags: ['Docker Folders'],
  summary: 'Update a Docker folder',
  request: { params: pathParamSchema('id'), ...jsonBody(UpdateDockerFolderSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteDockerFolderRoute = appRoute({
  method: 'delete',
  path: '/folders/{id}',
  tags: ['Docker Folders'],
  summary: 'Delete a Docker folder',
  request: { params: pathParamSchema('id') },
  responses: { 204: { description: 'No content' } },
});
export const moveDockerContainersRoute = appRoute({
  method: 'post',
  path: '/folders/move-containers',
  tags: ['Docker Folders'],
  summary: 'Move containers into a Docker folder',
  request: jsonBody(MoveDockerContainersToFolderSchema),
  responses: successJson,
});

export const triggerDockerWebhookRoute = appRoute({
  method: 'post',
  path: '/{token}',
  tags: ['Docker Webhooks'],
  summary: 'Trigger a Docker webhook',
  security: [],
  request: { params: pathParamSchema('token'), ...jsonBody(WebhookTriggerSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const getContainerWebhookRoute = appRoute({
  method: 'get',
  path: '/nodes/{nodeId}/containers/{containerName}/webhook',
  tags: ['Docker Webhooks'],
  summary: 'Get container webhook config',
  request: { params: containerNameParams },
  responses: okJson(UnknownDataResponseSchema),
});
export const upsertContainerWebhookRoute = appRoute({
  method: 'put',
  path: '/nodes/{nodeId}/containers/{containerName}/webhook',
  tags: ['Docker Webhooks'],
  summary: 'Configure container webhook',
  request: { params: containerNameParams, ...jsonBody(WebhookUpsertSchema) },
  responses: okJson(UnknownDataResponseSchema),
});
export const deleteContainerWebhookRoute = appRoute({
  method: 'delete',
  path: '/nodes/{nodeId}/containers/{containerName}/webhook',
  tags: ['Docker Webhooks'],
  summary: 'Delete container webhook',
  request: { params: containerNameParams },
  responses: successJson,
});
export const regenerateContainerWebhookRoute = appRoute({
  method: 'post',
  path: '/nodes/{nodeId}/containers/{containerName}/webhook/regenerate',
  tags: ['Docker Webhooks'],
  summary: 'Regenerate container webhook token',
  request: { params: containerNameParams },
  responses: okJson(UnknownDataResponseSchema),
});

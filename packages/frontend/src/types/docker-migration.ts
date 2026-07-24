export type DockerMigrationResource =
  | { type: "container"; containerName: string }
  | { type: "deployment"; deploymentId: string };

export interface DockerMigrationRequest {
  resource: DockerMigrationResource;
  sourceNodeId: string;
  targetNodeId: string;
  keepSource: boolean;
}

export interface DockerMigrationIssue {
  code: string;
  message: string;
  detail?: string;
  resource?: string;
}

export interface DockerMigrationArtifactPlan {
  id?: string;
  kind: "image" | "volume";
  sourceIdentity: string;
  targetIdentity: string;
  sizeBytes?: number | null;
  transferredBytes?: number;
  status?: string;
}

export interface DockerMigrationCapacity {
  requiredBytes: number;
  availableBytes: number | null;
  marginBytes: number;
  sufficient: boolean;
}

export interface DockerMigrationPreflight {
  fingerprint: string;
  targetNodeSlug?: string;
  sourceState: string;
  blockers: DockerMigrationIssue[];
  warnings: DockerMigrationIssue[];
  artifacts: DockerMigrationArtifactPlan[];
  capacity?: DockerMigrationCapacity | null;
  proxyHosts?: Array<{ id: string; enabled: boolean; maintenanceAlreadyEnabled: boolean }>;
  plannedChanges?: string[];
  deletionPlan?: Array<{
    type: "container" | "deployment" | "volume";
    name: string;
    sizeBytes?: number;
  }>;
  verificationPlan?: string[];
}

export type DockerMigrationStatus =
  | "pending"
  | "running"
  | "waiting"
  | "cancelling"
  | "completed"
  | "failed"
  | "cleanup_pending"
  | "needs_attention"
  | "cancelled";

export interface DockerMigration {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  targetNodeSlug?: string | null;
  targetResourceId?: string | null;
  resourceType: "container" | "deployment";
  resourceName: string;
  containerName?: string | null;
  deploymentId?: string | null;
  keepSource: boolean;
  sourceState: string;
  status: DockerMigrationStatus;
  phase: string;
  progress: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  warnings?: DockerMigrationIssue[];
  verification?: Record<string, boolean | number | string | null>;
  artifacts?: DockerMigrationArtifactPlan[];
  createdAt: string;
  startedAt?: string | null;
  updatedAt: string;
  completedAt?: string | null;
  cancellationRequestedAt?: string | null;
  cutoverAt?: string | null;
}

export interface StartDockerMigrationRequest extends DockerMigrationRequest {
  preflightFingerprint: string;
}

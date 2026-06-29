import type { DrizzleClient } from '@/db/client.js';
import { nodeFolders, nodes } from '@/db/schema/index.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import { FolderedResourceService } from '@/modules/resource-folders/resource-folder.service.js';

export class NodeFolderService extends FolderedResourceService {
  constructor(db: DrizzleClient, auditService: AuditService) {
    super(db, auditService, {
      folderTable: nodeFolders,
      resourceTable: nodes,
      resourceName: 'node',
      resourcePlural: 'nodes',
      auditResourceType: 'node_folder',
      eventName: 'node.folder.changed',
    });
  }
}

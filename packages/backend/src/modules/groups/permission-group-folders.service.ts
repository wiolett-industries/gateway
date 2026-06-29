import type { DrizzleClient } from '@/db/client.js';
import { permissionGroupFolders, permissionGroups } from '@/db/schema/index.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import { FolderedResourceService } from '@/modules/resource-folders/resource-folder.service.js';

export class PermissionGroupFolderService extends FolderedResourceService {
  constructor(db: DrizzleClient, auditService: AuditService) {
    super(db, auditService, {
      folderTable: permissionGroupFolders,
      resourceTable: permissionGroups,
      resourceName: 'permission_group',
      resourcePlural: 'permission_groups',
      auditResourceType: 'permission_group_folder',
      eventName: 'group.changed',
    });
  }
}

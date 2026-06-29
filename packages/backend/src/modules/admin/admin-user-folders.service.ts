import type { DrizzleClient } from '@/db/client.js';
import { adminUserFolders, users } from '@/db/schema/index.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import { FolderedResourceService } from '@/modules/resource-folders/resource-folder.service.js';

export class AdminUserFolderService extends FolderedResourceService {
  constructor(db: DrizzleClient, auditService: AuditService) {
    super(db, auditService, {
      folderTable: adminUserFolders,
      resourceTable: users,
      resourceName: 'user',
      resourcePlural: 'users',
      auditResourceType: 'admin_user_folder',
      eventName: 'user.changed',
    });
  }
}

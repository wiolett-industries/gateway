import type { DrizzleClient } from '@/db/client.js';
import { databaseConnectionFolders, databaseConnections } from '@/db/schema/index.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import { FolderedResourceService } from '@/modules/resource-folders/resource-folder.service.js';

export class DatabaseFolderService extends FolderedResourceService {
  constructor(db: DrizzleClient, auditService: AuditService) {
    super(db, auditService, {
      folderTable: databaseConnectionFolders,
      resourceTable: databaseConnections,
      resourceName: 'database_connection',
      resourcePlural: 'database_connections',
      auditResourceType: 'database_connection_folder',
      eventName: 'database.folder.changed',
    });
  }
}

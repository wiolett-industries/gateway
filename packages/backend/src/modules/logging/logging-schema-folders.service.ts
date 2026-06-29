import type { DrizzleClient } from '@/db/client.js';
import { loggingSchemaFolders, loggingSchemas } from '@/db/schema/index.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import { FolderedResourceService } from '@/modules/resource-folders/resource-folder.service.js';

export class LoggingSchemaFolderService extends FolderedResourceService {
  constructor(db: DrizzleClient, auditService: AuditService) {
    super(db, auditService, {
      folderTable: loggingSchemaFolders,
      resourceTable: loggingSchemas,
      resourceName: 'logging_schema',
      resourcePlural: 'logging_schemas',
      auditResourceType: 'logging_schema_folder',
      eventName: 'logging.schema.changed',
    });
  }
}

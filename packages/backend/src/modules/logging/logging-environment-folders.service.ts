import type { DrizzleClient } from '@/db/client.js';
import { loggingEnvironmentFolders, loggingEnvironments } from '@/db/schema/index.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import { FolderedResourceService } from '@/modules/resource-folders/resource-folder.service.js';

export class LoggingEnvironmentFolderService extends FolderedResourceService {
  constructor(db: DrizzleClient, auditService: AuditService) {
    super(db, auditService, {
      folderTable: loggingEnvironmentFolders,
      resourceTable: loggingEnvironments,
      resourceName: 'logging_environment',
      resourcePlural: 'logging_environments',
      auditResourceType: 'logging_environment_folder',
      eventName: 'logging.environment.changed',
    });
  }
}

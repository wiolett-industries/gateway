import type { DrizzleClient } from '@/db/client.js';
import { domainFolders, domains } from '@/db/schema/index.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import { FolderedResourceService } from '@/modules/resource-folders/resource-folder.service.js';

export class DomainFolderService extends FolderedResourceService {
  constructor(db: DrizzleClient, auditService: AuditService) {
    super(db, auditService, {
      folderTable: domainFolders,
      resourceTable: domains,
      resourceName: 'domain',
      resourcePlural: 'domains',
      auditResourceType: 'domain_folder',
      eventName: 'domain.changed',
    });
  }
}

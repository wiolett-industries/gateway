import { hasScope } from '@/lib/permissions.js';
import { CreateIntermediateCASchema, CreateRootCASchema, UpdateCASchema } from '@/modules/pki/ca.schemas.js';
import type { CAService } from '@/modules/pki/ca.service.js';
import type { User } from '@/types.js';
import { caTypeRevokeScope, caTypeViewScope } from './ai.service-helpers.js';

export const PKI_CA_TOOL_NAMES = new Set([
  'list_cas',
  'get_ca',
  'create_root_ca',
  'create_intermediate_ca',
  'delete_ca',
  'manage_ca',
]);

export interface PkiCaToolContext {
  caService: CAService;
}

export async function executePkiCaTool(
  context: PkiCaToolContext,
  user: User,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const a = args as any;

  switch (toolName) {
    case 'list_cas':
      return (await context.caService.getCATree()).filter((ca: { type: string }) =>
        hasScope(user.scopes, caTypeViewScope(ca.type))
      );
    case 'get_ca': {
      const ca = await context.caService.getCA(a.caId);
      if (!hasScope(user.scopes, caTypeViewScope(ca.type))) {
        throw new Error(`PERMISSION_DENIED: Missing required scope ${caTypeViewScope(ca.type)}`);
      }
      return ca;
    }
    case 'create_root_ca': {
      const rootCaInput = CreateRootCASchema.parse(args);
      return context.caService.createRootCA(rootCaInput, user.id);
    }
    case 'create_intermediate_ca': {
      const intCaInput = CreateIntermediateCASchema.parse(args);
      return context.caService.createIntermediateCA(a.parentCaId, intCaInput, user.id);
    }
    case 'delete_ca': {
      const ca = await context.caService.getCA(a.caId);
      const requiredScope = caTypeRevokeScope(ca.type);
      if (!hasScope(user.scopes, requiredScope)) {
        throw new Error(`PERMISSION_DENIED: Missing required scope ${requiredScope}`);
      }
      await context.caService.deleteCA(a.caId, user.id);
      return { success: true };
    }
    case 'manage_ca': {
      const ca = await context.caService.getCA(a.caId);
      const requiredScope = ca.type === 'root' ? 'pki:ca:create:root' : 'pki:ca:create:intermediate';
      if (!hasScope(user.scopes, requiredScope)) {
        throw new Error(`PERMISSION_DENIED: Missing required scope ${requiredScope}`);
      }
      if (a.operation === 'update') {
        return context.caService.updateCA(a.caId, UpdateCASchema.parse(args), user.id);
      }
      throw new Error(`Unsupported CA operation: ${String(a.operation)}`);
    }
    default:
      throw new Error(`Unsupported PKI CA tool: ${toolName}`);
  }
}

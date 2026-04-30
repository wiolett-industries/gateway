import { z } from 'zod';
import { isValidCidr } from '@/lib/ip-cidr.js';
import { CLIENT_IP_SOURCE_VALUES } from '@/modules/settings/network-settings.service.js';

export const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().max(255).optional(),
  groupId: z.string().uuid(),
});

export const UpdateUserGroupSchema = z.object({
  groupId: z.string().uuid(),
});

export const UpdateBlockSchema = z.object({
  blocked: z.boolean(),
});

export const UpdateAuthProvisioningSettingsSchema = z.object({
  oidcAutoCreateUsers: z.boolean().optional(),
  oidcDefaultGroupId: z.string().uuid().optional(),
  mcpServerEnabled: z.boolean().optional(),
  networkSecurity: z
    .object({
      clientIpSource: z.enum(CLIENT_IP_SOURCE_VALUES).optional(),
      trustedProxyCidrs: z
        .array(z.string().trim().min(1).max(64).refine(isValidCidr, 'Invalid CIDR range'))
        .max(64)
        .optional(),
      trustCloudflareHeaders: z.boolean().optional(),
    })
    .optional(),
});

export type UpdateUserGroupInput = z.infer<typeof UpdateUserGroupSchema>;
export type UpdateBlockInput = z.infer<typeof UpdateBlockSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateAuthProvisioningSettingsInput = z.infer<typeof UpdateAuthProvisioningSettingsSchema>;

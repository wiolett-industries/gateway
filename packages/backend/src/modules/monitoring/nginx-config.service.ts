import { createChildLogger } from '@/lib/logger.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';

const logger = createChildLogger('NginxConfigService');

const MAX_CONFIG_SIZE = 1_048_576; // 1 MB

export class NginxConfigService {
  private updateLock = false;

  constructor(private readonly nodeDispatch: NodeDispatchService) {}

  async getGlobalConfig(): Promise<string> {
    const nodeId = await this.nodeDispatch.getDefaultNodeId();
    if (!nodeId) {
      return '# No default nginx node configured\n';
    }
    const result = await this.nodeDispatch.readGlobalConfig(nodeId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to read global config from daemon');
    }
    return result.detail;
  }

  async updateGlobalConfig(content: string): Promise<{ valid: boolean; error?: string }> {
    if (content.length > MAX_CONFIG_SIZE) {
      return { valid: false, error: 'Config exceeds 1MB limit' };
    }

    if (this.updateLock) {
      return { valid: false, error: 'Another config update is in progress' };
    }
    this.updateLock = true;

    try {
      logger.info('Updating global nginx.conf via daemon');

      const nodeId = await this.nodeDispatch.getDefaultNodeId();
      if (!nodeId) {
        return { valid: false, error: 'No default nginx node configured' };
      }

      const backup = ''; // Daemon handles rollback internally
      const result = await this.nodeDispatch.updateGlobalConfig(nodeId, content, backup);

      if (!result.success) {
        return { valid: false, error: result.error };
      }

      logger.info('Global nginx.conf updated via daemon');
      return { valid: true };
    } finally {
      this.updateLock = false;
    }
  }

  async testConfig(): Promise<{ valid: boolean; error?: string }> {
    const nodeId = await this.nodeDispatch.getDefaultNodeId();
    if (!nodeId) {
      return { valid: false, error: 'No default nginx node configured' };
    }
    const result = await this.nodeDispatch.testConfig(nodeId);
    return { valid: result.success, error: result.error || undefined };
  }
}

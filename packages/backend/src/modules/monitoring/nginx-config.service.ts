import { createChildLogger } from '@/lib/logger.js';
import type { DockerService } from '@/services/docker.service.js';

const logger = createChildLogger('NginxConfigService');

const MAX_CONFIG_SIZE = 1_048_576; // 1 MB

export class NginxConfigService {
  private updateLock = false;

  constructor(
    private readonly dockerService: DockerService,
    private readonly nginxContainerName: string
  ) {}

  async getGlobalConfig(): Promise<string> {
    const result = await this.dockerService.execInContainer(
      this.nginxContainerName,
      ['cat', '/etc/nginx/nginx.conf']
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read nginx.conf: ${result.output}`);
    }
    return result.output;
  }

  private writeConfig(content: string): Promise<{ exitCode: number; output: string }> {
    const b64 = Buffer.from(content).toString('base64');
    return this.dockerService.execInContainer(
      this.nginxContainerName,
      ['sh', '-c', `echo '${b64}' | base64 -d > /etc/nginx/nginx.conf`]
    );
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
      logger.info('Updating global nginx.conf');

      // 1. Backup current config
      const backup = await this.getGlobalConfig();

      // 2. Write new config (base64 encoded to prevent injection)
      const writeResult = await this.writeConfig(content);
      if (writeResult.exitCode !== 0) {
        throw new Error(`Failed to write nginx.conf: ${writeResult.output}`);
      }

      // 3. Test
      const testResult = await this.dockerService.testNginxConfig();

      if (!testResult.valid) {
        logger.warn('nginx.conf test failed, rolling back', { error: testResult.error });
        // 4. Rollback
        await this.writeConfig(backup);
        return { valid: false, error: testResult.error };
      }

      // 5. Reload
      await this.dockerService.reloadNginx();
      logger.info('Global nginx.conf updated and nginx reloaded');
      return { valid: true };
    } finally {
      this.updateLock = false;
    }
  }

  async testConfig(): Promise<{ valid: boolean; error?: string }> {
    return this.dockerService.testNginxConfig();
  }
}

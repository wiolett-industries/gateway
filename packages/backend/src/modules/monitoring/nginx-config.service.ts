import { createChildLogger } from '@/lib/logger.js';
import type { DockerService } from '@/services/docker.service.js';

const logger = createChildLogger('NginxConfigService');

const HEREDOC_DELIMITER = '___GATEWAY_CONFIG_EOF___';

export class NginxConfigService {
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

  async updateGlobalConfig(content: string): Promise<{ valid: boolean; error?: string }> {
    logger.info('Updating global nginx.conf');

    // 1. Backup current config
    const backup = await this.getGlobalConfig();

    // 2. Write new config
    const writeResult = await this.dockerService.execInContainer(
      this.nginxContainerName,
      ['sh', '-c', `cat > /etc/nginx/nginx.conf << '${HEREDOC_DELIMITER}'\n${content}\n${HEREDOC_DELIMITER}`]
    );
    if (writeResult.exitCode !== 0) {
      throw new Error(`Failed to write nginx.conf: ${writeResult.output}`);
    }

    // 3. Test
    const testResult = await this.dockerService.testNginxConfig();

    if (!testResult.valid) {
      logger.warn('nginx.conf test failed, rolling back', { error: testResult.error });
      // 4. Rollback
      await this.dockerService.execInContainer(
        this.nginxContainerName,
        ['sh', '-c', `cat > /etc/nginx/nginx.conf << '${HEREDOC_DELIMITER}'\n${backup}\n${HEREDOC_DELIMITER}`]
      );
      return { valid: false, error: testResult.error };
    }

    // 5. Reload
    await this.dockerService.reloadNginx();
    logger.info('Global nginx.conf updated and nginx reloaded');
    return { valid: true };
  }

  async testConfig(): Promise<{ valid: boolean; error?: string }> {
    return this.dockerService.testNginxConfig();
  }
}

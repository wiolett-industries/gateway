import { AppError } from '@/middleware/error-handler.js';

export type ContainerTransition =
  | 'creating'
  | 'stopping'
  | 'restarting'
  | 'killing'
  | 'recreating'
  | 'updating'
  | 'migrating';

export class DockerContainerTransitions {
  private readonly transitions = new Map<string, ContainerTransition>();

  requireIdle(nodeId: string, name: string) {
    const current = this.get(nodeId, name);
    if (current) {
      throw new AppError(409, 'CONTAINER_BUSY', `Container is currently ${current}`);
    }
  }

  set(nodeId: string, name: string, state: ContainerTransition): boolean {
    if (this.get(nodeId, name) === state) return false;
    this.transitions.set(this.key(nodeId, name), state);
    return true;
  }

  clear(nodeId: string, name: string) {
    this.transitions.delete(this.key(nodeId, name));
  }

  get(nodeId: string, name: string): ContainerTransition | undefined {
    return this.transitions.get(this.key(nodeId, name));
  }

  private key(nodeId: string, name: string) {
    return `${nodeId}:${name}`;
  }
}

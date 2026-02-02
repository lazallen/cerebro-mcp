/**
 * Resource Lock for Concurrency Control
 *
 * Implements in-memory locking to prevent concurrent operations on the same resource
 * Per specification: Only first request processed, others return "already processing"
 */

import { logger } from '../../common';

/**
 * Error thrown when a resource is already locked
 */
export class ResourceLockedError extends Error {
  constructor(resourceId: string) {
    super(`Resource ${resourceId} is already being processed`);
    this.name = 'ResourceLockedError';
  }
}

/**
 * Resource Lock Class
 *
 * Manages in-memory locks for concurrent operation prevention
 * Uses Map to track active operations per resource ID
 */
export class ResourceLock {
  private locks = new Map<string, Promise<void>>();

  /**
   * Acquires a lock and executes the operation
   * If lock already exists, throws ResourceLockedError
   *
   * @param resourceId - Unique identifier for the resource (e.g., event ID)
   * @param operation - Async operation to execute
   * @returns Operation result
   * @throws ResourceLockedError if resource is already locked
   */
  async acquireLock<T>(resourceId: string, operation: () => Promise<T>): Promise<T> {
    // Check if resource is already locked
    if (this.locks.has(resourceId)) {
      logger.warn({
        operation: 'resource_lock_conflict',
        resourceId,
        msg: `Attempted to acquire lock for already-locked resource: ${resourceId}`,
      });
      throw new ResourceLockedError(resourceId);
    }

    logger.debug({
      operation: 'resource_lock_acquired',
      resourceId,
      msg: `Lock acquired for resource: ${resourceId}`,
    });

    // Create placeholder void promise for lock tracking
    // We only need to track that something is in progress, not the actual result
    let resolveTracking!: () => void;

    const trackingPromise: Promise<void> = new Promise((resolve) => {
      resolveTracking = resolve;
    });

    // Store lock immediately before executing operation
    this.locks.set(resourceId, trackingPromise);

    try {
      // Execute and await operation
      const result = await operation();

      // Release lock after successful completion
      this.locks.delete(resourceId);
      resolveTracking();

      logger.debug({
        operation: 'resource_lock_released',
        resourceId,
        msg: `Lock released for resource: ${resourceId}`,
      });

      return result;
    } catch (error) {
      // Release lock after error
      this.locks.delete(resourceId);
      // Resolve tracking promise even on error to avoid unhandled rejection
      // The actual error is propagated via throw, not via promise rejection
      resolveTracking();

      logger.debug({
        operation: 'resource_lock_released',
        resourceId,
        msg: `Lock released for resource: ${resourceId} (error)`,
      });

      throw error;
    }
  }

  /**
   * Checks if a resource is currently locked
   *
   * @param resourceId - Resource identifier to check
   * @returns true if locked, false otherwise
   */
  isLocked(resourceId: string): boolean {
    return this.locks.has(resourceId);
  }

  /**
   * Gets the number of currently active locks
   *
   * @returns Number of active locks
   */
  getActiveLockCount(): number {
    return this.locks.size;
  }

  /**
   * Clears all locks (use with caution)
   * Mainly for testing purposes
   */
  clearAllLocks(): void {
    this.locks.clear();
    logger.debug({
      operation: 'resource_locks_cleared',
      msg: 'All resource locks cleared',
    });
  }
}

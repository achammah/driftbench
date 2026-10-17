import { initializeShippedObjects as initializeCoreObjects } from '@agent-nexus/driftbench-core';
import { registerValueCheck } from './value-check/ladder';

/** Registers shipped definitions before loading or resolving specs, including after registry restore. */
export function initializeShippedObjects(): void {
  initializeCoreObjects();
  registerValueCheck();
}

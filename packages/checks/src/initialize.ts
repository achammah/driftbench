import { initializeShippedObjects as initializeCoreObjects } from '@agent-nexus/driftbench-core';
import { registerBlameObjects } from './blame/objects';
import { registerCheckSet } from './check-set';
import { registerValueCheck } from './value-check/ladder';

/** Registers shipped definitions before loading or resolving specs, including after registry restore. */
export function initializeShippedObjects(): void {
  initializeCoreObjects();
  registerCheckSet();
  registerValueCheck();
  registerBlameObjects();
}

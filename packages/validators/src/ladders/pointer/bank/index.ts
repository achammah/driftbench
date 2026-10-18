import { identityItems } from './identity';
import { labelItems } from './labels';
import { materializationItems } from './materialize';
import { privacyItems } from './privacy';
import { relationItems } from './relations';
import { replayItems } from './replay';
import { structureItems } from './structure';
import type { BankItem } from './types';

export function pointerBank(): BankItem[] {
  return [
    ...structureItems(),
    ...identityItems(),
    ...labelItems(),
    ...materializationItems(),
    ...replayItems(),
    ...privacyItems(),
    ...relationItems(),
  ];
}

export type { IOSetup, IOTrace, PointerIO, SampleEffect } from './io';
export { runItem } from './run';
export type { BankItem, Json, Plant, PointerAdapter, Probe, Request, Tier } from './types';

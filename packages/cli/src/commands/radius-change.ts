import { loadChangeManifest } from '@agent-nexus/driftbench-core';
import { validateEstateMap } from '@agent-nexus/driftbench-estate';
import { estatePromptManifest } from './radius-estate-prompt';

/** All CLI consumers revalidate auto evidence before allowing an empty version transition. */
export function loadRadiusChangeManifest(path: string) {
  return loadChangeManifest(path, {
    validatePromptMap: ({ map, source, before, after }) => {
      const checked = validateEstateMap(map);
      if (!checked.ok || !checked.map.atoms.some((atom) => atom.provenance.file === source)) return false;
      return (
        estatePromptManifest(checked.map, source, before, after, { from: 'same', to: 'same' }).changes
          .length === 0
      );
    },
  });
}

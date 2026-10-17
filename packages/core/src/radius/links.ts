import { type BlockLink, BlockLinks } from '../schema/links';
import type { Spec } from '../schema/spec';
import { error, type Issue, warning } from '../spec/issues';
import type { SectionRegistry } from './sections';

/** The links of a spec, from `metadata.links`. Empty when it has none. */
export function specLinks(spec: Spec): BlockLink[] {
  const parsed = BlockLinks.safeParse(spec.metadata?.links ?? []);
  return parsed.success ? parsed.data : [];
}

/** Whether a link is for block `index` of the spec: by id, by index, or for every block. */
export function linkHolds(spec: Spec, link: BlockLink, index: number): boolean {
  if (link.block === undefined) return true;
  return typeof link.block === 'number' ? link.block === index : spec.blocks[index]?.id === link.block;
}

/** The links of block `index` of the spec. */
export function blockLinks(spec: Spec, index: number): BlockLink[] {
  return specLinks(spec).filter((link) => linkHolds(spec, link, index));
}

/** The registries by prompt id. Two registries for one prompt are an error. */
export function registriesByPrompt(
  registries: readonly SectionRegistry[],
): { ok: true; byPrompt: Map<string, SectionRegistry> } | { ok: false; errors: string[] } {
  const byPrompt = new Map<string, SectionRegistry>();
  const errors: string[] = [];
  for (const registry of registries) {
    if (byPrompt.has(registry.prompt_id))
      errors.push(`two section registries describe the prompt ${registry.prompt_id}`);
    byPrompt.set(registry.prompt_id, registry);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, byPrompt };
}

/**
 * The effective status of a prompt-section link against the registries: `stale` when the target is
 * unknown or stale in its registry, else the status the link declares. `unknown-prompt` when no
 * registry describes the prompt.
 */
export function sectionLinkStatus(
  link: BlockLink,
  byPrompt: ReadonlyMap<string, SectionRegistry>,
): BlockLink['status'] | 'unknown-prompt' {
  if (link.to.kind !== 'prompt_section') return link.status;
  const registry = byPrompt.get(link.to.prompt);
  if (!registry) return 'unknown-prompt';
  const { section: id } = link.to;
  const section = registry.sections.find((each) => each.id === id);
  if (!section || section.stale === true) return 'stale';
  return link.status;
}

/**
 * Checks a spec's prompt-section links against the registries: a section no registry of its prompt
 * holds is an error; a link to a prompt with no registry, a stale link and a link to a stale section
 * are warnings.
 */
export function checkSpecLinks(spec: Spec, byPrompt: ReadonlyMap<string, SectionRegistry>): Issue[] {
  const issues: Issue[] = [];
  specLinks(spec).forEach((link, index) => {
    if (link.to.kind !== 'prompt_section') return;
    const path = `metadata.links.${index}.to`;
    const { prompt, section: id } = link.to;
    const registry = byPrompt.get(prompt);
    if (!registry) {
      issues.push(
        warning('LINK_TARGET_UNKNOWN', path, `no section registry was given for the prompt ${prompt}`),
      );
      return;
    }
    const section = registry.sections.find((each) => each.id === id);
    if (!section) {
      issues.push(
        error(
          'LINK_TARGET_UNKNOWN',
          path,
          `the prompt ${prompt} (version ${registry.version}) has no section ${id}`,
        ),
      );
      return;
    }
    if (section.stale === true) {
      issues.push(
        warning(
          'LINK_STALE',
          path,
          `the section ${prompt}#${id} could not be found again in version ${registry.version}: declare its span again`,
        ),
      );
    } else if (link.status === 'stale') {
      issues.push(
        warning('LINK_STALE', `metadata.links.${index}.status`, `the link to ${prompt}#${id} is stale`),
      );
    }
  });
  return issues;
}

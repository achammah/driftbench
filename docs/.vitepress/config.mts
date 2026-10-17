import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

/**
 * The driftbench docs site: the pages of docs/ as they are, built with VitePress for GitHub Pages.
 *
 * A link that leaves docs/ points at a file of the repository: it opens on GitHub, except the example
 * scorecards, which are copied into the site and open as pages of it.
 */

const REPO = 'https://github.com/achammah/driftbench';
const BASE = '/driftbench/';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPORTS = 'examples/acme/reports';

/** Where a relative link of a docs page points, as a path from the repository root. */
function repoPath(page: string, href: string): string {
  return posix.normalize(posix.join('docs', posix.dirname(page), href));
}

/** GitHub's heading anchor, as tools/docs/check-links.ts computes it. */
function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export default defineConfig({
  title: 'driftbench',
  description:
    'Block-level evaluation for AI agents: every exchange is a unit test, every number carries an interval.',
  base: BASE,
  lang: 'en',
  srcExclude: ['**/lanes/**'],
  lastUpdated: false,
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Geist:wght@300..600&family=Geist+Mono:wght@400;500&family=Libre+Caslon+Display&family=Libre+Caslon+Text:ital@0;1&display=swap',
      },
    ],
  ],
  markdown: {
    // Heading anchors as GitHub makes them, so a link that works on GitHub works on the site.
    anchor: { slugify: githubSlug },
    config(md) {
      // The pages hold no HTML of their own: text such as `<adapter[:agent]>` outside code is text, and
      // only the generated reference's leading comment is kept as a comment.
      md.renderer.rules.html_inline = (tokens, index) => md.utils.escapeHtml(tokens[index]?.content ?? '');
      md.renderer.rules.html_block = (tokens, index) => {
        const content = tokens[index]?.content ?? '';
        return /^<!--[\s\S]*-->\s*$/.test(content) ? '' : `<p>${md.utils.escapeHtml(content)}</p>`;
      };
      const render = md.renderer.rules.link_open;
      md.renderer.rules.link_open = (tokens, index, options, env, self) => {
        const token = tokens[index];
        const href = token?.attrGet('href');
        const page = (env as { relativePath?: string }).relativePath;
        if (token && href && page && !/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(href)) {
          const [path = '', hash] = href.split('#');
          const target = repoPath(page, path);
          if (!target.startsWith('docs/')) {
            const anchor = hash === undefined ? '' : `#${hash}`;
            if (target.startsWith(`${REPORTS}/`) && target.endsWith('.html')) {
              // A scorecard is a page of the site but not of VitePress: a full load, past the router.
              token.attrSet('href', `${BASE}${target}${anchor}`);
              token.attrSet('target', '_self');
              return self.renderToken(tokens, index, options);
            } else {
              const kind = /\.[a-z0-9]+$/i.test(target) ? 'blob' : 'tree';
              token.attrSet('href', `${REPO}/${kind}/main/${target}${anchor}`);
            }
          }
        }
        return render ? render(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
      };
    },
  },
  vite: {
    server: { fs: { allow: [ROOT] } },
  },
  async buildEnd(site) {
    const from = join(ROOT, REPORTS);
    const to = join(site.outDir, REPORTS);
    await mkdir(to, { recursive: true });
    for (const name of await readdir(from)) {
      if (name.endsWith('.html')) await copyFile(join(from, name), join(to, name));
    }
  },
  themeConfig: {
    siteTitle: 'driftbench',
    nav: [
      { text: 'Concepts', link: '/concepts/block' },
      { text: 'Running', link: '/running' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'Adapters', link: '/adapters/' },
      {
        text: 'Scorecards',
        items: [
          { text: 'Example scorecards', link: '/scorecards' },
          { text: 'Acme campaign', link: `/${REPORTS}/acme.html`, target: '_self' },
          { text: 'Acme campaign with faults', link: `/${REPORTS}/acme-faults.html`, target: '_self' },
          { text: 'Variance pilot', link: `/${REPORTS}/pilot-acme-random.html`, target: '_self' },
        ],
      },
    ],
    sidebar: [
      { text: 'Overview', items: [{ text: 'driftbench docs', link: '/' }] },
      {
        text: 'Concepts',
        items: [
          { text: 'Block', link: '/concepts/block' },
          { text: 'Given, When, Then', link: '/concepts/given-when-then' },
          { text: 'Run modes', link: '/concepts/run-modes' },
          { text: 'Blast radius', link: '/concepts/blast-radius' },
          { text: 'Drift', link: '/concepts/drift' },
          { text: 'Recovery', link: '/concepts/recovery' },
          { text: 'Judges', link: '/concepts/judges' },
          { text: 'Default judge', link: '/default-judge' },
          { text: 'Statistics', link: '/concepts/statistics' },
        ],
      },
      {
        text: 'Running',
        items: [
          { text: 'Running', link: '/running' },
          { text: 'CLI plugins', link: '/plugins' },
          { text: 'Generating tests', link: '/generating' },
          { text: 'Testing an estate', link: '/estate' },
          { text: 'The variable store', link: '/variables' },
          { text: 'Datasets and prompts', link: '/datasets' },
          { text: 'Validators', link: '/validators' },
          { text: 'Benchmark floors', link: '/benchmarks' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Spec reference', link: '/reference/spec' },
          { text: 'Task family reference', link: '/reference/family' },
          { text: 'Map reference', link: '/reference/map' },
          { text: 'Interview reference', link: '/reference/interview' },
          { text: 'Criteria and labels', link: '/reference/criteria' },
          { text: 'Personas and red-team', link: '/reference/users' },
          { text: 'Change manifest', link: '/reference/change' },
          { text: 'Estate files', link: '/reference/estate-files' },
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Checks', link: '/reference/checks' },
          { text: 'Public API', link: '/reference/api' },
        ],
      },
      {
        text: 'Adapters',
        items: [
          { text: 'Adapters', link: '/adapters/' },
          { text: 'function', link: '/adapters/function' },
          { text: 'http', link: '/adapters/http' },
          { text: 'nexus', link: '/adapters/nexus' },
          { text: 'process', link: '/adapters/process' },
          { text: 'openai-agents', link: '/adapters/openai-agents' },
          { text: 'anthropic', link: '/adapters/anthropic' },
          { text: 'google', link: '/adapters/google' },
          { text: 'langgraph', link: '/adapters/langgraph' },
          { text: 'Claude Code estates', link: '/adapters/claude-code' },
        ],
      },
      {
        text: 'Example scorecards',
        items: [{ text: 'Example scorecards', link: '/scorecards' }],
      },
      { text: 'Comparison', items: [{ text: 'Comparison', link: '/comparison' }] },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: {
      message: 'MIT. driftbench is made by Nexus.',
    },
  },
});

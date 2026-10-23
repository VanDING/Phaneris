import { Type } from '@sinclair/typebox';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';

type Catalog = Pick<ExtensionAPI, 'getAllTools' | 'getActiveTools' | 'setActiveTools'>;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const schema = Type.Object({
  query: Type.String({ description: 'Purpose, exact tool name, namespace, or empty for a directory. Chinese and mixed queries are supported.' }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

/** Word segmentation preserves CJK terms; exact phrases and names receive priority. */
function terms(text: string): string[] {
  return [...new Set([...segmenter.segment(text.normalize('NFKC').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/_/g, ' '))]
    .filter(part => part.isWordLike).map(part => part.segment))];
}

/** Uses the SDK active-set API so loading remains recorded in its canonical transcript. */
export function createPhanerisToolSearch(tools: Catalog, availability: (name: string) => { status: string; reason?: string } | undefined = () => undefined): ToolDefinition<typeof schema> {
  return {
    name: 'tool_search', label: 'Find tools', parameters: schema,
    description: 'Find connected tools by purpose, exact name or namespace, including Chinese queries. An empty query lists a directory. Reports already available matches separately from newly loaded tools. Missing connections must be enabled/authenticated before their tools can appear. Loading does not grant permission.',
    exposure: 'model-only', defaultActive: false, reachesTools: () => 'all',
    async execute(_id, { query, limit = 8, offset = 0 }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be an integer between 1 and 50');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a nonnegative integer');
      const active = tools.getActiveTools();
      const candidates = tools.getAllTools().filter(tool => tool.exposure === 'deferred' || tool.exposure === 'codemode' || availability(tool.name)?.status === 'unsupported');
      const normalized = query.normalize('NFKC').toLowerCase().trim();
      const queryTerms = terms(query);
      const ranked = candidates.map((tool, index) => {
        const text = `${tool.name} ${tool.description} ${JSON.stringify(tool.parameters)} ${tool.namespace?.name ?? ''} ${tool.namespace?.description ?? ''} ${tool.namespace?.aliases?.join(' ') ?? ''}`.normalize('NFKC').toLowerCase();
        const documentTerms = new Set(terms(text));
        const score = !normalized ? 1 : (tool.name.toLowerCase() === normalized || tool.name.toLowerCase().endsWith(`__${normalized}`) ? 100 : 0)
          + (tool.namespace?.name.toLowerCase().split(':').at(-1) === normalized || tool.namespace?.aliases?.some(alias => alias.toLowerCase() === normalized) ? 50 : 0)
          + (text.includes(normalized) ? 10 : 0) + queryTerms.filter(term => documentTerms.has(term)).length;
        return { tool, score, index };
      }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
      const matches = ranked.slice(offset, offset + limit).map(({ tool }) => ({ name: tool.name,
        description: tool.description.split(/\r?\n/)[0], namespace: tool.namespace?.name,
        availability: availability(tool.name) ?? { status: 'ready' },
        status: availability(tool.name)?.status === 'unsupported' ? 'unsupported' : active.includes(tool.name) ? 'already_available' : 'loaded_now' }));
      // A directory is observational; it does not activate every listed tool.
      const loaded = normalized ? matches.filter(match => match.status === 'loaded_now').map(match => match.name) : [];
      if (loaded.length) tools.setActiveTools([...active, ...loaded]);
      const directory = !normalized;
      return {
        content: [{ type: 'text', text: matches.length ? JSON.stringify({ directory, totalMatches: ranked.length, offset, hasMore: offset + matches.length < ranked.length,
          nextOffset: offset + matches.length < ranked.length ? offset + matches.length : null,
          matches: matches.map(match => ({ ...match, status: directory && match.status === 'loaded_now' ? 'available_to_load' : match.status })) })
          : 'No matching connected tools. Try another purpose or namespace; verify the required source is connected and enabled.' }],
        details: { loaded, matches, totalMatches: ranked.length, directory, offset, hasMore: offset + matches.length < ranked.length },
      };
    },
  };
}

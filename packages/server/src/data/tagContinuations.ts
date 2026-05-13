export interface ContinuationKeyword {
  name: string;
  detail: string;
  description: string;
  sortText?: string;
}

const FOR_KEYWORDS: ContinuationKeyword[] = [
  { name: 'in', detail: 'for-loop keyword', description: 'Required after the loop variable: `{% for x in collection %}`.', sortText: '0' },
  { name: 'reversed', detail: 'for-loop modifier', description: 'Iterate the collection in reverse order.' },
  { name: 'offset:', detail: 'for-loop modifier', description: 'Skip the first N items: `offset: 3`.' },
  { name: 'limit:', detail: 'for-loop modifier', description: 'Iterate at most N items: `limit: 5`.' },
];

const RENDER_KEYWORDS: ContinuationKeyword[] = [
  { name: 'with', detail: 'render keyword', description: 'Pass a single value as the local: `{% render "card" with item %}`.' },
  { name: 'for', detail: 'render keyword', description: 'Iterate a collection rendering once per item: `{% render "card" for items as item %}`.' },
  { name: 'as', detail: 'render keyword', description: 'Name the local alias when using `with` or `for`.' },
];

const PAGINATE_KEYWORDS: ContinuationKeyword[] = [
  { name: 'by', detail: 'paginate keyword', description: 'Page size: `{% paginate items by 10 %}`.' },
];

export const TAG_CONTINUATIONS: Readonly<Record<string, readonly ContinuationKeyword[]>> = Object.freeze({
  for: FOR_KEYWORDS,
  tablerow: FOR_KEYWORDS,
  render: RENDER_KEYWORDS,
  include: RENDER_KEYWORDS,
  paginate: PAGINATE_KEYWORDS,
});

const CONDITION_TAGS = new Set(['if', 'unless', 'elsif', 'when', 'case']);
const EXPRESSION_TAGS = new Set(['assign', 'echo']);

export function tagWantsOperators(tagName: string): boolean {
  return CONDITION_TAGS.has(tagName);
}

export function tagWantsVariables(tagName: string): boolean {
  return CONDITION_TAGS.has(tagName) || EXPRESSION_TAGS.has(tagName);
}

export interface TagInfo {
  name: string;
  description: string;
  syntax: string;
  docsUrl: string;
  isClosing: boolean;
  opens?: string;
}

function tag(
  name: string,
  description: string,
  syntax: string,
  opts: { isClosing?: boolean; opens?: string } = {},
): [string, TagInfo] {
  return [
    name,
    {
      name,
      description,
      syntax,
      docsUrl: `https://liquidjs.com/tags/${name.replace(/^end/, '')}.html`,
      isClosing: opts.isClosing ?? false,
      opens: opts.opens,
    },
  ];
}

export const TAGS: Readonly<Record<string, TagInfo>> = Object.freeze(
  Object.fromEntries([
    tag('if', 'Render a block if the condition is truthy.', '{% if condition %}...{% endif %}'),
    tag('elsif', 'Add a branch to an if/case.', '{% elsif condition %}'),
    tag('else', 'Fallback branch in if/case/unless.', '{% else %}'),
    tag('endif', 'Close an if block.', '{% endif %}', { isClosing: true, opens: 'if' }),
    tag('unless', 'Render a block if the condition is falsy.', '{% unless condition %}...{% endunless %}'),
    tag('endunless', 'Close an unless block.', '{% endunless %}', { isClosing: true, opens: 'unless' }),
    tag('case', 'Switch on a value.', '{% case value %}{% when ... %}{% endcase %}'),
    tag('when', 'Branch in a case block.', '{% when literal %}'),
    tag('endcase', 'Close a case block.', '{% endcase %}', { isClosing: true, opens: 'case' }),
    tag('for', 'Iterate over an array, range, or generator.', '{% for item in collection %}...{% endfor %}'),
    tag('endfor', 'Close a for loop.', '{% endfor %}', { isClosing: true, opens: 'for' }),
    tag('break', 'Exit the enclosing for loop.', '{% break %}'),
    tag('continue', 'Skip to the next iteration of the enclosing for loop.', '{% continue %}'),
    tag('tablerow', 'Render rows of an HTML table.', '{% tablerow item in collection %}...{% endtablerow %}'),
    tag('endtablerow', 'Close a tablerow block.', '{% endtablerow %}', { isClosing: true, opens: 'tablerow' }),
    tag('cycle', 'Cycle through a list of strings each time it is rendered.', '{% cycle "a", "b", "c" %}'),
    tag('assign', 'Bind a value to a variable.', '{% assign name = expression %}'),
    tag('capture', 'Capture the rendered block as a string variable.', '{% capture name %}...{% endcapture %}'),
    tag('endcapture', 'Close a capture block.', '{% endcapture %}', { isClosing: true, opens: 'capture' }),
    tag('increment', 'Create or increment a counter starting at 0.', '{% increment counter %}'),
    tag('decrement', 'Create or decrement a counter starting at -1.', '{% decrement counter %}'),
    tag('render', 'Render another template in an isolated scope.', '{% render "template", key: value %}'),
    tag('include', 'Render another template in the current scope (legacy).', '{% include "template" %}'),
    tag('layout', 'Wrap this template in a layout.', '{% layout "layout-name" %}'),
    tag('raw', 'Output the block contents without parsing Liquid.', '{% raw %}...{% endraw %}'),
    tag('endraw', 'Close a raw block.', '{% endraw %}', { isClosing: true, opens: 'raw' }),
    tag('comment', 'Comment block. Contents are not rendered.', '{% comment %}...{% endcomment %}'),
    tag('endcomment', 'Close a comment block.', '{% endcomment %}', { isClosing: true, opens: 'comment' }),
    tag('liquid', 'Run multiple Liquid statements without delimiters.', '{% liquid\n  assign x = 1\n%}'),
    tag('echo', 'Output an expression (equivalent to {{ ... }}).', '{% echo expression %}'),
  ]),
);

export function isKnownTag(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TAGS, name);
}

export function getTagInfo(name: string): TagInfo | undefined {
  return TAGS[name];
}

export function isClosingTag(name: string): boolean {
  return TAGS[name]?.isClosing ?? false;
}

export function getOpeningForClosing(name: string): string | undefined {
  return TAGS[name]?.opens;
}

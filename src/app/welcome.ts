/** The tutorial document shown on first launch. */
const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const m = (latex: string) => ({ type: 'math_inline', attrs: { latex } });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const b = (s: string) => t(s, [{ type: 'strong' }]);
const k = (s: string) => t(s, [{ type: 'code' }]);
const li = (...content: unknown[]) => ({ type: 'list_item', content: [p(...content)] });

export const WELCOME_DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Welcome to crunchpad')] },
    p(
      t('A document editor where equations live right in your text, like '),
      m('e^{i\\pi}+1=0'),
      t(' or '),
      m('\\int_0^1 x^2\\,dx=\\tfrac13'),
      t('. Click any equation to edit it.'),
    ),
    { type: 'heading', attrs: { level: 2 }, content: [t('Three ways to start an equation')] },
    {
      type: 'bullet_list',
      content: [
        li(b('Type it: '), t('wrap LaTeX in dollar signs, '), k('$x^2+1$'), t(', type '), k('$$'), t(' for an empty equation, or type a command like '), k('\\frac'), t(' then a space.')),
        li(b('Shortcut: '), k('Ctrl+M'), t(' inserts an inline equation, '), k('Ctrl+Shift+M'), t(' a centered display equation.')),
        li(b('Quick search: '), t('press '), k('Ctrl+Space'), t(' and type what you want: “theta”, “integral”, “matrix”, “export word”, “heading 2”…')),
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [t('Typing inside an equation')] },
    p(
      t('You don’t need to know LaTeX. Type '),
      k('1/2'),
      t(' for a fraction, '),
      k('x^2'),
      t(' for a power, '),
      k('sqrt'),
      t(', '),
      k('int'),
      t(', '),
      k('sum'),
      t(' or '),
      k('alpha'),
      t(' for templates and symbols, and '),
      k('->'),
      t(', '),
      k('<='),
      t(', '),
      k('!='),
      t(' for arrows and relations. Press '),
      k('Tab'),
      t(' to jump between empty slots, and the arrow keys (or '),
      k('Enter'),
      t(') to leave the equation.'),
    ),
    { type: 'math_display', attrs: { latex: '\\hat f(\\xi)=\\int_{-\\infty}^{\\infty} f(x)\\,e^{-2\\pi i x\\xi}\\,dx', numbered: true } },
    {
      type: 'math_env',
      attrs: { kind: 'theorem', title: 'Pythagoras' },
      content: [p(t('For a right triangle with legs '), m('a, b'), t(' and hypotenuse '), m('c'), t(', we have '), m('a^2+b^2=c^2'), t('.'))],
    },
    {
      type: 'math_env',
      attrs: { kind: 'proof', title: '' },
      content: [p(t('Arrange four copies of the triangle inside a square of side '), m('a+b'), t(' and compare areas.'))],
    },
    { type: 'heading', attrs: { level: 2 }, content: [t('Macros')] },
    p(
      t('Click '),
      b('Macros'),
      t(' in the File panel (or search “macros”) to define your own shortcuts. For example the built-in macro '),
      k('pd'),
      t(' expands to '),
      m('\\frac{\\partial}{\\partial x}'),
      t(' when typed inside an equation. You can also save any selection of text and equations as a reusable snippet.'),
    ),
    { type: 'heading', attrs: { level: 2 }, content: [t('Saving and exporting')] },
    p(
      t('Documents save as '),
      k('.mathdoc'),
      t(' files. Export to '),
      b('Word'),
      t(' (with real, editable Word equations), '),
      b('PDF'),
      t(', '),
      b('LaTeX'),
      t(' or '),
      b('HTML'),
      t(' from the Export panel. Press '),
      k('F1'),
      t(' for every shortcut.'),
    ),
    p(),
  ],
};

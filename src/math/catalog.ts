/**
 * Searchable catalog of math symbols and templates.
 *
 * `latex` uses MathLive placeholder syntax: `#?` is an empty slot the user can
 * Tab between, `#0` is replaced by whatever was selected when inserting.
 */
export interface MathEntry {
  title: string;
  latex: string;
  category: MathCategory;
  keywords?: string;
}

export type MathCategory =
  | 'Structures'
  | 'Calculus'
  | 'Functions'
  | 'Greek'
  | 'Operators'
  | 'Relations'
  | 'Arrows'
  | 'Sets & Logic'
  | 'Accents'
  | 'Fonts'
  | 'Brackets'
  | 'Matrices'
  | 'Misc';

export const CATEGORIES: MathCategory[] = [
  'Structures',
  'Calculus',
  'Functions',
  'Greek',
  'Operators',
  'Relations',
  'Arrows',
  'Sets & Logic',
  'Brackets',
  'Matrices',
  'Accents',
  'Fonts',
  'Misc',
];

const e = (category: MathCategory, title: string, latex: string, keywords = ''): MathEntry => ({
  title,
  latex,
  category,
  keywords,
});

const greekLower = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma',
  'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
];
const greekUpper = ['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega'];

export const MATH_CATALOG: MathEntry[] = [
  // Structures
  e('Structures', 'Fraction', '\\frac{#0}{#?}', 'divide over ratio a/b'),
  e('Structures', 'Inline fraction', '\\tfrac{#0}{#?}', 'small fraction text'),
  e('Structures', 'Square root', '\\sqrt{#0}', 'radical sqrt'),
  e('Structures', 'Nth root', '\\sqrt[#?]{#0}', 'cube root radical'),
  e('Structures', 'Power / superscript', '#0^{#?}', 'exponent squared power'),
  e('Structures', 'Subscript', '#0_{#?}', 'index'),
  e('Structures', 'Sub & superscript', '#0_{#?}^{#?}', 'index exponent'),
  e('Structures', 'Squared', '#0^2', 'power 2'),
  e('Structures', 'Inverse', '#0^{-1}', 'power -1 reciprocal'),
  e('Structures', 'Binomial', '\\binom{#?}{#?}', 'choose combination nCr'),
  e('Structures', 'Text in math', '\\text{#0}', 'words label'),
  e('Structures', 'Overbrace', '\\overbrace{#0}^{#?}', 'brace above'),
  e('Structures', 'Underbrace', '\\underbrace{#0}_{#?}', 'brace below'),
  e('Structures', 'Cases (piecewise)', '\\begin{cases}#? & #?\\\\ #? & #?\\end{cases}', 'piecewise function'),
  e('Structures', 'Aligned equations', '\\begin{aligned}#? &= #?\\\\ &= #?\\end{aligned}', 'align system steps'),
  e('Structures', 'Boxed', '\\boxed{#0}', 'box answer'),
  e('Structures', 'Stack over', '\\overset{#?}{#0}', 'overset above'),
  e('Structures', 'Stack under', '\\underset{#?}{#0}', 'underset below'),

  // Calculus
  e('Calculus', 'Integral', '\\int #0\\,d#?', 'antiderivative'),
  e('Calculus', 'Definite integral', '\\int_{#?}^{#?} #0\\,d#?', 'integral bounds limits'),
  e('Calculus', 'Double integral', '\\iint_{#?} #0\\,dA', 'area integral'),
  e('Calculus', 'Triple integral', '\\iiint_{#?} #0\\,dV', 'volume integral'),
  e('Calculus', 'Contour integral', '\\oint_{#?} #0', 'closed line integral'),
  e('Calculus', 'Sum', '\\sum_{#?}^{#?} #0', 'sigma summation series'),
  e('Calculus', 'Sum n=1 to ∞', '\\sum_{n=1}^{\\infty} #0', 'series infinite'),
  e('Calculus', 'Product', '\\prod_{#?}^{#?} #0', 'pi product'),
  e('Calculus', 'Limit', '\\lim_{#?\\to #?} #0', 'lim approaches'),
  e('Calculus', 'Limit to infinity', '\\lim_{n\\to\\infty} #0', 'lim infinity'),
  e('Calculus', 'Derivative d/dx', '\\frac{d}{dx}#0', 'differentiate'),
  e('Calculus', 'Derivative dy/dx', '\\frac{d#?}{d#?}', 'differentiate leibniz'),
  e('Calculus', 'Second derivative', '\\frac{d^2#?}{d#?^2}', 'differentiate'),
  e('Calculus', 'Partial derivative', '\\frac{\\partial #?}{\\partial #?}', 'partial'),
  e('Calculus', 'Prime', "#0'", 'derivative f prime'),
  e('Calculus', 'Evaluated at', '\\left.#0\\right|_{#?}^{#?}', 'evaluate bar'),
  e('Calculus', 'Partial', '\\partial', 'del'),
  e('Calculus', 'Nabla / gradient', '\\nabla', 'gradient del grad'),
  e('Calculus', 'Infinity', '\\infty', 'infinite oo'),

  // Functions
  ...['sin', 'cos', 'tan', 'csc', 'sec', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh'].map((f) =>
    e('Functions', f, `\\${f}\\left(#0\\right)`, 'trig trigonometry function'),
  ),
  e('Functions', 'log', '\\log\\left(#0\\right)', 'logarithm'),
  e('Functions', 'log base', '\\log_{#?}\\left(#0\\right)', 'logarithm base'),
  e('Functions', 'ln', '\\ln\\left(#0\\right)', 'natural log logarithm'),
  e('Functions', 'exp', '\\exp\\left(#0\\right)', 'exponential'),
  e('Functions', 'e^x', 'e^{#0}', 'exponential'),
  e('Functions', 'max', '\\max_{#?}', 'maximum'),
  e('Functions', 'min', '\\min_{#?}', 'minimum'),
  e('Functions', 'sup', '\\sup_{#?}', 'supremum'),
  e('Functions', 'inf', '\\inf_{#?}', 'infimum'),
  e('Functions', 'det', '\\det\\left(#0\\right)', 'determinant'),
  e('Functions', 'gcd', '\\gcd\\left(#0\\right)', 'greatest common divisor'),
  e('Functions', 'mod', '\\bmod', 'modulo'),
  e('Functions', 'f(x)', 'f\\left(x\\right)', 'function'),

  // Greek
  ...greekLower.map((g) => e('Greek', g, `\\${g}`, 'greek letter lowercase')),
  ...greekUpper.map((g) => e('Greek', g, `\\${g}`, 'greek letter uppercase capital')),

  // Operators
  e('Operators', 'Plus-minus', '\\pm', '+- plus minus'),
  e('Operators', 'Minus-plus', '\\mp', '-+'),
  e('Operators', 'Times', '\\times', 'multiply cross product x'),
  e('Operators', 'Dot', '\\cdot', 'multiply dot product'),
  e('Operators', 'Divide', '\\div', 'division obelus'),
  e('Operators', 'Asterisk', '\\ast', 'star convolution'),
  e('Operators', 'Circle plus', '\\oplus', 'direct sum xor'),
  e('Operators', 'Circle times', '\\otimes', 'tensor product'),
  e('Operators', 'Composition', '\\circ', 'compose ring'),
  e('Operators', 'Bullet', '\\bullet', 'dot'),
  e('Operators', 'Absolute value', '\\left|#0\\right|', 'abs modulus'),
  e('Operators', 'Norm', '\\left\\|#0\\right\\|', 'length magnitude'),
  e('Operators', 'Floor', '\\left\\lfloor #0\\right\\rfloor', 'round down'),
  e('Operators', 'Ceiling', '\\left\\lceil #0\\right\\rceil', 'round up ceil'),
  e('Operators', 'Factorial', '#0!', 'n!'),

  // Relations
  e('Relations', 'Not equal', '\\neq', '!= ne'),
  e('Relations', 'Less or equal', '\\leq', '<= le'),
  e('Relations', 'Greater or equal', '\\geq', '>= ge'),
  e('Relations', 'Much less', '\\ll', '<<'),
  e('Relations', 'Much greater', '\\gg', '>>'),
  e('Relations', 'Approximately', '\\approx', '~~ approx about'),
  e('Relations', 'Similar', '\\sim', '~ tilde'),
  e('Relations', 'Congruent', '\\cong', 'isomorphic'),
  e('Relations', 'Equivalent', '\\equiv', 'identical congruence mod'),
  e('Relations', 'Proportional', '\\propto', 'varies'),
  e('Relations', 'Defined as', '\\coloneqq', ':= define'),
  e('Relations', 'Perpendicular', '\\perp', 'orthogonal'),
  e('Relations', 'Parallel', '\\parallel', '||'),
  e('Relations', 'Divides', '\\mid', '| divides'),

  // Arrows
  e('Arrows', 'Right arrow', '\\to', '-> to maps'),
  e('Arrows', 'Left arrow', '\\leftarrow', '<-'),
  e('Arrows', 'Left-right arrow', '\\leftrightarrow', '<->'),
  e('Arrows', 'Implies', '\\Rightarrow', '=> implies then'),
  e('Arrows', 'Implied by', '\\Leftarrow', '<='),
  e('Arrows', 'If and only if', '\\Leftrightarrow', '<=> iff equivalent'),
  e('Arrows', 'Long implies', '\\implies', '==>'),
  e('Arrows', 'Long iff', '\\iff', '<==>'),
  e('Arrows', 'Maps to', '\\mapsto', '|-> function'),
  e('Arrows', 'Up arrow', '\\uparrow', 'increase'),
  e('Arrows', 'Down arrow', '\\downarrow', 'decrease'),
  e('Arrows', 'Hook right arrow', '\\hookrightarrow', 'injection embedding'),
  e('Arrows', 'Two-headed arrow', '\\twoheadrightarrow', 'surjection onto'),
  e('Arrows', 'Arrow with label', '\\xrightarrow{#?}', 'labeled arrow'),

  // Sets & Logic
  e('Sets & Logic', 'Element of', '\\in', 'in member belongs'),
  e('Sets & Logic', 'Not element of', '\\notin', 'not in'),
  e('Sets & Logic', 'Subset', '\\subset', 'contained'),
  e('Sets & Logic', 'Subset or equal', '\\subseteq', 'contained'),
  e('Sets & Logic', 'Superset', '\\supset', 'contains'),
  e('Sets & Logic', 'Superset or equal', '\\supseteq', 'contains'),
  e('Sets & Logic', 'Union', '\\cup', 'or cup'),
  e('Sets & Logic', 'Intersection', '\\cap', 'and cap'),
  e('Sets & Logic', 'Big union', '\\bigcup_{#?}^{#?}', 'union over'),
  e('Sets & Logic', 'Big intersection', '\\bigcap_{#?}^{#?}', 'intersection over'),
  e('Sets & Logic', 'Set minus', '\\setminus', 'difference \\'),
  e('Sets & Logic', 'Empty set', '\\emptyset', 'null set varnothing'),
  e('Sets & Logic', 'Set builder', '\\left\\{#? \\mid #?\\right\\}', 'set such that'),
  e('Sets & Logic', 'For all', '\\forall', 'every each'),
  e('Sets & Logic', 'Exists', '\\exists', 'there is some'),
  e('Sets & Logic', 'Not exists', '\\nexists', 'there is no'),
  e('Sets & Logic', 'Logical and', '\\land', 'wedge conjunction'),
  e('Sets & Logic', 'Logical or', '\\lor', 'vee disjunction'),
  e('Sets & Logic', 'Logical not', '\\neg', 'negation lnot'),
  e('Sets & Logic', 'Therefore', '\\therefore', 'thus hence'),
  e('Sets & Logic', 'Because', '\\because', 'since'),
  e('Sets & Logic', 'Real numbers ℝ', '\\mathbb{R}', 'reals RR'),
  e('Sets & Logic', 'Natural numbers ℕ', '\\mathbb{N}', 'naturals NN'),
  e('Sets & Logic', 'Integers ℤ', '\\mathbb{Z}', 'integers ZZ'),
  e('Sets & Logic', 'Rationals ℚ', '\\mathbb{Q}', 'rationals QQ'),
  e('Sets & Logic', 'Complex numbers ℂ', '\\mathbb{C}', 'complex CC'),

  // Brackets
  e('Brackets', 'Parentheses', '\\left(#0\\right)', 'round brackets ()'),
  e('Brackets', 'Square brackets', '\\left[#0\\right]', '[]'),
  e('Brackets', 'Braces', '\\left\\{#0\\right\\}', 'curly {}'),
  e('Brackets', 'Angle brackets', '\\left\\langle #0\\right\\rangle', 'inner product <>'),
  e('Brackets', 'Interval [a, b]', '\\left[#?, #?\\right]', 'closed interval'),
  e('Brackets', 'Interval (a, b)', '\\left(#?, #?\\right)', 'open interval'),

  // Matrices
  e('Matrices', '2×2 matrix (parens)', '\\begin{pmatrix}#? & #?\\\\ #? & #?\\end{pmatrix}', 'pmatrix'),
  e('Matrices', '3×3 matrix (parens)', '\\begin{pmatrix}#? & #? & #?\\\\ #? & #? & #?\\\\ #? & #? & #?\\end{pmatrix}', 'pmatrix'),
  e('Matrices', '2×2 matrix (brackets)', '\\begin{bmatrix}#? & #?\\\\ #? & #?\\end{bmatrix}', 'bmatrix'),
  e('Matrices', '3×3 matrix (brackets)', '\\begin{bmatrix}#? & #? & #?\\\\ #? & #? & #?\\\\ #? & #? & #?\\end{bmatrix}', 'bmatrix'),
  e('Matrices', '2×2 determinant', '\\begin{vmatrix}#? & #?\\\\ #? & #?\\end{vmatrix}', 'vmatrix det'),
  e('Matrices', 'Column vector (2)', '\\begin{pmatrix}#?\\\\ #?\\end{pmatrix}', 'vector column'),
  e('Matrices', 'Column vector (3)', '\\begin{pmatrix}#?\\\\ #?\\\\ #?\\end{pmatrix}', 'vector column'),
  e('Matrices', 'Transpose', '#0^{T}', 'transpose'),

  // Accents
  e('Accents', 'Vector arrow', '\\vec{#0}', 'vector arrow'),
  e('Accents', 'Hat', '\\hat{#0}', 'unit vector estimator'),
  e('Accents', 'Bar', '\\bar{#0}', 'mean conjugate overline'),
  e('Accents', 'Overline', '\\overline{#0}', 'bar conjugate closure'),
  e('Accents', 'Tilde', '\\tilde{#0}', 'wave'),
  e('Accents', 'Dot', '\\dot{#0}', 'time derivative'),
  e('Accents', 'Double dot', '\\ddot{#0}', 'second time derivative'),
  e('Accents', 'Underline', '\\underline{#0}', 'under'),

  // Fonts
  e('Fonts', 'Blackboard bold', '\\mathbb{#0}', 'double struck'),
  e('Fonts', 'Calligraphic', '\\mathcal{#0}', 'script'),
  e('Fonts', 'Fraktur', '\\mathfrak{#0}', 'gothic'),
  e('Fonts', 'Bold', '\\mathbf{#0}', 'bold vector'),
  e('Fonts', 'Roman (upright)', '\\mathrm{#0}', 'upright units'),

  // Misc
  e('Misc', 'Horizontal dots', '\\ldots', '... ellipsis'),
  e('Misc', 'Centered dots', '\\cdots', 'ellipsis'),
  e('Misc', 'Vertical dots', '\\vdots', 'ellipsis'),
  e('Misc', 'Diagonal dots', '\\ddots', 'ellipsis'),
  e('Misc', 'Degree', '^{\\circ}', 'degrees angle'),
  e('Misc', 'Angle', '\\angle', 'angle'),
  e('Misc', 'Triangle', '\\triangle', 'delta'),
  e('Misc', 'h-bar', '\\hbar', 'planck reduced'),
  e('Misc', 'ell', '\\ell', 'script l'),
  e('Misc', 'Aleph', '\\aleph', 'cardinal'),
  e('Misc', 'Real part', '\\Re', 'real'),
  e('Misc', 'Imaginary part', '\\Im', 'imaginary'),
  e('Misc', 'Prime mark', '\\prime', "'"),
  e('Misc', 'QED box', '\\square', 'end proof'),
];

/** Convert placeholder syntax into something MathLive can render as a preview. */
export function previewLatex(latex: string): string {
  return latex.replace(/\\text\{#[0?@]\}/g, '\\text{abc}').replace(/#[0?@]/g, '\\square');
}

/** Lookup used by the `\command ` text shortcut: e.g. typing `\frac ` in text. */
const byCommand = new Map<string, string>();
for (const entry of MATH_CATALOG) {
  const m = entry.latex.match(/^\\([a-zA-Z]+)/);
  if (m && !byCommand.has(m[1])) byCommand.set(m[1], entry.latex);
}
export function templateForCommand(name: string): string | null {
  return byCommand.get(name) ?? null;
}

import JSZip from 'jszip';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { ENV_KINDS, type EnvKind } from '../editor/schema';
import { escapeXml as esc, latexToOmml } from './mathconv';
import type { ExportOptions } from '../app/settings';

/**
 * Writes a .docx (Office Open XML) package by hand. Equations become native
 * Word equations (OMML), so they stay editable in Word.
 */

interface Ctx {
  /** Style for plain paragraphs inside this container (e.g. Quote). */
  pStyle?: string;
  /** Left indent in twips, for quotes and environments. */
  indent?: number;
  /** Left border colour for environment boxes. */
  border?: string;
  italic?: boolean;
  list?: { numId: number; level: number };
  /** Runs to put before the next paragraph's content (environment label). */
  prefix?: { xml: string };
  /** Nesting depth for lists inside non-list containers. */
  listLevel?: number;
}

const TWIPS_PER_LEVEL = 720;

export function toHexColor(color: string): string | null {
  const c = color.trim();
  let m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) return m[1].split('').map((x) => x + x).join('').toUpperCase();
  m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return m[1].toUpperCase();
  m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return null;
}

class DocxWriter {
  body: string[] = [];
  rels: string[] = [];
  nums: string[] = [];
  private nextRel = 10;
  private nextNum = 2; // 1 = bullets
  private eqNo = 0;
  private envNo: Record<string, number> = {};

  constructor(private opts: ExportOptions) {}

  run(text: string, marks: readonly Mark[], ctx: Ctx): string {
    const props: string[] = [];
    const has = (n: string) => marks.find((m) => m.type.name === n);
    if (has('code')) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
    if (has('strong')) props.push('<w:b/><w:bCs/>');
    if (has('em') || ctx.italic) props.push('<w:i/><w:iCs/>');
    if (has('strike')) props.push('<w:strike/>');
    const color = has('text_color');
    const link = has('link');
    if (color) {
      const hex = toHexColor(color.attrs.color);
      if (hex) props.push(`<w:color w:val="${hex}"/>`);
    } else if (link) props.push('<w:color w:val="0563C1"/>');
    if (has('underline') || link) props.push('<w:u w:val="single"/>');
    const hl = has('highlight');
    if (hl) {
      const hex = toHexColor(hl.attrs.color) ?? 'FFFF00';
      props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`);
    }
    if (has('superscript')) props.push('<w:vertAlign w:val="superscript"/>');
    else if (has('subscript')) props.push('<w:vertAlign w:val="subscript"/>');
    const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
    return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  }

  inline(node: PMNode, ctx: Ctx): string {
    let out = '';
    let linkOpen: string | null = null;
    let linkBuf = '';
    const flushLink = () => {
      if (linkOpen != null) {
        const id = `rId${this.nextRel++}`;
        this.rels.push(
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(linkOpen)}" TargetMode="External"/>`,
        );
        out += `<w:hyperlink r:id="${id}">${linkBuf}</w:hyperlink>`;
        linkOpen = null;
        linkBuf = '';
      }
    };
    node.forEach((child) => {
      const link = child.marks.find((m) => m.type.name === 'link');
      if ((link?.attrs.href ?? null) !== linkOpen) flushLink();
      if (link && linkOpen == null) linkOpen = link.attrs.href;
      let xml = '';
      if (child.isText) xml = this.run(child.text ?? '', child.marks, ctx);
      else if (child.type.name === 'math_inline') xml = latexToOmml(child.attrs.latex);
      else if (child.type.name === 'hard_break') xml = '<w:r><w:br/></w:r>';
      if (linkOpen != null) linkBuf += xml;
      else out += xml;
    });
    flushLink();
    return out;
  }

  pPr(ctx: Ctx, opts: { style?: string; align?: string; extra?: string } = {}): string {
    const parts: string[] = [];
    const style = opts.style ?? ctx.pStyle;
    if (style) parts.push(`<w:pStyle w:val="${style}"/>`);
    if (ctx.list) parts.push(`<w:numPr><w:ilvl w:val="${ctx.list.level}"/><w:numId w:val="${ctx.list.numId}"/></w:numPr>`);
    if (ctx.border) {
      parts.push(
        `<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${ctx.border}"/></w:pBdr>`,
      );
    }
    if (opts.extra) parts.push(opts.extra);
    if (ctx.indent && !ctx.list) parts.push(`<w:ind w:left="${ctx.indent}"/>`);
    const jc = opts.align && opts.align !== 'left' ? (opts.align === 'justify' ? 'both' : opts.align) : null;
    if (jc) parts.push(`<w:jc w:val="${jc}"/>`);
    return parts.length ? `<w:pPr>${parts.join('')}</w:pPr>` : '';
  }

  takePrefix(ctx: Ctx): string {
    if (!ctx.prefix) return '';
    const xml = ctx.prefix.xml;
    ctx.prefix.xml = '';
    return xml;
  }

  block(node: PMNode, ctx: Ctx) {
    switch (node.type.name) {
      case 'paragraph': {
        const prefix = this.takePrefix(ctx);
        this.body.push(`<w:p>${this.pPr(ctx, { align: node.attrs.align })}${prefix}${this.inline(node, ctx)}</w:p>`);
        if (ctx.list) ctx.list = undefined; // later paragraphs in the same item are continuation text
        break;
      }
      case 'heading':
        this.body.push(
          `<w:p>${this.pPr(ctx, { style: `Heading${node.attrs.level}`, align: node.attrs.align })}${this.inline(node, { ...ctx, italic: false })}</w:p>`,
        );
        break;
      case 'code_block': {
        const lines = node.textContent.split('\n');
        for (const line of lines) {
          this.body.push(`<w:p>${this.pPr(ctx, { style: 'Code' })}<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`);
        }
        break;
      }
      case 'horizontal_rule':
        this.body.push(
          `<w:p>${this.pPr(ctx, { extra: '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>' })}</w:p>`,
        );
        break;
      case 'math_display': {
        const prefix = this.takePrefix(ctx);
        if (prefix) this.body.push(`<w:p>${this.pPr(ctx)}${prefix}</w:p>`);
        const omml = latexToOmml(node.attrs.latex);
        if (node.attrs.numbered) {
          const n = ++this.eqNo;
          const tabs = '<w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs>';
          this.body.push(
            `<w:p>${this.pPr(ctx, { extra: tabs })}<w:r><w:tab/></w:r>${omml}<w:r><w:tab/><w:t>${this.opts.eqNumberStyle === 'bracket' ? `[${n}]` : `(${n})`}</w:t></w:r></w:p>`,
          );
        } else {
          this.body.push(`<w:p>${this.pPr(ctx, { align: 'center' })}<m:oMathPara>${omml}</m:oMathPara></w:p>`);
        }
        break;
      }
      case 'blockquote':
        node.forEach((c) => this.block(c, { ...ctx, pStyle: 'Quote', indent: (ctx.indent ?? 0) + TWIPS_PER_LEVEL }));
        break;
      case 'math_env': {
        const kind = node.attrs.kind as EnvKind;
        const spec = ENV_KINDS[kind] ?? ENV_KINDS.theorem;
        let label = spec.label;
        if (spec.numbered) {
          this.envNo[kind] = (this.envNo[kind] ?? 0) + 1;
          label += ` ${this.envNo[kind]}`;
        }
        if (node.attrs.title) label += ` (${node.attrs.title})`;
        label += '.';
        const labelRun =
          kind === 'proof'
            ? `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${esc(label)} </w:t></w:r>`
            : `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(label)} </w:t></w:r>`;
        const italicBody = ['theorem', 'lemma', 'corollary', 'proposition'].includes(kind);
        const inner: Ctx = {
          ...ctx,
          italic: italicBody || ctx.italic,
          border: kind === 'proof' ? undefined : kind === 'definition' ? '2E7D32' : '3F51B5',
          prefix: { xml: labelRun },
        };
        const start = this.body.length;
        node.forEach((c) => this.block(c, inner));
        if (kind === 'proof') {
          // Put the QED mark at the end of the last paragraph.
          const last = this.body.length - 1;
          if (last >= start) this.body[last] = this.body[last].replace(/<\/w:p>$/, '<w:r><w:tab/><w:t>∎</w:t></w:r></w:p>');
        }
        break;
      }
      case 'bullet_list':
      case 'ordered_list': {
        const level = ctx.list ? ctx.list.level + 1 : (ctx.listLevel ?? 0);
        let numId = 1;
        if (node.type.name === 'ordered_list') {
          numId = this.nextNum++;
          const abstractId = node.attrs.listStyle === 'lower-alpha' ? 2 : 1;
          this.nums.push(
            `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/><w:lvlOverride w:ilvl="${level}"><w:startOverride w:val="${node.attrs.order ?? 1}"/></w:lvlOverride></w:num>`,
          );
        }
        node.forEach((item) => {
          const itemCtx: Ctx = { ...ctx, list: { numId, level }, listLevel: level + 1 };
          item.forEach((c) => {
            if (c.type.name === 'bullet_list' || c.type.name === 'ordered_list') {
              this.block(c, { ...ctx, list: undefined, listLevel: level + 1 });
            } else {
              if (!itemCtx.list) itemCtx.indent = (level + 1) * TWIPS_PER_LEVEL;
              this.block(c, itemCtx);
            }
          });
        });
        break;
      }
      default:
        if (node.isTextblock) this.body.push(`<w:p>${this.pPr(ctx)}${this.inline(node, ctx)}</w:p>`);
        else node.forEach((c) => this.block(c, ctx));
    }
  }
}


const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function stylesXml(opts: ExportOptions) {
  const font = esc(opts.font);
  const size = Math.round(opts.fontSize * 2);
  // CSS line-height 1.55 looks like Word's 1.15 (276/240).
  const line = Math.round((240 * opts.lineSpacing) / 1.35);
  const heading = (n: number, size: number, color: string) => `
  <w:style w:type="paragraph" w:styleId="Heading${n}">
    <w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>
  </w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  ${heading(1, 36, '1F3864')}
  ${heading(2, 30, '1F3864')}
  ${heading(3, 26, '2F5496')}
  ${heading(4, 24, '2F5496')}
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BBBBBB"/></w:pBdr></w:pPr>
    <w:rPr><w:i/><w:color w:val="555555"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F3F3"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>`;
}

function numberingXml(nums: string[]) {
  const bullets = ['•', '◦', '▪'];
  const fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
  const lvl = (i: number, fmt: string, text: string) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${(i + 1) * TWIPS_PER_LEVEL}" w:hanging="360"/></w:pPr></w:lvl>`;
  const bulletLvls = Array.from({ length: 9 }, (_, i) => lvl(i, 'bullet', bullets[i % 3])).join('');
  const numLvls = Array.from({ length: 9 }, (_, i) => lvl(i, fmts[i % 3], `%${i + 1}.`)).join('');
  const letterLvls = Array.from({ length: 9 }, (_, i) => lvl(i, 'lowerLetter', `%${i + 1}.`)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLvls}</w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${numLvls}</w:abstractNum>
  <w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${letterLvls}</w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  ${nums.join('\n  ')}
</w:numbering>`;
}

export async function exportDocx(doc: PMNode, title: string, opts: ExportOptions): Promise<Uint8Array> {
  const w = new DocxWriter(opts);
  doc.forEach((node) => w.block(node, {}));

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
${w.body.join('\n')}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body>
</w:document>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${esc(title)}</dc:title><dc:creator>MathMirror</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
  );
  zip.file(
    'docProps/app.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>MathMirror</Application></Properties>`,
  );
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', stylesXml(opts));
  zip.file('word/numbering.xml', numberingXml(w.nums));
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  ${w.rels.join('\n  ')}
</Relationships>`,
  );
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

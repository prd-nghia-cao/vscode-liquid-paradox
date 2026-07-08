import {
  getLanguageService,
  type LanguageService,
  type HTMLDocument,
} from 'vscode-html-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { bucketCursor } from '../bucketCursor.js';
import { liquidSpans, maskNonHtml, offsetInSpans, type Span } from './htmlRegions.js';

let service: LanguageService | undefined;

/** Lazily-created singleton HTML language service. */
export function getHtmlService(): LanguageService {
  if (!service) service = getLanguageService();
  return service;
}

/** A virtual HTML view of a `.liquid` document plus its parsed HTML tree. */
export interface HtmlContext {
  version: number;
  /** `.liquid` text with all Liquid spans masked to whitespace (offset-parity). */
  virtualDoc: TextDocument;
  htmlDoc: HTMLDocument;
  spans: Span[];
}

const cache = new Map<string, HtmlContext>();

/**
 * Builds the masked virtual HTML `TextDocument` for `text`. Every non-HTML
 * (Liquid) span is replaced with whitespace, preserving length and line breaks
 * so positions map 1:1 with the source document.
 */
export function buildVirtualHtmlDocument(uri: string, version: number, text: string): TextDocument {
  return TextDocument.create(uri, 'html', version, maskNonHtml(text));
}

/**
 * Returns the cached {@link HtmlContext} for a document version, parsing the
 * masked virtual document on a cache miss (mirrors `html-language-features`).
 */
export function getHtmlContext(uri: string, version: number, text: string): HtmlContext {
  const cached = cache.get(uri);
  if (cached && cached.version === version) return cached;

  const spans = liquidSpans(text);
  const virtualDoc = TextDocument.create(uri, 'html', version, maskNonHtml(text, spans));
  const htmlDoc = getHtmlService().parseHTMLDocument(virtualDoc);
  const ctx: HtmlContext = { version, virtualDoc, htmlDoc, spans };
  cache.set(uri, ctx);
  return ctx;
}

/**
 * True when `offset` sits in an HTML region of the document. A position is HTML
 * only when it is outside every complete Liquid span (covering `{{ }}`,
 * `{% %}`, comments) AND `bucketCursor` classifies it as `text` (which also
 * rejects partially-typed / unbalanced delimiters that have no complete span
 * yet, e.g. an unclosed `{{`).
 */
export function isInHtmlRegion(text: string, offset: number, spans: Span[]): boolean {
  if (offsetInSpans(spans, offset)) return false;
  if (bucketCursor(text, offset).region !== 'text') return false;
  return true;
}

/** Drops the cached context for a closed document. */
export function disposeHtmlContext(uri: string): void {
  cache.delete(uri);
}

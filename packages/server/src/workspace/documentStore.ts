import { analyzeDocument, type DocumentModel } from '../analyzer/document.js';
import type { Binding } from '../types.js';

export interface DocumentStoreDeps {
  isComponentUri: (uri: string) => boolean;
  readJsonCompanion: (jsonAbsPath: string) => string | undefined;
  lookupComponent: (key: string) => Binding[] | undefined;
  uriToPath: (uri: string) => string;
}

export interface DocumentStore {
  update(uri: string, text: string): DocumentModel;
  get(uri: string): DocumentModel | undefined;
  remove(uri: string): void;
  allUris(): string[];
}

export function createDocumentStore(deps: DocumentStoreDeps): DocumentStore {
  const cache = new Map<string, DocumentModel>();

  return {
    update(uri, text) {
      const cached = cache.get(uri);
      if (cached && cached.text === text) return cached;
      const absPath = deps.uriToPath(uri);
      const jsonPath = absPath + '.json';
      const jsonText = deps.readJsonCompanion(jsonPath);
      const model = analyzeDocument({
        uri,
        text,
        jsonCompanion: jsonText !== undefined ? { path: jsonPath, text: jsonText } : undefined,
        isComponent: deps.isComponentUri(uri),
        componentLookup: deps.lookupComponent,
      });
      cache.set(uri, model);
      return model;
    },
    get(uri) {
      return cache.get(uri);
    },
    remove(uri) {
      cache.delete(uri);
    },
    allUris() {
      return [...cache.keys()];
    },
  };
}

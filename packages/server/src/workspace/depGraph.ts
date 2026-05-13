import type { Dependencies } from '../types.js';

export interface DepGraph {
  set(uri: string, deps: Dependencies): void;
  remove(uri: string): void;
  dependentsOfJson(jsonAbsPath: string): string[];
  dependentsOfRenderKey(key: string): string[];
  dependentsOfLayoutKey(key: string): string[];
}

export function createDepGraph(): DepGraph {
  const byUri = new Map<string, Dependencies>();
  const byJson = new Map<string, Set<string>>();
  const byRender = new Map<string, Set<string>>();
  const byLayout = new Map<string, Set<string>>();

  function addTo(map: Map<string, Set<string>>, key: string, uri: string): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(uri);
  }
  function removeFrom(map: Map<string, Set<string>>, key: string, uri: string): void {
    const set = map.get(key);
    if (!set) return;
    set.delete(uri);
    if (set.size === 0) map.delete(key);
  }

  return {
    set(uri, deps) {
      const old = byUri.get(uri);
      if (old) {
        if (old.jsonCompanion) removeFrom(byJson, old.jsonCompanion, uri);
        for (const r of old.renderedFiles) removeFrom(byRender, r, uri);
        if (old.layoutFile) removeFrom(byLayout, old.layoutFile, uri);
      }
      if (deps.jsonCompanion) addTo(byJson, deps.jsonCompanion, uri);
      for (const r of deps.renderedFiles) addTo(byRender, r, uri);
      if (deps.layoutFile) addTo(byLayout, deps.layoutFile, uri);
      byUri.set(uri, deps);
    },
    remove(uri) {
      const old = byUri.get(uri);
      if (!old) return;
      if (old.jsonCompanion) removeFrom(byJson, old.jsonCompanion, uri);
      for (const r of old.renderedFiles) removeFrom(byRender, r, uri);
      if (old.layoutFile) removeFrom(byLayout, old.layoutFile, uri);
      byUri.delete(uri);
    },
    dependentsOfJson(p) {
      return [...(byJson.get(p) ?? [])];
    },
    dependentsOfRenderKey(k) {
      return [...(byRender.get(k) ?? [])];
    },
    dependentsOfLayoutKey(k) {
      return [...(byLayout.get(k) ?? [])];
    },
  };
}

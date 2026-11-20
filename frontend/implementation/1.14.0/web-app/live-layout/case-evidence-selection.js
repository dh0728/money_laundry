import { useSyncExternalStore } from 'react';

const empty = new Set();
const readEmpty = () => empty;
const subscribeEmpty = () => () => {};

export function createCaseEvidenceSelection() {
  let selected = empty;
  const listeners = new Set();
  function publish(next) {
    selected = next;
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => selected,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change(codes, checked) {
      const next = new Set(selected);
      for (const code of codes) {
        if (checked) next.add(code);
        else next.delete(code);
      }
      if (next.size !== selected.size) publish(next);
    },
    clear() {
      if (selected.size) publish(empty);
    },
  };
}

export function useCaseEvidenceSelection(selection) {
  return useSyncExternalStore(selection?.subscribe ?? subscribeEmpty, selection?.getSnapshot ?? readEmpty);
}

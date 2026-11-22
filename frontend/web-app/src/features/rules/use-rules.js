import { useEffect, useState, useSyncExternalStore } from 'react';
import { currentPreviewUser, subscribePreviewUser } from '../auth/preview-session-user.js';
import { ruleRepository } from './rule-repository';

/** 룰 목록을 불러오고, 저장소가 바뀌거나 사용자가 바뀌면 다시 읽는다. */
export function useRules(repository = ruleRepository) {
  const user = useSyncExternalStore(subscribePreviewUser, currentPreviewUser);
  const [state, setState] = useState({ status: 'loading', rules: [], error: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => repository.list().then(
      rules => { if (live) setState({ status: 'ready', rules, error: '' }); },
      error => { if (live) setState(previous => ({ ...previous, status: 'error', error: error?.message ?? '' })); });
    load();
    const unsubscribe = repository.subscribe(load);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [repository, user, attempt]);
  return {
    ...state,
    retry() {
      setState(previous => ({ ...previous, status: 'loading', error: '' }));
      setAttempt(count => count + 1);
    },
  };
}

import { expect, it } from 'vitest';
import { restoreWorkTabCodes } from './work-tab-state';

const defaultTabs = ['T-261111-00000001', 'T-261111-00000002', 'A-261111-001042', 'A-261111-001051'];
const oldSampleTab = 'T-261111-00000003';
const addedTab = 'T-261111-00000526';
const legacyDefaults = [...defaultTabs, oldSampleTab];

it('migrates a partially deleted old sample list without reopening removed tabs', () => {
  const stored = [defaultTabs[1], oldSampleTab, addedTab, defaultTabs[3]];
  expect(restoreWorkTabCodes(stored, defaultTabs, legacyDefaults))
    .toEqual([defaultTabs[1], addedTab, defaultTabs[3]]);
});

it('keeps later edits after migration, including adding a previously seeded tab', () => {
  expect(restoreWorkTabCodes({ version: 2, codes: [addedTab, oldSampleTab] }, defaultTabs, legacyDefaults))
    .toEqual([addedTab, oldSampleTab]);
  expect(restoreWorkTabCodes({ version: 2, codes: [] }, defaultTabs, legacyDefaults)).toEqual([]);
  expect(restoreWorkTabCodes(null, defaultTabs, legacyDefaults)).toEqual(defaultTabs);
});

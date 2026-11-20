import { expect, it } from 'vitest';
import { previewUrl, readPreviewRoute } from './preview-route';
import { ScreenNavigation, sections } from './screen-layouts';

it('keeps the selected transaction and data source when linking to the ledger table', () => {
  const url = new URL('http://localhost/investigate/ledger?transaction=T-261111-00000002&data=sample&view=table');
  const route = readPreviewRoute(url);
  expect(route.screen).not.toBe(sections.T);
  expect(route.code).toBe('T-261111-00000002');
  const modes = ScreenNavigation(route.screen, route.code).secondary;
  expect(modes.map(item => [item.label, item.active])).toEqual([['표', true], ['카드', false]]);
  expect(previewUrl(route, url.searchParams)).toBe('/investigate/ledger?data=sample&view=table&transaction=T-261111-00000002');
});

it('keeps historical benchmark codes out of investigation and accepts them in the source ledger', () => {
  const code = 'T-220901-00004743';
  expect(readPreviewRoute(new URL(`http://localhost/investigate/ledger?transaction=${code}`)).code).toBe('');
  const source = new URL(`http://localhost/benchmark/ledger?view=table&transaction=${code}`);
  const route = readPreviewRoute(source);
  expect(route.code).toBe(code);
  expect(previewUrl(route, source.searchParams)).toBe(source.pathname + source.search);
});

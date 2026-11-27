import { expect, it } from 'vitest';
import { ledgerTableScreen, previewUrl, readPreviewRoute } from './preview-route';
import { ScreenNavigation, sections } from './screen-layouts';

it('opens the overall dashboard by default and lists it before the personal dashboard', () => {
  const route = readPreviewRoute(new URL('http://localhost/'));
  expect(previewUrl(route)).toBe('/dashboard/all');
  const navigation = ScreenNavigation(route.screen);
  expect(navigation.global[0].value).toBe(route.screen);
  expect(navigation.primary.map(({ label, active }) => [label, active]))
    .toEqual([['전체', true], ['개인', false]]);
  expect(readPreviewRoute(new URL('http://localhost/dashboard/mine')).screen).toBe('dashboard/mine');
});

it('주 메뉴에 거래·Alert·Episode를 바로 두고 목록에는 표·카드만 남긴다', () => {
  const labels = navigation => navigation.global.map(item => item.label);
  const current = navigation => navigation.global.filter(item => item.current).map(item => [item.label, item.current]);
  const alerts = ScreenNavigation('add-tab/alerts-table');
  expect(labels(alerts)).toEqual(['대시보드', '룰엔진', '거래', 'Alert', 'Episode', '보고서 작성']);
  expect(current(alerts)).toEqual([['Alert', 'page']]);
  expect(alerts.primary).toEqual([]);
  expect(alerts.secondary.map(({ label, active }) => [label, active])).toEqual([['표', true], ['카드', false]]);
  expect(current(ScreenNavigation(sections.E))).toEqual([['Episode', 'page']]);
  expect(current(ScreenNavigation(ledgerTableScreen))).toEqual([['거래', 'page']]);
  // 상세 화면에서는 그 사건의 메뉴가 현재 위치로 남아 목록으로 바로 돌아갈 수 있다
  expect(current(ScreenNavigation('alert/overview-allpanel', 'A-230916-002197'))).toEqual([['Alert', 'location']]);
  expect(current(ScreenNavigation('episode/analysis', 'E-230916-000012'))).toEqual([['Episode', 'location']]);
  expect(current(ScreenNavigation(sections.T, 'T-261111-00000002'))).toEqual([['거래', 'location']]);
});

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

it('opens and restores real transaction codes outside the sample dates in service mode', () => {
  const code = 'T-230908-00000021';
  const direct = new URL(`http://localhost/transactions/${code}`);
  const ledger = new URL(`http://localhost/investigate/ledger?transaction=${code}`);
  const route = readPreviewRoute(direct, { serviceMode: true });
  expect(route.code).toBe(code);
  expect(readPreviewRoute(ledger, { serviceMode: true })).toEqual(route);
  expect(previewUrl({ ...route, serviceMode: true })).toBe(ledger.pathname + ledger.search);
  expect(readPreviewRoute(ledger).code).toBe('');
});

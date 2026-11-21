import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Button, IconButton } from '../../components/radar/components.js';
import { ActionButton } from '../../components/radar/primary-button.jsx';
import layoutCss from '../../app/radar/layout.css?raw';
import workTabButtonCss from '../../components/radar/work-tab-add-button.css?raw';

it('keeps the React button shape when its surface changes', () => {
  const { rerender } = render(<ActionButton className="icon-button" surface="floating">도구</ActionButton>);
  const button = screen.getByRole('button', { name: '도구' });
  expect(button.dataset.buttonShape).toBe('circle');

  rerender(<ActionButton className="icon-button" surface="ghost">도구</ActionButton>);
  expect(button.dataset.buttonSurface).toBe('ghost');
  expect(button.dataset.buttonShape).toBe('circle');

  rerender(<ActionButton shape="pill" surface="ghost">도구</ActionButton>);
  expect(button.dataset.buttonShape).toBe('pill');
});

it('gives equivalent vanilla buttons the same structural shapes for every surface', () => {
  for (const surface of ['', 'ghost', 'floating', 'primary']) {
    expect(IconButton('', '도구', '', '', surface)).toContain('data-button-shape="circle"');
    expect(Button('도구', { shape: 'pill', surface })).toContain('data-button-shape="pill"');
    expect(Button('도구', { surface })).toContain('data-button-shape="corner"');
  }
});

it('keeps shared button surface and interaction rules free of geometry changes', () => {
  const sharedStyles = layoutCss.slice(layoutCss.indexOf('.button {'), layoutCss.indexOf('[data-drawer-button]'));
  const floatingStyles = layoutCss.slice(layoutCss.indexOf('--floating-shadow:'), layoutCss.indexOf('.magic-bento__card { --mb-radius:'));
  const geometry = /(?:^|;)\s*(?:[\w-]*(?:width|height|size|radius)|scale|transform|padding[\w-]*)\s*:/;
  for (const css of [sharedStyles, floatingStyles, workTabButtonCss]) {
    const stateRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => /:hover|:active|:focus-visible|\[data-button-surface/.test(selector));
    for (const [, selector, declarations] of stateRules) {
      expect(declarations, selector).not.toMatch(geometry);
    }
  }
});

import { expect, it, vi } from 'vitest';
import { setupOverlayDismissal } from './overlay-dismissal';

it('keeps the work drawer open during a card tab addition and dismisses it on an unrelated click', () => {
  const shell = document.createElement('div');
  shell.innerHTML = '<button aria-expanded="true"></button><aside></aside><article><button data-add-work-tab><span>+</span></button></article><main></main>';
  document.body.append(shell);
  const drawerButton = shell.firstElementChild;
  drawerButton.getClientRects = () => [{ width: 40 }];
  const dismiss = vi.fn();
  setupOverlayDismissal([{
    button: drawerButton, surfaces: [shell.querySelector('aside')], keepOpenOn: '[data-add-work-tab]', dismiss,
  }]);
  const click = target => {
    const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 });
    Object.defineProperty(down, 'isPrimary', { value: true });
    target.dispatchEvent(down);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  };
  try {
    click(shell.querySelector('span'));
    expect(dismiss).not.toHaveBeenCalled();
    click(shell.querySelector('main'));
    expect(dismiss).toHaveBeenCalledTimes(1);
  } finally {
    shell.remove();
  }
});

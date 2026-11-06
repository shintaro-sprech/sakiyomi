// Moves focus to an element from code, as after a screen changes. A heading is not a control,
// so after a click or tap it takes focus without the ring; after a key press the ring shows,
// so a keyboard user sees where they are.
let lastInput: 'pointer' | 'keyboard' = 'pointer'
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => (lastInput = 'pointer'), { capture: true })
  window.addEventListener('keydown', () => (lastInput = 'keyboard'), { capture: true })
}

export function moveFocus(element: HTMLElement, options: FocusOptions = {}) {
  if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) element.tabIndex = -1
  if (lastInput === 'pointer') {
    element.dataset.quietFocus = ''
    element.addEventListener('blur', () => delete element.dataset.quietFocus, { once: true })
  }
  element.focus(options)
}

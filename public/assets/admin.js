// Back office: confirmation prompts for destructive buttons (kept out of inline handlers for the CSP).
document.addEventListener('click', (event) => {
  const el = event.target instanceof Element ? event.target.closest('[data-confirm]') : null;
  if (el && !window.confirm(el.getAttribute('data-confirm'))) event.preventDefault();
});

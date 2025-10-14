(() => {
  const ID = 'public-session-banner';
  if (document.getElementById(ID)) return;

  const banner = document.createElement('div');
  banner.id = ID;

  // Use a shadow root to avoid clobbering page styles
  const shadow = banner.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .ps-wrapper{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#ffeb3b;color:#111;padding:8px 12px;font-family:Segoe UI, Roboto, Arial, sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.12);}
    .ps-text{font-size:14px}
    .ps-close{background:transparent;border:0;font-size:16px;cursor:pointer}
  `;

  const wrapper = document.createElement('div');
  wrapper.className = 'ps-wrapper';
  wrapper.innerHTML = `<span class="ps-text">This is a public session</span><button class="ps-close" aria-label="Close banner">✕</button>`;

  shadow.appendChild(style);
  shadow.appendChild(wrapper);

  // Insert at the top of <html>
  document.documentElement.prepend(banner);

  // Close button
  shadow.querySelector('.ps-close').addEventListener('click', () => banner.remove());
})();

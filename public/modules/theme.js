// modules/theme.js — Theme toggle

import { dom } from './state.js';

export function getTheme() {
  return localStorage.getItem('theme') || 'dark';
}

export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  if (dom.iconSun && dom.iconMoon) {
    if (theme === 'light') {
      dom.iconSun.style.display = 'none';
      dom.iconMoon.style.display = '';
    } else {
      dom.iconSun.style.display = '';
      dom.iconMoon.style.display = 'none';
    }
  }
}

export function initTheme() {
  setTheme(getTheme());
  if (dom.themeToggle) {
    dom.themeToggle.addEventListener('click', function() {
      var current = getTheme();
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }
}

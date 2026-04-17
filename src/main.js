/**
 * main.js – Application entry point.
 * Wires tabs and initialises panels.
 */

import { initConfigPanel } from './ui/configPanel.js';
import { initDashboard, refreshSimSummary, refreshPlaybackProductOptions } from './ui/dashboard.js';

/* ============ Tab Navigation ============ */
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`tab-${target}`);
      if (panel) {
        panel.classList.add('active');
        // Re-trigger animation
        panel.style.animation = 'none';
        panel.offsetHeight; // reflow
        panel.style.animation = '';
      }
      // Refresh summary when entering simulate tab
      if (target === 'simulate') {
        refreshSimSummary();
        refreshPlaybackProductOptions();
      }
    });
  });
}

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initConfigPanel();
  initDashboard();
  refreshSimSummary();
  refreshPlaybackProductOptions();
});

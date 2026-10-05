/* ================================================================
   RankHarbour — dashboard.js
   Signed-in dashboard behaviour: accessible tabs, overview shortcuts
   and the plan comparison highlight. Holds no user data; account.js
   fills and clears the personal fields. The SEO Evaluation tab's
   network calls live in seo-evaluation.js.
   ================================================================ */

import { initSeoEvaluation } from './seo-evaluation.js';

const PLAN_NAMES = {
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
  enterprise: 'Enterprise',
  'enterprise-plus': 'Enterprise Plus',
};
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// The tablist lives in the page header, outside `root`, so it is passed in separately.
export function initDashboard(root, tablist) {
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const table = root.querySelector('#compare-table');
  const scroller = table.closest('.compare__scroll');
  const focusLine = root.querySelector('#compare-focus');
  const focusName = root.querySelector('#compare-focus-name');

  const panelFor = (tab) => document.getElementById(tab.getAttribute('aria-controls'));
  const tabByName = (name) => tabs.find((tab) => tab.id === `dash-tab-${name}`);
  const scrollBehavior = () => (reducedMotion.matches ? 'auto' : 'smooth');

  const seo = initSeoEvaluation(root.querySelector('#dash-panel-seo'));

  // A newly opened panel starts at the top of the page, just under the fixed header.
  function scrollToTop() {
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function selectTab(tab, { focus = false, scroll = false } = {}) {
    const changed = tab.getAttribute('aria-selected') !== 'true';
    tabs.forEach((other) => {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      panelFor(other).hidden = !selected;
    });
    if (scroll && changed) scrollToTop();
    if (focus) tab.focus();
  }

  // Automatic activation: arrows, Home and End move focus and select together.
  tablist.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const last = tabs.length - 1;
    const next = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next], { focus: true, scroll: true });
  });
  tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab, { scroll: true })));

  // Shortcuts open a tab and move focus to that panel's heading.
  function openPanel(name) {
    const tab = tabByName(name);
    selectTab(tab, { scroll: true });
    panelFor(tab).querySelector('.dash-h2').focus({ preventScroll: true });
  }
  root.querySelectorAll('[data-dash-go]').forEach((button) => {
    button.addEventListener('click', () => openPanel(button.dataset.dashGo));
  });

  // "Compare inclusions": highlight that plan's column and bring it into view.
  function highlight(plan) {
    table.querySelectorAll('[data-col]').forEach((cell) => {
      cell.classList.toggle('is-highlight', cell.dataset.col === plan);
    });
    if (!plan) {
      table.removeAttribute('data-highlight');
      focusLine.hidden = true;
      focusName.textContent = '';
      return;
    }
    table.dataset.highlight = plan;
    focusName.textContent = PLAN_NAMES[plan];
    focusLine.hidden = false;
  }

  root.querySelectorAll('[data-compare]').forEach((button) => {
    button.addEventListener('click', () => {
      const plan = button.dataset.compare;
      highlight(plan);
      const header = table.querySelector(`thead [data-col="${plan}"]`);
      const rowHeader = table.querySelector('thead .compare__feature');
      // Keep the chosen column visible beside the sticky feature column on narrow screens.
      scroller.scrollLeft = Math.max(0, header.offsetLeft - rowHeader.offsetWidth);
      root.querySelector('#compare').scrollIntoView({ block: 'start', behavior: scrollBehavior() });
      header.focus({ preventScroll: true });
    });
  });

  root.querySelector('#compare-clear').addEventListener('click', () => {
    highlight(null);
    scroller.focus();
  });

  return {
    /** Abandons in-flight work (e.g. an SEO evaluation) before signing out. */
    cancel() {
      seo.cancel();
    },
    /** Back to a clean first-visit state (used on sign-out or a user change). */
    reset() {
      highlight(null);
      scroller.scrollLeft = 0;
      root.querySelectorAll('details[open]').forEach((details) => { details.open = false; });
      seo.reset();
      selectTab(tabs[0]);
    },
  };
}

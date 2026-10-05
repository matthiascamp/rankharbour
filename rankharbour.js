/* ================================================================
   RankHarbour — rankharbour.js
   ================================================================ */
(function () {
  'use strict';

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── HEADER ── */
  const header = document.querySelector('.rh-header');
  if (header) {
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 24);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ── MOBILE NAV ── */
  const menuBtn  = document.getElementById('rh-menu-btn');
  const mobileNav = document.getElementById('rh-mobile-nav');
  let lastFocus = null;

  if (menuBtn && mobileNav) {
    menuBtn.addEventListener('click', () => {
      const open = menuBtn.getAttribute('aria-expanded') === 'true';
      if (open) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') {
        closeMenu();
      }
    });

    mobileNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });
  }

  function openMenu() {
    lastFocus = document.activeElement;
    menuBtn.setAttribute('aria-expanded', 'true');
    mobileNav.classList.add('open');
    document.body.style.overflow = 'hidden';
    const firstLink = mobileNav.querySelector('a, button');
    if (firstLink) firstLink.focus();
  }

  function closeMenu() {
    menuBtn.setAttribute('aria-expanded', 'false');
    mobileNav.classList.remove('open');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  /* ── HERO ENTRANCE ANIMATION ── */
  if (!prefersReduced) {
    const eyebrow   = document.querySelector('.rh-hero__eyebrow');
    const lines     = document.querySelectorAll('.rh-hero__headline .line');
    const para      = document.querySelector('.rh-hero__para');
    const actions   = document.querySelector('.rh-hero__actions');
    const annotation = document.querySelector('.rh-hero__annotation');

    function fadeIn(el, delay) {
      if (!el) return;
      setTimeout(() => {
        el.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, delay);
    }

    // Stagger: eyebrow → lines → para → actions → annotation
    let t = 150;
    fadeIn(eyebrow, t);
    lines.forEach((line, i) => {
      t += 130;
      fadeIn(line, t);
    });
    t += 140;
    fadeIn(para, t);
    t += 120;
    fadeIn(actions, t);
    t += 140;
    fadeIn(annotation, t);
  } else {
    // Make everything immediately visible
    document.querySelectorAll(
      '.rh-hero__eyebrow, .rh-hero__headline .line, .rh-hero__para, .rh-hero__actions, .rh-hero__annotation'
    ).forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }

  /* ── HERO PARALLAX ── */
  if (!prefersReduced) {
    const heroBg = document.querySelector('.rh-hero__bg');
    if (heroBg) {
      let ticking = false;
      window.addEventListener('scroll', () => {
        if (!ticking) {
          requestAnimationFrame(() => {
            const scrolled = window.scrollY;
            const max = document.querySelector('.rh-hero').offsetHeight;
            if (scrolled < max) {
              const pct = scrolled / max;
              heroBg.style.transform = `scale(1.04) translateY(${pct * 5}%)`;
            }
            ticking = false;
          });
          ticking = true;
        }
      }, { passive: true });
    }
  }

  /* ── APPROACH TABS ── */
  const tabs   = document.querySelectorAll('.rh-approach__tab');
  const panels = document.querySelectorAll('.rh-approach__panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.panel;
      tabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      panels.forEach((p) => {
        p.classList.remove('active');
        p.hidden = true;
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(target);
      if (panel) {
        panel.classList.add('active');
        panel.hidden = false;
      }
    });

    // Keyboard left/right
    tab.addEventListener('keydown', (e) => {
      const tabList = Array.from(tabs);
      const idx = tabList.indexOf(tab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        tabList[(idx + 1) % tabList.length].click();
        tabList[(idx + 1) % tabList.length].focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        tabList[(idx - 1 + tabList.length) % tabList.length].click();
        tabList[(idx - 1 + tabList.length) % tabList.length].focus();
      }
    });
  });

  /* ── SCROLL REVEAL (Intersection Observer) ── */
  if (!prefersReduced && 'IntersectionObserver' in window) {
    const revealItems = document.querySelectorAll('.rh-reveal');
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('rh-visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealItems.forEach((el) => revealObserver.observe(el));
  } else {
    // If no IntersectionObserver or reduced motion, show all
    document.querySelectorAll('.rh-reveal').forEach((el) => {
      el.classList.add('rh-visible');
    });
  }

  /* ── CONTACT FORM ── */
  const form = document.getElementById('rh-contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const result = document.getElementById('rh-form-result');
      if (result) {
        result.classList.add('visible');
        form.querySelector('.rh-form__submit').disabled = true;
        form.querySelector('.rh-form__submit').textContent = 'Submitted';
        result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  /* ── SMOOTH ANCHOR SCROLL with header offset ── */
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      const offset = header ? header.offsetHeight : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - offset - 12;
      window.scrollTo({ top, behavior: prefersReduced ? 'auto' : 'smooth' });
    });
  });

})();

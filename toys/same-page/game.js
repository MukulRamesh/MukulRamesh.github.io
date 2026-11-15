(() => {
  'use strict';

  const DATA_URL = 'data.json';
  const WORDS = [
    'copper', 'mango', 'otter', 'willow', 'ember', 'harbor', 'cobalt',
    'saffron', 'meadow', 'quartz', 'nimbus', 'fable', 'juniper', 'orchid',
    'pebble', 'raven', 'sable', 'tundra', 'velvet', 'walnut', 'yarrow',
    'zephyr', 'amber', 'basil', 'cedar', 'dahlia', 'flint', 'garnet',
    'hazel', 'indigo', 'jade', 'kelp'
  ];

  const app = document.getElementById('sp-app');
  let dataset = null;
  let puzzles = null;
  let revealArmed = false;

  // --- small DOM helpers -------------------------------------------------

  function appendChildren(node, children) {
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      if (typeof child === 'string' || typeof child === 'number') {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') {
        node.className = value;
      } else if (key === 'text') {
        node.textContent = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    }
    appendChildren(node, children);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setApp(...children) {
    clear(app);
    appendChildren(app, children);
  }

  function card(...children) {
    return el('div', { class: 'sp-card' }, ...children);
  }

  function poolLabel(pool) {
    return pool === 'evergreen' ? 'Evergreen' : 'Trending';
  }

  // --- data --------------------------------------------------------------

  async function loadData() {
    const response = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`data.json returned ${response.status}`);
    dataset = await response.json();
    if (!dataset || !Array.isArray(dataset.parents)) {
      throw new Error('data.json is missing its parents list');
    }
    puzzles = [];
    for (const parent of dataset.parents) {
      for (const pair of parent.pairs || []) {
        puzzles.push({
          parent: parent.title,
          pool: parent.pool,
          one: pair.one,
          two: pair.two
        });
      }
    }
    if (!puzzles.length) throw new Error('data.json has no puzzles');
  }

  function namesFor(item) {
    if (!item) return [];
    return Array.isArray(item.answers) && item.answers.length
      ? item.answers
      : [item.title, item.display].filter(Boolean);
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/^the\s+/, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function matches(guess, item) {
    const normalized = normalize(guess);
    if (!normalized) return false;
    return namesFor(item).some(answer => normalize(answer) === normalized);
  }

  // --- seed + URL --------------------------------------------------------

  function parseSeed(seed) {
    const match = /-(\d+)$/.exec(seed || '');
    if (!match) return null;
    const index = Number(match[1]);
    return Number.isSafeInteger(index) ? index : null;
  }

  function randomSeed() {
    const index = Math.floor(Math.random() * puzzles.length);
    const first = WORDS[Math.floor(Math.random() * WORDS.length)];
    const second = WORDS[Math.floor(Math.random() * WORDS.length)];
    return `${first}-${second}-${String(index).padStart(4, '0')}`;
  }

  function gameUrl(seed, player) {
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(dataset.version));
    url.searchParams.set('seed', seed);
    url.searchParams.set('p', String(player));
    return url;
  }

  function setGameUrl(seed, player) {
    window.history.replaceState(null, '', gameUrl(seed, player).href);
  }

  function getParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      v: params.get('v'),
      seed: params.get('seed'),
      p: params.get('p')
    };
  }

  // --- views -------------------------------------------------------------

  function renderLanding() {
    revealArmed = false;
    setApp(
      card(
        el('p', { class: 'sp-kicker', text: 'A two-player Wikipedia guessing game' }),
        el('h2', { class: 'sp-heading', text: 'Two players. One article. Two secret names.' }),
        el('p', {
          class: 'sp-line',
          text: 'Start a game and send the second link to a friend. Each of you sees the other player\'s name — and has to work out which name is yours.'
        }),
        el('div', { class: 'sp-actions' },
          el('button', { class: 'sp-btn', type: 'button', onclick: startNewGame }, 'Start a game')
        ),
        el('p', { class: 'sp-small sp-mt', text: 'You\'ll be Player 1. You\'ll get a link to send to Player 2.' })
      )
    );
  }

  function renderConfirm(seed, puzzle) {
    revealArmed = false;
    setApp(
      card(
        el('p', { class: 'sp-kicker', text: 'You\'ve been invited' }),
        el('h2', { class: 'sp-heading', text: 'You are Player 2' }),
        el('p', {
          class: 'sp-line',
          text: 'Make sure you\'re not the person who started this game. Opening the wrong link shows your own name.'
        }),
        el('div', { class: 'sp-actions' },
          el('button', {
            class: 'sp-btn',
            type: 'button',
            onclick: () => renderGame(seed, '2', puzzle)
          }, 'Play'),
          el('button', {
            class: 'sp-btn sp-btn-secondary',
            type: 'button',
            onclick: startNewGame
          }, 'Start a new game instead')
        )
      )
    );
  }

  function renderGame(seed, player, puzzle) {
    revealArmed = false;
    const own = player === '1' ? puzzle.one : puzzle.two;
    const partner = player === '1' ? puzzle.two : puzzle.one;
    const status = el('p', { class: 'sp-status', role: 'status', 'aria-live': 'polite' });

    const input = el('input', {
      class: 'sp-input',
      id: 'sp-guess',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      placeholder: 'Type your name',
      'aria-label': 'What\'s your name?'
    });

    const form = el('form', {
      class: 'sp-form',
      onsubmit: event => {
        event.preventDefault();
        submitGuess(player, puzzle, input, status);
      }
    },
      el('label', { class: 'sp-label', for: 'sp-guess', text: 'What\'s your name?' }),
      el('div', { class: 'sp-inputrow' },
        input,
        el('button', { class: 'sp-btn', type: 'submit' }, 'Guess')
      )
    );

    const reveal = el('button', {
      class: 'sp-btn sp-btn-secondary',
      type: 'button',
      onclick: () => armReveal(player, puzzle, reveal, status)
    }, 'Reveal my name');

    const children = [
      el('p', { class: 'sp-kicker' },
        `You are Player ${player}`,
        el('span', { class: 'sp-tag', text: poolLabel(puzzle.pool) })
      ),
      el('p', { class: 'sp-line' },
        'Your partner\'s name is "',
        el('strong', { class: 'sp-name', text: partner.display || partner.title }),
        '".'
      ),
      el('p', { class: 'sp-line', text: 'Ask your partner questions to figure out what your own name is.' }),
      el('p', { class: 'sp-hint' },
        'Everyone\'s name is somehow related by the word "',
        el('strong', { class: 'sp-name', text: puzzle.parent }),
        '".'
      ),
      form,
      status,
      el('div', { class: 'sp-actions' }, reveal)
    ];

    if (player === '1') {
      const partnerUrl = gameUrl(seed, 2).href;
      const linkInput = el('input', {
        class: 'sp-linkinput',
        type: 'text',
        readonly: true,
        value: partnerUrl,
        'aria-label': 'Player 2 link'
      });
      const copyStatus = el('span', { class: 'sp-small', role: 'status', 'aria-live': 'polite' });

      children.push(
        el('div', { class: 'sp-partner' },
          el('h2', { class: 'sp-subheading', text: 'Send this to Player 2' }),
          el('p', {
            class: 'sp-small',
            text: 'Don\'t open this link yourself — it would show you your own name.'
          }),
          el('div', { class: 'sp-linkrow' },
            linkInput,
            el('button', {
              class: 'sp-copy',
              type: 'button',
              onclick: async () => {
                const copied = await copyText(partnerUrl);
                copyStatus.textContent = copied ? 'Copied.' : 'Select the link and copy it.';
              }
            }, 'Copy link')
          ),
          copyStatus
        )
      );
    }

    setApp(card(...children));
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
      input.focus();
    }
  }

  function submitGuess(player, puzzle, input, status) {
    const guess = input.value.trim();
    if (!guess) {
      status.className = 'sp-status';
      status.textContent = 'Type a name first.';
      return;
    }

    const own = player === '1' ? puzzle.one : puzzle.two;
    const partner = player === '1' ? puzzle.two : puzzle.one;

    if (matches(guess, own)) {
      renderResult(player, puzzle, 'correct');
      return;
    }
    if (matches(guess, partner)) {
      status.className = 'sp-status error';
      status.textContent = 'That\'s your partner\'s name — you\'re looking for your own.';
      return;
    }
    status.className = 'sp-status error';
    status.textContent = 'That\'s not your name — keep asking.';
  }

  function armReveal(player, puzzle, button, status) {
    if (!revealArmed) {
      revealArmed = true;
      button.textContent = 'Tap again to reveal';
      status.className = 'sp-status';
      status.textContent = 'This ends your round and shows both names.';
      return;
    }
    renderResult(player, puzzle, 'reveal');
  }

  function renderResult(player, puzzle, mode) {
    revealArmed = false;
    const own = player === '1' ? puzzle.one : puzzle.two;
    const partner = player === '1' ? puzzle.two : puzzle.one;
    const heading = mode === 'correct' ? 'You found your name.' : 'Your name was...';

    setApp(
      card(
        el('p', { class: 'sp-kicker' },
          mode === 'correct' ? 'You got it' : 'Round revealed',
          el('span', { class: 'sp-tag', text: poolLabel(puzzle.pool) })
        ),
        el('h2', { class: 'sp-heading', text: heading }),
        el('p', { class: 'sp-line' },
          'You are "',
          el('strong', { class: 'sp-name', text: own.display || own.title }),
          '".'
        ),
        el('p', { class: 'sp-line' },
          'Your partner is "',
          el('strong', { class: 'sp-name', text: partner.display || partner.title }),
          '".'
        ),
        el('p', { class: 'sp-hint' },
          'You\'re both linked from "',
          el('strong', { class: 'sp-name', text: puzzle.parent }),
          '".'
        ),
        el('p', { class: 'sp-small sp-mt', text: 'The race is social — tell your partner how you did.' }),
        el('div', { class: 'sp-actions' },
          el('button', { class: 'sp-btn', type: 'button', onclick: startNewGame }, 'New game')
        )
      )
    );
  }

  function renderError(title, detail) {
    const actions = [];
    if (puzzles && puzzles.length) {
      actions.push(el('button', { class: 'sp-btn', type: 'button', onclick: startNewGame }, 'Start a new game'));
    } else {
      actions.push(el('button', { class: 'sp-btn', type: 'button', onclick: () => window.location.reload() }, 'Reload'));
    }

    setApp(
      card(
        el('p', { class: 'sp-kicker', text: 'Something went wrong' }),
        el('h2', { class: 'sp-heading', text: title }),
        el('p', { class: 'sp-line', text: detail }),
        el('div', { class: 'sp-actions' }, ...actions)
      )
    );
  }

  // --- actions -----------------------------------------------------------

  function startNewGame() {
    const seed = randomSeed();
    const index = parseSeed(seed);
    setGameUrl(seed, 1);
    renderGame(seed, '1', puzzles[index]);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // Fall through to the textarea fallback.
    }

    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    } catch (error) {
      return false;
    }
  }

  // --- boot --------------------------------------------------------------

  async function init() {
    setApp(el('p', { class: 'sp-loading', text: 'Dealing the cards…' }));

    try {
      await loadData();
    } catch (error) {
      console.error(error);
      renderError(
        'Could not load the puzzle data.',
        'Try refreshing the page. If you opened this file directly, serve the site over HTTP instead.'
      );
      return;
    }

    const params = getParams();
    if (!params.seed) {
      renderLanding();
      return;
    }
    if (params.v !== String(dataset.version)) {
      renderError(
        'This link is from an older puzzle set.',
        'Start a new game to get a fresh pair of links.'
      );
      return;
    }

    const index = parseSeed(params.seed);
    if (index === null || index < 0 || index >= puzzles.length) {
      renderError(
        'That game link does not match this puzzle set.',
        'Start a new game to get a fresh pair of links.'
      );
      return;
    }
    if (params.p !== '1' && params.p !== '2') {
      renderError(
        'That game link is missing its player.',
        'Start a new game to get a fresh pair of links.'
      );
      return;
    }

    const puzzle = puzzles[index];
    if (params.p === '2') {
      renderConfirm(params.seed, puzzle);
    } else {
      renderGame(params.seed, '1', puzzle);
    }
  }

  init();
})();

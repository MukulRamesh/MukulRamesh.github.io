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
  let hintTimer = null;
  let selectedCategory = '';

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

  function poolTag(pool) {
    const evergreen = pool === 'evergreen';
    const label = evergreen ? 'Evergreen' : 'Trending';
    const explanation = evergreen
      ? 'Evergreen: the parent article comes from the curated Vital Articles core list — stable, well-known topics.'
      : 'Trending: the parent article comes from the filtered monthly pageviews top 1,000 — what people were reading that month.';

    return el('span', {
      class: 'sp-tag',
      tabindex: '0',
      'aria-label': explanation,
      'data-tip': explanation,
      text: label
    });
  }

  const CATEGORY_LABELS = {
    'History': 'History',
    'Geography': 'Geography',
    'People': 'People',
    'Arts': 'Arts',
    'Physical sciences': 'Physical sciences',
    'Biology and health sciences': 'Biology & health',
    'Society and social sciences': 'Society',
    'Technology': 'Technology',
    'Philosophy and religion': 'Philosophy & religion',
    'Everyday life': 'Everyday life',
    'Mathematics': 'Mathematics',
    'Trending': 'Trending',
    'Other': 'Other'
  };
  const CATEGORY_ORDER = [
    'History', 'Geography', 'People', 'Arts', 'Physical sciences',
    'Biology and health sciences', 'Society and social sciences',
    'Technology', 'Philosophy and religion', 'Everyday life',
    'Mathematics', 'Trending', 'Other'
  ];

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || category;
  }

  function categoryChoices() {
    const present = new Set(puzzles.map(puzzle => puzzle.category).filter(Boolean));
    const ordered = CATEGORY_ORDER.filter(category => present.has(category));
    const extras = [...present]
      .filter(category => !CATEGORY_ORDER.includes(category))
      .sort();
    return [...ordered, ...extras];
  }

  function categoryTag(puzzle) {
    const category = puzzle.category || '';
    if (!category) return null;
    if (puzzle.pool === 'trending' && category === 'Trending') return null;
    return el('span', { class: 'sp-cat', text: categoryLabel(category) });
  }

  function newGameControl() {
    const select = el('select', {
      class: 'sp-select',
      id: 'sp-category-select',
      'aria-label': 'Category for the new game'
    });
    select.appendChild(el('option', { value: '', text: 'Random' }));
    for (const category of categoryChoices()) {
      select.appendChild(el('option', {
        value: category,
        text: categoryLabel(category)
      }));
    }
    select.value = selectedCategory;
    select.addEventListener('change', () => {
      selectedCategory = select.value;
    });

    const button = el('button', {
      class: 'sp-btn sp-btn-secondary',
      type: 'button',
      onclick: () => startNewGame(select.value)
    }, 'New game');

    return el('div', { class: 'sp-newgame' },
      el('label', {
        class: 'sp-select-label',
        for: 'sp-category-select',
        text: 'Category'
      }),
      select,
      button
    );
  }

  function clearHintTimer() {
    if (hintTimer) {
      clearInterval(hintTimer);
      hintTimer = null;
    }
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
          category: parent.category || '',
          hint: parent.hint || '',
          one: pair.one,
          two: pair.two
        });
      }
    }
    if (!puzzles.length) throw new Error('data.json has no puzzles');
  }

  // --- seed + URL --------------------------------------------------------

  function parseSeed(seed) {
    const match = /-(\d+)$/.exec(seed || '');
    if (!match) return null;
    const index = Number(match[1]);
    return Number.isSafeInteger(index) ? index : null;
  }

  function randomSeed(category) {
    const choices = [];
    puzzles.forEach((puzzle, index) => {
      if (!category || puzzle.category === category) choices.push(index);
    });
    const indices = choices.length ? choices : puzzles.map((_, index) => index);
    const index = indices[Math.floor(Math.random() * indices.length)];
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

  // --- context hints -----------------------------------------------------

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function splitSentences(text) {
    const parts = text.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g);
    if (!parts) return [];

    const merged = [];
    for (const part of parts) {
      const sentence = part.trim();
      if (!sentence) continue;
      const previous = merged.length ? merged[merged.length - 1] : '';
      // Keep initials and dotted abbreviations ("Michael J.", "U.S.") with
      // the sentence they belong to.
      if (previous && /(?:^|[\s.])[A-Z]\.$/.test(previous)) {
        merged[merged.length - 1] = `${previous} ${sentence}`;
      } else {
        merged.push(sentence);
      }
    }
    return merged;
  }

  function redactOwnName(text, own) {
    let out = text || '';
    const terms = [own.title, own.display, own.anchor]
      .filter(term => term && term.length >= 3);

    for (const term of terms) {
      const pattern = new RegExp(
        `(?<![\\w])${escapeRegExp(term)}(?![\\w])`,
        'gi'
      );
      out = out.replace(pattern, '_____');
    }
    return out;
  }

  function contextPanel(puzzle, own) {
    const text = redactOwnName(puzzle.hint, own);
    const sentences = splitSentences(text);
    if (!sentences.length) return null;

    let shown = 1;
    const body = el('p', { class: 'sp-context-text', text: sentences[0] });
    const status = el('p', {
      class: 'sp-context-status',
      text: sentences.length > 1 ? 'New context appears every 30 seconds.' : 'The article context is fully revealed.'
    });
    let button = null;

    const revealNext = () => {
      if (shown >= sentences.length) {
        clearHintTimer();
        return;
      }
      shown += 1;
      body.textContent = sentences.slice(0, shown).join(' ');
      if (shown >= sentences.length) {
        clearHintTimer();
        if (button) button.disabled = true;
        status.textContent = 'The article context is fully revealed.';
      }
    };

    if (sentences.length > 1) {
      button = el('button', {
        class: 'sp-context-btn',
        type: 'button',
        onclick: revealNext
      }, 'More context');
      hintTimer = setInterval(revealNext, 30000);
    }

    return el('div', { class: 'sp-context' },
      el('p', { class: 'sp-context-title', text: 'Article context' }),
      body,
      button ? el('div', { class: 'sp-context-actions' }, button) : null,
      status
    );
  }

  // --- views -------------------------------------------------------------

  function renderLanding() {
    clearHintTimer();
    revealArmed = false;
    setApp(
      card(
        el('p', { class: 'sp-kicker', text: 'A two-player guessing game' }),
        el('h2', { class: 'sp-heading', text: 'Two players. One article. Two secret names.' }),
        el('p', {
          class: 'sp-line',
          text: 'Pick a category, then start a game and send the second link to a friend. Each of you sees the other player\'s name — and has to work out which name is yours.'
        }),
        el('div', { class: 'sp-actions' }, newGameControl()),
        el('p', {
          class: 'sp-small sp-mt',
          text: 'You\'ll be Player 1. You\'ll get a link to send to Player 2.'
        })
      )
    );
  }

  function renderConfirm(seed, puzzle) {
    clearHintTimer();
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
            onclick: () => renderLanding()
          }, 'Start a new game instead')
        )
      )
    );
  }

  function renderGame(seed, player, puzzle) {
    clearHintTimer();
    revealArmed = false;
    const own = player === '1' ? puzzle.one : puzzle.two;
    const partner = player === '1' ? puzzle.two : puzzle.one;

    const reveal = el('button', {
      class: 'sp-btn sp-btn-secondary',
      type: 'button',
      onclick: () => armReveal(player, puzzle, reveal)
    }, 'Reveal my name');

    const children = [
      el('p', { class: 'sp-kicker' },
        `You are Player ${player}`,
        poolTag(puzzle.pool),
        categoryTag(puzzle)
      ),
      el('p', { class: 'sp-line' },
        'Your partner\'s name is "',
        el('strong', { class: 'sp-name', text: partner.display || partner.title }),
        '".'
      ),
      el('p', {
        class: 'sp-line',
        text: 'Ask your partner yes/no questions to work out your own name.'
      }),
      el('p', { class: 'sp-hint' },
        'Everyone\'s name is somehow related by the word "',
        el('strong', { class: 'sp-name', text: puzzle.parent }),
        '".'
      )
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
            text: 'Don\'t open this link yourself. It would show you your own name.'
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

    children.push(el('div', { class: 'sp-actions' }, newGameControl(), reveal));

    const context = contextPanel(puzzle, own);
    if (context) children.push(context);

    setApp(card(...children));
  }

  function armReveal(player, puzzle, button) {
    if (!revealArmed) {
      revealArmed = true;
      button.textContent = 'Tap again to reveal';
      return;
    }
    renderResult(player, puzzle);
  }

  function renderResult(player, puzzle) {
    clearHintTimer();
    revealArmed = false;
    const own = player === '1' ? puzzle.one : puzzle.two;
    const partner = player === '1' ? puzzle.two : puzzle.one;

    setApp(
      card(
        el('p', { class: 'sp-kicker' },
          'Round revealed',
          poolTag(puzzle.pool),
          categoryTag(puzzle)
        ),
        el('h2', { class: 'sp-heading', text: 'Your name was...' }),
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
        el('p', {
          class: 'sp-small sp-mt',
          text: 'The race is social. Tell your partner how you did.'
        }),
        el('div', { class: 'sp-actions' }, newGameControl())
      )
    );
  }

  function renderError(title, detail) {
    clearHintTimer();
    const actions = [];
    if (puzzles && puzzles.length) {
      actions.push(el('button', { class: 'sp-btn', type: 'button', onclick: () => renderLanding() }, 'Start a new game'));
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

  function startNewGame(category = selectedCategory) {
    selectedCategory = category || '';
    const seed = randomSeed(selectedCategory);
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

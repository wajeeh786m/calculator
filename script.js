/* =====================================================================
   LUMEN CALCULATOR — SCRIPT
   Sections:
   1. Constants & DOM refs      5. HistoryManager
   2. Utilities                 6. SoundPlayer
   3. CalculatorEngine          7. Event Wiring
   4. UIController               8. Init
   ===================================================================== */
(() => {
  'use strict';

  /* ================= 1. CONSTANTS & DOM REFS ================= */
  const MAX_DIGITS = 15;                 // digits before switching to scientific notation
  const HISTORY_KEY = 'lumen.history';
  const THEME_KEY = 'lumen.theme';
  const SOUND_KEY = 'lumen.sound';
  const STATE_KEY = 'lumen.state';

  const dom = {
    body: document.body,
    calculator: document.getElementById('calculator'),
    expressionEl: document.getElementById('expression'),
    resultEl: document.getElementById('result'),
    keypad: document.getElementById('keypad'),
    copyBtn: document.getElementById('copyBtn'),
    copyTip: document.getElementById('copyTip'),
    soundToggle: document.getElementById('soundToggle'),
    themeToggle: document.getElementById('themeToggle'),
    historyToggle: document.getElementById('historyToggle'),
    historyPanel: document.getElementById('historyPanel'),
    historyList: document.getElementById('historyList'),
    clearHistoryBtn: document.getElementById('clearHistory'),
  };

  /* ================= 2. UTILITIES ================= */
  const Utils = {
    /** Format a finite number for display: thousands separators, trimmed decimals, scientific notation for extremes. */
    formatNumber(value) {
      if (value === null || value === undefined || Number.isNaN(value)) return 'Error';
      if (!Number.isFinite(value)) return 'Error';

      const abs = Math.abs(value);

      // Extremely large or extremely small (but non-zero) -> scientific notation
      if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
        return value.toExponential(6).replace(/e\+?(-?)(\d+)/, 'e$1$2');
      }

      // Round to avoid floating point noise, keep up to 10 decimal places
      const rounded = Math.round((value + Number.EPSILON) * 1e10) / 1e10;

      const [intPart, decPart] = rounded.toString().split('.');
      const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

      if (!decPart) return withSeparators;

      // Cap total significant digits for very long decimals
      const maxDecimals = Math.max(0, MAX_DIGITS - intPart.replace('-', '').length);
      const trimmedDec = decPart.slice(0, maxDecimals);

      return trimmedDec ? `${withSeparators}.${trimmedDec}` : withSeparators;
    },

    /** Parse a formatted display string (with commas) back into a float. */
    parseFormatted(str) {
      return parseFloat(String(str).replace(/,/g, ''));
    },

    debounce(fn, wait) {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
      };
    },
  };

  /* ================= 3. CALCULATOR ENGINE (pure logic, no DOM) ================= */
  class CalculatorEngine {
    constructor() {
      this.reset();
    }

    reset() {
      this.currentValue = '0';   // string being typed/displayed
      this.previousValue = null; // number
      this.operator = null;      // '+', '-', '*', '/'
      this.expression = '';      // human-readable trail, e.g. "12 + 4"
      this.overwrite = true;     // next digit press replaces currentValue
      this.justEvaluated = false;
      this.error = false;
    }

    inputDigit(digit) {
      if (this.error) this.reset();

      if (this.overwrite) {
        this.currentValue = digit === '0' && false ? '0' : digit;
        this.overwrite = false;
      } else {
        if (this.currentValue.replace('-', '').replace('.', '').length >= MAX_DIGITS) return;
        this.currentValue = this.currentValue === '0' ? digit : this.currentValue + digit;
      }
      this.justEvaluated = false;
    }

    inputDecimal() {
      if (this.error) this.reset();

      if (this.overwrite) {
        this.currentValue = '0.';
        this.overwrite = false;
        return;
      }
      if (!this.currentValue.includes('.')) {
        this.currentValue += '.';
      }
      this.justEvaluated = false;
    }

    toggleSign() {
      if (this.error) return;
      if (this.currentValue === '0') return;
      this.currentValue = this.currentValue.startsWith('-')
        ? this.currentValue.slice(1)
        : `-${this.currentValue}`;
    }

    inputPercent() {
      if (this.error) return;
      const value = parseFloat(this.currentValue);
      if (Number.isNaN(value)) return;

      let result;
      if (this.operator && this.previousValue !== null) {
        // Percentage relative to the previous operand (e.g. 200 + 10% = 200 + 20)
        result = (this.previousValue * value) / 100;
      } else {
        result = value / 100;
      }
      this.currentValue = this.trimFloat(result);
      this.overwrite = true;
    }

    deleteLast() {
      if (this.error) {
        this.reset();
        return;
      }
      if (this.overwrite) return;
      this.currentValue = this.currentValue.length > 1 ? this.currentValue.slice(0, -1) : '0';
      if (this.currentValue === '-') this.currentValue = '0';
    }

    setOperator(op) {
      if (this.error) this.reset();

      const inputValue = parseFloat(this.currentValue);

      if (this.operator && !this.overwrite) {
        // Chain: evaluate what we have so far first
        const result = this.compute();
        if (result === null) return; // error already flagged
        this.previousValue = result;
        this.currentValue = this.trimFloat(result);
      } else {
        this.previousValue = inputValue;
      }

      this.operator = op;
      this.overwrite = true;
      this.justEvaluated = false;
      this.expression = `${Utils.formatNumber(this.previousValue)} ${this.operatorSymbol(op)}`;
    }

    equals() {
      if (this.error) return null;
      if (this.operator === null || this.previousValue === null) return null;

      const before = `${Utils.formatNumber(this.previousValue)} ${this.operatorSymbol(this.operator)} ${Utils.formatNumber(parseFloat(this.currentValue))}`;
      const result = this.compute();
      if (result === null) return null;

      this.expression = `${before} =`;
      this.currentValue = this.trimFloat(result);
      this.previousValue = null;
      this.operator = null;
      this.overwrite = true;
      this.justEvaluated = true;

      return { expression: before, result: this.currentValue };
    }

    compute() {
      const a = this.previousValue;
      const b = parseFloat(this.currentValue);
      let result;

      switch (this.operator) {
        case '+': result = a + b; break;
        case '-': result = a - b; break;
        case '*': result = a * b; break;
        case '/':
          if (b === 0) {
            this.flagError();
            return null;
          }
          result = a / b;
          break;
        default:
          return null;
      }

      if (!Number.isFinite(result)) {
        this.flagError();
        return null;
      }

      return result;
    }

    flagError() {
      this.error = true;
      this.currentValue = 'Error';
      this.previousValue = null;
      this.operator = null;
      this.overwrite = true;
    }

    clear() {
      this.reset();
    }

    trimFloat(num) {
      // Keep enough precision internally, formatting handles display trimming
      return String(Math.round((num + Number.EPSILON) * 1e10) / 1e10);
    }

    operatorSymbol(op) {
      switch (op) {
        case '+': return '+';
        case '-': return '\u2212';
        case '*': return '\u00d7';
        case '/': return '\u00f7';
        default: return '';
      }
    }

    getDisplayValue() {
      if (this.error) return 'Error';
      return Utils.formatNumber(parseFloat(this.currentValue));
    }

    getExpression() {
      if (this.operator && !this.justEvaluated) {
        return `${Utils.formatNumber(this.previousValue)} ${this.operatorSymbol(this.operator)}`;
      }
      return this.expression;
    }

    /** Serialize minimal state for localStorage persistence across refresh. */
    serialize() {
      return {
        currentValue: this.currentValue,
        previousValue: this.previousValue,
        operator: this.operator,
        expression: this.expression,
        overwrite: this.overwrite,
        justEvaluated: this.justEvaluated,
        error: this.error,
      };
    }

    restore(state) {
      if (!state) return;
      Object.assign(this, state);
    }
  }

  /* ================= 4. UI CONTROLLER ================= */
  class UIController {
    constructor(engine, sound, history) {
      this.engine = engine;
      this.sound = sound;
      this.history = history;
      this.copyTipTimer = null;
    }

    render() {
      dom.resultEl.textContent = this.engine.getDisplayValue();
      dom.expressionEl.textContent = this.engine.getExpression() || '\u00a0';
      dom.resultEl.classList.toggle('error-text', this.engine.error);

      // Highlight active operator key
      dom.keypad.querySelectorAll('.key--op').forEach((btn) => {
        btn.classList.toggle('active-op', btn.dataset.action === this.opNameFor(this.engine.operator) && this.engine.overwrite);
      });

      this.persistState();
    }

    opNameFor(op) {
      return { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide' }[op] || null;
    }

    opSymbolFor(action) {
      return { add: '+', subtract: '-', multiply: '*', divide: '/' }[action];
    }

    pulseResult() {
      dom.resultEl.classList.remove('pulse');
      // Force reflow to restart animation
      void dom.resultEl.offsetWidth;
      dom.resultEl.classList.add('pulse');
    }

    shakeError() {
      dom.calculator.classList.remove('shake');
      void dom.calculator.offsetWidth;
      dom.calculator.classList.add('shake');
      setTimeout(() => dom.calculator.classList.remove('shake'), 500);
    }

    handleAction(action, sourceEl) {
      const engine = this.engine;

      switch (action) {
        case 'clear':
          engine.clear();
          this.sound.play('clear');
          break;

        case 'delete':
          engine.deleteLast();
          this.sound.play('tap');
          break;

        case 'percent':
          engine.inputPercent();
          this.sound.play('tap');
          break;

        case 'sign':
          engine.toggleSign();
          this.sound.play('tap');
          break;

        case 'decimal':
          engine.inputDecimal();
          this.sound.play('tap');
          break;

        case 'add':
        case 'subtract':
        case 'multiply':
        case 'divide':
          engine.setOperator(this.opSymbolFor(action));
          this.sound.play('operator');
          if (engine.error) this.onError();
          break;

        case 'equals': {
          const before = engine.error;
          const outcome = engine.equals();
          if (engine.error && !before) {
            this.onError();
          } else if (outcome) {
            this.sound.play('equals');
            this.pulseResult();
            this.history.add(outcome.expression, engine.getDisplayValue());
          }
          break;
        }

        default:
          return;
      }

      this.render();
    }

    handleDigit(digit) {
      this.engine.inputDigit(digit);
      this.sound.play('tap');
      this.render();
    }

    onError() {
      this.shakeError();
      this.sound.play('error');
    }

    async copyResult() {
      const text = this.engine.error ? '' : this.engine.getDisplayValue().replace(/,/g, '');
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        // Fallback for environments without clipboard API access
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        try { document.execCommand('copy'); } catch (e) { /* no-op */ }
        document.body.removeChild(temp);
      }

      dom.copyTip.classList.add('show');
      clearTimeout(this.copyTipTimer);
      this.copyTipTimer = setTimeout(() => dom.copyTip.classList.remove('show'), 1200);
    }

    persistState() {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify(this.engine.serialize()));
      } catch (err) {
        /* localStorage unavailable — fail silently, calculator still works */
      }
    }

    restoreState() {
      try {
        const raw = localStorage.getItem(STATE_KEY);
        if (raw) this.engine.restore(JSON.parse(raw));
      } catch (err) {
        /* ignore corrupt state */
      }
      this.render();
    }
  }

  /* ================= 5. HISTORY MANAGER ================= */
  class HistoryManager {
    constructor() {
      this.items = this.load();
    }

    load() {
      try {
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (err) {
        return [];
      }
    }

    save() {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(this.items.slice(0, 50)));
      } catch (err) {
        /* storage full or unavailable — history just won't persist */
      }
    }

    add(expression, result) {
      this.items.unshift({ expression, result, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
      this.items = this.items.slice(0, 50);
      this.save();
      this.renderList();
    }

    clear() {
      this.items = [];
      this.save();
      this.renderList();
    }

    renderList() {
      const hasItems = this.items.length > 0;
      dom.historyPanel.dataset.hasItems = String(hasItems);
      dom.historyList.innerHTML = '';

      this.items.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'history__item';
        li.style.animationDelay = `${Math.min(index, 8) * 35}ms`;
        li.dataset.result = item.result;
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');
        li.setAttribute('aria-label', `Reuse result ${item.result}`);

        const expr = document.createElement('div');
        expr.className = 'history__item-expr';
        expr.textContent = item.expression;

        const result = document.createElement('div');
        result.className = 'history__item-result';
        result.textContent = item.result;

        li.append(expr, result);
        dom.historyList.appendChild(li);
      });
    }
  }

  /* ================= 6. SOUND PLAYER ================= */
  class SoundPlayer {
    constructor() {
      this.enabled = this.loadPreference();
      this.ctx = null;
      this.updateToggleUI();
    }

    loadPreference() {
      try {
        const stored = localStorage.getItem(SOUND_KEY);
        return stored === null ? true : stored === 'true';
      } catch (err) {
        return true;
      }
    }

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    play(type) {
      if (!this.enabled) return;
      const ctx = this.ensureContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const presets = {
        tap:      { freq: 720, dur: 0.05, gainPeak: 0.05, type: 'sine' },
        operator: { freq: 540, dur: 0.07, gainPeak: 0.06, type: 'sine' },
        equals:   { freq: 880, dur: 0.12, gainPeak: 0.08, type: 'triangle' },
        clear:    { freq: 320, dur: 0.09, gainPeak: 0.06, type: 'sine' },
        error:    { freq: 160, dur: 0.18, gainPeak: 0.07, type: 'sawtooth' },
      };
      const p = presets[type] || presets.tap;

      osc.type = p.type;
      osc.frequency.setValueAtTime(p.freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(p.gainPeak, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.dur);

      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + p.dur + 0.02);
    }

    toggle() {
      this.enabled = !this.enabled;
      try { localStorage.setItem(SOUND_KEY, String(this.enabled)); } catch (err) { /* no-op */ }
      this.updateToggleUI();
      if (this.enabled) this.play('tap');
    }

    updateToggleUI() {
      dom.soundToggle.setAttribute('aria-pressed', String(this.enabled));
    }
  }

  /* ================= 7. THEME MANAGER ================= */
  const ThemeManager = {
    load() {
      let theme = 'dark';
      try {
        theme = localStorage.getItem(THEME_KEY) || 'dark';
      } catch (err) { /* default to dark */ }
      this.apply(theme);
    },

    apply(theme) {
      dom.body.dataset.theme = theme;
      dom.themeToggle.setAttribute('aria-pressed', String(theme === 'light'));
      try { localStorage.setItem(THEME_KEY, theme); } catch (err) { /* no-op */ }
    },

    toggle() {
      const next = dom.body.dataset.theme === 'light' ? 'dark' : 'light';
      this.apply(next);
    },
  };

  /* ================= 8. INIT & EVENT WIRING ================= */
  function init() {
    const engine = new CalculatorEngine();
    const sound = new SoundPlayer();
    const history = new HistoryManager();
    const ui = new UIController(engine, sound, history);

    ThemeManager.load();
    history.renderList();
    ui.restoreState();

    /* ---- Keypad: single delegated listener ---- */
    dom.keypad.addEventListener('click', (e) => {
      const btn = e.target.closest('.key');
      if (!btn) return;

      spawnRipple(btn, e);
      btn.classList.remove('pressed');
      void btn.offsetWidth;
      btn.classList.add('pressed');

      if (btn.dataset.num !== undefined) {
        ui.handleDigit(btn.dataset.num);
        return;
      }
      if (btn.dataset.action) {
        ui.handleAction(btn.dataset.action, btn);
      }
    });

    /* ---- Ripple effect on click ---- */
    function spawnRipple(btn, evt) {
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement('span');
      ripple.className = 'key__ripple';

      const originX = (evt.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2;
      const originY = (evt.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2;

      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${originX}px`;
      ripple.style.top = `${originY}px`;

      btn.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    }

    /* ---- Copy button ---- */
    dom.copyBtn.addEventListener('click', () => ui.copyResult());

    /* ---- Sound toggle ---- */
    dom.soundToggle.addEventListener('click', () => sound.toggle());

    /* ---- Theme toggle ---- */
    dom.themeToggle.addEventListener('click', () => ThemeManager.toggle());

    /* ---- History panel toggle ---- */
    dom.historyToggle.addEventListener('click', () => {
      const isOpen = dom.historyPanel.dataset.open === 'true';
      dom.historyPanel.dataset.open = String(!isOpen);
      dom.historyToggle.setAttribute('aria-pressed', String(!isOpen));
      dom.historyToggle.setAttribute('aria-expanded', String(!isOpen));
    });

    /* ---- History item click: recall result into display ---- */
    dom.historyList.addEventListener('click', (e) => {
      const item = e.target.closest('.history__item');
      if (!item) return;
      recallHistoryItem(item);
    });

    dom.historyList.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('.history__item');
      if (!item) return;
      e.preventDefault();
      recallHistoryItem(item);
    });

    function recallHistoryItem(item) {
      const value = Utils.parseFormatted(item.dataset.result);
      if (Number.isNaN(value)) return;
      engine.reset();
      engine.currentValue = String(value);
      engine.overwrite = true;
      ui.render();
      ui.pulseResult();
    }

    /* ---- Clear history ---- */
    dom.clearHistoryBtn.addEventListener('click', () => history.clear());

    /* ---- Keyboard support ---- */
    const keyActionMap = {
      '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide',
      'Enter': 'equals', '=': 'equals',
      'Escape': 'clear',
      'Backspace': 'delete', 'Delete': 'delete',
      '%': 'percent',
    };

    window.addEventListener('keydown', (e) => {
      // Avoid hijacking browser shortcuts (Cmd/Ctrl combos)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        flashKeyFor(`[data-num="${e.key}"]`);
        ui.handleDigit(e.key);
        return;
      }

      if (e.key === '.') {
        e.preventDefault();
        flashKeyFor('[data-action="decimal"]');
        ui.handleAction('decimal');
        return;
      }

      const action = keyActionMap[e.key];
      if (action) {
        e.preventDefault();
        flashKeyFor(`[data-action="${action}"]`);
        ui.handleAction(action);
      }
    });

    function flashKeyFor(selector) {
      const btn = dom.keypad.querySelector(selector);
      if (!btn) return;
      btn.classList.remove('pressed');
      void btn.offsetWidth;
      btn.classList.add('pressed');
    }

    /* ---- Persist state before unload as a safety net ---- */
    window.addEventListener('beforeunload', () => ui.persistState());
  }

  document.addEventListener('DOMContentLoaded', init);
})();

const RESOURCE_NAME = typeof GetParentResourceName !== "undefined" ? GetParentResourceName() : window.location.host;
const MAX_MACRO_SUGGESTIONS = 6;
const MESSAGE_HISTORY_LIMIT = 500;
const MESSAGE_ID_TTL_MS = 60000;
const SEND_REPEAT_GUARD_MS = 500;
const UI_SAVE_DEBOUNCE_MS = 220;
const INTERFACE_SCALE_STEP = 0.05;
const TEXT_SCALE_STEP = 0.05;
const INTERFACE_NAMES = ["radio", "chat", "macro"];
const THEME_PRESETS = {
  default: true,
  midnight: true,
  amber: true,
  ice: true
};

function postToResource(path, data) {
  return fetch(`https://${RESOURCE_NAME}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data || {})
  }).then((resp) => resp.json());
}

let currentPrimaryFreq = null;
let currentSecondaryFreq = null;
let activeFrequency = "primary";
let messageHistory = [];
let autoScrollEnabled = true;
let soundsEnabled = true;
let soundVolume = 0.3;
let visualizerIntervalId = null;
let freqCounts = {};
let freqConfigs = {};
let macroSets = { GlobalMacros: [] };
let userMacros = [];
let currentMacroCategory = "all";
let pendingInputResolver = null;
let pendingDeleteMacroId = null;
let deleteRequestPending = false;
let suggestionItems = [];
let suggestionIndex = -1;
let sendInFlight = false;
let lastSubmitSignature = "";
let lastSubmitAt = 0;
let settingsOpen = false;
let uiSaveTimer = null;
let layoutModeOpen = false;
let selectedLayoutInterface = "radio";
let themeRangeEnabled = false;
let dragState = null;
let layoutSnapshot = null;
let layoutVisibilitySnapshot = null;

const seenMessageIds = new Map();

function getDefaultUiSettings() {
  return {
    autoScroll: true,
    textScale: {
      radio: 1.0,
      chat: 1.0,
      macro: 1.0
    },
    interfaceScale: {
      radio: 1.0,
      chat: 1.0,
      macro: 1.0
    },
    positions: {
      radio: { x: 0.5, y: 0.5 },
      chat: { x: 0.84, y: 0.8 },
      macro: { x: 0.5, y: 0.5 }
    },
    theme: {
      preset: "default",
      accent: "#00ffa3"
    }
  };
}

function getDefaultThemeOverrides() {
  return {
    exact: {},
    ranges: []
  };
}

let uiSettings = getDefaultUiSettings();
let themeOverrides = getDefaultThemeOverrides();

const dom = {
  chatMessages: null,
  chatInput: null,
  radioInterface: null,
  chatInterface: null,
  macroOverlay: null,
  radioPanel: null,
  chatPanel: null,
  macroPanel: null,
  settingsOverlay: null,
  settingsAutoScroll: null,
  settingsRelayPrimary: null,
  settingsRelaySecondary: null,
  settingsThemePreset: null,
  settingsThemeAccent: null,
  settingsThemeBase: null,
  settingsThemeMax: null,
  settingsThemeMaxWrap: null,
  themeToggleRange: null,
  themeSaveEntry: null,
  openLayoutMode: null,
  themeOverridesList: null,
  clearCacheOverlay: null,
  clearCacheCancel: null,
  clearCacheConfirm: null,
  layoutModeOverlay: null,
  layoutTargetRadio: null,
  layoutTargetChat: null,
  layoutTargetMacro: null,
  layoutSizeMinus: null,
  layoutSizeReset: null,
  layoutSizePlus: null,
  layoutTextMinus: null,
  layoutTextReset: null,
  layoutTextPlus: null,
  layoutCancel: null,
  layoutSave: null
};

const sounds = {
  radioOn: null,
  radioOff: null,
  freqChange: null,
  msgIn: null,
  msgSent: null,
  button: null
};

let resolvedPlaceholders = {
  location: "Unknown",
  locationCoords: null,
  waypoint: "No waypoint set",
  waypointCoords: null,
  hour: "00:00",
  name: "Unknown",
  surname: "Unknown",
  job: "Unknown",
  rank: "Unknown",
  citizenid: null
};

let chatRelayState = {
  primary: false,
  secondary: false
};

function normalizeFrequency(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim().replace(",", ".");
  if (!raw) {
    return null;
  }

  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return null;
  }

  return num.toFixed(2);
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return Object.values(value);
  }

  return [];
}

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry));
  }

  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, entry]) => {
      out[key] = deepClone(entry);
    });
    return out;
  }

  return value;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }

  if (num < min) {
    return min;
  }

  if (num > max) {
    return max;
  }

  return num;
}

function normalizeColor(value, fallback) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(raw)) {
    return raw;
  }
  return fallback;
}

function normalizePreset(value, fallback) {
  const preset = String(value || "").trim().toLowerCase();
  if (THEME_PRESETS[preset]) {
    return preset;
  }
  return fallback;
}

function normalizeUiSettings(raw, fallback) {
  const base = deepClone(fallback || getDefaultUiSettings());
  if (!base.textScale || typeof base.textScale !== "object") {
    const legacyScale = clampNumber(base.textScale, 0.85, 1.35, 1.0);
    base.textScale = {
      radio: legacyScale,
      chat: legacyScale,
      macro: legacyScale
    };
  }

  if (!raw || typeof raw !== "object") {
    return base;
  }

  if (raw.autoScroll !== undefined) {
    base.autoScroll = !!raw.autoScroll;
  }

  if (raw.textScale !== undefined) {
    if (raw.textScale && typeof raw.textScale === "object") {
      if (raw.textScale.radio !== undefined) {
        base.textScale.radio = clampNumber(raw.textScale.radio, 0.85, 1.35, base.textScale.radio);
      }
      if (raw.textScale.chat !== undefined) {
        base.textScale.chat = clampNumber(raw.textScale.chat, 0.85, 1.35, base.textScale.chat);
      }
      if (raw.textScale.macro !== undefined) {
        base.textScale.macro = clampNumber(raw.textScale.macro, 0.85, 1.35, base.textScale.macro);
      }
    } else {
      const unifiedScale = clampNumber(raw.textScale, 0.85, 1.35, base.textScale.chat);
      base.textScale.radio = unifiedScale;
      base.textScale.chat = unifiedScale;
      base.textScale.macro = unifiedScale;
    }
  }

  if (raw.interfaceScale && typeof raw.interfaceScale === "object") {
    if (raw.interfaceScale.radio !== undefined) {
      base.interfaceScale.radio = clampNumber(raw.interfaceScale.radio, 0.8, 1.35, base.interfaceScale.radio);
    }
    if (raw.interfaceScale.chat !== undefined) {
      base.interfaceScale.chat = clampNumber(raw.interfaceScale.chat, 0.8, 1.35, base.interfaceScale.chat);
    }
    if (raw.interfaceScale.macro !== undefined) {
      base.interfaceScale.macro = clampNumber(raw.interfaceScale.macro, 0.8, 1.35, base.interfaceScale.macro);
    }
  }

  if (raw.positions && typeof raw.positions === "object") {
    ["radio", "chat", "macro"].forEach((key) => {
      const position = raw.positions[key];
      if (position && typeof position === "object") {
        base.positions[key] = {
          x: clampNumber(position.x, 0, 1, base.positions[key].x),
          y: clampNumber(position.y, 0, 1, base.positions[key].y)
        };
      }
    });
  }

  if (raw.theme && typeof raw.theme === "object") {
    base.theme.preset = normalizePreset(raw.theme.preset, base.theme.preset);
    base.theme.accent = normalizeColor(raw.theme.accent, base.theme.accent);
  }

  return base;
}

function normalizeThemeEntry(raw) {
  const defaults = getDefaultUiSettings().theme;
  const input = raw && typeof raw === "object" ? raw : {};

  return {
    preset: normalizePreset(input.preset, defaults.preset),
    accent: normalizeColor(input.accent, defaults.accent)
  };
}

function normalizeThemeOverrides(raw) {
  const clean = getDefaultThemeOverrides();
  if (!raw || typeof raw !== "object") {
    return clean;
  }

  if (raw.exact && typeof raw.exact === "object") {
    Object.entries(raw.exact).forEach(([frequency, value]) => {
      const normalized = normalizeFrequency(frequency);
      if (!normalized) {
        return;
      }
      clean.exact[normalized] = normalizeThemeEntry(value);
    });
  }

  if (Array.isArray(raw.ranges)) {
    raw.ranges.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const min = normalizeFrequency(entry.min);
      const max = normalizeFrequency(entry.max);
      if (!min || !max) {
        return;
      }

      const minNum = Number(min);
      const maxNum = Number(max);
      if (!Number.isFinite(minNum) || !Number.isFinite(maxNum) || minNum > maxNum) {
        return;
      }

      const theme = normalizeThemeEntry(entry);
      clean.ranges.push({
        min,
        max,
        preset: theme.preset,
        accent: theme.accent
      });
    });
  }

  return clean;
}

function cacheDom() {
  dom.chatMessages = document.getElementById("chat-messages");
  dom.chatInput = document.getElementById("chat-input");
  dom.radioInterface = document.getElementById("radio-interface");
  dom.chatInterface = document.getElementById("chat-interface");
  dom.macroOverlay = document.getElementById("macro-modal-overlay");
  dom.radioPanel = document.querySelector("#radio-interface .radio-device");
  dom.chatPanel = document.querySelector("#chat-interface .chat-radio-device");
  dom.macroPanel = document.querySelector("#macro-modal-overlay .macro-modal");
  dom.settingsOverlay = document.getElementById("settings-overlay");
  dom.settingsAutoScroll = document.getElementById("setting-auto-scroll");
  dom.settingsRelayPrimary = document.getElementById("setting-relay-primary");
  dom.settingsRelaySecondary = document.getElementById("setting-relay-secondary");
  dom.settingsThemePreset = document.getElementById("setting-theme-preset");
  dom.settingsThemeAccent = document.getElementById("setting-theme-accent");
  dom.settingsThemeBase = document.getElementById("setting-theme-base");
  dom.settingsThemeMax = document.getElementById("setting-theme-max");
  dom.settingsThemeMaxWrap = document.getElementById("setting-theme-max-wrap");
  dom.themeToggleRange = document.getElementById("theme-toggle-range");
  dom.themeSaveEntry = document.getElementById("theme-save-entry");
  dom.openLayoutMode = document.getElementById("setting-open-layout-mode");
  dom.themeOverridesList = document.getElementById("theme-overrides-list");
  dom.clearCacheOverlay = document.getElementById("clear-cache-overlay");
  dom.clearCacheCancel = document.getElementById("clear-cache-cancel");
  dom.clearCacheConfirm = document.getElementById("clear-cache-confirm");
  dom.layoutModeOverlay = document.getElementById("layout-mode-overlay");
  dom.layoutTargetRadio = document.getElementById("layout-target-radio");
  dom.layoutTargetChat = document.getElementById("layout-target-chat");
  dom.layoutTargetMacro = document.getElementById("layout-target-macro");
  dom.layoutSizeMinus = document.getElementById("layout-size-minus");
  dom.layoutSizeReset = document.getElementById("layout-size-reset");
  dom.layoutSizePlus = document.getElementById("layout-size-plus");
  dom.layoutTextMinus = document.getElementById("layout-text-minus");
  dom.layoutTextReset = document.getElementById("layout-text-reset");
  dom.layoutTextPlus = document.getElementById("layout-text-plus");
  dom.layoutCancel = document.getElementById("layout-cancel");
  dom.layoutSave = document.getElementById("layout-save");
}

function tonumberSafe(value) {
  const num = parseInt(value, 10);
  return Number.isFinite(num) ? num : 0;
}

function getActiveFrequency() {
  return activeFrequency === "secondary" ? currentSecondaryFreq : currentPrimaryFreq;
}

function createClientMessageId() {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${randomPart}`;
}

function cleanupSeenMessageIds() {
  const now = Date.now();
  seenMessageIds.forEach((expiry, key) => {
    if (expiry <= now) {
      seenMessageIds.delete(key);
    }
  });
}

function isDuplicateMessageId(messageId) {
  const id = String(messageId || "").trim();
  if (!id) {
    return false;
  }

  cleanupSeenMessageIds();

  const now = Date.now();
  const expiry = seenMessageIds.get(id) || 0;
  if (expiry > now) {
    return true;
  }

  seenMessageIds.set(id, now + MESSAGE_ID_TTL_MS);
  return false;
}

function initSounds() {
  sounds.radioOn = document.getElementById("audio-radio-on");
  sounds.radioOff = document.getElementById("audio-radio-off");
  sounds.freqChange = document.getElementById("audio-freq-change");
  sounds.msgIn = document.getElementById("audio-msg-in");
  sounds.msgSent = document.getElementById("audio-msg-sent");
  sounds.button = document.getElementById("audio-button");

  if (sounds.radioOn) sounds.radioOn.src = "sounds/radio_on.ogg";
  if (sounds.radioOff) sounds.radioOff.src = "sounds/radio_off.ogg";
  if (sounds.freqChange) sounds.freqChange.src = "sounds/frequency_change.ogg";
  if (sounds.msgIn) sounds.msgIn.src = "sounds/message_in.ogg";
  if (sounds.msgSent) sounds.msgSent.src = "sounds/message_sent.ogg";
  if (sounds.button) sounds.button.src = "sounds/button_click.ogg";

  Object.values(sounds).forEach((sound) => {
    if (sound) {
      sound.volume = soundVolume;
    }
  });
}

function playSound(name) {
  if (!soundsEnabled) {
    return;
  }

  const sound = sounds[name];
  if (!sound) {
    return;
  }

  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function animateVisualizer() {
  const bars = document.querySelectorAll(".wave-bar");
  bars.forEach((bar) => {
    const randomHeight = Math.random() * 80 + 20;
    bar.style.height = `${randomHeight}%`;
  });
}

function applyMacroPayload(globalMacros, allMacroSets) {
  const nextSets = {};

  if (allMacroSets && typeof allMacroSets === "object") {
    Object.entries(allMacroSets).forEach(([key, value]) => {
      nextSets[key] = toArray(value);
    });
  }

  if (Array.isArray(globalMacros)) {
    nextSets.GlobalMacros = globalMacros;
  } else if (!nextSets.GlobalMacros) {
    nextSets.GlobalMacros = toArray(nextSets.GeneralMacros);
  }

  macroSets = nextSets;
}

function showNuiElement(selector) {
  document.body.style.pointerEvents = "auto";
  $(selector).removeClass("hidden");
}

function hideNuiElement(selector) {
  $(selector).addClass("hidden");

  setTimeout(() => {
    if (
      $("#radio-interface").hasClass("hidden") &&
      $("#chat-interface").hasClass("hidden")
    ) {
      document.body.style.pointerEvents = "none";
    }
  }, 120);
}

function getInterfacePanel(interfaceName) {
  if (interfaceName === "radio") {
    return dom.radioPanel;
  }

  if (interfaceName === "chat") {
    return dom.chatPanel;
  }

  if (interfaceName === "macro") {
    return dom.macroPanel;
  }

  return null;
}

function getInterfaceLayer(interfaceName) {
  if (interfaceName === "radio") {
    return dom.radioInterface;
  }

  if (interfaceName === "chat") {
    return dom.chatInterface;
  }

  if (interfaceName === "macro") {
    return dom.macroOverlay;
  }

  return null;
}

function resetInterfaceLayerOrder() {
  INTERFACE_NAMES.forEach((name) => {
    const layer = getInterfaceLayer(name);
    if (!layer) {
      return;
    }
    layer.style.zIndex = "";
    layer.classList.remove("layout-layer-top");
  });
}

function bringInterfaceLayerToFront(interfaceName) {
  const active = interfaceName === "chat" || interfaceName === "macro" ? interfaceName : "radio";

  INTERFACE_NAMES.forEach((name, index) => {
    const layer = getInterfaceLayer(name);
    if (!layer) {
      return;
    }

    layer.classList.remove("layout-layer-top");
    layer.style.zIndex = String(15020 - index);
  });

  const activeLayer = getInterfaceLayer(active);
  if (activeLayer) {
    activeLayer.classList.add("layout-layer-top");
    activeLayer.style.zIndex = "15060";
  }
}

function applyScaleVariables() {
  document.documentElement.style.setProperty("--radio-scale", String(uiSettings.interfaceScale.radio));
  document.documentElement.style.setProperty("--chat-scale", String(uiSettings.interfaceScale.chat));
  document.documentElement.style.setProperty("--macro-scale", String(uiSettings.interfaceScale.macro));
  document.documentElement.style.setProperty("--radio-text-scale", String(uiSettings.textScale.radio));
  document.documentElement.style.setProperty("--chat-text-scale", String(uiSettings.textScale.chat));
  document.documentElement.style.setProperty("--macro-text-scale", String(uiSettings.textScale.macro));
}

function applyInterfacePosition(interfaceName, clampIntoViewport) {
  const panel = getInterfacePanel(interfaceName);
  const saved = uiSettings.positions[interfaceName];
  if (!panel || !saved) {
    return;
  }

  let x = clampNumber(saved.x, 0, 1, 0.5);
  let y = clampNumber(saved.y, 0, 1, 0.5);

  panel.style.left = `${(x * 100).toFixed(4)}%`;
  panel.style.top = `${(y * 100).toFixed(4)}%`;

  if (!clampIntoViewport) {
    return;
  }

  const width = window.innerWidth || 1;
  const height = window.innerHeight || 1;
  const rect = panel.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const minX = Math.min(0.98, Math.max(0.02, halfWidth / width));
  const maxX = Math.max(minX, 1 - minX);
  const minY = Math.min(0.98, Math.max(0.02, halfHeight / height));
  const maxY = Math.max(minY, 1 - minY);

  const clampedX = clampNumber(x, minX, maxX, x);
  const clampedY = clampNumber(y, minY, maxY, y);

  if (clampedX !== x || clampedY !== y) {
    uiSettings.positions[interfaceName] = { x: clampedX, y: clampedY };
    panel.style.left = `${(clampedX * 100).toFixed(4)}%`;
    panel.style.top = `${(clampedY * 100).toFixed(4)}%`;
    if (!layoutModeOpen) {
      scheduleUiSave();
    }
  }
}

function applyAllInterfacePositions(clampIntoViewport) {
  ["radio", "chat", "macro"].forEach((interfaceName) => {
    applyInterfacePosition(interfaceName, clampIntoViewport);
  });
}

function getThemeOverrideForFrequency(frequency) {
  const normalized = normalizeFrequency(frequency);
  if (!normalized) {
    return null;
  }

  if (themeOverrides.exact[normalized]) {
    return themeOverrides.exact[normalized];
  }

  const freqNum = Number(normalized);
  let selected = null;
  let selectedRange = null;

  themeOverrides.ranges.forEach((entry) => {
    const min = Number(entry.min);
    const max = Number(entry.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return;
    }

    if (freqNum < min || freqNum > max) {
      return;
    }

    const span = max - min;
    if (selectedRange === null || span < selectedRange) {
      selected = entry;
      selectedRange = span;
    }
  });

  return selected;
}

function getEffectiveTheme(frequency, fallbackColor) {
  const base = normalizeThemeEntry(uiSettings.theme);
  const override = getThemeOverrideForFrequency(frequency);
  if (override) {
    return normalizeThemeEntry(override);
  }

  return {
    preset: base.preset,
    accent: normalizeColor(fallbackColor, base.accent)
  };
}

function applyThemeForFrequency(frequency, fallbackColor) {
  const theme = getEffectiveTheme(frequency, fallbackColor || uiSettings.theme.accent);
  document.body.setAttribute("data-theme", theme.preset);
  document.documentElement.style.setProperty("--accent-green", theme.accent);
}

function syncSettingsControls() {
  if (dom.settingsAutoScroll) {
    dom.settingsAutoScroll.checked = !!autoScrollEnabled;
  }

  if (dom.settingsThemePreset) {
    dom.settingsThemePreset.value = normalizePreset(uiSettings.theme.preset, "default");
  }

  if (dom.settingsThemeAccent) {
    dom.settingsThemeAccent.value = normalizeColor(uiSettings.theme.accent, "#00ffa3");
  }

  if (dom.settingsThemeBase && !dom.settingsThemeBase.value) {
    const active = getActiveFrequency();
    if (active) {
      dom.settingsThemeBase.value = active;
    }
  }

  setThemeRangeEnabled(themeRangeEnabled, true);
  updateChatRelayButton();
  updateLayoutTargetButtons();
}

function saveUiSettingsNow() {
  if (uiSaveTimer) {
    clearTimeout(uiSaveTimer);
    uiSaveTimer = null;
  }

  return postToResource("saveUiSettings", {
    ui: uiSettings
  })
    .then((response) => {
      if (!response || !response.success) {
        return null;
      }

      uiSettings = normalizeUiSettings(response.ui, uiSettings);
      if (response.themeOverrides) {
        themeOverrides = normalizeThemeOverrides(response.themeOverrides);
      }
      applyUiSettingsVisuals(true);
      renderThemeOverridesList();
      updateChatFrequencyDisplay();
      return response;
    })
    .catch(() => null);
}

function scheduleUiSave() {
  if (uiSaveTimer) {
    clearTimeout(uiSaveTimer);
  }

  uiSaveTimer = setTimeout(() => {
    uiSaveTimer = null;

    postToResource("saveUiSettings", {
      ui: uiSettings
    })
      .then((response) => {
        if (!response || !response.success) {
          return;
        }

        uiSettings = normalizeUiSettings(response.ui, uiSettings);
        if (response.themeOverrides) {
          themeOverrides = normalizeThemeOverrides(response.themeOverrides);
        }
        applyUiSettingsVisuals(true);
        renderThemeOverridesList();
        updateChatFrequencyDisplay();
      })
      .catch(() => {});
  }, UI_SAVE_DEBOUNCE_MS);
}

function applyUiSettingsVisuals(clampPositions) {
  uiSettings = normalizeUiSettings(uiSettings, uiSettings);
  autoScrollEnabled = !!uiSettings.autoScroll;

  applyScaleVariables();
  applyAllInterfacePositions(clampPositions === true);
  syncSettingsControls();
}

function renderThemeOverridesList() {
  if (!dom.themeOverridesList) {
    return;
  }

  const items = [];

  Object.keys(themeOverrides.exact).sort().forEach((frequency) => {
    const entry = normalizeThemeEntry(themeOverrides.exact[frequency]);
    items.push(`
      <div class="theme-override-item">
        <div class="theme-override-meta">
          <span class="theme-override-title">${escapeHtml(frequency)} MHz</span>
          <span class="theme-override-sub">Preset ${escapeHtml(entry.preset)} | ${escapeHtml(entry.accent)}</span>
        </div>
        <div class="theme-override-actions">
          <input
            type="color"
            class="theme-override-color"
            title="Change override color"
            value="${escapeHtml(entry.accent)}"
            data-mode="exact"
            data-frequency="${escapeHtml(frequency)}"
            data-preset="${escapeHtml(entry.preset)}"
          />
          <button class="btn-delete-theme" data-mode="exact" data-frequency="${escapeHtml(frequency)}">Delete</button>
        </div>
      </div>
    `);
  });

  themeOverrides.ranges.forEach((entry, index) => {
    const normalizedEntry = normalizeThemeEntry(entry);
    items.push(`
      <div class="theme-override-item">
        <div class="theme-override-meta">
          <span class="theme-override-title">${escapeHtml(entry.min)} - ${escapeHtml(entry.max)} MHz</span>
          <span class="theme-override-sub">Preset ${escapeHtml(normalizedEntry.preset)} | ${escapeHtml(normalizedEntry.accent)}</span>
        </div>
        <div class="theme-override-actions">
          <input
            type="color"
            class="theme-override-color"
            title="Change override color"
            value="${escapeHtml(normalizedEntry.accent)}"
            data-mode="range"
            data-min="${escapeHtml(entry.min)}"
            data-max="${escapeHtml(entry.max)}"
            data-preset="${escapeHtml(normalizedEntry.preset)}"
          />
          <button class="btn-delete-theme" data-mode="range" data-index="${index + 1}">Delete</button>
        </div>
      </div>
    `);
  });

  if (!items.length) {
    dom.themeOverridesList.innerHTML = "<div class=\"theme-override-empty\">No overrides saved.</div>";
    return;
  }

  dom.themeOverridesList.innerHTML = items.join("");
}

function setThemeRangeEnabled(enabled, keepValue) {
  themeRangeEnabled = enabled === true;

  if (dom.settingsThemeMaxWrap) {
    dom.settingsThemeMaxWrap.classList.toggle("hidden", !themeRangeEnabled);
  }

  if (dom.themeToggleRange) {
    dom.themeToggleRange.classList.toggle("active", themeRangeEnabled);
  }

  if (!keepValue && !themeRangeEnabled && dom.settingsThemeMax) {
    dom.settingsThemeMax.value = "";
  }
}

function updateLayoutTargetButtons() {
  const controls = [
    dom.layoutTargetRadio,
    dom.layoutTargetChat,
    dom.layoutTargetMacro
  ];

  controls.forEach((button) => {
    if (!button) {
      return;
    }
    const name = String(button.getAttribute("data-interface") || "");
    button.classList.toggle("active", layoutModeOpen && name === selectedLayoutInterface);
  });

  const entries = [
    ["radio", dom.radioPanel],
    ["chat", dom.chatPanel],
    ["macro", dom.macroPanel]
  ];

  entries.forEach(([name, panel]) => {
    if (!panel) {
      return;
    }
    panel.classList.toggle("move-mode-active", layoutModeOpen && selectedLayoutInterface === name);
  });
}

function captureLayoutVisibility() {
  return {
    radio: !$("#radio-interface").hasClass("hidden"),
    chat: !$("#chat-interface").hasClass("hidden"),
    macro: !$("#macro-modal-overlay").hasClass("hidden")
  };
}

function restoreLayoutVisibility(snapshot) {
  const state = snapshot || { radio: false, chat: false, macro: false };
  $("#radio-interface").toggleClass("hidden", !state.radio);
  $("#chat-interface").toggleClass("hidden", !state.chat);
  $("#macro-modal-overlay").toggleClass("hidden", !state.macro);

  if (!state.radio && !state.chat) {
    document.body.style.pointerEvents = "none";
  }
}

function showLayoutPreview() {
  document.body.style.pointerEvents = "auto";
  $("body").addClass("layout-mode-open");
  $("#radio-interface").removeClass("hidden");
  $("#chat-interface").removeClass("hidden");
  $("#macro-modal-overlay").removeClass("hidden");
  $("#create-macro-panel").addClass("hidden");
  $("#delete-macro-overlay").addClass("hidden");
  hideMacroSuggestions();
}

function setLayoutTarget(interfaceName) {
  const next = interfaceName === "chat" || interfaceName === "macro" ? interfaceName : "radio";
  selectedLayoutInterface = next;
  if (layoutModeOpen) {
    bringInterfaceLayerToFront(selectedLayoutInterface);
  }
  updateLayoutTargetButtons();
}

function changeSelectedInterfaceSize(delta) {
  const key = selectedLayoutInterface;
  const current = uiSettings.interfaceScale[key];
  const next = clampNumber(current + delta, 0.8, 1.35, current);
  if (next === current) {
    return;
  }
  uiSettings.interfaceScale[key] = next;
  applyUiSettingsVisuals(true);
}

function resetSelectedInterfaceSize() {
  const key = selectedLayoutInterface;
  if (uiSettings.interfaceScale[key] === 1) {
    return;
  }
  uiSettings.interfaceScale[key] = 1;
  applyUiSettingsVisuals(true);
}

function changeTextSize(delta) {
  const key = selectedLayoutInterface;
  const current = uiSettings.textScale[key];
  const next = clampNumber(current + delta, 0.85, 1.35, current);
  if (next === current) {
    return;
  }
  uiSettings.textScale[key] = next;
  applyUiSettingsVisuals(true);
}

function resetTextSize() {
  const key = selectedLayoutInterface;
  if (uiSettings.textScale[key] === 1) {
    return;
  }
  uiSettings.textScale[key] = 1;
  applyUiSettingsVisuals(true);
}

function enterLayoutMode() {
  if (layoutModeOpen) {
    return;
  }

  layoutSnapshot = deepClone(uiSettings);
  layoutVisibilitySnapshot = captureLayoutVisibility();
  layoutModeOpen = true;
  settingsOpen = false;
  selectedLayoutInterface = "radio";

  if (dom.settingsOverlay) {
    dom.settingsOverlay.classList.add("hidden");
  }
  $("#btn-settings").removeClass("active");

  if (dom.layoutModeOverlay) {
    dom.layoutModeOverlay.classList.remove("hidden");
  }

  showLayoutPreview();
  applyUiSettingsVisuals(true);
  bringInterfaceLayerToFront(selectedLayoutInterface);
  updateLayoutTargetButtons();
}

function closeLayoutMode(saveChanges, reopenSettings) {
  if (!layoutModeOpen) {
    return;
  }

  layoutModeOpen = false;
  dragState = null;
  $("body").removeClass("layout-mode-open");

  if (dom.layoutModeOverlay) {
    dom.layoutModeOverlay.classList.add("hidden");
  }

  if (!saveChanges && layoutSnapshot) {
    uiSettings = normalizeUiSettings(layoutSnapshot, getDefaultUiSettings());
    applyUiSettingsVisuals(true);
  }

  restoreLayoutVisibility(layoutVisibilitySnapshot);
  layoutSnapshot = null;
  layoutVisibilitySnapshot = null;
  resetInterfaceLayerOrder();
  updateLayoutTargetButtons();

  if (saveChanges) {
    saveUiSettingsNow();
  }

  if (reopenSettings) {
    toggleSettingsPanel(true);
  }
}

function toggleSettingsPanel(forceState) {
  const show = typeof forceState === "boolean" ? forceState : !settingsOpen;
  if (layoutModeOpen && show) {
    return;
  }
  settingsOpen = show;

  if (!dom.settingsOverlay) {
    return;
  }

  dom.settingsOverlay.classList.toggle("hidden", !show);
  $("#btn-settings").toggleClass("active", show);

  if (show) {
    syncSettingsControls();
    renderThemeOverridesList();
  }
}

function beginMoveDrag(interfaceName, event) {
  if (!layoutModeOpen) {
    return;
  }

  if (event.button !== 0) {
    return;
  }

  const panel = getInterfacePanel(interfaceName);
  if (!panel) {
    return;
  }

  const rect = panel.getBoundingClientRect();
  dragState = {
    interface: interfaceName,
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  setLayoutTarget(interfaceName);
  bringInterfaceLayerToFront(interfaceName);

  if (panel.setPointerCapture) {
    panel.setPointerCapture(event.pointerId);
  }

  event.preventDefault();
}

function updateMoveDrag(clientX, clientY) {
  if (!dragState) {
    return;
  }

  const panel = getInterfacePanel(dragState.interface);
  if (!panel) {
    return;
  }

  const width = window.innerWidth || 1;
  const height = window.innerHeight || 1;
  const rect = panel.getBoundingClientRect();
  const centerX = clientX - dragState.offsetX + (rect.width / 2);
  const centerY = clientY - dragState.offsetY + (rect.height / 2);

  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const minX = Math.min(0.98, Math.max(0.02, halfWidth / width));
  const maxX = Math.max(minX, 1 - minX);
  const minY = Math.min(0.98, Math.max(0.02, halfHeight / height));
  const maxY = Math.max(minY, 1 - minY);

  uiSettings.positions[dragState.interface] = {
    x: clampNumber(centerX / width, minX, maxX, 0.5),
    y: clampNumber(centerY / height, minY, maxY, 0.5)
  };

  applyInterfacePosition(dragState.interface, false);
}

function endMoveDrag(event) {
  if (!dragState) {
    return;
  }

  const panel = getInterfacePanel(dragState.interface);
  if (panel && panel.releasePointerCapture) {
    try {
      panel.releasePointerCapture(dragState.pointerId);
    } catch (_) {
    }
  }

  applyInterfacePosition(dragState.interface, true);
  dragState = null;

  if (event) {
    event.preventDefault();
  }
}

function applyFrequencySync(data) {
  currentPrimaryFreq = normalizeFrequency(data.primary);
  currentSecondaryFreq = normalizeFrequency(data.secondary);
  activeFrequency = data.activeFreq === "secondary" ? "secondary" : "primary";

  chatRelayState.primary = !!data.primaryChatRelay;
  chatRelayState.secondary = !!data.secondaryChatRelay;

  if (activeFrequency === "primary" && !currentPrimaryFreq && currentSecondaryFreq) {
    activeFrequency = "secondary";
  } else if (activeFrequency === "secondary" && !currentSecondaryFreq && currentPrimaryFreq) {
    activeFrequency = "primary";
  }

  if (!currentPrimaryFreq) {
    chatRelayState.primary = false;
  }

  if (!currentSecondaryFreq) {
    chatRelayState.secondary = false;
  }

  updateFrequencyDisplay("primary", currentPrimaryFreq);
  updateFrequencyDisplay("secondary", currentSecondaryFreq);
  updateChatFrequencyDisplay();
  filterMessages();
  updateChatRelayButton();

  if (!$("#macro-modal-overlay").hasClass("hidden")) {
    loadMacros();
  }

  updateMacroSuggestions();
}

function toggleRadio(show, primary, secondary, globalMacros, allMacroSets) {
  if (show) {
    currentPrimaryFreq = normalizeFrequency(primary);
    currentSecondaryFreq = normalizeFrequency(secondary);

    applyMacroPayload(globalMacros, allMacroSets);

    updateFrequencyDisplay("primary", currentPrimaryFreq);
    updateFrequencyDisplay("secondary", currentSecondaryFreq);

    showNuiElement("#radio-interface");
    requestAnimationFrame(() => {
      applyUiSettingsVisuals(true);
    });
    playSound("radioOn");
    return;
  }

  hideNuiElement("#radio-interface");
  playSound("radioOff");
  postToResource("nuiClosed", {}).catch(() => {});
}

function toggleChat(show, primary, secondary, activeFreq, primaryChatRelay, secondaryChatRelay, globalMacros, allMacroSets) {
  if (show) {
    currentPrimaryFreq = normalizeFrequency(primary);
    currentSecondaryFreq = normalizeFrequency(secondary);
    activeFrequency = activeFreq === "secondary" ? "secondary" : "primary";
    chatRelayState.primary = !!primaryChatRelay;
    chatRelayState.secondary = !!secondaryChatRelay;

    if (!currentPrimaryFreq) {
      chatRelayState.primary = false;
    }

    if (!currentSecondaryFreq) {
      chatRelayState.secondary = false;
    }

    if (activeFrequency === "primary" && !currentPrimaryFreq && currentSecondaryFreq) {
      activeFrequency = "secondary";
    } else if (activeFrequency === "secondary" && !currentSecondaryFreq && currentPrimaryFreq) {
      activeFrequency = "primary";
    }

    applyMacroPayload(globalMacros, allMacroSets);

    updateChatFrequencyDisplay();
    filterMessages();
    updateChatRelayButton();

    showNuiElement("#chat-interface");
    toggleSettingsPanel(false);
    if (dom.chatInput) {
      dom.chatInput.focus();
    }
    playSound("radioOn");

    loadMacros();
    updateMacroSuggestions();

    if (autoScrollEnabled) {
      setTimeout(scrollToBottom, 50);
    }

    requestAnimationFrame(() => {
      applyUiSettingsVisuals(true);
    });

    if (!visualizerIntervalId) {
      visualizerIntervalId = setInterval(animateVisualizer, 150);
    }
    return;
  }

  hideNuiElement("#chat-interface");
  hideMacroSuggestions();
  if (layoutModeOpen) {
    closeLayoutMode(false, false);
  }
  toggleSettingsPanel(false);
  playSound("radioOff");

  if (visualizerIntervalId) {
    clearInterval(visualizerIntervalId);
    visualizerIntervalId = null;
  }

  postToResource("nuiClosed", {}).catch(() => {});
}

function updateFrequencyDisplay(type, frequency) {
  const id = type === "primary" ? "#primary-display-lcd" : "#secondary-display-lcd";
  const normalized = normalizeFrequency(frequency);

  if (!normalized) {
    $(id).text("---");
    return;
  }

  const count = freqCounts[normalized] || 0;
  $(id).text(`${normalized} (${count})`);
}

function setFrequency(type) {
  const inputId = type === "primary" ? "#primary-freq" : "#secondary-freq";
  const raw = $(inputId).val();
  const normalized = normalizeFrequency(raw);

  if (!normalized) {
    return;
  }

  playSound("button");

  postToResource("setFrequency", {
    frequency: normalized,
    isPrimary: type === "primary"
  })
    .then((response) => {
      if (!response || !response.success) {
        return;
      }

      currentPrimaryFreq = normalizeFrequency(response.primary);
      currentSecondaryFreq = normalizeFrequency(response.secondary);
      activeFrequency = response.activeFreq === "secondary" ? "secondary" : "primary";
      chatRelayState.primary = !!response.primaryChatRelay;
      chatRelayState.secondary = !!response.secondaryChatRelay;

      $(inputId).val("");

      updateFrequencyDisplay("primary", currentPrimaryFreq);
      updateFrequencyDisplay("secondary", currentSecondaryFreq);
      updateChatFrequencyDisplay();
      filterMessages();
      updateChatRelayButton();

      if (!$("#macro-modal-overlay").hasClass("hidden")) {
        loadMacros();
      }

      updateMacroSuggestions();
      playSound("freqChange");
    })
    .catch(() => {});
}

function closeRadio() {
  hideNuiElement("#radio-interface");
  playSound("radioOff");
  postToResource("close", { type: "radio" }).catch(() => {});
}

function updateChatFrequencyDisplay() {
  const frequency = getActiveFrequency();
  const defaultColor = normalizeColor(uiSettings.theme && uiSettings.theme.accent, "#00ffa3");

  if (frequency) {
    const config = freqConfigs[frequency] || {};
    const label = config.label || (activeFrequency === "primary" ? "CHANNEL 1" : "CHANNEL 2");
    const count = freqCounts[frequency] || 0;

    applyThemeForFrequency(frequency, config.color || defaultColor);
    $("#chat-freq-display").text(`${frequency} MHz (${count})`);
    $("#channel-type").text(label);
  } else {
    applyThemeForFrequency(null, defaultColor);
    $("#chat-freq-display").text("---");
    $("#channel-type").text(activeFrequency === "primary" ? "CHANNEL 1" : "CHANNEL 2");
  }

  const otherFrequency = activeFrequency === "primary" ? currentSecondaryFreq : currentPrimaryFreq;
  const otherType = activeFrequency === "primary" ? "CH2" : "CH1";

  if (otherFrequency) {
    const otherConfig = freqConfigs[otherFrequency] || {};
    const otherLabel = otherConfig.label || otherType;
    const otherCount = freqCounts[otherFrequency] || 0;
    $("#switch-text").text(`${otherLabel} (${otherCount})`);
    $(".btn-switch").prop("disabled", false);
  } else {
    $("#switch-text").text("N/A");
    $(".btn-switch").prop("disabled", true);
  }
}

function switchFrequency() {
  playSound("freqChange");

  postToResource("switchFrequency", {})
    .then((response) => {
      if (!response) {
        return;
      }

      activeFrequency = response.activeFreq === "secondary" ? "secondary" : "primary";
      chatRelayState.primary = !!response.primaryChatRelay;
      chatRelayState.secondary = !!response.secondaryChatRelay;

      updateChatFrequencyDisplay();
      filterMessages();
      updateChatRelayButton();

      if (!$("#macro-modal-overlay").hasClass("hidden")) {
        loadMacros();
      }

      updateMacroSuggestions();
    })
    .catch(() => {});
}

function updateChatRelayButton() {
  const hasPrimary = !!currentPrimaryFreq;
  const hasSecondary = !!currentSecondaryFreq;

  if (dom.settingsRelayPrimary) {
    dom.settingsRelayPrimary.disabled = !hasPrimary;
    dom.settingsRelayPrimary.checked = hasPrimary && !!chatRelayState.primary;
  }

  if (dom.settingsRelaySecondary) {
    dom.settingsRelaySecondary.disabled = !hasSecondary;
    dom.settingsRelaySecondary.checked = hasSecondary && !!chatRelayState.secondary;
  }
}

function toggleChatRelay(channelOverride, explicitEnabled) {
  const channel = channelOverride === "secondary" ? "secondary" : (channelOverride === "primary" ? "primary" : (activeFrequency === "secondary" ? "secondary" : "primary"));
  const payload = { channel };

  if (typeof explicitEnabled === "boolean") {
    payload.enabled = explicitEnabled;
  }

  return postToResource("toggleChatRelay", payload)
    .then((response) => {
      if (!response) {
        return null;
      }

      chatRelayState.primary = !!response.primaryChatRelay;
      chatRelayState.secondary = !!response.secondaryChatRelay;
      updateChatRelayButton();
      return response;
    })
    .catch(() => null);
}
function filterMessages() {
  const current = getActiveFrequency();
  if (!dom.chatMessages) {
    return;
  }

  if (!current) {
    dom.chatMessages.innerHTML = "";
    if (autoScrollEnabled) {
      scrollToBottom();
    }
    return;
  }

  const html = messageHistory
    .filter((entry) => entry.frequency === current)
    .map((entry) => buildMessageHtml(entry.sender, entry.message, entry.isMe, entry.timestamp))
    .join("");

  dom.chatMessages.innerHTML = html;

  if (autoScrollEnabled) {
    scrollToBottom();
  }
}

function addMessage(frequency, sender, message, senderId, isMe, timestamp, clientMessageId) {
  const freq = normalizeFrequency(frequency);
  if (!freq) {
    return;
  }

  if (isDuplicateMessageId(clientMessageId)) {
    return;
  }

  const entry = {
    frequency: freq,
    sender: sender,
    message: message,
    timestamp: timestamp || Date.now(),
    senderId: senderId,
    isMe: !!isMe,
    clientMessageId: clientMessageId || null
  };

  messageHistory.push(entry);

  if (messageHistory.length > MESSAGE_HISTORY_LIMIT) {
    messageHistory = messageHistory.slice(-MESSAGE_HISTORY_LIMIT);
  }

  const current = getActiveFrequency();
  if (current && current === freq) {
    if (dom.chatMessages) {
      dom.chatMessages.insertAdjacentHTML("beforeend", buildMessageHtml(sender, message, !!isMe, entry.timestamp));
      if (autoScrollEnabled) {
        scrollToBottom();
      }
    }

    if (!isMe) {
      playSound("msgIn");
      for (let i = 0; i < 5; i += 1) {
        setTimeout(animateVisualizer, i * 100);
      }
    }
  }
}

function buildMessageHtml(sender, message, isMe, timestamp) {
  const time = formatTime(timestamp);
  const formatted = formatMessageContent(message);

  return `
    <div class="chat-message ${isMe ? "own-message" : ""}">
      <div class="message-header">
        <div class="message-sender-wrap">
          <span class="message-sender">${escapeHtml(sender)}</span>
        </div>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-content">${formatted}</div>
    </div>
  `;
}

function toggleAutoScroll(forceValue) {
  if (typeof forceValue === "boolean") {
    autoScrollEnabled = forceValue;
  } else {
    autoScrollEnabled = !autoScrollEnabled;
  }

  uiSettings.autoScroll = autoScrollEnabled;
  syncSettingsControls();
  scheduleUiSave();

  if (autoScrollEnabled) {
    scrollToBottom();
  }
}

function sendMessage() {
  if (sendInFlight) {
    return;
  }

  const text = dom.chatInput ? dom.chatInput.value : $("#chat-input").val();
  const message = String(text || "").trim();

  if (!message) {
    return;
  }

  const frequency = getActiveFrequency();
  if (!frequency) {
    return;
  }

  const resolved = resolveStaticPlaceholders(message).trim();
  if (!resolved) {
    return;
  }

  const signature = `${frequency}|${resolved}`;
  const now = Date.now();
  if (signature === lastSubmitSignature && now - lastSubmitAt < SEND_REPEAT_GUARD_MS) {
    return;
  }

  const clientMessageId = createClientMessageId();
  sendInFlight = true;

  playSound("msgSent");
  for (let i = 0; i < 3; i += 1) {
    setTimeout(animateVisualizer, i * 100);
  }

  postToResource("sendMessage", {
    message: resolved,
    frequency,
    clientMessageId
  })
    .then((response) => {
      if (response && response.success) {
        if (dom.chatInput) {
          dom.chatInput.value = "";
        } else {
          $("#chat-input").val("");
        }
        updateCharCount();
        hideMacroSuggestions();
      }
    })
    .catch(() => {})
    .finally(() => {
      sendInFlight = false;
      lastSubmitSignature = signature;
      lastSubmitAt = now;
    });
}

function closeChat() {
  if (layoutModeOpen) {
    closeLayoutMode(false, false);
  }
  hideNuiElement("#chat-interface");
  hideMacroSuggestions();
  toggleSettingsPanel(false);
  playSound("radioOff");

  if (visualizerIntervalId) {
    clearInterval(visualizerIntervalId);
    visualizerIntervalId = null;
  }

  postToResource("close", { type: "chat" }).catch(() => {});
}

function updateCharCount() {
  const count = ((dom.chatInput && dom.chatInput.value) || $("#chat-input").val() || "").length;
  $("#char-count").text(count);

  if (count >= 250) {
    $("#char-count").css("color", "#ff4444");
  } else if (count >= 200) {
    $("#char-count").css("color", "#ffaa00");
  } else {
    $("#char-count").css("color", "#9ea5a0");
  }
}

function scrollToBottom() {
  const node = dom.chatMessages || document.getElementById("chat-messages");
  if (node) {
    node.scrollTop = node.scrollHeight;
  }
}

function formatTime(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  };

  return String(text ?? "").replace(/[&<>"']/g, (value) => map[value]);
}

function formatMessageContent(message) {
  const escaped = escapeHtml(message);
  const gpsTokenRegex = /%gpslink\|([^|]+)\|(-?\d+(?:\.\d+)?)\|(-?\d+(?:\.\d+)?)\|(-?\d+(?:\.\d+)?)%/g;

  return escaped.replace(gpsTokenRegex, (full, label, x, y, z) => {
    return `<span class="gps-link" onclick="setGpsWaypoint(${x}, ${y}, ${z})">${label}</span>`;
  });
}

function sanitizeGpsLabel(label) {
  return String(label || "Unknown").replace(/[|%]/g, "").trim() || "Unknown";
}

function buildGpsToken(label, coords) {
  const safeLabel = sanitizeGpsLabel(label);
  if (!coords || typeof coords !== "object") {
    return safeLabel;
  }

  const x = Number(coords.x);
  const y = Number(coords.y);
  const z = Number(coords.z);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return safeLabel;
  }

  const safeZ = Number.isFinite(z) ? z : 0;
  return `%gpslink|${safeLabel}|${x.toFixed(2)}|${y.toFixed(2)}|${safeZ.toFixed(2)}%`;
}

function resolveStaticPlaceholders(text) {
  let value = String(text || "");

  const locationToken = buildGpsToken(resolvedPlaceholders.location || "Unknown Location", resolvedPlaceholders.locationCoords);
  const waypointToken = buildGpsToken(resolvedPlaceholders.waypoint || "No waypoint set", resolvedPlaceholders.waypointCoords);

  value = value.replace(/%location%/g, locationToken);
  value = value.replace(/%waypoint%/g, waypointToken);
  value = value.replace(/%hour%/g, resolvedPlaceholders.hour || "00:00");
  value = value.replace(/%name%/g, resolvedPlaceholders.name || "Unknown");
  value = value.replace(/%surname%/g, resolvedPlaceholders.surname || "Unknown");
  value = value.replace(/%job%/g, resolvedPlaceholders.job || "None");
  value = value.replace(/%rank%/g, resolvedPlaceholders.rank || "None");

  return value;
}

function setGpsWaypoint(x, y, z) {
  playSound("button");
  postToResource("setWaypoint", { x, y, z }).catch(() => {});
}
function normalizeMacro(raw, defaultType, sourceKey, isUser) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const label = String(raw.label || "").trim();
  const value = String(raw.value || "").trim();

  if (!label || !value) {
    return null;
  }

  return {
    id: raw.id,
    label,
    value,
    description: raw.description ? String(raw.description) : "",
    type: defaultType,
    source: sourceKey || defaultType,
    isUser: !!isUser
  };
}

function getAvailableMacros() {
  const macros = [];
  const seen = new Set();

  const appendMacroSet = (set, type, source, isUser) => {
    toArray(set).forEach((item) => {
      const macro = normalizeMacro(item, type, source, isUser);
      if (!macro) {
        return;
      }

      const key = `${macro.label}\u0000${macro.value}\u0000${macro.source}\u0000${macro.isUser ? "1" : "0"}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      macros.push(macro);
    });
  };

  appendMacroSet(macroSets.GlobalMacros || macroSets.GeneralMacros || [], "global", "GlobalMacros", false);

  const activeFreq = getActiveFrequency();
  const config = activeFreq ? freqConfigs[activeFreq] : null;

  if (config && config.macros) {
    let keys = [];
    if (Array.isArray(config.macros)) {
      keys = config.macros;
    } else if (config.macros && typeof config.macros === "object") {
      keys = Object.values(config.macros);
    } else {
      keys = [config.macros];
    }
    keys.forEach((key) => {
      if (typeof key !== "string" || !key) {
        return;
      }
      appendMacroSet(macroSets[key] || [], "job", key, false);
    });
  }

  appendMacroSet(userMacros, "user", "UserMacros", true);

  return macros;
}

function setMacroFilter(category) {
  currentMacroCategory = category;
  $(".filter-tab").removeClass("active");
  $(`.filter-tab[data-category="${category}"]`).addClass("active");
  filterMacros();
}

function renderMacroList(macros) {
  const list = $("#macro-list");
  list.empty();

  if (!macros.length) {
    list.append("<div class=\"macro-empty\">No macros available on this channel.</div>");
    return;
  }

  macros.forEach((macro) => {
    const type = macro.isUser ? "user" : (macro.type === "global" ? "global" : "job");
    const labelText = macro.isUser ? "USER" : (macro.type === "global" ? "GENERAL" : "JOB");
    const encodedLabel = encodeURIComponent(macro.label || "");
    const encodedValue = encodeURIComponent(macro.value || "");
    const macroId = Number(macro.id);

    const html = `
      <div class="macro-item ${macro.isUser ? "user-macro" : ""}" data-type="${type}" data-label="${encodedLabel}" data-value="${encodedValue}">
        <span class="macro-tag">${labelText}</span>
        <span class="macro-label">${escapeHtml(macro.label)}</span>
        <span class="macro-val">${escapeHtml(macro.value)}</span>
        ${macro.description ? `<span class="macro-desc">${escapeHtml(macro.description)}</span>` : ""}
        ${macro.isUser && Number.isFinite(macroId) ? `<button class="btn-delete-macro" data-id="${macroId}">Delete</button>` : ""}
      </div>
    `;

    list.append(html);
  });

  filterMacros();
}

function loadMacros() {
  const macros = getAvailableMacros();
  $(".macro-count").text(`${macros.length} available`);
  renderMacroList(macros);
}

function filterMacros() {
  const term = ($("#macro-search-input").val() || "").toLowerCase();

  $(".macro-item").each(function eachMacro() {
    const type = $(this).attr("data-type");
    const text = $(this).text().toLowerCase();

    const matchesSearch = text.includes(term);
    const matchesCategory = currentMacroCategory === "all" || type === currentMacroCategory;

    $(this).toggle(matchesSearch && matchesCategory);
  });
}

function handleMacroClick(label, value) {
  const macroValue = String(value || "");
  const inputs = Array.from(macroValue.matchAll(/%input(?::"([^"]*)")?%/g));

  if (inputs.length > 0) {
    processMacroInputs(macroValue, inputs, 0);
  } else {
    completeMacroSelection(macroValue);
  }
}

function processMacroInputs(currentValue, inputMatches, index) {
  if (index >= inputMatches.length) {
    completeMacroSelection(currentValue);
    return;
  }

  const tag = inputMatches[index][0];
  const customQuestion = (inputMatches[index][1] || "").trim();
  const label = customQuestion || `Input ${index + 1}`;

  openInputPrompt(label, (answer) => {
    const replacement = String(answer || "").trim();
    const nextValue = currentValue.replace(tag, replacement);
    processMacroInputs(nextValue, inputMatches, index + 1);
  });
}

function openInputPrompt(question, onSubmit) {
  pendingInputResolver = onSubmit;
  $("#prompt-question").text(question);
  $("#prompt-input").val("");
  $("#input-prompt-overlay").removeClass("hidden");
  setTimeout(() => $("#prompt-input").focus(), 10);
}

function submitPrompt() {
  if (!pendingInputResolver) {
    return;
  }

  const value = $("#prompt-input").val().trim();
  if (!value) {
    return;
  }

  const resolver = pendingInputResolver;
  pendingInputResolver = null;
  $("#input-prompt-overlay").addClass("hidden");
  resolver(value);
}

function completeMacroSelection(value) {
  const input = $("#chat-input");
  const current = input.val();
  const next = current ? (current.endsWith(" ") ? `${current}${value}` : `${current} ${value}`) : value;

  input.val(next).focus();

  if (!$("#macro-modal-overlay").hasClass("hidden")) {
    toggleMacroModal();
  }

  updateCharCount();
  updateMacroSuggestions();
}

function buildSuggestionQuery() {
  const value = (dom.chatInput && dom.chatInput.value) || $("#chat-input").val() || "";
  if (!value.startsWith("&")) {
    return null;
  }
  return value.slice(1).trim().toLowerCase();
}

function renderMacroSuggestions() {
  const box = $("#macro-suggestions");

  if (!suggestionItems.length) {
    box.html("<div class=\"macro-suggestion-empty\">No macro found.</div>");
    box.removeClass("hidden");
    return;
  }

  const html = suggestionItems.map((macro, index) => {
    const active = index === suggestionIndex ? "active" : "";
    return `
      <div class="macro-suggestion-item ${active}" data-index="${index}">
        <div class="macro-suggestion-label">${escapeHtml(macro.label)}</div>
        <div class="macro-suggestion-value">${escapeHtml(macro.value)}</div>
      </div>
    `;
  }).join("");

  box.html(html);
  box.removeClass("hidden");
}

function hideMacroSuggestions() {
  suggestionItems = [];
  suggestionIndex = -1;
  $("#macro-suggestions").addClass("hidden").empty();
}

function updateMacroSuggestions() {
  const query = buildSuggestionQuery();
  if (query === null) {
    hideMacroSuggestions();
    return;
  }

  const allMacros = getAvailableMacros();

  const matched = allMacros.filter((macro) => {
    if (!query) {
      return true;
    }

    const label = macro.label.toLowerCase();
    const value = macro.value.toLowerCase();
    const description = (macro.description || "").toLowerCase();

    return label.includes(query) || value.includes(query) || description.includes(query);
  }).slice(0, MAX_MACRO_SUGGESTIONS);

  suggestionItems = matched;
  suggestionIndex = matched.length > 0 ? 0 : -1;
  renderMacroSuggestions();
}

function applyMacroSuggestion(index) {
  const macro = suggestionItems[index];
  if (!macro) {
    return;
  }

  hideMacroSuggestions();
  if (dom.chatInput) {
    dom.chatInput.value = "";
  } else {
    $("#chat-input").val("");
  }
  updateCharCount();
  handleMacroClick(macro.label, macro.value);
}

function handleSuggestionNavigation(event) {
  if ($("#macro-suggestions").hasClass("hidden")) {
    return false;
  }

  if (!suggestionItems.length) {
    return false;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    suggestionIndex = (suggestionIndex + 1) % suggestionItems.length;
    renderMacroSuggestions();
    return true;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    suggestionIndex = (suggestionIndex - 1 + suggestionItems.length) % suggestionItems.length;
    renderMacroSuggestions();
    return true;
  }

  if ((event.key === "Enter" || event.key === "Tab") && suggestionIndex >= 0) {
    event.preventDefault();
    applyMacroSuggestion(suggestionIndex);
    return true;
  }

  if (event.key === "Escape") {
    hideMacroSuggestions();
    return false;
  }

  return false;
}
function openCreateMacro() {
  $("#create-macro-panel").removeClass("hidden");
}

function closeCreateMacro() {
  $("#create-macro-panel").addClass("hidden");
  $("#new-macro-label, #new-macro-value, #new-macro-desc").val("");
}

function saveNewMacro() {
  const label = $("#new-macro-label").val().trim();
  const value = $("#new-macro-value").val().trim();
  const description = $("#new-macro-desc").val().trim();

  if (!label || !value) {
    return;
  }

  postToResource("saveUserMacro", {
    label,
    value,
    description
  }).catch(() => {});

  closeCreateMacro();
}

function openDeleteMacroConfirm(id) {
  const macroId = Number(id);
  if (!Number.isFinite(macroId)) {
    return;
  }

  pendingDeleteMacroId = macroId;
  deleteRequestPending = false;
  $("#delete-macro-error").text("");
  $("#delete-macro-confirm").prop("disabled", false).text("Delete");
  $("#delete-macro-cancel").prop("disabled", false);
  $("#delete-macro-overlay").removeClass("hidden");
}

function closeDeleteMacroConfirm() {
  if (deleteRequestPending) {
    return;
  }

  pendingDeleteMacroId = null;
  $("#delete-macro-error").text("");
  $("#delete-macro-overlay").addClass("hidden");
}

function confirmDeleteMacro() {
  if (deleteRequestPending || !Number.isFinite(pendingDeleteMacroId)) {
    return;
  }

  deleteRequestPending = true;
  $("#delete-macro-confirm").prop("disabled", true).text("Deleting...");
  $("#delete-macro-cancel").prop("disabled", true);
  $("#delete-macro-error").text("");

  postToResource("deleteUserMacro", { id: pendingDeleteMacroId }).catch(() => {
    deleteRequestPending = false;
    $("#delete-macro-confirm").prop("disabled", false).text("Delete");
    $("#delete-macro-cancel").prop("disabled", false);
    $("#delete-macro-error").text("Unable to contact resource.");
  });
}

function handleMacroDeletedAck(success) {
  if (!deleteRequestPending && $("#delete-macro-overlay").hasClass("hidden")) {
    return;
  }

  if (success) {
    deleteRequestPending = false;
    pendingDeleteMacroId = null;
    $("#delete-macro-overlay").addClass("hidden");
    $("#delete-macro-confirm").prop("disabled", false).text("Delete");
    $("#delete-macro-cancel").prop("disabled", false);
    $("#delete-macro-error").text("");
    return;
  }

  deleteRequestPending = false;
  $("#delete-macro-confirm").prop("disabled", false).text("Delete");
  $("#delete-macro-cancel").prop("disabled", false);
  $("#delete-macro-error").text("Unable to delete this macro.");
}

function toggleMacroModal() {
  playSound("button");

  const overlay = $("#macro-modal-overlay");
  if (overlay.hasClass("hidden")) {
    postToResource("fetchUserMacros", {}).catch(() => {});
    loadMacros();
    overlay.removeClass("hidden");
    requestAnimationFrame(() => {
      applyUiSettingsVisuals(true);
    });
    $("#macro-search-input").val("").focus();
    return;
  }

  overlay.addClass("hidden");
  closeCreateMacro();
  closeDeleteMacroConfirm();
}

function loadHistory(frequency, history, customData) {
  const freq = normalizeFrequency(frequency);
  if (!freq) {
    return;
  }

  if (customData) {
    freqConfigs[freq] = customData;
  }

  messageHistory = messageHistory.filter((entry) => entry.frequency !== freq);

  toArray(history).forEach((entry) => {
    const entryFreq = normalizeFrequency(entry.frequency) || freq;
    const isMe =
      (entry.citizenid && resolvedPlaceholders.citizenid === entry.citizenid) ||
      (entry.sender === `${resolvedPlaceholders.name} ${resolvedPlaceholders.surname}`);

    messageHistory.push({
      frequency: entryFreq,
      sender: entry.sender,
      message: entry.message,
      timestamp: entry.timestamp || Date.now(),
      isMe,
      clientMessageId: entry.clientMessageId || null
    });
  });

  messageHistory.sort((a, b) => a.timestamp - b.timestamp);
  if (messageHistory.length > MESSAGE_HISTORY_LIMIT) {
    messageHistory = messageHistory.slice(-MESSAGE_HISTORY_LIMIT);
  }

  if (!$("#chat-interface").hasClass("hidden")) {
    updateChatFrequencyDisplay();
    filterMessages();
  }

  if (!$("#macro-modal-overlay").hasClass("hidden")) {
    loadMacros();
  }

  updateMacroSuggestions();
}

function saveThemeOverrideEntry() {
  const fallbackBase = getActiveFrequency();
  const base = normalizeFrequency((dom.settingsThemeBase && dom.settingsThemeBase.value) || fallbackBase);
  if (!base) {
    return;
  }

  const max = normalizeFrequency(dom.settingsThemeMax && dom.settingsThemeMax.value);
  const payload = {
    preset: uiSettings.theme.preset,
    accent: uiSettings.theme.accent
  };

  if (themeRangeEnabled && max) {
    if (Number(base) > Number(max)) {
      return;
    }
    payload.mode = "range";
    payload.min = base;
    payload.max = max;
  } else {
    payload.mode = "exact";
    payload.frequency = base;
  }

  postToResource("saveThemeOverride", payload)
    .then((response) => {
      if (!response || !response.success) {
        return;
      }

      themeOverrides = normalizeThemeOverrides(response.themeOverrides || themeOverrides);
      renderThemeOverridesList();
      updateChatFrequencyDisplay();
    })
    .catch(() => {});
}

function deleteThemeOverride(mode, frequency, index) {
  const payload = { mode };
  if (mode === "exact") {
    payload.frequency = frequency;
  } else {
    payload.index = index;
  }

  postToResource("deleteThemeOverride", payload)
    .then((response) => {
      if (!response || !response.success) {
        return;
      }

      themeOverrides = normalizeThemeOverrides(response.themeOverrides || themeOverrides);
      renderThemeOverridesList();
      updateChatFrequencyDisplay();
    })
    .catch(() => {});
}

function saveThemeOverrideColor(mode, accent, options) {
  const payload = {
    mode: mode === "range" ? "range" : "exact",
    preset: normalizePreset(options && options.preset, uiSettings.theme.preset),
    accent: normalizeColor(accent, uiSettings.theme.accent)
  };

  if (payload.mode === "exact") {
    payload.frequency = normalizeFrequency(options && options.frequency);
    if (!payload.frequency) {
      return;
    }
  } else {
    payload.min = normalizeFrequency(options && options.min);
    payload.max = normalizeFrequency(options && options.max);
    if (!payload.min || !payload.max || Number(payload.min) > Number(payload.max)) {
      return;
    }
  }

  postToResource("saveThemeOverride", payload)
    .then((response) => {
      if (!response || !response.success) {
        return;
      }

      themeOverrides = normalizeThemeOverrides(response.themeOverrides || themeOverrides);
      renderThemeOverridesList();
      updateChatFrequencyDisplay();
    })
    .catch(() => {});
}

function resetUiDefaults() {
  postToResource("resetUiDefaults", {})
    .then((response) => {
      if (!response || !response.success) {
        return;
      }

      uiSettings = normalizeUiSettings(response.ui, getDefaultUiSettings());
      themeOverrides = normalizeThemeOverrides(response.themeOverrides || getDefaultThemeOverrides());
      applyUiSettingsVisuals(true);
      renderThemeOverridesList();
      updateChatFrequencyDisplay();
    })
    .catch(() => {});
}

function clearCache() {
  if (!dom.clearCacheOverlay) {
    return;
  }
  dom.clearCacheOverlay.classList.remove("hidden");
}

function closeClearCacheConfirm() {
  if (!dom.clearCacheOverlay) {
    return;
  }
  dom.clearCacheOverlay.classList.add("hidden");
}

function confirmClearCache() {
  postToResource("clearCache", {})
    .then((response) => {
      if (!response || !response.success) {
        return;
      }

      uiSettings = normalizeUiSettings(response.ui, getDefaultUiSettings());
      themeOverrides = normalizeThemeOverrides(response.themeOverrides || getDefaultThemeOverrides());
      messageHistory = [];
      applyUiSettingsVisuals(true);
      renderThemeOverridesList();
      updateChatFrequencyDisplay();
      filterMessages();
      closeClearCacheConfirm();
    })
    .catch(() => {});
}

window.addEventListener("message", (event) => {
  const data = event.data;

  switch (data.action) {
    case "toggleRadio":
      toggleRadio(data.show, data.primary, data.secondary, data.globalMacros, data.allMacroSets);
      break;
    case "toggleChat":
      toggleChat(
        data.show,
        data.primary,
        data.secondary,
        data.activeFreq,
        data.primaryChatRelay,
        data.secondaryChatRelay,
        data.globalMacros,
        data.allMacroSets
      );
      break;
    case "loadHistory":
      loadHistory(data.frequency, data.history, data.customData);
      break;
    case "newMessage":
      addMessage(data.frequency, data.sender, data.message, data.senderId, data.isMe, data.timestamp, data.clientMessageId);
      break;
    case "updatePlaceholders":
      resolvedPlaceholders = { ...resolvedPlaceholders, ...data.data };
      break;
    case "syncFrequencies":
      applyFrequencySync(data);
      break;
    case "syncUiSettings":
      uiSettings = normalizeUiSettings(data.ui, uiSettings);
      themeOverrides = normalizeThemeOverrides(data.themeOverrides || themeOverrides);
      applyUiSettingsVisuals(true);
      renderThemeOverridesList();
      updateChatFrequencyDisplay();
      break;
    case "themeOverrideState":
      themeOverrides = normalizeThemeOverrides(data.themeOverrides || themeOverrides);
      renderThemeOverridesList();
      updateChatFrequencyDisplay();
      break;
    case "uiDefaultsApplied":
      uiSettings = normalizeUiSettings(data.ui, getDefaultUiSettings());
      themeOverrides = normalizeThemeOverrides(data.themeOverrides || getDefaultThemeOverrides());
      applyUiSettingsVisuals(true);
      renderThemeOverridesList();
      updateChatFrequencyDisplay();
      if (data.cleared === true) {
        messageHistory = [];
        filterMessages();
      }
      break;
    case "forceHideAll":
      if (layoutModeOpen) {
        closeLayoutMode(false, false);
      }
      hideNuiElement("#radio-interface");
      hideNuiElement("#chat-interface");
      hideNuiElement("#input-prompt-overlay");
      hideNuiElement("#macro-modal-overlay");
      hideNuiElement("#delete-macro-overlay");
      closeClearCacheConfirm();
      settingsOpen = false;
      if (dom.settingsOverlay) {
        dom.settingsOverlay.classList.add("hidden");
      }
      if (dom.layoutModeOverlay) {
        dom.layoutModeOverlay.classList.add("hidden");
      }
      $("body").removeClass("layout-mode-open");
      hideMacroSuggestions();
      $("#btn-settings").removeClass("active");
      if (visualizerIntervalId) {
        clearInterval(visualizerIntervalId);
        visualizerIntervalId = null;
      }
      break;
    case "setSounds":
      soundsEnabled = !!data.enabled;
      soundVolume = Number.isFinite(Number(data.volume)) ? Number(data.volume) : 0.3;
      Object.values(sounds).forEach((sound) => {
        if (sound) {
          sound.volume = soundVolume;
        }
      });
      break;
    case "updateFreqCount": {
      const freq = normalizeFrequency(data.frequency);
      if (freq) {
        freqCounts[freq] = tonumberSafe(data.count);
        updateFrequencyDisplay("primary", currentPrimaryFreq);
        updateFrequencyDisplay("secondary", currentSecondaryFreq);
        updateChatFrequencyDisplay();
      }
      break;
    }
    case "autoScrollToBottom":
      if (autoScrollEnabled) {
        scrollToBottom();
      }
      break;
    case "requestSwitchChannel":
      if (!layoutModeOpen && !$("#chat-interface").hasClass("hidden")) {
        switchFrequency();
      }
      break;
    case "receiveUserMacros":
      userMacros = toArray(data.macros).map((entry) => ({
        id: Number(entry.id),
        label: String(entry.label || ""),
        value: String(entry.value || ""),
        description: entry.description ? String(entry.description) : ""
      }));
      loadMacros();
      updateMacroSuggestions();
      break;
    case "macroSaved":
      break;
    case "macroDeleted":
      handleMacroDeletedAck(data.success === true);
      break;
    default:
      break;
  }
});

function handleGlobalKeyDown(event) {
  if (event.key === "Escape") {
    if (!$("#clear-cache-overlay").hasClass("hidden")) {
      event.preventDefault();
      closeClearCacheConfirm();
      return;
    }

    if (!$("#delete-macro-overlay").hasClass("hidden")) {
      event.preventDefault();
      closeDeleteMacroConfirm();
      return;
    }

    if (!$("#input-prompt-overlay").hasClass("hidden")) {
      event.preventDefault();
      $("#input-prompt-overlay").addClass("hidden");
      pendingInputResolver = null;
      return;
    }

    if (layoutModeOpen) {
      event.preventDefault();
      closeLayoutMode(false, true);
      return;
    }

    if (!$("#macro-modal-overlay").hasClass("hidden")) {
      event.preventDefault();
      toggleMacroModal();
      return;
    }

    if (settingsOpen) {
      event.preventDefault();
      toggleSettingsPanel(false);
      return;
    }

    if (!$("#radio-interface").hasClass("hidden")) {
      event.preventDefault();
      closeRadio();
      return;
    }

    if (!$("#chat-interface").hasClass("hidden")) {
      event.preventDefault();
      closeChat();
    }
  }

  if (event.key === "Tab" && !layoutModeOpen && !$("#chat-interface").hasClass("hidden")) {
    if (handleSuggestionNavigation(event)) {
      return;
    }

    event.preventDefault();
    switchFrequency();
  }
}

$(document).ready(() => {
  const ns = ".radioNui";

  cacheDom();
  initSounds();
  document.body.style.pointerEvents = "none";
  applyUiSettingsVisuals(false);

  $(document).off(ns);
  $(window).off(ns);

  $(document).off(`click${ns}`, ".btn-macro").on(`click${ns}`, ".btn-macro", () => {
    toggleMacroModal();
  });

  $(document).off(`click${ns}`, ".macro-item").on(`click${ns}`, ".macro-item", function handleMacroItemClick(event) {
    if ($(event.target).closest(".btn-delete-macro").length) {
      return;
    }

    const encodedLabel = $(this).attr("data-label") || "";
    const encodedValue = $(this).attr("data-value") || "";
    handleMacroClick(decodeURIComponent(encodedLabel), decodeURIComponent(encodedValue));
  });

  $(document).off(`click${ns}`, ".btn-delete-macro").on(`click${ns}`, ".btn-delete-macro", function handleDeleteClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const id = Number($(this).attr("data-id"));
    if (!Number.isFinite(id)) {
      return;
    }

    openDeleteMacroConfirm(id);
  });

  $(document).off(`click${ns}`, ".macro-suggestion-item").on(`click${ns}`, ".macro-suggestion-item", function handleSuggestionClick() {
    const index = Number($(this).attr("data-index"));
    if (!Number.isFinite(index)) {
      return;
    }
    applyMacroSuggestion(index);
  });

  $(document).off(`click${ns}`, ".btn-delete-theme").on(`click${ns}`, ".btn-delete-theme", function handleThemeDelete() {
    const mode = String($(this).attr("data-mode") || "");

    if (mode === "exact") {
      const frequency = String($(this).attr("data-frequency") || "");
      if (!frequency) {
        return;
      }
      deleteThemeOverride("exact", frequency, null);
      return;
    }

    if (mode === "range") {
      const index = Number($(this).attr("data-index"));
      if (!Number.isFinite(index)) {
        return;
      }
      deleteThemeOverride("range", null, index);
    }
  });

  $(document).off(`change${ns}`, ".theme-override-color").on(`change${ns}`, ".theme-override-color", function handleThemeColorChange() {
    const mode = String($(this).attr("data-mode") || "");
    const accent = String($(this).val() || "");
    const preset = String($(this).attr("data-preset") || "");

    if (mode === "exact") {
      const frequency = String($(this).attr("data-frequency") || "");
      if (!frequency) {
        return;
      }
      saveThemeOverrideColor("exact", accent, { frequency, preset });
      return;
    }

    if (mode === "range") {
      const min = String($(this).attr("data-min") || "");
      const max = String($(this).attr("data-max") || "");
      if (!min || !max) {
        return;
      }
      saveThemeOverrideColor("range", accent, { min, max, preset });
    }
  });

  $("#chat-input").off(ns)
    .on(`input${ns}`, () => {
      updateCharCount();
      updateMacroSuggestions();
    })
    .on(`keydown${ns}`, (event) => {
      if (handleSuggestionNavigation(event)) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        sendMessage();
      }
    });

  $("#macro-search-input").off(ns).on(`input${ns}`, () => {
    filterMacros();
  });

  $("#delete-macro-overlay").off(ns).on(`click${ns}`, (event) => {
    if (event.target && event.target.id === "delete-macro-overlay") {
      closeDeleteMacroConfirm();
    }
  });

  if (dom.settingsAutoScroll) {
    $(dom.settingsAutoScroll).off(ns).on(`change${ns}`, function onAutoScrollChange() {
      toggleAutoScroll(this.checked);
    });
  }

  if (dom.settingsRelayPrimary) {
    $(dom.settingsRelayPrimary).off(ns).on(`change${ns}`, function onRelayPrimaryChange() {
      toggleChatRelay("primary", this.checked);
    });
  }

  if (dom.settingsRelaySecondary) {
    $(dom.settingsRelaySecondary).off(ns).on(`change${ns}`, function onRelaySecondaryChange() {
      toggleChatRelay("secondary", this.checked);
    });
  }

  if (dom.settingsThemePreset) {
    $(dom.settingsThemePreset).off(ns).on(`change${ns}`, function onThemePresetChange() {
      uiSettings.theme.preset = normalizePreset(this.value, uiSettings.theme.preset);
      applyUiSettingsVisuals(true);
      updateChatFrequencyDisplay();
      scheduleUiSave();
    });
  }

  if (dom.settingsThemeAccent) {
    $(dom.settingsThemeAccent).off(ns).on(`input${ns}`, function onThemeAccentInput() {
      uiSettings.theme.accent = normalizeColor(this.value, uiSettings.theme.accent);
      applyUiSettingsVisuals(true);
      updateChatFrequencyDisplay();
      scheduleUiSave();
    });
  }

  if (dom.themeToggleRange) {
    $(dom.themeToggleRange).off(ns).on(`click${ns}`, () => {
      if (!themeRangeEnabled) {
        const hasBase = normalizeFrequency(dom.settingsThemeBase && dom.settingsThemeBase.value);
        if (!hasBase) {
          return;
        }
      }
      setThemeRangeEnabled(!themeRangeEnabled, false);
    });
  }

  if (dom.settingsThemeBase) {
    $(dom.settingsThemeBase).off(ns).on(`input${ns}`, () => {
      const hasBase = normalizeFrequency(dom.settingsThemeBase.value);
      if (!hasBase && themeRangeEnabled) {
        setThemeRangeEnabled(false, false);
      }
    });
  }

  if (dom.themeSaveEntry) {
    $(dom.themeSaveEntry).off(ns).on(`click${ns}`, () => {
      saveThemeOverrideEntry();
    });
  }

  if (dom.openLayoutMode) {
    $(dom.openLayoutMode).off(ns).on(`click${ns}`, () => {
      enterLayoutMode();
    });
  }

  $("#setting-reset-defaults").off(ns).on(`click${ns}`, () => {
    resetUiDefaults();
  });

  $("#setting-clear-cache").off(ns).on(`click${ns}`, () => {
    clearCache();
  });

  if (dom.clearCacheCancel) {
    $(dom.clearCacheCancel).off(ns).on(`click${ns}`, () => {
      closeClearCacheConfirm();
    });
  }

  if (dom.clearCacheConfirm) {
    $(dom.clearCacheConfirm).off(ns).on(`click${ns}`, () => {
      confirmClearCache();
    });
  }

  if (dom.clearCacheOverlay) {
    $(dom.clearCacheOverlay).off(ns).on(`click${ns}`, (event) => {
      if (event.target && event.target.id === "clear-cache-overlay") {
        closeClearCacheConfirm();
      }
    });
  }

  [dom.layoutTargetRadio, dom.layoutTargetChat, dom.layoutTargetMacro].forEach((button) => {
    if (!button) {
      return;
    }
    $(button).off(ns).on(`click${ns}`, () => {
      const name = String(button.getAttribute("data-interface") || "");
      setLayoutTarget(name);
    });
  });

  if (dom.layoutSizeMinus) {
    $(dom.layoutSizeMinus).off(ns).on(`click${ns}`, () => {
      changeSelectedInterfaceSize(-INTERFACE_SCALE_STEP);
    });
  }

  if (dom.layoutSizePlus) {
    $(dom.layoutSizePlus).off(ns).on(`click${ns}`, () => {
      changeSelectedInterfaceSize(INTERFACE_SCALE_STEP);
    });
  }

  if (dom.layoutSizeReset) {
    $(dom.layoutSizeReset).off(ns).on(`click${ns}`, () => {
      resetSelectedInterfaceSize();
    });
  }

  if (dom.layoutTextMinus) {
    $(dom.layoutTextMinus).off(ns).on(`click${ns}`, () => {
      changeTextSize(-TEXT_SCALE_STEP);
    });
  }

  if (dom.layoutTextPlus) {
    $(dom.layoutTextPlus).off(ns).on(`click${ns}`, () => {
      changeTextSize(TEXT_SCALE_STEP);
    });
  }

  if (dom.layoutTextReset) {
    $(dom.layoutTextReset).off(ns).on(`click${ns}`, () => {
      resetTextSize();
    });
  }

  if (dom.layoutCancel) {
    $(dom.layoutCancel).off(ns).on(`click${ns}`, () => {
      closeLayoutMode(false, true);
    });
  }

  if (dom.layoutSave) {
    $(dom.layoutSave).off(ns).on(`click${ns}`, () => {
      closeLayoutMode(true, true);
    });
  }

  if (dom.radioPanel) {
    $(dom.radioPanel).off(ns).on(`pointerdown${ns}`, (event) => beginMoveDrag("radio", event));
  }

  if (dom.chatPanel) {
    $(dom.chatPanel).off(ns).on(`pointerdown${ns}`, (event) => beginMoveDrag("chat", event));
  }

  if (dom.macroPanel) {
    $(dom.macroPanel).off(ns).on(`pointerdown${ns}`, (event) => beginMoveDrag("macro", event));
  }

  $(window)
    .on(`pointermove${ns}`, (event) => {
      updateMoveDrag(event.clientX, event.clientY);
    })
    .on(`pointerup${ns}`, (event) => {
      endMoveDrag(event);
    })
    .on(`pointercancel${ns}`, (event) => {
      endMoveDrag(event);
    })
    .on(`resize${ns}`, () => {
      applyUiSettingsVisuals(true);
    });

  $(document).on(`keydown${ns}`, handleGlobalKeyDown);

  postToResource("nuiReady", {}).catch(() => {});
});

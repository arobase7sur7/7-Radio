const RESOURCE_NAME = typeof GetParentResourceName !== "undefined" ? GetParentResourceName() : window.location.host;
const MAX_MACRO_SUGGESTIONS = 6;

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

function tonumberSafe(value) {
  const num = parseInt(value, 10);
  return Number.isFinite(num) ? num : 0;
}

function getActiveFrequency() {
  return activeFrequency === "secondary" ? currentSecondaryFreq : currentPrimaryFreq;
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
    $("#chat-input").focus();
    playSound("radioOn");

    loadMacros();
    updateMacroSuggestions();

    if (autoScrollEnabled) {
      setTimeout(scrollToBottom, 50);
    }

    if (!visualizerIntervalId) {
      visualizerIntervalId = setInterval(animateVisualizer, 150);
    }
    return;
  }

  hideNuiElement("#chat-interface");
  hideMacroSuggestions();
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
  const defaultColor = "#00ffa3";

  if (frequency) {
    const config = freqConfigs[frequency] || {};
    const accent = config.color || defaultColor;
    const label = config.label || (activeFrequency === "primary" ? "CHANNEL 1" : "CHANNEL 2");
    const count = freqCounts[frequency] || 0;

    document.documentElement.style.setProperty("--accent-green", accent);
    $("#chat-freq-display").text(`${frequency} MHz (${count})`);
    $("#channel-type").text(label);
  } else {
    document.documentElement.style.setProperty("--accent-green", defaultColor);
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
  const channel = activeFrequency === "secondary" ? "secondary" : "primary";
  const hasFrequency = channel === "primary" ? !!currentPrimaryFreq : !!currentSecondaryFreq;
  const enabled = !!chatRelayState[channel];
  const button = $("#btn-chat-relay");

  if (!button.length) {
    return;
  }

  if (!hasFrequency) {
    button.prop("disabled", true).removeClass("active").text("CHAT OFF");
    return;
  }

  button.prop("disabled", false);
  button.toggleClass("active", enabled);
  button.text(enabled ? "CHAT ON" : "CHAT OFF");
}

function toggleChatRelay() {
  const channel = activeFrequency === "secondary" ? "secondary" : "primary";

  postToResource("toggleChatRelay", { channel })
    .then((response) => {
      if (!response) {
        return;
      }

      chatRelayState.primary = !!response.primaryChatRelay;
      chatRelayState.secondary = !!response.secondaryChatRelay;
      updateChatRelayButton();
    })
    .catch(() => {});
}
function filterMessages() {
  const current = getActiveFrequency();
  const container = $("#chat-messages");
  container.empty();

  if (!current) {
    scrollToBottom();
    return;
  }

  messageHistory.forEach((message) => {
    if (message.frequency === current) {
      displayMessage(message.sender, message.message, message.isMe, message.timestamp);
    }
  });

  scrollToBottom();
}

function addMessage(frequency, sender, message, senderId, isMe, timestamp) {
  const freq = normalizeFrequency(frequency);
  if (!freq) {
    return;
  }

  const entry = {
    frequency: freq,
    sender: sender,
    message: message,
    timestamp: timestamp || Date.now(),
    senderId: senderId,
    isMe: !!isMe
  };

  messageHistory.push(entry);

  if (messageHistory.length > 400) {
    messageHistory = messageHistory.slice(-400);
  }

  const current = getActiveFrequency();
  if (current && current === freq) {
    displayMessage(sender, message, !!isMe, entry.timestamp);

    if (!isMe) {
      playSound("msgIn");
      for (let i = 0; i < 5; i += 1) {
        setTimeout(animateVisualizer, i * 100);
      }
    }
  }
}

function displayMessage(sender, message, isMe, timestamp) {
  const time = formatTime(timestamp);
  const formatted = formatMessageContent(message);

  const html = `
    <div class="chat-message ${isMe ? "own-message" : ""}">
      <div class="message-header">
        <span class="message-sender">${escapeHtml(sender)}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-content">${formatted}</div>
    </div>
  `;

  $("#chat-messages").append(html);

  if (autoScrollEnabled) {
    scrollToBottom();
  }
}

function toggleAutoScroll() {
  autoScrollEnabled = !autoScrollEnabled;
  $("#btn-pause-scroll").toggleClass("active", !autoScrollEnabled);

  if (autoScrollEnabled) {
    scrollToBottom();
  }
}

function sendMessage() {
  const text = $("#chat-input").val();
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

  playSound("msgSent");
  for (let i = 0; i < 3; i += 1) {
    setTimeout(animateVisualizer, i * 100);
  }

  postToResource("sendMessage", {
    message: resolved,
    frequency
  })
    .then((response) => {
      if (response && response.success) {
        $("#chat-input").val("");
        updateCharCount();
        hideMacroSuggestions();
      }
    })
    .catch(() => {});
}

function closeChat() {
  hideNuiElement("#chat-interface");
  hideMacroSuggestions();
  playSound("radioOff");

  if (visualizerIntervalId) {
    clearInterval(visualizerIntervalId);
    visualizerIntervalId = null;
  }

  postToResource("close", { type: "chat" }).catch(() => {});
}

function updateCharCount() {
  const count = ($("#chat-input").val() || "").length;
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
  const node = document.getElementById("chat-messages");
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
  const value = $("#chat-input").val() || "";
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
  $("#chat-input").val("");
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
      isMe
    });
  });

  messageHistory.sort((a, b) => a.timestamp - b.timestamp);
  if (messageHistory.length > 400) {
    messageHistory = messageHistory.slice(-400);
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
      addMessage(data.frequency, data.sender, data.message, data.senderId, data.isMe, data.timestamp);
      break;
    case "updatePlaceholders":
      resolvedPlaceholders = { ...resolvedPlaceholders, ...data.data };
      break;
    case "syncFrequencies":
      applyFrequencySync(data);
      break;
    case "forceHideAll":
      hideNuiElement("#radio-interface");
      hideNuiElement("#chat-interface");
      hideNuiElement("#input-prompt-overlay");
      hideNuiElement("#macro-modal-overlay");
      hideNuiElement("#delete-macro-overlay");
      hideMacroSuggestions();
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
      if (!$("#chat-interface").hasClass("hidden")) {
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

$(document).ready(() => {
  initSounds();
  document.body.style.pointerEvents = "none";

  $(document).on("click", ".btn-macro", () => {
    toggleMacroModal();
  });

  $(document).on("click", ".macro-item", function handleMacroItemClick(event) {
    if ($(event.target).closest(".btn-delete-macro").length) {
      return;
    }

    const encodedLabel = $(this).attr("data-label") || "";
    const encodedValue = $(this).attr("data-value") || "";

    handleMacroClick(decodeURIComponent(encodedLabel), decodeURIComponent(encodedValue));
  });

  $(document).on("click", ".btn-delete-macro", function handleDeleteClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const id = Number($(this).attr("data-id"));
    if (!Number.isFinite(id)) {
      return;
    }

    openDeleteMacroConfirm(id);
  });

  $(document).on("click", ".macro-suggestion-item", function handleSuggestionClick() {
    const index = Number($(this).attr("data-index"));
    if (!Number.isFinite(index)) {
      return;
    }
    applyMacroSuggestion(index);
  });

  $("#chat-input").on("input", () => {
    updateCharCount();
    updateMacroSuggestions();
  });

  $("#chat-input").on("keydown", (event) => {
    if (handleSuggestionNavigation(event)) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  });

  $("#macro-search-input").on("input", () => {
    filterMacros();
  });

  $("#delete-macro-overlay").on("click", (event) => {
    if (event.target && event.target.id === "delete-macro-overlay") {
      closeDeleteMacroConfirm();
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("#delete-macro-overlay").hasClass("hidden")) {
      event.preventDefault();
      closeDeleteMacroConfirm();
      return;
    }

    if (!$("#macro-modal-overlay").hasClass("hidden")) {
      event.preventDefault();
      toggleMacroModal();
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

  if (event.key === "Tab" && !$("#chat-interface").hasClass("hidden")) {
    if (handleSuggestionNavigation(event)) {
      return;
    }

    event.preventDefault();
    switchFrequency();
  }
});

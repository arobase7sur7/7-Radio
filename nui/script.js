const RESOURCE_NAME = (typeof GetParentResourceName !== 'undefined') ? GetParentResourceName() : window.location.host;

function postToResource(path, data) {
  return fetch(`https://${RESOURCE_NAME}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data || {})
  }).then(resp => resp.json());
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
const sounds = {
  radioOn: null,
  radioOff: null,
  freqChange: null,
  msgIn: null,
  msgSent: null,
  button: null,
};

let userMacros = [];
let resolvedPlaceholders = {
  location: "Unknown",
  locationCoords: null,
  hour: "00:00",
  name: "Unknown",
  surname: "Unknown",
  job: "Unknown",
  rank: "Unknown",
  citizenid: null
};
let chatRelayState = {
  primary: false,
  secondary: false,
};
let Config = {
  GlobalMacros: []
};

let currentMacroCategory = 'all';

function initSounds() {
  sounds.radioOn = document.getElementById("audio-radio-on");
  sounds.radioOff = document.getElementById("audio-radio-off");
  sounds.freqChange = document.getElementById("audio-freq-change");
  sounds.msgIn = document.getElementById("audio-msg-in");
  sounds.msgSent = document.getElementById("audio-msg-sent");
  sounds.button = document.getElementById("audio-button");

  sounds.radioOn.src = "sounds/radio_on.ogg";
  sounds.radioOff.src = "sounds/radio_off.ogg";
  sounds.freqChange.src = "sounds/frequency_change.ogg";
  sounds.msgIn.src = "sounds/message_in.ogg";
  sounds.msgSent.src = "sounds/message_sent.ogg";
  sounds.button.src = "sounds/button_click.ogg";

  Object.values(sounds).forEach((sound) => {
    if (sound) sound.volume = soundVolume;
  });
}

function playSound(soundName) {
  if (!soundsEnabled || !sounds[soundName]) return;

  const sound = sounds[soundName];
  sound.currentTime = 0;
  sound.play().catch((e) => console.log("Error:", e));
}

function animateVisualizer() {
  const bars = document.querySelectorAll(".wave-bar");
  bars.forEach((bar, index) => {
    const randomHeight = Math.random() * 80 + 20;
    bar.style.height = randomHeight + "%";
  });
}

window.addEventListener("message", function (event) {
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
      addMessage(
        data.frequency,
        data.sender,
        data.message,
        data.senderId,
        data.isMe
      );
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
      if (visualizerIntervalId) {
        clearInterval(visualizerIntervalId);
        visualizerIntervalId = null;
      }
      break;
    case "setSounds":
      soundsEnabled = data.enabled;
      soundVolume = data.volume || 0.3;
      Object.values(sounds).forEach((sound) => {
        if (sound) sound.volume = soundVolume;
      });
      break;
    case "updateFreqCount":
      if (data.frequency) {
        freqCounts[data.frequency] = tonumberSafe(data.count);
        updateFrequencyDisplay("primary", currentPrimaryFreq);
        updateFrequencyDisplay("secondary", currentSecondaryFreq);
        updateChatFrequencyDisplay();
      }
      break;
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
      userMacros = data.macros || [];
      loadMacros();
      break;
    case "macroSaved":

      break;
  }
});

function tonumberSafe(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

$(document).ready(function () {
  initSounds();

  $(document).on("click", ".btn-macro", function () {
    toggleMacroModal();
  });

  $(document).on("click", ".macro-item", function (event) {
    if ($(event.target).closest(".btn-delete-macro").length) return;

    const encodedLabel = $(this).attr("data-label") || "";
    const encodedValue = $(this).attr("data-value") || "";
    const label = decodeURIComponent(encodedLabel);
    const value = decodeURIComponent(encodedValue);

    handleMacroClick(label, value);
  });

  $(document).on("click", ".btn-delete-macro", function (event) {
    event.preventDefault();
    event.stopPropagation();

    const id = Number($(this).attr("data-id"));
    if (!Number.isFinite(id)) return;

    deleteUserMacro(id);
  });
});

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    if (!$("#radio-interface").hasClass("hidden")) {
      event.preventDefault();
      closeRadio();
    }
    if (!$("#chat-interface").hasClass("hidden")) {
      event.preventDefault();
      closeChat();
    }
  }

  if (event.key === "Tab" && !$("#chat-interface").hasClass("hidden")) {
    event.preventDefault();
    switchFrequency();
  }
});

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
  const previousPrimary = currentPrimaryFreq;
  const previousSecondary = currentSecondaryFreq;

  currentPrimaryFreq = data.primary ?? null;
  currentSecondaryFreq = data.secondary ?? null;
  activeFrequency = data.activeFreq || activeFrequency || "primary";

  if (!currentPrimaryFreq || previousPrimary !== currentPrimaryFreq) {
    chatRelayState.primary = !!data.primaryChatRelay;
  }
  if (!currentSecondaryFreq || previousSecondary !== currentSecondaryFreq) {
    chatRelayState.secondary = !!data.secondaryChatRelay;
  }

  if (activeFrequency === "primary" && !currentPrimaryFreq && currentSecondaryFreq) {
    activeFrequency = "secondary";
  } else if (activeFrequency === "secondary" && !currentSecondaryFreq && currentPrimaryFreq) {
    activeFrequency = "primary";
  }

  updateFrequencyDisplay("primary", currentPrimaryFreq);
  updateFrequencyDisplay("secondary", currentSecondaryFreq);
  updateChatFrequencyDisplay();
  filterMessages();
  updateChatRelayButton();
}

function toggleRadio(show, primary, secondary, globalMacros, allMacroSets) {
  if (show) {
    currentPrimaryFreq = primary;
    currentSecondaryFreq = secondary;

    if (globalMacros) Config.GlobalMacros = globalMacros;
    if (allMacroSets) Object.assign(Config, allMacroSets);

    updateFrequencyDisplay("primary", primary);
    updateFrequencyDisplay("secondary", secondary);

    showNuiElement("#radio-interface");
    playSound("radioOn");
  } else {
    hideNuiElement("#radio-interface");
    playSound("radioOff");

    postToResource("nuiClosed", {});
  }
}

function updateFrequencyDisplay(type, frequency) {
  const displayId =
    type === "primary" ? "#primary-display-lcd" : "#secondary-display-lcd";
  const value = frequency || "---";
  const count = frequency ? freqCounts[frequency] || 0 : 0;
  const text = frequency ? `${value} (${count})` : value;
  $(displayId).text(text);
}

function setFrequency(type) {
  const inputId = type === "primary" ? "#primary-freq" : "#secondary-freq";
  const frequency = parseFloat($(inputId).val());

  if (!frequency || isNaN(frequency)) return;

  playSound("button");

  const roundedFreq = parseFloat(frequency).toFixed(2);

  postToResource("setFrequency", {
    frequency: roundedFreq,
    isPrimary: type === "primary",
  })
    .then(function (response) {
      if (response && response.success) {
        $(inputId).val("");

        currentPrimaryFreq = response.primary ?? currentPrimaryFreq;
        currentSecondaryFreq = response.secondary ?? currentSecondaryFreq;
        activeFrequency = response.activeFreq || activeFrequency;
        chatRelayState.primary = !!response.primaryChatRelay;
        chatRelayState.secondary = !!response.secondaryChatRelay;

        updateFrequencyDisplay("primary", currentPrimaryFreq);
        updateFrequencyDisplay("secondary", currentSecondaryFreq);
        updateChatFrequencyDisplay();
        updateChatRelayButton();

        if (!$("#chat-interface").hasClass("hidden")) {
          filterMessages();
        }

        playSound("freqChange");
      }
    })
    .catch(function (error) {
      console.error(`[${RESOURCE_NAME}] error POST:`, error);
    });
}

function openChat() {
  playSound("button");
  postToResource("openChatFromRadio", {});
}

function closeRadio() {
  hideNuiElement("#radio-interface");
  playSound("radioOff");
  postToResource("close", { type: "radio" });
}

function toggleChat(show, primary, secondary, activeFreq, primaryChatRelay, secondaryChatRelay, globalMacros, allMacroSets) {
  if (show) {
    currentPrimaryFreq = primary;
    currentSecondaryFreq = secondary;
    activeFrequency = activeFreq || "primary";
    chatRelayState.primary = !!primaryChatRelay;
    chatRelayState.secondary = !!secondaryChatRelay;

    if (globalMacros) Config.GlobalMacros = globalMacros;
    if (allMacroSets) Object.assign(Config, allMacroSets);

    updateChatFrequencyDisplay();
    filterMessages();
    updateChatRelayButton();

    showNuiElement("#chat-interface");
    $("#chat-input").focus();
    playSound("radioOn");

    loadMacros();

    if (autoScrollEnabled) {
      setTimeout(scrollToBottom, 50);
    }

    if (!visualizerIntervalId)
      visualizerIntervalId = setInterval(animateVisualizer, 150);
  } else {
    hideNuiElement("#chat-interface");
    playSound("radioOff");

    if (visualizerIntervalId) {
      clearInterval(visualizerIntervalId);
      visualizerIntervalId = null;
    }

    postToResource("nuiClosed", {});
  }
}

function updateChatFrequencyDisplay() {
  const freq =
    activeFrequency === "primary" ? currentPrimaryFreq : currentSecondaryFreq;
  const defaultGreen = "#00ffa3";

  if (freq) {
    const freqStr = parseFloat(freq).toFixed(2);
    const freqConfig = freqConfigs[freqStr];
    const accentColor = (freqConfig && freqConfig.color) ? freqConfig.color : defaultGreen;
    const defaultType = activeFrequency === "primary" ? "CHANNEL 1" : "CHANNEL 2";
    const label = (freqConfig && freqConfig.label) ? freqConfig.label : defaultType;
    const count = freqCounts[freq] || 0;

    document.documentElement.style.setProperty('--accent-green', accentColor);
    $("#chat-freq-display").text(`${freq} MHz (${count})`);
    $("#channel-type").text(label);
  } else {
    const fallbackType = activeFrequency === "primary" ? "CHANNEL 1" : "CHANNEL 2";
    document.documentElement.style.setProperty('--accent-green', defaultGreen);
    $("#chat-freq-display").text("---");
    $("#channel-type").text(fallbackType);
  }

  const otherType = activeFrequency === "primary" ? "CH2" : "CH1";
  const otherFreq =
    activeFrequency === "primary" ? currentSecondaryFreq : currentPrimaryFreq;
  const otherConfig = freqConfigs[otherFreq];
  const otherLabel = (otherConfig && otherConfig.label) ? otherConfig.label : otherType;

  if (otherFreq) {
    const otherCount = freqCounts[otherFreq] || 0;
    $("#switch-text").text(otherLabel + " (" + otherCount + ")");
    $(".btn-switch").prop("disabled", false);
  } else {
    $("#switch-text").text("N/A");
    $(".btn-switch").prop("disabled", true);
  }
}

function switchFrequency() {
  playSound("freqChange");

  postToResource("switchFrequency", {}).then(function (response) {
    activeFrequency = response.activeFreq;
    chatRelayState.primary = !!response.primaryChatRelay;
    chatRelayState.secondary = !!response.secondaryChatRelay;
    updateChatFrequencyDisplay();
    filterMessages();
    updateChatRelayButton();
  });
}

function updateChatRelayButton() {
  const channel = activeFrequency === "secondary" ? "secondary" : "primary";
  const hasFrequency = channel === "primary" ? !!currentPrimaryFreq : !!currentSecondaryFreq;
  const isEnabled = !!chatRelayState[channel];
  const button = $("#btn-chat-relay");

  if (!button.length) return;

  if (!hasFrequency) {
    button.prop("disabled", true).removeClass("active").text("CHAT OFF");
    return;
  }

  button.prop("disabled", false);
  button.toggleClass("active", isEnabled);
  button.text(isEnabled ? "CHAT ON" : "CHAT OFF");
}

function toggleChatRelay() {
  const channel = activeFrequency === "secondary" ? "secondary" : "primary";

  postToResource("toggleChatRelay", { channel }).then(function (response) {
    if (!response) return;

    chatRelayState.primary = !!response.primaryChatRelay;
    chatRelayState.secondary = !!response.secondaryChatRelay;
    updateChatRelayButton();
  });
}

function filterMessages() {
  const currentFreq =
    activeFrequency === "primary" ? currentPrimaryFreq : currentSecondaryFreq;

  $("#chat-messages").empty();

  if (!currentFreq) {
    scrollToBottom();
    return;
  }

  const currentFreqStr = parseFloat(currentFreq).toFixed(2);

  messageHistory.forEach((msg) => {
    if (parseFloat(msg.frequency).toFixed(2) === currentFreqStr) {
      displayMessage(msg.sender, msg.message, msg.isMe, msg.timestamp);
    }
  });

  scrollToBottom();
}

function addMessage(frequency, sender, message, senderId, isMe, timestamp) {
  const freqStr = parseFloat(frequency).toFixed(2);

  const msgData = {
    frequency: freqStr,
    sender: sender,
    message: message,
    timestamp: timestamp || Date.now(),
    senderId: senderId,
    isMe: isMe
  };

  messageHistory.push(msgData);



  const currentFreq =
    activeFrequency === "primary" ? currentPrimaryFreq : currentSecondaryFreq;
  if (currentFreq && parseFloat(freqStr).toFixed(2) === parseFloat(currentFreq).toFixed(2)) {
    displayMessage(sender, message, isMe, msgData.timestamp);

    if (!isMe) {
      playSound("msgIn");

      for (let i = 0; i < 5; i++) {
        setTimeout(animateVisualizer, i * 100);
      }
    }
  }
}

function displayMessage(sender, message, isMe, timestamp) {
  const time = formatTime(timestamp);
  const formattedMessage = formatMessageContent(message);

  const messageHtml = `
        <div class="chat-message ${isMe ? "own-message" : ""}">
            <div class="message-header">
                <span class="message-sender">${escapeHtml(sender)}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">${formattedMessage}</div>
        </div>
    `;

  $("#chat-messages").append(messageHtml);
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
  const message = $("#chat-input").val().trim();

  if (!message) return;

  const frequency =
    activeFrequency === "primary" ? currentPrimaryFreq : currentSecondaryFreq;


  const resolvedMessage = resolveStaticPlaceholders(message);

  playSound("msgSent");

  for (let i = 0; i < 3; i++) {
    setTimeout(animateVisualizer, i * 100);
  }

  postToResource("sendMessage", {
    message: resolvedMessage,
    frequency: frequency,
  }).then(function (response) {
    if (response.success) {
      $("#chat-input").val("");
      updateCharCount();
    }
  });
}

function closeChat() {
  hideNuiElement("#chat-interface");
  playSound("radioOff");
  if (visualizerIntervalId) {
    clearInterval(visualizerIntervalId);
    visualizerIntervalId = null;
  }
  postToResource("close", { type: "chat" });
}

function handleKeyPress(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
}

$("#chat-input").on("input", function () {
  updateCharCount();
});

function updateCharCount() {
  const count = $("#chat-input").val().length;
  $("#char-count").text(count);

  if (count >= 250) {
    $("#char-count").css("color", "#ff4444");
  } else if (count >= 200) {
    $("#char-count").css("color", "#ffaa00");
  } else {
    $("#char-count").css("color", "#888");
  }
}

function scrollToBottom() {
  const chatBody = document.getElementById("chat-messages");
  if (chatBody) {
    chatBody.scrollTop = chatBody.scrollHeight;
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
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(text ?? "").replace(/[&<>"']/g, (m) => map[m]);
}

function formatMessageContent(message) {
  const escapedMessage = escapeHtml(message);
  const gpsTokenRegex = /%gpslink\|([^|]+)\|(-?\d+(?:\.\d+)?)\|(-?\d+(?:\.\d+)?)\|(-?\d+(?:\.\d+)?)%/g;

  return escapedMessage.replace(gpsTokenRegex, (match, label, x, y, z) => {
    return `<span class="gps-link" onclick="setGpsWaypoint(${x}, ${y}, ${z})">${label}</span>`;
  });
}

function sanitizeGpsLabel(label) {
  return String(label || "Unknown").replace(/[|%]/g, "").trim() || "Unknown";
}

function setGpsWaypoint(x, y, z) {
  playSound("button");
  postToResource("setWaypoint", { x, y, z });
}


function loadMacros() {
  console.log("[7-Radio] Starting loadMacros...");
  const currentFreq =
    activeFrequency === "primary" ? currentPrimaryFreq : currentSecondaryFreq;

  console.log("[7-Radio] Current Frequency:", currentFreq);
  if (!currentFreq) return;
  const freqStr = parseFloat(currentFreq).toFixed(2);
  const freqConfig = freqConfigs[freqStr];

  console.log("[7-Radio] Freq Config found:", !!freqConfig);
  if (freqConfig) console.log("[7-Radio] Freq Macros Key:", freqConfig.macros);

  let macros = [];


  let globalSet = (typeof Config !== "undefined") ? (Config.GlobalMacros || Config.GeneralMacros || []) : [];
  console.log("[7-Radio] raw globalSet:", globalSet);
  if (globalSet && !Array.isArray(globalSet)) {
    globalSet = Object.values(globalSet);
  }

  macros = globalSet.map(m => ({ ...m, type: 'global' }));
  console.log("[7-Radio] processed Global count:", macros.length);


  if (freqConfig && freqConfig.macros && typeof Config !== "undefined") {
    const macroKeys = Array.isArray(freqConfig.macros) ? freqConfig.macros : [freqConfig.macros];
    console.log("[7-Radio] macroKeys for this freq:", macroKeys);

    macroKeys.forEach(key => {
      let set = Config[key];
      if (set) {
        if (!Array.isArray(set)) set = Object.values(set);
        macros = [...macros, ...set.map(m => ({ ...m, type: key }))];
        console.log("[7-Radio] added set:", key, "new count:", macros.length);
      } else {
        console.warn("[7-Radio] macro set not found:", key);
      }
    });
  }


  console.log("[7-Radio] raw userMacros:", userMacros);
  macros = [...macros, ...userMacros.map((m) => ({ ...m, isUser: true, type: 'user' }))];

  console.log("[7-Radio] final macros Count:", macros.length);
  $(".macro-count").text(`${macros.length} available`);
  renderMacroList(macros);
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

  macros.forEach((macro) => {

    const type = macro.isUser ? 'user' : (macro.type === 'global' ? 'global' : 'job');
    const macroTypeLabel = macro.isUser ? "USER" : (macro.type === 'global' ? "GENERAL" : "JOB");
    const encodedLabel = encodeURIComponent(macro.label || "");
    const encodedValue = encodeURIComponent(macro.value || "");

    const item = $(`
      <div class="macro-item ${macro.isUser ? "user-macro" : ""}" data-type="${type}" data-label="${encodedLabel}" data-value="${encodedValue}">
        <span class="macro-tag">${macroTypeLabel}</span>
        <span class="macro-label">${escapeHtml(macro.label)}</span>
        <span class="macro-val">${escapeHtml(macro.value)}</span>
        ${macro.description ? `<span class="macro-desc">${escapeHtml(macro.description)}</span>` : ""}
        ${macro.isUser ? `<button class="btn-delete-macro" data-id="${macro.id}">Delete</button>` : ""}
      </div>
    `);
    list.append(item);
  });

  filterMacros();
}

let pendingInputResolver = null;

function handleMacroClick(label, val) {
  const macroValue = String(val || "");

  const inputs = Array.from(macroValue.matchAll(/%input(?::"([^"]*)")?%/g));

  if (inputs.length > 0) {
    processMacroInputs(macroValue, inputs, 0);
  } else {
    completeMacroSelection(macroValue);
  }
}

function processMacroInputs(originalVal, inputMatches, index) {
  if (index >= inputMatches.length) {

    completeMacroSelection(originalVal);
    return;
  }

  const tag = inputMatches[index][0];
  const customQuestion = (inputMatches[index][1] || "").trim();
  const promptLabel = customQuestion || `Input ${index + 1}`;

  openInputPrompt(promptLabel, (userInputValue) => {
    const replacement = String(userInputValue || "").trim();
    const newVal = originalVal.replace(tag, replacement);
    processMacroInputs(newVal, inputMatches, index + 1);
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
  if (!pendingInputResolver) return;

  const userInput = $("#prompt-input").val().trim();
  if (!userInput) return;

  const resolver = pendingInputResolver;
  pendingInputResolver = null;
  $("#input-prompt-overlay").addClass("hidden");
  resolver(userInput);
}

function completeMacroSelection(val) {

  const input = $("#chat-input");
  const currentVal = input.val();
  const newVal = currentVal ? (currentVal.endsWith(" ") ? currentVal + val : currentVal + " " + val) : val;
  input.val(newVal).focus();

  if (!$("#macro-modal-overlay").hasClass("hidden")) {
    toggleMacroModal();
  }
  updateCharCount();
}

function resolveStaticPlaceholders(text) {
  let val = text;
  const locationLabel = sanitizeGpsLabel(resolvedPlaceholders.location || "Unknown Location");
  const coords = resolvedPlaceholders.locationCoords || {};
  const x = Number(coords.x);
  const y = Number(coords.y);
  const z = Number(coords.z);

  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    const gpsToken = `%gpslink|${locationLabel}|${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}%`;
    val = val.replace(/%location%/g, gpsToken);
  } else {
    val = val.replace(/%location%/g, locationLabel);
  }

  val = val.replace(/%hour%/g, resolvedPlaceholders.hour || "00:00");
  val = val.replace(/%name%/g, resolvedPlaceholders.name || "Unknown");
  val = val.replace(/%surname%/g, resolvedPlaceholders.surname || "Unknown");
  val = val.replace(/%job%/g, resolvedPlaceholders.job || "None");
  val = val.replace(/%rank%/g, resolvedPlaceholders.rank || "None");
  return val;
}

function setGpsAtCurrent() {
  postToResource("setGpsAtCurrent", {});
}

function filterMacros() {
  const term = $("#macro-search-input").val().toLowerCase();

  $(".macro-item").each(function () {
    const type = $(this).attr("data-type");
    const text = $(this).text().toLowerCase();

    const matchesSearch = text.includes(term);
    const matchesCategory = (currentMacroCategory === 'all' || type === currentMacroCategory);

    if (matchesSearch && matchesCategory) {
      $(this).show();
    } else {
      $(this).hide();
    }
  });
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
  const desc = $("#new-macro-desc").val().trim();

  if (!label || !value) return;

  postToResource("saveUserMacro", { label, value, description: desc });
  closeCreateMacro();
}

function deleteUserMacro(id) {
  if (!window.confirm("Delete this personal macro?")) return;

  postToResource("deleteUserMacro", { id });


  userMacros = userMacros.filter(m => m.id !== id);
  loadMacros();
}

function toggleMacroModal() {
  playSound("button");
  const overlay = $("#macro-modal-overlay");
  if (overlay.hasClass("hidden")) {
    postToResource("fetchUserMacros", {});
    overlay.removeClass("hidden");
    $("#macro-search-input").val("").focus();
  } else {
    overlay.addClass("hidden");
    closeCreateMacro();
  }
}

function loadHistory(frequency, history, customData) {
  const freqStr = parseFloat(frequency).toFixed(2);

  if (customData) {
    freqConfigs[freqStr] = customData;
  }


  const targetFreq = parseFloat(frequency).toFixed(2);
  messageHistory = messageHistory.filter(msg => parseFloat(msg.frequency).toFixed(2) !== targetFreq);


  if (history) {
    history.forEach(msg => {

      const isMe = (msg.citizenid && resolvedPlaceholders.citizenid === msg.citizenid) ||
        (msg.sender === resolvedPlaceholders.name + " " + resolvedPlaceholders.surname);

      messageHistory.push({
        frequency: msg.frequency,
        sender: msg.sender,
        message: msg.message,
        timestamp: msg.timestamp || Date.now(),
        isMe: isMe
      });
    });
  }


  messageHistory.sort((a, b) => a.timestamp - b.timestamp);
  if (messageHistory.length > 200) {
    messageHistory = messageHistory.slice(-200);
  }

  if (!$("#chat-interface").hasClass("hidden")) {
    updateChatFrequencyDisplay();
    filterMessages();
  }
}



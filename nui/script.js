const RESOURCE_NAME = "7_radio";
function postToResource(path, data) {
  return $.post(`https://${RESOURCE_NAME}/${path}`, JSON.stringify(data || {}));
}

let currentPrimaryFreq = null;
let currentSecondaryFreq = null;
let activeFrequency = "primary";
let messageHistory = [];
let soundsEnabled = true;
let soundVolume = 0.3;
let visualizerIntervalId = null;
let freqCounts = {};

const sounds = {
  radioOn: null,
  radioOff: null,
  freqChange: null,
  msgIn: null,
  msgSent: null,
  button: null,
};

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
      toggleRadio(data.show, data.primary, data.secondary);
      break;
    case "toggleChat":
      toggleChat(data.show, data.primary, data.secondary, data.activeFreq);
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
    case "requestSwitchChannel":
      if (!$("#chat-interface").hasClass("hidden")) {
        switchFrequency();
      }
      break;
  }
});

function tonumberSafe(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

$(document).ready(function () {
  initSounds();
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

function toggleRadio(show, primary, secondary) {
  if (show) {
    currentPrimaryFreq = primary;
    currentSecondaryFreq = secondary;

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

  const roundedFreq = Math.round(frequency * 10) / 10;

  postToResource("setFrequency", {
    frequency: roundedFreq.toFixed(1),
    isPrimary: type === "primary",
  })
    .done(function (response) {
      if (response && response.success) {
        updateFrequencyDisplay(type, roundedFreq.toFixed(1));
        $(inputId).val("");

        if (type === "primary") {
          currentPrimaryFreq = roundedFreq.toFixed(1);
        } else {
          currentSecondaryFreq = roundedFreq.toFixed(1);
        }

        playSound("freqChange");
      }
    })
    .fail(function (error) {
      console.error("[7_RADIO] error POST:", error);
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

function toggleChat(show, primary, secondary, activeFreq) {
  if (show) {
    currentPrimaryFreq = primary;
    currentSecondaryFreq = secondary;
    activeFrequency = activeFreq || "primary";

    updateChatFrequencyDisplay();
    showNuiElement("#chat-interface");
    $("#chat-input").focus();
    playSound("radioOn");

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
  const type = activeFrequency === "primary" ? "CHANNEL 1" : "CHANNEL 2";

  const displayFreq = freq ? `${freq} MHz` : "---";
  const count = freq ? freqCounts[freq] || 0 : 0;
  $("#chat-freq-display").text(displayFreq + " (" + count + ")");
  $("#channel-type").text(type);

  const otherType = activeFrequency === "primary" ? "CH2" : "CH1";
  const otherFreq =
    activeFrequency === "primary" ? currentSecondaryFreq : currentPrimaryFreq;

  if (otherFreq) {
    const otherCount = freqCounts[otherFreq] || 0;
    $("#switch-icon").text("↔️ " + otherType + " (" + otherCount + ")");
    $(".btn-switch").prop("disabled", false);
  } else {
    $("#switch-icon").text("↔️ N/A");
    $(".btn-switch").prop("disabled", true);
  }
}

function switchFrequency() {
  playSound("freqChange");

  postToResource("switchFrequency", {}).done(function (response) {
    activeFrequency = response.activeFreq;
    updateChatFrequencyDisplay();
    filterMessages();
  });
}

function filterMessages() {
  const currentFreq =
    activeFrequency === "primary" ? currentPrimaryFreq : currentSecondaryFreq;

  $("#chat-messages").empty();

  messageHistory.forEach((msg) => {
    if (msg.frequency === currentFreq) {
      displayMessage(msg.sender, msg.message, msg.isMe, msg.timestamp);
    }
  });

  scrollToBottom();
}

function addMessage(frequency, sender, message, senderId, isMe) {
  const msgData = {
    frequency: frequency,
    sender: sender,
    message: message,
    senderId: senderId,
    isMe: isMe,
    timestamp: new Date(),
  };

  messageHistory.push(msgData);

  if (messageHistory.length > 50) {
    messageHistory.shift();
  }

  const currentFreq =
    activeFrequency === "primary" ? currentPrimaryFreq : currentSecondaryFreq;
  if (frequency === currentFreq) {
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

  const messageHtml = `
        <div class="chat-message ${isMe ? "own-message" : ""}">
            <div class="message-header">
                <span class="message-sender">${escapeHtml(sender)}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">${escapeHtml(message)}</div>
        </div>
    `;

  $("#chat-messages").append(messageHtml);
  scrollToBottom();
}

function sendMessage() {
  const message = $("#chat-input").val().trim();

  if (!message) return;

  const frequency =
    activeFrequency === "primary" ? currentPrimaryFreq : currentSecondaryFreq;

  playSound("msgSent");

  for (let i = 0; i < 3; i++) {
    setTimeout(animateVisualizer, i * 100);
  }

  postToResource("sendMessage", {
    message: message,
    frequency: frequency,
  }).done(function (response) {
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

function formatTime(date) {
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
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

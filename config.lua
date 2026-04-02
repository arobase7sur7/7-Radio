Config = {}

-- Keybind defaults
-- These are the DEFAULT keys assigned on first install only.
-- Players can rebind them at any time via: Pause Menu > Settings > Key Bindings > FiveM
-- Changing these values WILL NOT override a player's personal binding once they have set it.
Config.OpenRadioKey      = 'F9'   -- Default key to open / close the radio interface
Config.OpenChatKey       = 'F11'  -- Default key to open / close the radio chat
Config.SwitchFrequencyKey = 'TAB' -- Default key to switch between primary / secondary channel in radio chat

Config.RadioItem = 'radio' -- Name of the item needed to open the radio / put "none" or false to disable item needed

-- Chat relay output to the right tab when using my poodlechat remake resource, otherwise it will fallback to default chat output
Config.ChatRelay = {
    provider = 'auto', -- 'auto' = use poodlechat when available, otherwise default chat / 'poodlechat' / 'chat'
    poodleChatResource = 'poodlechat', -- Resource name used for exports
    targetChannel = 'radio', -- poodlechat target channel when provider is auto/poodlechat (example: 'local' or 'radio')
    fallbackToDefault = true -- When poodlechat fails/unavailable, fallback to TriggerEvent('chat:addMessage', ...)
}

-- Restricted frequencies
Config.RestrictedFrequencies = {
    -- Specific frequencies
    { freq = '100.00', jobs = {'police'}, label = 'POLICE', color = '#3498db', showJob = true, showJobRank = true, minGrade = 0, macros = {"PoliceMacros"} },
    { freq = '101.00', jobs = {'police:from2'}, label = 'POLICE-CMD', color = '#2980b9', showJob = true, showJobRank = true, macros = {"PoliceMacros"} },
    { freq = '102.00', jobs = {'ambulance:fixed4'}, label = 'EMS', color = '#e74c3c', showJob = true, showJobRank = false, macros = {"EMSMacros"} }, 
    { freq = '103.00', jobs = {'ambulance'}, label = 'EMS', color = '#e74c3c', showJob = true, showJobRank = false, macros = {"EMSMacros"} },
    { freq = '104.00', jobs = {'police:from5', 'ambulance:from2'}, label = 'CHIEF', color = '#8e44ad', showJob = true, showJobRank = true },
    { freq = '200.00', jobs = {'police', 'ambulance'}, label = 'URGENCE', color = '#f1c40f', showJob = true, showJobRank = false, macros = {"PoliceMacros", "EMSMacros"} }, -- Emergency shared

    -- Frequency ranges
    { min = 99.00, max = 99.99, jobs = {'police'}, label = 'P-TAC', color = '#3498db', showJob = true, macros = {"PoliceMacros"} },
    { min = 88.00, max = 88.99, jobs = {'ambulance'}, label = 'E-TAC', color = '#e74c3c', showJob = true, macros = {"EMSMacros"} },
    { min = 77.00, max = 77.99, jobs = {'police', 'ambulance'}, label = 'UTAC', color = '#f1c40f', showJob = true, macros = {"PoliceMacros", "EMSMacros"} },
}

-- General config
Config.MaxFrequency = 999.99
Config.MinFrequency = 1.00
Config.MaxMessageLength = 500 -- Character count
Config.ChatHistoryLimit = 100 -- Max number of messages to keep in database for chat history retrieval but infinite on client side for scrolling back through messages, erased after server restart or relogin

-- Animation
Config.UseAnimation = true
Config.AnimationDict = 'random@arrests'
Config.AnimationName = 'generic_radio_chatter'

-- Sounds
Config.Sounds = {
    enabled = true,
    volume = 0.3, 
    
    radioOpen = 'sounds/radio_on.ogg',
    radioClose = 'sounds/radio_off.ogg',
    frequencyChange = 'sounds/frequency_change.ogg',
    messageIn = 'sounds/message_in.ogg',
    messageSent = 'sounds/message_sent.ogg',
    buttonClick = 'sounds/button_click.ogg',
}

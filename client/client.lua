local QBCore = exports['qb-core']:GetCoreObject()

local PlayerData = {}
local radioItem = Config.RadioItem

local radioState = {
    radioOpen = false,
    chatOpen = false,
    primary = nil,
    secondary = nil,
    active = 'primary',
    chatRelay = {
        primary = false,
        secondary = false
    }
}

local radioNotifyCooldownMs = 5000
local radioNotifyPreviewLength = 80
local radioNotifyEnablePreview = false
local lastRadioNotify = {}

local statePersistencePrefix = '7_radio:state:'
local persistenceVersion = 2
local hasRestoredState = false
local restoreInProgress = false
local restoreWorkerRunning = false
local restoreDesiredState = nil
local restoreRetryCount = 0
local maxRestoreRetries = 6
local restoreRetryDelayMs = 700
local frequencyRequestSequence = 0
local latestFrequencyRequestSequence = 0
local pendingFrequencyStateRequests = {}
local recentIncomingMessageIds = {}
local incomingMessageWindowMs = 60000
local normalizeFrequencyLabel
local syncFrequencyStateToNui
local uiThemePresets = {
    ['default'] = true,
    ['midnight'] = true,
    ['amber'] = true,
    ['ice'] = true
}
local chatRelayConfig = type(Config.ChatRelay) == 'table' and Config.ChatRelay or {}

local function normalizeChatRelayProvider(value)
    local provider = tostring(value or 'auto'):lower()
    if provider == 'chat' or provider == 'poodlechat' then
        return provider
    end
    return 'auto'
end

local function getChatRelayProvider()
    return normalizeChatRelayProvider(chatRelayConfig.provider)
end

local function getChatRelayTargetChannel()
    local channel = tostring(chatRelayConfig.targetChannel or ''):match('^%s*(.-)%s*$')
    if channel == '' then
        return 'local'
    end
    return channel:lower()
end

local function shouldFallbackToDefaultChat()
    if chatRelayConfig.fallbackToDefault == nil then
        return true
    end
    return chatRelayConfig.fallbackToDefault == true
end

local function getPoodleChatResourceName()
    local resourceName = tostring(chatRelayConfig.poodleChatResource or 'poodlechat'):match('^%s*(.-)%s*$')
    if resourceName == '' then
        return 'poodlechat'
    end
    return resourceName
end

local function isResourceRunning(resourceName)
    if type(GetResourceState) ~= 'function' then
        return false
    end

    local state = GetResourceState(resourceName)
    return state == 'started' or state == 'starting'
end

local function sendDefaultRelayMessage(header, messageText)
    TriggerEvent('chat:addMessage', {
        color = {0, 255, 163},
        multiline = true,
        args = {header, messageText}
    })
end

local function sendPoodleRelayMessage(header, messageText)
    local resourceName = getPoodleChatResourceName()
    if not isResourceRunning(resourceName) then
        return false
    end

    local payload = {
        channel = getChatRelayTargetChannel(),
        color = {0, 255, 163},
        multiline = true,
        args = {header, messageText}
    }

    local ok, didSend = pcall(function()
        return exports[resourceName]:AddChannelMessage(payload)
    end)

    return ok and didSend == true
end

local function relayMessageToConfiguredChat(header, messageText)
    local provider = getChatRelayProvider()
    local shouldTryPoodle = provider == 'auto' or provider == 'poodlechat'

    if shouldTryPoodle and sendPoodleRelayMessage(header, messageText) then
        return
    end

    if provider == 'poodlechat' and not shouldFallbackToDefaultChat() then
        return
    end

    sendDefaultRelayMessage(header, messageText)
end

local function deepCopy(source)
    if type(source) ~= 'table' then
        return source
    end

    local result = {}
    for key, value in pairs(source) do
        result[key] = deepCopy(value)
    end
    return result
end

local function clampNumber(value, minValue, maxValue, fallback)
    local num = tonumber(value)
    if not num then
        return fallback
    end
    if num < minValue then
        return minValue
    end
    if num > maxValue then
        return maxValue
    end
    return num
end

local function sanitizeColor(value, fallback)
    local raw = tostring(value or ''):lower()
    if raw:match('^#%x%x%x%x%x%x$') then
        return raw
    end
    return fallback
end

local function sanitizeThemePreset(value, fallback)
    local preset = tostring(value or ''):lower()
    if uiThemePresets[preset] then
        return preset
    end
    return fallback
end

local function getDefaultUiState()
    return {
        autoScroll = true,
        textScale = {
            radio = 1.0,
            chat = 1.0,
            macro = 1.0
        },
        interfaceScale = {
            radio = 1.0,
            chat = 1.0,
            macro = 1.0
        },
        positions = {
            radio = { x = 0.5, y = 0.5 },
            chat = { x = 0.84, y = 0.8 },
            macro = { x = 0.5, y = 0.5 }
        },
        theme = {
            preset = 'default',
            accent = '#00ffa3'
        }
    }
end

local function getDefaultThemeOverrides()
    return {
        exact = {},
        ranges = {}
    }
end

local uiState = getDefaultUiState()
local themeOverrides = getDefaultThemeOverrides()

local function sanitizeUiState(raw, fallback)
    local base = deepCopy(type(fallback) == 'table' and fallback or getDefaultUiState())
    if type(base.textScale) ~= 'table' then
        local legacyScale = clampNumber(base.textScale, 0.85, 1.35, 1.0)
        base.textScale = {
            radio = legacyScale,
            chat = legacyScale,
            macro = legacyScale
        }
    end

    if type(raw) ~= 'table' then
        return base
    end

    if raw.autoScroll ~= nil then
        base.autoScroll = raw.autoScroll == true
    end

    if raw.textScale ~= nil then
        if type(raw.textScale) == 'table' then
            if raw.textScale.radio ~= nil then
                base.textScale.radio = clampNumber(raw.textScale.radio, 0.85, 1.35, base.textScale.radio)
            end
            if raw.textScale.chat ~= nil then
                base.textScale.chat = clampNumber(raw.textScale.chat, 0.85, 1.35, base.textScale.chat)
            end
            if raw.textScale.macro ~= nil then
                base.textScale.macro = clampNumber(raw.textScale.macro, 0.85, 1.35, base.textScale.macro)
            end
        else
            local unifiedScale = clampNumber(raw.textScale, 0.85, 1.35, base.textScale.chat)
            base.textScale.radio = unifiedScale
            base.textScale.chat = unifiedScale
            base.textScale.macro = unifiedScale
        end
    end

    if type(raw.interfaceScale) == 'table' then
        if raw.interfaceScale.radio ~= nil then
            base.interfaceScale.radio = clampNumber(raw.interfaceScale.radio, 0.8, 1.35, base.interfaceScale.radio)
        end
        if raw.interfaceScale.chat ~= nil then
            base.interfaceScale.chat = clampNumber(raw.interfaceScale.chat, 0.8, 1.35, base.interfaceScale.chat)
        end
        if raw.interfaceScale.macro ~= nil then
            base.interfaceScale.macro = clampNumber(raw.interfaceScale.macro, 0.8, 1.35, base.interfaceScale.macro)
        end
    end

    if type(raw.positions) == 'table' then
        for _, key in ipairs({ 'radio', 'chat', 'macro' }) do
            local input = raw.positions[key]
            if type(input) == 'table' then
                local x = clampNumber(input.x, 0.0, 1.0, base.positions[key].x)
                local y = clampNumber(input.y, 0.0, 1.0, base.positions[key].y)
                base.positions[key] = { x = x, y = y }
            end
        end
    end

    if type(raw.theme) == 'table' then
        base.theme.preset = sanitizeThemePreset(raw.theme.preset, base.theme.preset)
        base.theme.accent = sanitizeColor(raw.theme.accent, base.theme.accent)
    end

    return base
end

local function normalizeOverrideTheme(raw)
    local defaults = getDefaultUiState().theme
    local input = type(raw) == 'table' and raw or {}
    return {
        preset = sanitizeThemePreset(input.preset, defaults.preset),
        accent = sanitizeColor(input.accent, defaults.accent)
    }
end

local function sanitizeThemeOverrides(raw)
    local clean = getDefaultThemeOverrides()
    if type(raw) ~= 'table' then
        return clean
    end

    if type(raw.exact) == 'table' then
        for frequency, theme in pairs(raw.exact) do
            local freqLabel = normalizeFrequencyLabel(frequency)
            if freqLabel then
                local num = tonumber(freqLabel)
                if num and num >= (Config.MinFrequency or 1.0) and num <= (Config.MaxFrequency or 999.99) then
                    clean.exact[freqLabel] = normalizeOverrideTheme(theme)
                end
            end
        end
    end

    if type(raw.ranges) == 'table' then
        for _, entry in ipairs(raw.ranges) do
            if type(entry) == 'table' then
                local minLabel = normalizeFrequencyLabel(entry.min)
                local maxLabel = normalizeFrequencyLabel(entry.max)
                local minNum = minLabel and tonumber(minLabel) or nil
                local maxNum = maxLabel and tonumber(maxLabel) or nil

                if minNum and maxNum and minNum <= maxNum then
                    if minNum >= (Config.MinFrequency or 1.0) and maxNum <= (Config.MaxFrequency or 999.99) then
                        local theme = normalizeOverrideTheme(entry)
                        clean.ranges[#clean.ranges + 1] = {
                            min = minLabel,
                            max = maxLabel,
                            preset = theme.preset,
                            accent = theme.accent
                        }
                    end
                end
            end
        end
    end

    return clean
end

normalizeFrequencyLabel = function(value)
    if value == nil then
        return nil
    end

    local raw = tostring(value):gsub(',', '.')
    raw = raw:match('^%s*(.-)%s*$')

    local num = tonumber(raw)
    if not num then
        return nil
    end

    return string.format('%.2f', num)
end

local function parseFrequency(value)
    local label = normalizeFrequencyLabel(value)
    if not label then
        return nil, nil
    end

    local num = tonumber(label)
    if not num then
        return nil, nil
    end

    if num < Config.MinFrequency or num > Config.MaxFrequency then
        return nil, nil
    end

    return label, num
end

local function parseJobEntry(entry)
    local raw = tostring(entry or '')
    local jobName, condition = raw:match('^([^:]+):(.+)$')
    if not jobName then
        return raw, nil
    end
    return jobName, condition
end

local function evaluateCondition(condition, grade)
    if type(condition) ~= 'string' or condition == '' then
        return nil
    end

    if condition:sub(1, 4) == 'from' then
        local minGrade = tonumber(condition:sub(5))
        if minGrade then
            return grade >= minGrade
        end
    elseif condition:sub(1, 5) == 'fixed' then
        local fixedGrade = tonumber(condition:sub(6))
        if fixedGrade then
            return grade == fixedGrade
        end
    end

    return nil
end

function HasAccessToFrequency(frequency)
    if not PlayerData.job or type(Config.RestrictedFrequencies) ~= 'table' then
        return true
    end

    local freqLabel = normalizeFrequencyLabel(frequency)
    if not freqLabel then
        return false
    end

    local freqNum = tonumber(freqLabel) or 0

    for _, restriction in ipairs(Config.RestrictedFrequencies) do
        local match = false

        if restriction.freq then
            local target = normalizeFrequencyLabel(restriction.freq)
            if target and target == freqLabel then
                match = true
            end
        elseif restriction.min and restriction.max and freqNum >= restriction.min and freqNum <= restriction.max then
            match = true
        end

        if match then
            local allowedJobs = restriction.jobs
            if type(allowedJobs) ~= 'table' or #allowedJobs == 0 then
                return true
            end

            local playerJob = (PlayerData.job and PlayerData.job.name) or 'unknown'
            local playerGrade = (PlayerData.job and PlayerData.job.grade and PlayerData.job.grade.level) or 0

            local jobMatch = false
            local conditionedMatch = nil

            for _, entry in ipairs(allowedJobs) do
                local jobName, condition = parseJobEntry(entry)
                if playerJob == jobName then
                    jobMatch = true
                    conditionedMatch = evaluateCondition(condition, playerGrade)
                    break
                end
            end

            if not jobMatch then
                return false
            end

            if conditionedMatch ~= nil then
                return conditionedMatch
            end

            if restriction.fixedGrade then
                return playerGrade == restriction.fixedGrade
            end

            if restriction.minGrade then
                return playerGrade >= restriction.minGrade
            end

            return true
        end
    end

    return true
end

local function getChannelForFrequency(frequency)
    local label = normalizeFrequencyLabel(frequency)
    if not label then
        return nil
    end

    if radioState.primary and radioState.primary == label then
        return 'primary'
    end

    if radioState.secondary and radioState.secondary == label then
        return 'secondary'
    end

    return nil
end

local function stripGpsTokenFromMessage(message)
    if not message then
        return ''
    end
    return tostring(message):gsub('%%gpslink|([^|]+)|[^|]+|[^|]+|[^%%]+%%', '%1')
end

local function shouldProcessIncomingMessage(clientMessageId)
    local id = tostring(clientMessageId or ''):match('^%s*(.-)%s*$')
    if id == '' then
        return true
    end

    local now = GetGameTimer()
    for key, expiresAt in pairs(recentIncomingMessageIds) do
        if expiresAt <= now then
            recentIncomingMessageIds[key] = nil
        end
    end

    local existingExpiry = recentIncomingMessageIds[id]
    if existingExpiry and existingExpiry > now then
        return false
    end

    recentIncomingMessageIds[id] = now + incomingMessageWindowMs
    return true
end

local function getCitizenId()
    if PlayerData and PlayerData.citizenid then
        return PlayerData.citizenid
    end

    local data = QBCore.Functions.GetPlayerData()
    if data then
        PlayerData = data
    end

    if PlayerData and PlayerData.citizenid then
        return PlayerData.citizenid
    end

    return nil
end

local function getStateStorageKey()
    local citizenId = getCitizenId()
    if not citizenId then
        return nil
    end
    return statePersistencePrefix .. tostring(citizenId)
end

local function applyActiveFallback()
    if radioState.active == 'primary' and not radioState.primary and radioState.secondary then
        radioState.active = 'secondary'
    elseif radioState.active == 'secondary' and not radioState.secondary and radioState.primary then
        radioState.active = 'primary'
    elseif not radioState.primary and not radioState.secondary then
        radioState.active = 'primary'
    end

    if radioState.active ~= 'primary' and radioState.active ~= 'secondary' then
        radioState.active = 'primary'
    end
end

local function buildFrequencyStatePayload()
    return {
        primary = radioState.primary,
        secondary = radioState.secondary,
        active = radioState.active,
        primaryChatRelay = radioState.chatRelay.primary == true,
        secondaryChatRelay = radioState.chatRelay.secondary == true
    }
end

local function applyFrequencyStateFromServer(primary, secondary, active, primaryChatRelay, secondaryChatRelay, skipPersist)
    local primaryLabel = parseFrequency(primary)
    local secondaryLabel = parseFrequency(secondary)

    if primaryLabel and secondaryLabel and primaryLabel == secondaryLabel then
        secondaryLabel = nil
    end

    radioState.primary = primaryLabel
    radioState.secondary = secondaryLabel
    radioState.active = tostring(active or 'primary') == 'secondary' and 'secondary' or 'primary'
    radioState.chatRelay.primary = primaryLabel and primaryChatRelay == true or false
    radioState.chatRelay.secondary = secondaryLabel and secondaryChatRelay == true or false

    applyActiveFallback()
    syncFrequencyStateToNui(skipPersist)
end

local function createFrequencyRequestId()
    frequencyRequestSequence = frequencyRequestSequence + 1
    return ('%s_%s'):format(GetGameTimer(), frequencyRequestSequence)
end

local function requestFrequencyStateApply(payload, reason, handler)
    local requestId = createFrequencyRequestId()
    latestFrequencyRequestSequence = frequencyRequestSequence
    pendingFrequencyStateRequests[requestId] = {
        sequence = frequencyRequestSequence,
        reason = reason,
        payload = payload,
        handler = handler
    }

    TriggerServerEvent(
        '7_radio:server:applyFrequencyState',
        payload.primary,
        payload.secondary,
        payload.active,
        payload.primaryChatRelay,
        payload.secondaryChatRelay,
        requestId
    )

    return requestId
end

local function persistRadioState()
    local key = getStateStorageKey()
    if not key then
        return
    end

    local payload = {
        version = persistenceVersion,
        primary = radioState.primary,
        secondary = radioState.secondary,
        active = radioState.active,
        relay = {
            primary = radioState.chatRelay.primary,
            secondary = radioState.chatRelay.secondary
        },
        ui = uiState,
        themeOverrides = themeOverrides
    }

    SetResourceKvp(key, json.encode(payload))
end

local function syncUiSettingsToNui()
    SendNUIMessage({
        action = 'syncUiSettings',
        ui = uiState,
        themeOverrides = themeOverrides
    })
end

local function syncThemeOverrideStateToNui()
    SendNUIMessage({
        action = 'themeOverrideState',
        themeOverrides = themeOverrides
    })
end

syncFrequencyStateToNui = function(skipPersist)
    SendNUIMessage({
        action = 'syncFrequencies',
        primary = radioState.primary,
        secondary = radioState.secondary,
        activeFreq = radioState.active,
        primaryChatRelay = radioState.chatRelay.primary,
        secondaryChatRelay = radioState.chatRelay.secondary
    })

    if not skipPersist then
        persistRadioState()
    end
end

local function notifyUiDefaultsApplied(cleared)
    SendNUIMessage({
        action = 'uiDefaultsApplied',
        cleared = cleared == true,
        ui = uiState,
        themeOverrides = themeOverrides
    })
end

local function buildMacroSetsPayload()
    local sets = {}

    for key, value in pairs(Config) do
        if type(key) == 'string' and key:sub(-6) == 'Macros' and type(value) == 'table' then
            sets[key] = value
        end
    end

    if type(Config.GlobalMacros) == 'table' then
        sets.GlobalMacros = Config.GlobalMacros
    end

    return sets
end

local function closeNuiClean()
    SendNUIMessage({ action = 'forceHideAll' })

    SetNuiFocus(false, false)
    SetNuiFocusKeepInput(false)

    if SetCursorLocation then
        SetCursorLocation(0.5, 0.5)
    end

    Citizen.SetTimeout(100, function()
        SetNuiFocus(false, false)
    end)
end

function HasRadio()
    if radioItem == 'none' or radioItem == false then
        return true
    end
    return QBCore.Functions.HasItem(radioItem)
end

local function validatePersistedFrequency(value)
    local frequency = normalizeFrequencyLabel(value)
    if not frequency then
        return nil
    end

    local num = tonumber(frequency)
    if not num or num < Config.MinFrequency or num > Config.MaxFrequency then
        return nil
    end

    if not HasAccessToFrequency(frequency) then
        return nil
    end

    return frequency
end

local function requestRestoreApply()
    if not restoreInProgress or not restoreDesiredState then
        return
    end
    requestFrequencyStateApply(restoreDesiredState, 'restore')
end

local function restorePersistedState()
    if hasRestoredState or restoreInProgress then
        return
    end

    local key = getStateStorageKey()
    if not key then
        return
    end

    local raw = GetResourceKvpString(key)
    local loadedFromStorage = false
    local desiredState = {
        primary = nil,
        secondary = nil,
        active = 'primary',
        primaryChatRelay = false,
        secondaryChatRelay = false
    }

    if raw and raw ~= '' then
        local ok, data = pcall(json.decode, raw)
        if ok and type(data) == 'table' then
            loadedFromStorage = true
            uiState = sanitizeUiState(data.ui, getDefaultUiState())
            themeOverrides = sanitizeThemeOverrides(data.themeOverrides)

            local primary = validatePersistedFrequency(data.primary)
            local secondary = validatePersistedFrequency(data.secondary)
            if primary and secondary and primary == secondary then
                secondary = nil
            end

            local relayPrimary = false
            local relaySecondary = false
            if type(data.relay) == 'table' then
                relayPrimary = data.relay.primary == true
                relaySecondary = data.relay.secondary == true
            end

            desiredState.primary = primary
            desiredState.secondary = secondary
            desiredState.active = tostring(data.active or 'primary') == 'secondary' and 'secondary' or 'primary'
            desiredState.primaryChatRelay = relayPrimary
            desiredState.secondaryChatRelay = relaySecondary
        end
    end

    if not loadedFromStorage then
        uiState = getDefaultUiState()
        themeOverrides = getDefaultThemeOverrides()
    end

    restoreInProgress = true
    restoreDesiredState = desiredState
    restoreRetryCount = 0

    syncUiSettingsToNui()
    syncThemeOverrideStateToNui()
    requestRestoreApply()
end

local function scheduleStateRestore()
    if hasRestoredState or restoreInProgress or restoreWorkerRunning then
        return
    end

    restoreWorkerRunning = true
    CreateThread(function()
        for _ = 1, 80 do
            local data = QBCore.Functions.GetPlayerData()
            if data then
                PlayerData = data
            end

            if PlayerData and PlayerData.citizenid and PlayerData.job then
                restorePersistedState()
                restoreWorkerRunning = false
                return
            end

            Wait(250)
        end

        restoreWorkerRunning = false
    end)
end

CreateThread(function()
    PlayerData = QBCore.Functions.GetPlayerData() or {}

    Wait(1000)
    SendNUIMessage({
        action = 'setSounds',
        enabled = Config.Sounds.enabled,
        volume = Config.Sounds.volume
    })
    syncUiSettingsToNui()
    syncThemeOverrideStateToNui()

    scheduleStateRestore()
end)


AddEventHandler('onClientResourceStart', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then
        return
    end

    scheduleStateRestore()
end)

RegisterNetEvent('7_radio:client:frequencyStateApplied', function(requestId, status, primary, secondary, active, primaryChatRelay, secondaryChatRelay)
    local request = requestId and pendingFrequencyStateRequests[requestId] or nil
    if requestId then
        pendingFrequencyStateRequests[requestId] = nil
    end

    if requestId and not request then
        return
    end

    if request and request.reason ~= 'restore' and request.sequence < latestFrequencyRequestSequence then
        if request.handler then
            request.handler(false, 'stale', request.payload, nil)
        end
        return
    end

    if status == 'not_ready' then
        if request and request.reason == 'restore' and restoreInProgress and restoreDesiredState then
            if restoreRetryCount < maxRestoreRetries then
                restoreRetryCount = restoreRetryCount + 1
                Citizen.SetTimeout(restoreRetryDelayMs, function()
                    if restoreInProgress and restoreDesiredState then
                        requestRestoreApply()
                    end
                end)
            else
                restoreInProgress = false
                hasRestoredState = true
                restoreDesiredState = nil
                restoreRetryCount = 0
                applyFrequencyStateFromServer(nil, nil, 'primary', false, false)
            end
        end

        if request and request.handler then
            request.handler(false, status, request.payload, nil)
        end
        return
    end

    local skipPersist = request and request.reason == 'clear_cache'
    applyFrequencyStateFromServer(primary, secondary, active, primaryChatRelay, secondaryChatRelay, skipPersist)

    if request and request.reason == 'restore' then
        restoreInProgress = false
        hasRestoredState = true
        restoreDesiredState = nil
        restoreRetryCount = 0
    end

    if request and request.handler then
        request.handler(true, status, request.payload, buildFrequencyStatePayload())
    end
end)

RegisterNetEvent('QBCore:Client:OnPlayerLoaded', function()
    PlayerData = QBCore.Functions.GetPlayerData() or {}
    hasRestoredState = false
    restoreInProgress = false
    restoreWorkerRunning = false
    restoreDesiredState = nil
    restoreRetryCount = 0
    latestFrequencyRequestSequence = 0
    pendingFrequencyStateRequests = {}
    recentIncomingMessageIds = {}
    lastRadioNotify = {}
    scheduleStateRestore()
end)

RegisterNetEvent('QBCore:Client:OnPlayerUnload', function()
    TriggerServerEvent('7_radio:server:resetPlayerFrequencies')

    radioState.radioOpen = false
    radioState.chatOpen = false
    radioState.primary = nil
    radioState.secondary = nil
    radioState.active = 'primary'
    radioState.chatRelay.primary = false
    radioState.chatRelay.secondary = false

    PlayerData = {}
    hasRestoredState = false
    restoreInProgress = false
    restoreWorkerRunning = false
    restoreDesiredState = nil
    restoreRetryCount = 0
    latestFrequencyRequestSequence = 0
    pendingFrequencyStateRequests = {}
    recentIncomingMessageIds = {}
    lastRadioNotify = {}

    closeNuiClean()
end)

AddEventHandler('onClientResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then
        return
    end

    radioState.radioOpen = false
    radioState.chatOpen = false
    pendingFrequencyStateRequests = {}
    restoreInProgress = false
    restoreWorkerRunning = false
    restoreDesiredState = nil
    restoreRetryCount = 0
    latestFrequencyRequestSequence = 0
    closeNuiClean()
end)

RegisterNetEvent('QBCore:Client:OnJobUpdate', function(jobInfo)
    PlayerData.job = jobInfo

    local desiredState = buildFrequencyStatePayload()
    local hasChanges = false

    if desiredState.primary and not HasAccessToFrequency(desiredState.primary) then
        QBCore.Functions.Notify('You no longer have access to this frequency', 'error')
        desiredState.primary = nil
        desiredState.primaryChatRelay = false
        hasChanges = true
    end

    if desiredState.secondary and not HasAccessToFrequency(desiredState.secondary) then
        QBCore.Functions.Notify('You no longer have access to the secondary frequency', 'error')
        desiredState.secondary = nil
        desiredState.secondaryChatRelay = false
        hasChanges = true
    end

    if hasChanges then
        requestFrequencyStateApply(desiredState, 'job_update')
    else
        syncFrequencyStateToNui()
    end
end)

function ToggleRadioUI()
    radioState.radioOpen = not radioState.radioOpen

    if radioState.radioOpen then
        SendNUIMessage({
            action = 'toggleRadio',
            show = true,
            primary = radioState.primary,
            secondary = radioState.secondary,
            globalMacros = Config.GlobalMacros or {},
            allMacroSets = buildMacroSetsPayload()
        })
        syncUiSettingsToNui()

        Citizen.SetTimeout(10, function()
            SetNuiFocus(true, true)
            SetNuiFocusKeepInput(false)
        end)
        return
    end

    SendNUIMessage({
        action = 'toggleRadio',
        show = false
    })
    closeNuiClean()
end

function ToggleChatUI()
    radioState.chatOpen = not radioState.chatOpen

    if radioState.chatOpen then
        SendNUIMessage({
            action = 'toggleChat',
            show = true,
            primary = radioState.primary,
            secondary = radioState.secondary,
            activeFreq = radioState.active,
            primaryChatRelay = radioState.chatRelay.primary,
            secondaryChatRelay = radioState.chatRelay.secondary,
            globalMacros = Config.GlobalMacros or {},
            allMacroSets = buildMacroSetsPayload()
        })
        syncUiSettingsToNui()

        Citizen.SetTimeout(10, function()
            SetNuiFocus(true, true)
            SetNuiFocusKeepInput(false)
        end)
        return
    end

    SendNUIMessage({
        action = 'toggleChat',
        show = false
    })
    closeNuiClean()
end

local function ensureRadioAccessOrNotify()
    if HasRadio() then
        return true
    end

    QBCore.Functions.Notify('You do not have a radio', 'error')
    return false
end

RegisterCommand('radio', function()
    if not ensureRadioAccessOrNotify() then
        return
    end
    ToggleRadioUI()
end)

RegisterCommand('radiochat', function()
    if not radioState.primary and not radioState.secondary then
        QBCore.Functions.Notify('You are not connected to any frequency', 'error')
        return
    end

    if not ensureRadioAccessOrNotify() then
        return
    end

    ToggleChatUI()
end)

RegisterCommand('radio_toggle', function()
    if not ensureRadioAccessOrNotify() then
        return
    end

    ToggleRadioUI()
end, false)

RegisterCommand('radio_chat_toggle', function()
    if not radioState.primary and not radioState.secondary then
        QBCore.Functions.Notify('You are not connected to any frequency', 'error')
        return
    end

    if not ensureRadioAccessOrNotify() then
        return
    end

    ToggleChatUI()
end, false)

RegisterKeyMapping('radio_toggle', 'Open / Close radio', 'keyboard', Config.OpenRadioKey or 'F9')
RegisterKeyMapping('radio_chat_toggle', 'Open / Close radio chat', 'keyboard', Config.OpenChatKey or 'F10')

RegisterCommand('radio_switch_channel', function()
    SendNUIMessage({ action = 'requestSwitchChannel' })
end, false)

RegisterKeyMapping('radio_switch_channel', 'Switch channel (chat radio)', 'keyboard', Config.SwitchFrequencyKey or 'TAB')

RegisterNUICallback('close', function(data, cb)
    if data.type == 'radio' then
        radioState.radioOpen = false
    elseif data.type == 'chat' then
        radioState.chatOpen = false
    end

    SendNUIMessage({ action = 'toggleRadio', show = false })
    SendNUIMessage({ action = 'toggleChat', show = false })
    closeNuiClean()

    cb('ok')
end)

RegisterNUICallback('nuiClosed', function(_, cb)
    radioState.radioOpen = false
    radioState.chatOpen = false
    closeNuiClean()
    cb('ok')
end)

RegisterNUICallback('nuiReady', function(_, cb)
    SendNUIMessage({
        action = 'setSounds',
        enabled = Config.Sounds.enabled,
        volume = Config.Sounds.volume
    })
    syncFrequencyStateToNui(true)
    syncUiSettingsToNui()
    syncThemeOverrideStateToNui()
    cb('ok')
end)

RegisterNUICallback('setFrequency', function(data, cb)
    local frequency = data and data.frequency
    local isPrimary = data and data.isPrimary == true

    if restoreInProgress then
        QBCore.Functions.Notify('Radio state is still loading, try again', 'error')
        cb({ success = false })
        return
    end

    local freqLabel = parseFrequency(frequency)
    if not freqLabel then
        QBCore.Functions.Notify('Invalid frequency', 'error')
        cb({ success = false })
        return
    end

    if not HasAccessToFrequency(freqLabel) then
        QBCore.Functions.Notify('You do not have access to this frequency', 'error')
        cb({ success = false })
        return
    end

    local channel = isPrimary and 'primary' or 'secondary'
    local otherChannel = isPrimary and 'secondary' or 'primary'
    local desiredState = buildFrequencyStatePayload()

    desiredState[channel] = freqLabel
    if desiredState[otherChannel] == freqLabel then
        desiredState[otherChannel] = nil
        if otherChannel == 'primary' then
            desiredState.primaryChatRelay = false
        else
            desiredState.secondaryChatRelay = false
        end
    end

    if isPrimary then
        desiredState.active = 'primary'
    elseif desiredState.active ~= 'secondary' and desiredState.secondary and not desiredState.primary then
        desiredState.active = 'secondary'
    end

    requestFrequencyStateApply(desiredState, 'set_frequency', function(success, status, requestedState, appliedState)
        if not success or not appliedState then
            if status == 'not_ready' then
                QBCore.Functions.Notify('Radio is not ready yet, try again', 'error')
            else
                QBCore.Functions.Notify('Unable to set this frequency', 'error')
            end

            cb({
                success = false,
                primary = radioState.primary,
                secondary = radioState.secondary,
                activeFreq = radioState.active,
                primaryChatRelay = radioState.chatRelay.primary,
                secondaryChatRelay = radioState.chatRelay.secondary
            })
            return
        end

        local appliedFrequency = appliedState[channel]
        local requestedFrequency = requestedState[channel]
        local accepted = requestedFrequency and appliedFrequency == requestedFrequency

        if accepted then
            QBCore.Functions.Notify((isPrimary and 'Primary' or 'Secondary') .. ' frequency set to ' .. requestedFrequency, 'success')
        else
            QBCore.Functions.Notify('Unable to set this frequency', 'error')
        end

        cb({
            success = accepted == true,
            primary = radioState.primary,
            secondary = radioState.secondary,
            activeFreq = radioState.active,
            primaryChatRelay = radioState.chatRelay.primary,
            secondaryChatRelay = radioState.chatRelay.secondary
        })
    end)
end)

RegisterNUICallback('sendMessage', function(data, cb)
    local message = tostring((data and data.message) or '')
    message = message:match('^%s*(.-)%s*$')
    local frequency = parseFrequency(data and data.frequency)
    local clientMessageId = tostring((data and data.clientMessageId) or ''):match('^%s*(.-)%s*$')

    if clientMessageId == '' then
        clientMessageId = ('%d_%d'):format(GetGameTimer(), math.random(100000, 999999))
    end

    if message == '' then
        cb({ success = false })
        return
    end

    if #message > Config.MaxMessageLength then
        QBCore.Functions.Notify('Message too long', 'error')
        cb({ success = false })
        return
    end

    if not frequency then
        QBCore.Functions.Notify('Invalid frequency', 'error')
        cb({ success = false })
        return
    end

    if not HasAccessToFrequency(frequency) then
        QBCore.Functions.Notify('You do not have access to this frequency', 'error')
        cb({ success = false })
        return
    end

    if Config.UseAnimation then
        CreateThread(function()
            local ped = PlayerPedId()
            RequestAnimDict(Config.AnimationDict)

            local timeout = GetGameTimer() + 2000
            while not HasAnimDictLoaded(Config.AnimationDict) and GetGameTimer() < timeout do
                Wait(10)
            end

            if not HasAnimDictLoaded(Config.AnimationDict) then
                return
            end

            TaskPlayAnim(ped, Config.AnimationDict, Config.AnimationName, 8.0, -8.0, 900, 49, 0, false, false, false)
            Wait(900)
            StopAnimTask(ped, Config.AnimationDict, Config.AnimationName, 1.0)
        end)
    end

    TriggerServerEvent('7_radio:server:sendMessage', frequency, message, clientMessageId)
    cb({ success = true, clientMessageId = clientMessageId })
end)

RegisterNUICallback('switchFrequency', function(_, cb)
    if radioState.active == 'primary' and radioState.secondary then
        radioState.active = 'secondary'
    elseif radioState.active == 'secondary' and radioState.primary then
        radioState.active = 'primary'
    end

    applyActiveFallback()
    syncFrequencyStateToNui()

    cb({
        activeFreq = radioState.active,
        frequency = radioState.active == 'primary' and radioState.primary or radioState.secondary,
        primaryChatRelay = radioState.chatRelay.primary,
        secondaryChatRelay = radioState.chatRelay.secondary
    })
end)

RegisterNUICallback('toggleChatRelay', function(data, cb)
    local requestedChannel = tostring((data and data.channel) or radioState.active)
    local channel = requestedChannel == 'secondary' and 'secondary' or 'primary'
    local targetFrequency = channel == 'primary' and radioState.primary or radioState.secondary
    local explicitEnabled = data and data.enabled

    if restoreInProgress then
        cb({
            success = false,
            reason = 'restoring',
            channel = channel,
            enabled = channel == 'primary' and radioState.chatRelay.primary or radioState.chatRelay.secondary,
            primaryChatRelay = radioState.chatRelay.primary,
            secondaryChatRelay = radioState.chatRelay.secondary
        })
        return
    end

    if not targetFrequency then
        radioState.chatRelay[channel] = false
        syncFrequencyStateToNui()
        cb({
            success = false,
            reason = 'no_frequency',
            channel = channel,
            enabled = false,
            primaryChatRelay = radioState.chatRelay.primary,
            secondaryChatRelay = radioState.chatRelay.secondary
        })
        return
    end

    if not HasAccessToFrequency(targetFrequency) then
        radioState.chatRelay[channel] = false
        syncFrequencyStateToNui()
        cb({
            success = false,
            reason = 'restricted',
            channel = channel,
            enabled = false,
            primaryChatRelay = radioState.chatRelay.primary,
            secondaryChatRelay = radioState.chatRelay.secondary
        })
        return
    end

    local desiredState = buildFrequencyStatePayload()
    if type(explicitEnabled) == 'boolean' then
        if channel == 'primary' then
            desiredState.primaryChatRelay = explicitEnabled
        else
            desiredState.secondaryChatRelay = explicitEnabled
        end
    else
        if channel == 'primary' then
            desiredState.primaryChatRelay = not desiredState.primaryChatRelay
        else
            desiredState.secondaryChatRelay = not desiredState.secondaryChatRelay
        end
    end

    requestFrequencyStateApply(desiredState, 'toggle_relay', function(success, status, _, appliedState)
        if not success or not appliedState then
            cb({
                success = false,
                reason = status == 'not_ready' and 'not_ready' or 'apply_failed',
                channel = channel,
                enabled = channel == 'primary' and radioState.chatRelay.primary or radioState.chatRelay.secondary,
                primaryChatRelay = radioState.chatRelay.primary,
                secondaryChatRelay = radioState.chatRelay.secondary
            })
            return
        end

        cb({
            success = true,
            channel = channel,
            enabled = channel == 'primary' and appliedState.primaryChatRelay or appliedState.secondaryChatRelay,
            primaryChatRelay = appliedState.primaryChatRelay,
            secondaryChatRelay = appliedState.secondaryChatRelay
        })
    end)
end)

RegisterNUICallback('saveUiSettings', function(data, cb)
    local incoming = type(data) == 'table' and data.ui or nil
    uiState = sanitizeUiState(incoming, uiState)

    persistRadioState()
    syncUiSettingsToNui()

    cb({
        success = true,
        ui = uiState,
        themeOverrides = themeOverrides
    })
end)

RegisterNUICallback('setInterfaceMoveMode', function(data, cb)
    local interfaceName = tostring((data and data.interface) or ''):lower()
    local enabled = data and data.enabled == true

    if interfaceName ~= 'radio' and interfaceName ~= 'chat' and interfaceName ~= 'macro' then
        cb({ success = false })
        return
    end

    SendNUIMessage({
        action = 'moveModeState',
        interface = interfaceName,
        enabled = enabled
    })

    cb({
        success = true,
        interface = interfaceName,
        enabled = enabled
    })
end)

RegisterNUICallback('saveThemeOverride', function(data, cb)
    local mode = tostring((data and data.mode) or ''):lower()
    local theme = normalizeOverrideTheme(data)

    if mode == 'exact' then
        local freq = parseFrequency(data and data.frequency)
        if not freq then
            cb({ success = false, reason = 'invalid_frequency' })
            return
        end

        themeOverrides.exact[freq] = theme
    elseif mode == 'range' then
        local minLabel = parseFrequency(data and data.min)
        local maxLabel = parseFrequency(data and data.max)
        if not minLabel or not maxLabel then
            cb({ success = false, reason = 'invalid_range' })
            return
        end

        local minNum = tonumber(minLabel) or 0
        local maxNum = tonumber(maxLabel) or 0
        if minNum > maxNum then
            cb({ success = false, reason = 'invalid_range' })
            return
        end

        local updated = false
        for index, entry in ipairs(themeOverrides.ranges) do
            if entry.min == minLabel and entry.max == maxLabel then
                themeOverrides.ranges[index] = {
                    min = minLabel,
                    max = maxLabel,
                    preset = theme.preset,
                    accent = theme.accent
                }
                updated = true
                break
            end
        end

        if not updated then
            themeOverrides.ranges[#themeOverrides.ranges + 1] = {
                min = minLabel,
                max = maxLabel,
                preset = theme.preset,
                accent = theme.accent
            }
        end
    else
        cb({ success = false, reason = 'invalid_mode' })
        return
    end

    themeOverrides = sanitizeThemeOverrides(themeOverrides)
    persistRadioState()
    syncThemeOverrideStateToNui()
    syncUiSettingsToNui()

    cb({
        success = true,
        themeOverrides = themeOverrides
    })
end)

RegisterNUICallback('deleteThemeOverride', function(data, cb)
    local mode = tostring((data and data.mode) or ''):lower()

    if mode == 'exact' then
        local freq = parseFrequency(data and data.frequency)
        if not freq then
            cb({ success = false, reason = 'invalid_frequency' })
            return
        end
        themeOverrides.exact[freq] = nil
    elseif mode == 'range' then
        local index = tonumber(data and data.index)
        if not index or index < 1 or index > #themeOverrides.ranges then
            cb({ success = false, reason = 'invalid_range' })
            return
        end
        table.remove(themeOverrides.ranges, index)
    else
        cb({ success = false, reason = 'invalid_mode' })
        return
    end

    themeOverrides = sanitizeThemeOverrides(themeOverrides)
    persistRadioState()
    syncThemeOverrideStateToNui()
    syncUiSettingsToNui()

    cb({
        success = true,
        themeOverrides = themeOverrides
    })
end)

RegisterNUICallback('resetUiDefaults', function(_, cb)
    uiState = getDefaultUiState()
    themeOverrides = getDefaultThemeOverrides()

    persistRadioState()
    syncUiSettingsToNui()
    syncThemeOverrideStateToNui()
    notifyUiDefaultsApplied(false)

    cb({
        success = true,
        ui = uiState,
        themeOverrides = themeOverrides
    })
end)

RegisterNUICallback('clearCache', function(_, cb)
    local key = getStateStorageKey()
    if key then
        DeleteResourceKvp(key)
    end

    uiState = getDefaultUiState()
    themeOverrides = getDefaultThemeOverrides()

    requestFrequencyStateApply({
        primary = nil,
        secondary = nil,
        active = 'primary',
        primaryChatRelay = false,
        secondaryChatRelay = false
    }, 'clear_cache', function(success)
        if not success then
            cb({
                success = false,
                ui = uiState,
                themeOverrides = themeOverrides
            })
            return
        end

        syncFrequencyStateToNui(true)
        syncUiSettingsToNui()
        syncThemeOverrideStateToNui()
        notifyUiDefaultsApplied(true)

        cb({
            success = true,
            ui = uiState,
            themeOverrides = themeOverrides
        })
    end)
end)

RegisterNetEvent('7_radio:client:receiveMessage', function(frequency, senderName, message, senderId, clientMessageId, timestamp)
    local freqLabel = normalizeFrequencyLabel(frequency)
    if not freqLabel then
        return
    end

    local channel = getChannelForFrequency(freqLabel)
    if not channel then
        return
    end

    if not shouldProcessIncomingMessage(clientMessageId) then
        return
    end

    SendNUIMessage({
        action = 'newMessage',
        frequency = freqLabel,
        sender = senderName,
        message = message,
        senderId = senderId,
        clientMessageId = clientMessageId,
        timestamp = timestamp,
        isMe = senderId == GetPlayerServerId(PlayerId())
    })

    if radioState.chatRelay[channel] and HasAccessToFrequency(freqLabel) then
        local cleanedMessage = stripGpsTokenFromMessage(message)
        local senderLabel = senderName or 'Unknown'
        local relayHeader = ('[RADIO %s] %s'):format(freqLabel, senderLabel)
        relayMessageToConfiguredChat(relayHeader, cleanedMessage)
    elseif radioState.chatRelay[channel] and not HasAccessToFrequency(freqLabel) then
        radioState.chatRelay[channel] = false
        syncFrequencyStateToNui()
    end

    if radioState.chatOpen then
        return
    end

    local now = GetGameTimer()
    local last = lastRadioNotify[freqLabel] or 0

    if now - last < radioNotifyCooldownMs then
        return
    end

    local channelLabel = 'OTHER'
    if radioState.primary and radioState.primary == freqLabel then
        channelLabel = 'CHANNEL 1'
    elseif radioState.secondary and radioState.secondary == freqLabel then
        channelLabel = 'CHANNEL 2'
    end

    local notifText = ('New message on %s (%s)'):format(freqLabel, channelLabel)
    if senderName and senderName ~= '' then
        notifText = notifText .. ' - ' .. senderName
    end

    if radioNotifyEnablePreview and message and message ~= '' then
        local preview = stripGpsTokenFromMessage(message)
        if #preview > radioNotifyPreviewLength then
            preview = preview:sub(1, radioNotifyPreviewLength) .. '...'
        end
        notifText = notifText .. '\n"' .. preview .. '"'
    end

    local sent = false
    if QBCore and QBCore.Functions and QBCore.Functions.Notify then
        local ok = pcall(function()
            QBCore.Functions.Notify(notifText, 'primary', 5000)
        end)
        sent = ok
        if not ok then
            QBCore.Functions.Notify(notifText, 'primary')
            sent = true
        end
    end

    if not sent then
        TriggerEvent('chat:addMessage', {
            color = {255, 128, 0},
            multiline = true,
            args = {'[RADIO]', notifText}
        })
    end

    lastRadioNotify[freqLabel] = now
end)

RegisterNetEvent('7_radio:client:updateFrequencyCount', function(frequency, count)
    local freqLabel = normalizeFrequencyLabel(frequency)
    if not freqLabel then
        return
    end

    SendNUIMessage({
        action = 'updateFreqCount',
        frequency = freqLabel,
        count = tonumber(count) or 0
    })
end)

RegisterNetEvent('7_radio:client:loadHistory', function(frequency, history, customData)
    local freqLabel = normalizeFrequencyLabel(frequency)
    if not freqLabel then
        return
    end

    local normalizedHistory = {}

    if type(history) == 'table' then
        for _, item in ipairs(history) do
            local entryFreq = normalizeFrequencyLabel(item.frequency) or freqLabel
            normalizedHistory[#normalizedHistory + 1] = {
                frequency = entryFreq,
                sender = item.sender,
                message = item.message,
                timestamp = item.timestamp,
                citizenid = item.citizenid,
                senderId = item.senderId
            }
        end
    end

    SendNUIMessage({
        action = 'loadHistory',
        frequency = freqLabel,
        history = normalizedHistory,
        customData = customData
    })
end)

RegisterNUICallback('setWaypoint', function(data, cb)
    SetNewWaypoint(data.x, data.y)
    QBCore.Functions.Notify('GPS updated', 'success')
    cb('ok')
end)

RegisterNUICallback('saveUserMacro', function(data, cb)
    TriggerServerEvent('7_radio:server:saveUserMacro', data.label, data.value, data.description)
    cb('ok')
end)

RegisterNUICallback('deleteUserMacro', function(data, cb)
    TriggerServerEvent('7_radio:server:deleteUserMacro', data.id)
    cb('ok')
end)

RegisterNUICallback('fetchUserMacros', function(_, cb)
    TriggerServerEvent('7_radio:server:getUserMacros')
    cb('ok')
end)

RegisterNetEvent('7_radio:client:receiveUserMacros', function(macros)
    SendNUIMessage({
        action = 'receiveUserMacros',
        macros = macros
    })
end)

RegisterNetEvent('7_radio:client:onMacroSaved', function(id)
    SendNUIMessage({
        action = 'macroSaved',
        id = id
    })

    TriggerServerEvent('7_radio:server:getUserMacros')
end)

RegisterNetEvent('7_radio:client:onMacroDeleted', function(success, macroId)
    SendNUIMessage({
        action = 'macroDeleted',
        success = success == true,
        id = macroId
    })

    if success then
        TriggerServerEvent('7_radio:server:getUserMacros')
    end
end)

local function getStreetAndArea(coords)
    local s1, s2 = GetStreetNameAtCoord(coords.x, coords.y, coords.z)
    local streetName = GetStreetNameFromHashKey(s1)

    if s2 ~= 0 then
        streetName = streetName .. ' / ' .. GetStreetNameFromHashKey(s2)
    end

    local area = GetLabelText(GetNameOfZone(coords.x, coords.y, coords.z))

    if area and area ~= '' and area ~= 'NULL' then
        return streetName .. ', ' .. area
    end

    return streetName
end

local function getCurrentLocationData()
    local coords = GetEntityCoords(PlayerPedId())
    local text = getStreetAndArea(coords)

    return text, {
        x = coords.x,
        y = coords.y,
        z = coords.z
    }
end

local function getCurrentWaypointData()
    local waypointBlip = GetFirstBlipInfoId(8)
    if waypointBlip == 0 or not DoesBlipExist(waypointBlip) then
        return 'No waypoint set', nil
    end

    local coords = GetBlipInfoIdCoord(waypointBlip)
    if not coords then
        return 'No waypoint set', nil
    end

    local text = getStreetAndArea(coords)

    return text, {
        x = coords.x,
        y = coords.y,
        z = coords.z
    }
end

local function getInGameTime()
    local hours = GetClockHours()
    local minutes = GetClockMinutes()
    return string.format('%02d:%02d', hours, minutes)
end

CreateThread(function()
    while true do
        if radioState.chatOpen or radioState.radioOpen then
            local locationText, locationCoords = getCurrentLocationData()
            local waypointText, waypointCoords = getCurrentWaypointData()
            local timeText = getInGameTime()

            local name = 'Unknown'
            local surname = 'Unknown'
            local jobLabel = 'None'
            local rankLabel = 'None'
            local citizenid = nil

            if PlayerData and PlayerData.charinfo then
                name = PlayerData.charinfo.firstname or name
                surname = PlayerData.charinfo.lastname or surname
            end

            if PlayerData and PlayerData.job then
                jobLabel = PlayerData.job.label or jobLabel
                if PlayerData.job.grade then
                    rankLabel = PlayerData.job.grade.name or PlayerData.job.grade.label or rankLabel
                end
            end

            if PlayerData then
                citizenid = PlayerData.citizenid
            end

            SendNUIMessage({
                action = 'updatePlaceholders',
                data = {
                    location = locationText,
                    locationCoords = locationCoords,
                    waypoint = waypointText,
                    waypointCoords = waypointCoords,
                    hour = timeText,
                    name = name,
                    surname = surname,
                    job = jobLabel,
                    rank = rankLabel,
                    citizenid = citizenid
                }
            })

            Wait(1000)
        else
            Wait(2000)
        end
    end
end)

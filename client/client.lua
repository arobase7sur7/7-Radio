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
local radioNotifyEnablePreview = true
local lastRadioNotify = {}

local statePersistencePrefix = '7_radio:state:'
local persistenceVersion = 1
local hasRestoredState = false
local restoreInProgress = false

local function normalizeFrequencyLabel(value)
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
        }
    }

    SetResourceKvp(key, json.encode(payload))
end

local function syncFrequencyStateToNui()
    SendNUIMessage({
        action = 'syncFrequencies',
        primary = radioState.primary,
        secondary = radioState.secondary,
        activeFreq = radioState.active,
        primaryChatRelay = radioState.chatRelay.primary,
        secondaryChatRelay = radioState.chatRelay.secondary
    })

    persistRadioState()
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

local function restorePersistedState()
    if hasRestoredState or restoreInProgress then
        return
    end

    local key = getStateStorageKey()
    if not key then
        return
    end

    restoreInProgress = true

    local raw = GetResourceKvpString(key)
    local restored = false

    if raw and raw ~= '' then
        local ok, data = pcall(json.decode, raw)
        if ok and type(data) == 'table' then
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

            radioState.primary = nil
            radioState.secondary = nil
            radioState.chatRelay.primary = false
            radioState.chatRelay.secondary = false

            TriggerServerEvent('7_radio:server:resetPlayerFrequencies')

            if primary then
                radioState.primary = primary
                TriggerServerEvent('7_radio:server:joinFrequency', primary, true)
                radioState.chatRelay.primary = relayPrimary
            end

            if secondary then
                radioState.secondary = secondary
                TriggerServerEvent('7_radio:server:joinFrequency', secondary, false)
                radioState.chatRelay.secondary = relaySecondary
            end

            radioState.active = tostring(data.active or 'primary') == 'secondary' and 'secondary' or 'primary'
            applyActiveFallback()
            syncFrequencyStateToNui()
            restored = true
        end
    end

    if not restored then
        applyActiveFallback()
        syncFrequencyStateToNui()
    end

    hasRestoredState = true
    restoreInProgress = false
end

local function scheduleStateRestore()
    if hasRestoredState or restoreInProgress then
        return
    end

    CreateThread(function()
        for _ = 1, 80 do
            local data = QBCore.Functions.GetPlayerData()
            if data then
                PlayerData = data
            end

            if PlayerData and PlayerData.citizenid and PlayerData.job then
                restorePersistedState()
                return
            end

            Wait(250)
        end
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

    scheduleStateRestore()
end)


AddEventHandler('onClientResourceStart', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then
        return
    end

    scheduleStateRestore()
end)

RegisterNetEvent('QBCore:Client:OnPlayerLoaded', function()
    PlayerData = QBCore.Functions.GetPlayerData() or {}
    hasRestoredState = false
    restoreInProgress = false
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

    closeNuiClean()
end)

RegisterNetEvent('QBCore:Client:OnJobUpdate', function(jobInfo)
    PlayerData.job = jobInfo

    if radioState.primary and not HasAccessToFrequency(radioState.primary) then
        QBCore.Functions.Notify('You no longer have access to this frequency', 'error')
        TriggerServerEvent('7_radio:server:leaveFrequency', radioState.primary)
        radioState.primary = nil
        radioState.chatRelay.primary = false
    end

    if radioState.secondary and not HasAccessToFrequency(radioState.secondary) then
        QBCore.Functions.Notify('You no longer have access to the secondary frequency', 'error')
        TriggerServerEvent('7_radio:server:leaveFrequency', radioState.secondary)
        radioState.secondary = nil
        radioState.chatRelay.secondary = false
    end

    applyActiveFallback()
    syncFrequencyStateToNui()
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

RegisterNUICallback('setFrequency', function(data, cb)
    local frequency = data and data.frequency
    local isPrimary = data and data.isPrimary == true

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
    local current = radioState[channel]
    local otherFrequency = radioState[otherChannel]

    if current and current ~= freqLabel then
        radioState.chatRelay[channel] = false
        if otherFrequency ~= current then
            TriggerServerEvent('7_radio:server:leaveFrequency', current)
        end
    end

    if current ~= freqLabel and otherFrequency ~= freqLabel then
        TriggerServerEvent('7_radio:server:joinFrequency', freqLabel, isPrimary)
    end

    radioState[channel] = freqLabel
    if isPrimary then
        radioState.active = 'primary'
    end

    applyActiveFallback()
    syncFrequencyStateToNui()

    QBCore.Functions.Notify((isPrimary and 'Primary' or 'Secondary') .. ' frequency set to ' .. freqLabel, 'success')

    cb({
        success = true,
        primary = radioState.primary,
        secondary = radioState.secondary,
        activeFreq = radioState.active,
        primaryChatRelay = radioState.chatRelay.primary,
        secondaryChatRelay = radioState.chatRelay.secondary
    })
end)

RegisterNUICallback('sendMessage', function(data, cb)
    local message = tostring((data and data.message) or '')
    message = message:match('^%s*(.-)%s*$')
    local frequency = normalizeFrequencyLabel(data and data.frequency)

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
        local ped = PlayerPedId()
        RequestAnimDict(Config.AnimationDict)
        while not HasAnimDictLoaded(Config.AnimationDict) do
            Wait(10)
        end
        TaskPlayAnim(ped, Config.AnimationDict, Config.AnimationName, 8.0, -8.0, -1, 49, 0, false, false, false)
        Wait(1000)
        StopAnimTask(ped, Config.AnimationDict, Config.AnimationName, 1.0)
    end

    TriggerServerEvent('7_radio:server:sendMessage', frequency, message)
    cb({ success = true })
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

    radioState.chatRelay[channel] = not radioState.chatRelay[channel]
    syncFrequencyStateToNui()

    cb({
        success = true,
        channel = channel,
        enabled = radioState.chatRelay[channel],
        primaryChatRelay = radioState.chatRelay.primary,
        secondaryChatRelay = radioState.chatRelay.secondary
    })
end)

RegisterNetEvent('7_radio:client:receiveMessage', function(frequency, senderName, message, senderId)
    local freqLabel = normalizeFrequencyLabel(frequency)
    if not freqLabel then
        return
    end

    local channel = getChannelForFrequency(freqLabel)
    if not channel then
        return
    end

    SendNUIMessage({
        action = 'newMessage',
        frequency = freqLabel,
        sender = senderName,
        message = message,
        senderId = senderId,
        isMe = senderId == GetPlayerServerId(PlayerId())
    })

    if radioState.chatRelay[channel] and HasAccessToFrequency(freqLabel) then
        local cleanedMessage = stripGpsTokenFromMessage(message)
        local senderLabel = senderName or 'Unknown'

        TriggerEvent('chat:addMessage', {
            color = {0, 255, 163},
            multiline = true,
            args = {('[RADIO %s] %s'):format(freqLabel, senderLabel), cleanedMessage}
        })
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

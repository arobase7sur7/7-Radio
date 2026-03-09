local QBCore = exports['qb-core']:GetCoreObject()
local PlayerData = {}
local radioOpen = false
local chatOpen = false
local currentFrequency = nil
local secondaryFrequency = nil
local activeFrequency = 'primary' 
local radioItem = Config.RadioItem 

local radioNotifyCooldownMs = 5000 
local lastRadioNotify = {}         


local radioNotifyPreviewLength = 80 
local radioNotifyEnablePreview = true 
local chatRelayEnabled = {
    primary = false,
    secondary = false
}


CreateThread(function()
    PlayerData = QBCore.Functions.GetPlayerData()
    
    
    Wait(1000)
    SendNUIMessage({
        action = 'setSounds',
        enabled = Config.Sounds.enabled,
        volume = Config.Sounds.volume
    })
end)

RegisterNetEvent('QBCore:Client:OnPlayerLoaded', function()
    PlayerData = QBCore.Functions.GetPlayerData()
end)

local function NormalizeFrequencyLabel(frequency)
    local freq = tonumber(frequency)
    if freq then
        return string.format('%.2f', freq)
    end
    return tostring(frequency or '')
end

local function GetChannelForFrequency(frequency)
    local freqLabel = NormalizeFrequencyLabel(frequency)

    if currentFrequency and NormalizeFrequencyLabel(currentFrequency) == freqLabel then
        return 'primary'
    end

    if secondaryFrequency and NormalizeFrequencyLabel(secondaryFrequency) == freqLabel then
        return 'secondary'
    end

    return nil
end

local function StripGpsTokenFromMessage(message)
    if not message then return '' end
    return tostring(message):gsub("%%gpslink|([^|]+)|[^|]+|[^|]+|[^%%]+%%", "%1")
end

local function SyncFrequencyStateToNui()
    SendNUIMessage({
        action = 'syncFrequencies',
        primary = currentFrequency,
        secondary = secondaryFrequency,
        activeFreq = activeFrequency,
        primaryChatRelay = chatRelayEnabled.primary,
        secondaryChatRelay = chatRelayEnabled.secondary
    })
end

RegisterNetEvent('QBCore:Client:OnJobUpdate', function(JobInfo)
    PlayerData.job = JobInfo
    
    if currentFrequency then
        if not HasAccessToFrequency(currentFrequency) then
            QBCore.Functions.Notify('You no longer have access to this frequency', 'error')
            TriggerServerEvent('7_radio:server:leaveFrequency', currentFrequency)
            currentFrequency = nil
            chatRelayEnabled.primary = false
        end
    end
    if secondaryFrequency then
        if not HasAccessToFrequency(secondaryFrequency) then
            QBCore.Functions.Notify('You no longer have access to the secondary frequency', 'error')
            TriggerServerEvent('7_radio:server:leaveFrequency', secondaryFrequency)
            secondaryFrequency = nil
            chatRelayEnabled.secondary = false
        end
    end

    if activeFrequency == 'primary' and not currentFrequency and secondaryFrequency then
        activeFrequency = 'secondary'
    elseif activeFrequency == 'secondary' and not secondaryFrequency and currentFrequency then
        activeFrequency = 'primary'
    elseif not currentFrequency and not secondaryFrequency then
        activeFrequency = 'primary'
    end

    SyncFrequencyStateToNui()
end)


function HasAccessToFrequency(frequency)
    if not PlayerData.job or not Config.RestrictedFrequencies then return true end
    
    local freqStr = tostring(frequency)
    if tonumber(frequency) then
        freqStr = string.format("%.2f", tonumber(frequency))
    end
    
    for _, restriction in ipairs(Config.RestrictedFrequencies) do
        local isMatch = false
        
        if restriction.freq then
            if tostring(restriction.freq) == freqStr then
                isMatch = true
            end
        elseif restriction.min and restriction.max then
            local freqNum = tonumber(frequency) or 0
            if freqNum >= restriction.min and freqNum <= restriction.max then
                isMatch = true
            end
        end
        
        if isMatch then
            local jobMatch = false
            local specificGradeMatch = nil

            local jobName = (PlayerData.job and PlayerData.job.name) or "unknown"
            local grade = (PlayerData.job and PlayerData.job.grade and PlayerData.job.grade.level) or 0

            for _, allowedJobEntry in ipairs(restriction.jobs) do
                local allowedJobName = allowedJobEntry
                local condition = nil

                if string.find(allowedJobEntry, ":") then
                    local parts = {}
                    for s in string.gmatch(allowedJobEntry, "([^:]+)") do
                        table.insert(parts, s)
                    end
                    allowedJobName = parts[1]
                    condition = parts[2]
                end

                if jobName == allowedJobName then
                    jobMatch = true
                    if condition then
                        local grade = (PlayerData.job and PlayerData.job.grade and PlayerData.job.grade.level) or 0
                        if string.sub(condition, 1, 4) == "from" then
                            local minG = tonumber(string.sub(condition, 5))
                            if minG then
                                specificGradeMatch = (grade >= minG)
                            end
                        elseif string.sub(condition, 1, 5) == "fixed" then
                            local fixG = tonumber(string.sub(condition, 6))
                            if fixG then
                                specificGradeMatch = (grade == fixG)
                            end
                        end
                    end
                    break
                end
            end
            
            if jobMatch then
                if specificGradeMatch ~= nil then
                    return specificGradeMatch
                end

                if restriction.fixedGrade then
                    return grade == restriction.fixedGrade
                end
                if restriction.minGrade then
                    return grade >= restriction.minGrade
                end
                return true
            end
            return false
        end
    end
    
    return true
end


function HasRadio()
    if radioItem == "none" or radioItem == false then
        return true
    end
    return QBCore.Functions.HasItem(radioItem)
end



RegisterCommand('radio', function()
    if not HasRadio() then
        QBCore.Functions.Notify('You don\'t have radio', 'error')
        return
    end
    ToggleRadioUI()
end)


RegisterCommand('radiochat', function()
    if not currentFrequency and not secondaryFrequency then
        QBCore.Functions.Notify('You are not connected to any frequency', 'error')
        return
    end
    if not HasRadio() then
        QBCore.Functions.Notify('You don\'t have radio', 'error')
        return
    end
    ToggleChatUI()
end)






RegisterCommand('radio_toggle', function()
    if not HasRadio() then
        QBCore.Functions.Notify('You don\'t have radio', 'error')
        return
    end

    ToggleRadioUI()
end, false)


RegisterCommand('radio_chat_toggle', function()
    if not currentFrequency and not secondaryFrequency then
        QBCore.Functions.Notify('You are not connected to any frequency', 'error')
        return
    end
    if not HasRadio() then
        QBCore.Functions.Notify('You don\'t have radio', 'error')
        return
    end

    ToggleChatUI()
end, false)


RegisterKeyMapping('radio_toggle', 'Open / Close radio', 'keyboard', 'F9')
RegisterKeyMapping('radio_chat_toggle', 'Open / Close radio chat', 'keyboard', 'F10')


RegisterCommand('radio_switch_channel', function()
    SendNUIMessage({ action = 'requestSwitchChannel' })
end, false)

RegisterKeyMapping('radio_switch_channel', 'Switch channel (chat radio)', 'keyboard', 'TAB')
RegisterKeyMapping('radio_switch_channel', 'Switch channel (chat radio)', 'keyboard', 'TAB')


function GetControlKey(key)
    local keys = {
        ['F9'] = 56,
        ['F10'] = 57,
        ['TAB'] = 37
    }
    return keys[key] or 56
end


local function CloseNuiClean()
  
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
function ToggleRadioUI()
    radioOpen = not radioOpen

    if radioOpen then
        
        SendNUIMessage({
            action = 'toggleRadio',
            show = true,
            primary = currentFrequency,
            secondary = secondaryFrequency,
            globalMacros = Config.GlobalMacros or {},
            allMacroSets = {
                PoliceMacros = Config.PoliceMacros,
                EMSMacros = Config.EMSMacros,
                GeneralMacros = Config.GlobalMacros
            }
        })
        
        Citizen.SetTimeout(10, function()
            SetNuiFocus(true, true)
            
            SetNuiFocusKeepInput(false)
        end)
    else
        
        SendNUIMessage({
            action = 'toggleRadio',
            show = false
        })
        CloseNuiClean()
    end
end


function ToggleChatUI()
    chatOpen = not chatOpen

    if chatOpen then
        SendNUIMessage({
            action = 'toggleChat',
            show = true,
            primary = currentFrequency,
            secondary = secondaryFrequency,
            activeFreq = activeFrequency,
            primaryChatRelay = chatRelayEnabled.primary,
            secondaryChatRelay = chatRelayEnabled.secondary,
            globalMacros = Config.GlobalMacros or {},
            allMacroSets = {
                PoliceMacros = Config.PoliceMacros,
                EMSMacros = Config.EMSMacros,
                GeneralMacros = Config.GlobalMacros
            }
        })
        Citizen.SetTimeout(10, function()
            SetNuiFocus(true, true)
            SetNuiFocusKeepInput(false)
        end)
    else
        SendNUIMessage({
            action = 'toggleChat',
            show = false
        })
        CloseNuiClean()
    end
end

RegisterNUICallback('close', function(data, cb)
    if data.type == 'radio' then
        radioOpen = false
    elseif data.type == 'chat' then
        chatOpen = false
    end

    
    SendNUIMessage({ action = 'toggleRadio', show = false })
    SendNUIMessage({ action = 'toggleChat', show = false })
    CloseNuiClean()

    cb('ok')
end)

RegisterNUICallback('nuiClosed', function(data, cb)
    radioOpen = false
    chatOpen = false
    CloseNuiClean()

    cb('ok')
end)

RegisterNUICallback('openChatFromRadio', function(data, cb)
    
    radioOpen = false
    SendNUIMessage({ action = 'toggleRadio', show = false })
    CloseNuiClean()
    
    Citizen.SetTimeout(120, function()
        if not chatOpen then
            ToggleChatUI()
        end
    end)
    cb('ok')
end)

RegisterNUICallback('setFrequency', function(data, cb)
    local frequency = tostring(data.frequency)
    local isPrimary = data.isPrimary
    local normalizedNewFrequency = NormalizeFrequencyLabel(frequency)
    
    
    local freq = tonumber(frequency)
    if freq < Config.MinFrequency or freq > Config.MaxFrequency then
        QBCore.Functions.Notify('Invalid frequency', 'error')
        cb({success = false})
        return
    end
    
    
    if not HasAccessToFrequency(frequency) then
        QBCore.Functions.Notify('You do not have access to this frequency', 'error')
        cb({success = false})
        return
    end
    
    
    if isPrimary and currentFrequency then
        TriggerServerEvent('7_radio:server:leaveFrequency', currentFrequency)
    elseif not isPrimary and secondaryFrequency then
        TriggerServerEvent('7_radio:server:leaveFrequency', secondaryFrequency)
    end
    
    
    TriggerServerEvent('7_radio:server:joinFrequency', frequency, isPrimary)
    
    if isPrimary then
        if currentFrequency and NormalizeFrequencyLabel(currentFrequency) ~= normalizedNewFrequency then
            chatRelayEnabled.primary = false
        end
        currentFrequency = frequency
        activeFrequency = 'primary'
    else
        if secondaryFrequency and NormalizeFrequencyLabel(secondaryFrequency) ~= normalizedNewFrequency then
            chatRelayEnabled.secondary = false
        end
        secondaryFrequency = frequency
    end
    
    SyncFrequencyStateToNui()
    QBCore.Functions.Notify('' .. (isPrimary and 'principal' or 'secondary') .. ' frequency set on ' .. frequency, 'success')
    cb({
        success = true,
        primary = currentFrequency,
        secondary = secondaryFrequency,
        activeFreq = activeFrequency,
        primaryChatRelay = chatRelayEnabled.primary,
        secondaryChatRelay = chatRelayEnabled.secondary
    })
end)

RegisterNUICallback('sendMessage', function(data, cb)
    local message = data.message
    local frequency = data.frequency
    
    if not message or message == '' then
        cb({success = false})
        return
    end
    
    if #message > Config.MaxMessageLength then
        QBCore.Functions.Notify('Message too long', 'error')
        cb({success = false})
        return
    end
    
    
    if not HasAccessToFrequency(frequency) then
        QBCore.Functions.Notify('You do not have access to this frequency', 'error')
        cb({success = false})
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
    cb({success = true})
end)

RegisterNUICallback('switchFrequency', function(data, cb)
    if activeFrequency == 'primary' and secondaryFrequency then
        activeFrequency = 'secondary'
    elseif activeFrequency == 'secondary' and currentFrequency then
        activeFrequency = 'primary'
    end
    
    cb({
        activeFreq = activeFrequency,
        frequency = activeFrequency == 'primary' and currentFrequency or secondaryFrequency,
        primaryChatRelay = chatRelayEnabled.primary,
        secondaryChatRelay = chatRelayEnabled.secondary
    })
end)

RegisterNUICallback('toggleChatRelay', function(data, cb)
    local requestedChannel = tostring((data and data.channel) or activeFrequency)
    local channel = requestedChannel == 'secondary' and 'secondary' or 'primary'
    local targetFrequency = channel == 'primary' and currentFrequency or secondaryFrequency

    if not targetFrequency then
        chatRelayEnabled[channel] = false
        SyncFrequencyStateToNui()
        cb({
            success = false,
            reason = 'no_frequency',
            channel = channel,
            enabled = false,
            primaryChatRelay = chatRelayEnabled.primary,
            secondaryChatRelay = chatRelayEnabled.secondary
        })
        return
    end

    if not HasAccessToFrequency(targetFrequency) then
        chatRelayEnabled[channel] = false
        SyncFrequencyStateToNui()
        cb({
            success = false,
            reason = 'restricted',
            channel = channel,
            enabled = false,
            primaryChatRelay = chatRelayEnabled.primary,
            secondaryChatRelay = chatRelayEnabled.secondary
        })
        return
    end

    chatRelayEnabled[channel] = not chatRelayEnabled[channel]
    SyncFrequencyStateToNui()

    cb({
        success = true,
        channel = channel,
        enabled = chatRelayEnabled[channel],
        primaryChatRelay = chatRelayEnabled.primary,
        secondaryChatRelay = chatRelayEnabled.secondary
    })
end)

RegisterNetEvent('7_radio:client:receiveMessage', function(frequency, senderName, message, senderId)
    local channel = GetChannelForFrequency(frequency)
    if not channel then
        return
    end

    
    SendNUIMessage({
        action = 'newMessage',
        frequency = frequency,
        sender = senderName,
        message = message,
        senderId = senderId,
        isMe = senderId == GetPlayerServerId(PlayerId())
    })

    if chatRelayEnabled[channel] and HasAccessToFrequency(frequency) then
        local freqLabel = NormalizeFrequencyLabel(frequency)
        local cleanedMessage = StripGpsTokenFromMessage(message)
        local senderLabel = senderName or 'Unknown'

        TriggerEvent('chat:addMessage', {
            color = {0, 255, 163},
            multiline = true,
            args = {string.format('[RADIO %s] %s', freqLabel, senderLabel), cleanedMessage}
        })
    elseif chatRelayEnabled[channel] and not HasAccessToFrequency(frequency) then
        chatRelayEnabled[channel] = false
        SyncFrequencyStateToNui()
    end

    
    if Config and Config.UseSound then
        PlaySound(-1, 'NAV_UP_DOWN', Config.RadioClickSound, 0, 0, 1)
    end

    
    if not chatOpen then
        
        lastRadioNotify = lastRadioNotify or {}

        local freqKey = tostring(frequency)
        local now = GetGameTimer()
        local cooldown = radioNotifyCooldownMs or 5000            
        local last = lastRadioNotify[freqKey] or 0

        if (now - last) >= cooldown then
            
            local channelLabel = "OTHER"
            if frequency == currentFrequency then
                channelLabel = "CHANNEL 1"
            elseif frequency == secondaryFrequency then
                channelLabel = "CHANNEL 2"
            end

            
            local notifText = string.format('New message on %s (%s)', freqKey, channelLabel)
            if senderName and senderName ~= '' then
                notifText = notifText .. ' — ' .. senderName
            end

            
            local previewEnabled = (radioNotifyEnablePreview ~= nil) and radioNotifyEnablePreview or true
            local previewLen = radioNotifyPreviewLength or 80
            if previewEnabled and message and message ~= '' then
                local preview = StripGpsTokenFromMessage(message)
                if #preview > previewLen then
                    preview = string.sub(preview, 1, previewLen) .. '...'
                end
                notifText = notifText .. '\n"' .. preview .. '"'
            end

            
            if QBCore and QBCore.Functions and QBCore.Functions.Notify then
                local ok = pcall(function()
                    
                    QBCore.Functions.Notify(notifText, 'primary', 5000)
                end)
                if not ok then
                    
                    QBCore.Functions.Notify(notifText, 'primary')
                end
            else
                
                TriggerEvent('chat:addMessage', {
                    color = {255, 128, 0},
                    multiline = true,
                    args = {'[RADIO]', notifText}
                })
            end

            
            lastRadioNotify[freqKey] = now
        end
    end
end)


RegisterNetEvent('7_radio:client:updateFrequencyCount', function(frequency, count)
    
    SendNUIMessage({
        action = 'updateFreqCount',
        frequency = tostring(frequency),
        count = tonumber(count) or 0
    })
end)

RegisterNetEvent('7_radio:client:loadHistory', function(frequency, history, customData)
    SendNUIMessage({
        action = "loadHistory",
        frequency = frequency,
        history = history,
        customData = customData
    })
end)

RegisterNUICallback('setWaypoint', function(data, cb)
    SetNewWaypoint(data.x, data.y)
    QBCore.Functions.Notify('GPS mis à jour !', 'success')
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

RegisterNUICallback('fetchUserMacros', function(data, cb)
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

local function GetCurrentLocationData()
    local playerPed = PlayerPedId()
    local coords = GetEntityCoords(playerPed)
    local s1, s2 = GetStreetNameAtCoord(coords.x, coords.y, coords.z)
    local streetName = GetStreetNameFromHashKey(s1)
    local area = GetLabelText(GetNameOfZone(coords.x, coords.y, coords.z))
    
    if s2 ~= 0 then
        streetName = streetName .. " / " .. GetStreetNameFromHashKey(s2)
    end
    
    local locationText = streetName
    if area and area ~= '' and area ~= 'NULL' then
        locationText = locationText .. ", " .. area
    end

    return locationText, {
        x = coords.x,
        y = coords.y,
        z = coords.z
    }
end

local function GetInGameTime()
    local hours = GetClockHours()
    local minutes = GetClockMinutes()
    return string.format("%02d:%02d", hours, minutes)
end

CreateThread(function()
    while true do
        if chatOpen or radioOpen then
            local Player = QBCore.Functions.GetPlayerData()
            local locationText, locationCoords = GetCurrentLocationData()
            local timeText = GetInGameTime()

            local name = 'Unknown'
            local surname = 'Unknown'
            local jobLabel = 'None'
            local rankLabel = 'None'
            local citizenid = nil

            if Player and Player.charinfo then
                name = Player.charinfo.firstname or name
                surname = Player.charinfo.lastname or surname
            end

            if Player and Player.job then
                jobLabel = Player.job.label or jobLabel
                if Player.job.grade then
                    rankLabel = Player.job.grade.name or Player.job.grade.label or rankLabel
                end
            end

            if Player then
                citizenid = Player.citizenid
            end

            SendNUIMessage({
                action = 'updatePlaceholders',
                data = {
                    location = locationText,
                    locationCoords = locationCoords,
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
RegisterNUICallback('setGpsAtCurrent', function(data, cb)
    local coords = GetEntityCoords(PlayerPedId())
    SetNewWaypoint(coords.x, coords.y)
    QBCore.Functions.Notify('GPS marked at position', 'success')
    cb('ok')
end)

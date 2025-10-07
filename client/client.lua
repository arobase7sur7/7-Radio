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

RegisterNetEvent('QBCore:Client:OnJobUpdate', function(JobInfo)
    PlayerData.job = JobInfo
    
    if currentFrequency then
        if not HasAccessToFrequency(currentFrequency) then
            QBCore.Functions.Notify('You no longer have access to this frequency', 'error')
            TriggerServerEvent('7_radio:server:leaveFrequency', currentFrequency)
            currentFrequency = nil
        end
    end
    if secondaryFrequency then
        if not HasAccessToFrequency(secondaryFrequency) then
            QBCore.Functions.Notify('You no longer have access to the secondary frequency', 'error')
            TriggerServerEvent('7_radio:server:leaveFrequency', secondaryFrequency)
            secondaryFrequency = nil
        end
    end
end)


function HasAccessToFrequency(frequency)
    if not PlayerData.job then return true end
    
    local freq = tonumber(frequency)
    
    
    if Config.RestrictedFrequencies[frequency] then
        local allowedJobs = Config.RestrictedFrequencies[frequency]
        for _, job in ipairs(allowedJobs) do
            if PlayerData.job.name == job then
                return true
            end
        end
        return false
    end
    
    
    for _, range in ipairs(Config.FrequencyRanges) do
        if freq >= range.min and freq <= range.max then
            for _, job in ipairs(range.jobs) do
                if PlayerData.job.name == job then
                    return true
                end
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

    
    Citizen.SetTimeout(80, function()
        SetNuiFocus(false, false)
        SetNuiFocusKeepInput(false)

        
        if SetCursorLocation then
            SetCursorLocation(0.5, 0.5)
        end

        
        Citizen.SetTimeout(120, function()
            SetNuiFocus(false, false)
            SetNuiFocusKeepInput(false)
        end)
    end)
end
function ToggleRadioUI()
    radioOpen = not radioOpen

    if radioOpen then
        
        SendNUIMessage({
            action = 'toggleRadio',
            show = true,
            primary = currentFrequency,
            secondary = secondaryFrequency
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
            activeFreq = activeFrequency
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
        currentFrequency = frequency
        activeFrequency = 'primary'
    else
        secondaryFrequency = frequency
    end
    
    QBCore.Functions.Notify('' .. (isPrimary and 'principal' or 'secondary') .. ' frequency set on ' .. frequency, 'success')
    cb({success = true})
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
        frequency = activeFrequency == 'primary' and currentFrequency or secondaryFrequency
    })
end)

RegisterNetEvent('7_radio:client:receiveMessage', function(frequency, senderName, message, senderId)
    
    if frequency ~= currentFrequency and frequency ~= secondaryFrequency then
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
                local preview = message
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

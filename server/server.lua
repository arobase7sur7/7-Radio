local QBCore = exports['qb-core']:GetCoreObject()


local radioFrequencies = {}

local function registerServerEventAliases(eventName, handler)
    RegisterNetEvent(('7_radio:%s'):format(eventName), handler)

end


registerServerEventAliases('server:joinFrequency', function(frequency, isPrimary)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then return end

    local freqKey = tostring(frequency)

    if not radioFrequencies[freqKey] then
        radioFrequencies[freqKey] = {}
    end

    radioFrequencies[freqKey][src] = {
        name = (Player.PlayerData and Player.PlayerData.charinfo and (Player.PlayerData.charinfo.firstname .. ' ' .. Player.PlayerData.charinfo.lastname)) or ("Player#" .. src),
        job = (Player.PlayerData and Player.PlayerData.job and Player.PlayerData.job.name) or "unknown",
        citizenid = (Player.PlayerData and Player.PlayerData.citizenid) or nil
    }

local count = GetTableLength(radioFrequencies[freqKey] or {})
TriggerClientEvent('7_radio:client:updateFrequencyCount', -1, freqKey, count)

end)


registerServerEventAliases('server:leaveFrequency', function(frequency)
    local src = source
    local freqKey = tostring(frequency)

    if radioFrequencies[freqKey] and radioFrequencies[freqKey][src] then
        local playerName = radioFrequencies[freqKey][src].name
        radioFrequencies[freqKey][src] = nil

        if next(radioFrequencies[freqKey]) == nil then
            radioFrequencies[freqKey] = nil
        end

        local count = radioFrequencies[freqKey] and GetTableLength(radioFrequencies[freqKey]) or 0
TriggerClientEvent('7_radio:client:updateFrequencyCount', -1, freqKey, count)


    end
end)


registerServerEventAliases('server:sendMessage', function(frequency, message)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then return end

    local freqKey = tostring(frequency)


    if not radioFrequencies[freqKey] or not radioFrequencies[freqKey][src] then
        TriggerClientEvent('QBCore:Notify', src, 'You are not on this frequency', 'error')
        return
    end

    if not HasAccessToFrequency(src, freqKey) then
        TriggerClientEvent('QBCore:Notify', src, 'You no longer have access to this frequency', 'error')
        radioFrequencies[freqKey][src] = nil
        return
    end

    local senderName = radioFrequencies[freqKey][src].name

  
    for playerId, playerData in pairs(radioFrequencies[freqKey]) do

        if GetPlayerPing(playerId) and GetPlayerPing(playerId) > 0 then
            if HasAccessToFrequency(playerId, freqKey) then
    
                TriggerClientEvent('7_radio:client:receiveMessage', playerId, freqKey, senderName, message, src)
            else
                radioFrequencies[freqKey][playerId] = nil
                TriggerClientEvent('QBCore:Notify', playerId, 'You no longer have access to this frequency', 'error')
            end
        else
          
            radioFrequencies[freqKey][playerId] = nil
        end
    end

    print(string.format('[7_RADIO] [%s] %s: %s', freqKey, senderName, message))

  
    if exports and exports.oxmysql then
        local ok, err = pcall(function()
            exports.oxmysql:insert('INSERT INTO radio_logs (citizenid, frequency, message, timestamp) VALUES (?, ?, ?, ?)', {
                Player.PlayerData.citizenid,
                freqKey,
                message,
                os.date('%Y-%m-%d %H:%M:%S')
            })
        end)
        if not ok then
            print('[7_RADIO] Warning: error when adding to DB:', err)
        end
    end
end)


function HasAccessToFrequency(source, frequency)
    local Player = QBCore.Functions.GetPlayer(source)
    if not Player or not Player.PlayerData then return false end

    local freq = tonumber(frequency)
    local playerJob = (Player.PlayerData.job and Player.PlayerData.job.name) or "unknown"


    if Config and Config.RestrictedFrequencies and Config.RestrictedFrequencies[frequency] then
        local allowedJobs = Config.RestrictedFrequencies[frequency]
        for _, job in ipairs(allowedJobs) do
            if playerJob == job then
                return true
            end
        end
        return false
    end


    if Config and Config.FrequencyRanges then
        for _, range in ipairs(Config.FrequencyRanges) do
            if freq and freq >= range.min and freq <= range.max then
                for _, job in ipairs(range.jobs) do
                    if playerJob == job then
                        return true
                    end
                end
                return false
            end
        end
    end

    return true
end


AddEventHandler('playerDropped', function(reason)
    local src = source
    if not src then return end

    for frequency, players in pairs(radioFrequencies) do
        if players[src] then
            players[src] = nil
            if next(radioFrequencies[frequency]) == nil then
                radioFrequencies[frequency] = nil
            end
    
        end
    end
end)

QBCore.Commands.Add('radiolist', 'View list of active frequencies (admin)', {}, false, function(source)
    local Player = QBCore.Functions.GetPlayer(source)

   
    local hasAce = false

    if IsPlayerAceAllowed then
        local ok, res = pcall(function()
            return IsPlayerAceAllowed(source, "admin")
        end)
        if ok and res then
            hasAce = true
        end
    end

 
    local hasJobAdmin = false
    if Player and Player.PlayerData and Player.PlayerData.job and Player.PlayerData.job.name == 'admin' then
        hasJobAdmin = true
    end

    if not hasAce and not hasJobAdmin then
        TriggerClientEvent('QBCore:Notify', source, 'You do not have permission', 'error')
        return
    end

    local total = 0
    for frequency, players in pairs(radioFrequencies) do
        total = total + 1
        local num = GetTableLength(players)
     
        local freqLabel = tostring(frequency)
        if tonumber(frequency) then
            freqLabel = string.format("%.2f", tonumber(frequency))
        end

        TriggerClientEvent('chat:addMessage', source, {
            color = {0, 255, 0},
            multiline = true,
            args = {'[RADIO]', 'Frequency ' .. freqLabel .. ' : ' .. num .. ' connected'}
        })
    end

    if total == 0 then
        TriggerClientEvent('QBCore:Notify', source, 'No active frequency', 'primary')
    end
end, 'admin')


function GetTableLength(t)
    local count = 0
    if not t then return 0 end
    for _ in pairs(t) do
        count = count + 1
    end
    return count
end

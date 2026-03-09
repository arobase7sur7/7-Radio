local QBCore = exports['qb-core']:GetCoreObject()


local radioFrequencies = {}
local frequencyHistory = {}

local function NormalizeFrequency(frequency)
    local freq = tonumber(frequency)
    if freq then
        return string.format("%.2f", freq)
    end
    return tostring(frequency)
end

local function registerServerEventAliases(eventName, handler)
    RegisterNetEvent(('7_radio:%s'):format(eventName), handler)
end


registerServerEventAliases('server:joinFrequency', function(frequency, isPrimary)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then return end

    local freqKey = NormalizeFrequency(frequency)

    if not HasAccessToFrequency(src, freqKey) then
        TriggerClientEvent('QBCore:Notify', src, 'Vous n\'avez pas accès à cette fréquence', 'error')
        return
    end

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


    local freqConfig = GetFrequencyConfig(freqKey)
    local customData = {
        label = freqConfig and freqConfig.label or nil,
        color = freqConfig and freqConfig.color or nil,
        macros = freqConfig and freqConfig.macros or nil
    }

    if frequencyHistory[freqKey] then

        TriggerClientEvent('7_radio:client:loadHistory', src, freqKey, frequencyHistory[freqKey], customData)
    else

        if exports and exports.oxmysql then
            local limit = Config.ChatHistoryLimit or 100
            exports.oxmysql:execute('SELECT sender, message, timestamp, citizenid FROM radio_history WHERE frequency = ? ORDER BY id DESC LIMIT ?', {
                freqKey, limit
            }, function(results)
                local history = {}
                if results and #results > 0 then

                    for i = #results, 1, -1 do
                        table.insert(history, {
                            frequency = freqKey,
                            sender = results[i].sender,
                            message = results[i].message,
                            timestamp = results[i].timestamp,
                            citizenid = results[i].citizenid
                        })
                    end
                end
                frequencyHistory[freqKey] = history
                TriggerClientEvent('7_radio:client:loadHistory', src, freqKey, history, customData)
            end)
        else
            TriggerClientEvent('7_radio:client:loadHistory', src, freqKey, {}, customData)
        end
    end
end)


registerServerEventAliases('server:leaveFrequency', function(frequency)
    local src = source
    local freqKey = NormalizeFrequency(frequency)

    if radioFrequencies[freqKey] and radioFrequencies[freqKey][src] then
        local playerName = radioFrequencies[freqKey][src].name
        radioFrequencies[freqKey][src] = nil

        if next(radioFrequencies[freqKey]) == nil then
            radioFrequencies[freqKey] = nil

            frequencyHistory[freqKey] = nil
        end

        local count = radioFrequencies[freqKey] and GetTableLength(radioFrequencies[freqKey]) or 0
TriggerClientEvent('7_radio:client:updateFrequencyCount', -1, freqKey, count)


    end
end)


registerServerEventAliases('server:sendMessage', function(frequency, message)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then return end

    local freqKey = NormalizeFrequency(frequency)


    if not radioFrequencies[freqKey] or not radioFrequencies[freqKey][src] then
        TriggerClientEvent('QBCore:Notify', src, 'You are not on this frequency', 'error')
        return
    end

    if not HasAccessToFrequency(src, freqKey) then
        TriggerClientEvent('QBCore:Notify', src, 'You no longer have access to this frequency', 'error')
        if radioFrequencies[freqKey] then radioFrequencies[freqKey][src] = nil end
        return
    end

    local senderName = radioFrequencies[freqKey][src].name
    local displaySender = senderName


    local freqConfig = GetFrequencyConfig(freqKey)
    if freqConfig then
        local prefix = ""
        if freqConfig.showJob and Player.PlayerData.job then
            prefix = Player.PlayerData.job.label or Player.PlayerData.job.name
        end
        if freqConfig.showJobRank and Player.PlayerData.job and Player.PlayerData.job.grade then
            if prefix ~= "" then prefix = prefix .. " - " end
            prefix = prefix .. (Player.PlayerData.job.grade.name or Player.PlayerData.job.grade.label)
        end

        if prefix ~= "" then
            displaySender = "[" .. prefix .. "] " .. senderName
        end
    end


    for playerId, playerData in pairs(radioFrequencies[freqKey]) do
        if GetPlayerPing(playerId) and GetPlayerPing(playerId) > 0 then
            if HasAccessToFrequency(playerId, freqKey) then
                TriggerClientEvent('7_radio:client:receiveMessage', playerId, freqKey, displaySender, message, src)
            else
                radioFrequencies[freqKey][playerId] = nil
                TriggerClientEvent('QBCore:Notify', playerId, 'You no longer have access to this frequency', 'error')
            end
        else
          
            radioFrequencies[freqKey][playerId] = nil
        end
    end

    print(string.format('[7_RADIO] [%s] %s: %s', freqKey, senderName, message))


    if not frequencyHistory[freqKey] then frequencyHistory[freqKey] = {} end
    table.insert(frequencyHistory[freqKey], {
        frequency = freqKey,
        sender = displaySender,
        citizenid = Player.PlayerData.citizenid,
        message = message,
        timestamp = os.time() * 1000,
        senderId = src
    })
    

    local limit = Config.ChatHistoryLimit or 100
    if #frequencyHistory[freqKey] > limit then
        table.remove(frequencyHistory[freqKey], 1)
    end

    if exports and exports.oxmysql then
        exports.oxmysql:insert('INSERT INTO radio_history (frequency, sender, citizenid, message, timestamp) VALUES (?, ?, ?, ?, ?)', {
            freqKey, displaySender, Player.PlayerData.citizenid, message, os.time() * 1000
        }, function(id)
            if not id then
                print('[7_RADIO] Warning: error when adding to DB')
            end
        end)
    end
end)


function GetFrequencyConfig(frequency)
    local freq = tonumber(frequency) or 0
    if not Config.RestrictedFrequencies then return nil end

    for _, restriction in ipairs(Config.RestrictedFrequencies) do
        local freqStr = NormalizeFrequency(frequency)

        if restriction.freq then
            if tostring(restriction.freq) == freqStr then
                return restriction
            end
        elseif restriction.min and restriction.max then
            local freqNum = tonumber(frequency) or 0
            if freqNum >= restriction.min and freqNum <= restriction.max then
                return restriction
            end
        end
    end
    return nil
end


function HasAccessToFrequency(source, frequency)
    local Player = QBCore.Functions.GetPlayer(source)
    if not Player or not Player.PlayerData then return false end

    local freqStr = NormalizeFrequency(frequency)

    if not Config.RestrictedFrequencies then return true end

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

            local playerJob = (Player.PlayerData.job and Player.PlayerData.job.name) or "unknown"
            local playerGrade = (Player.PlayerData.job and Player.PlayerData.job.grade and Player.PlayerData.job.grade.level) or 0

            for _, allowedJobEntry in ipairs(restriction.jobs) do
                local jobName = allowedJobEntry
                local condition = nil

                if string.find(allowedJobEntry, ":") then
                    local parts = {}
                    for s in string.gmatch(allowedJobEntry, "([^:]+)") do
                        table.insert(parts, s)
                    end
                    jobName = parts[1]
                    condition = parts[2]
                end

                if playerJob == jobName then
                    jobMatch = true
                    if condition then
                        if string.sub(condition, 1, 4) == "from" then
                            local minG = tonumber(string.sub(condition, 5))
                            if minG then
                                specificGradeMatch = (playerGrade >= minG)
                            end
                        elseif string.sub(condition, 1, 5) == "fixed" then
                            local fixG = tonumber(string.sub(condition, 6))
                            if fixG then
                                specificGradeMatch = (playerGrade == fixG)
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
                    return playerGrade == restriction.fixedGrade
                elseif restriction.minGrade then
                    return playerGrade >= restriction.minGrade
                end
                
                return true
            end
            return false
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

                frequencyHistory[frequency] = nil
            end
            
            local count = radioFrequencies[frequency] and GetTableLength(radioFrequencies[frequency]) or 0
            TriggerClientEvent('7_radio:client:updateFrequencyCount', -1, frequency, count)
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


RegisterNetEvent('7_radio:server:saveUserMacro', function(label, value, desc)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then return end
    
    local identifier = Player.PlayerData.license

    if exports and exports.oxmysql then
        exports.oxmysql:insert('INSERT INTO radio_macros (identifier, label, value, description) VALUES (?, ?, ?, ?)', {
            identifier, label, value, desc
        }, function(id)
            if id then
                TriggerClientEvent('7_radio:client:onMacroSaved', src, id)
            end
        end)
    end
end)

RegisterNetEvent('7_radio:server:deleteUserMacro', function(macroId)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then return end
    
    local identifier = Player.PlayerData.license

    if exports and exports.oxmysql then
        exports.oxmysql:execute('DELETE FROM radio_macros WHERE id = ? AND identifier = ?', {
            macroId, identifier
        })
    end
end)

RegisterNetEvent('7_radio:server:getUserMacros', function()
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then return end
    
    local identifier = Player.PlayerData.license

    if exports and exports.oxmysql then
        exports.oxmysql:execute('SELECT id, label, value, description FROM radio_macros WHERE identifier = ?', {
            identifier
        }, function(results)
            TriggerClientEvent('7_radio:client:receiveUserMacros', src, results)
        end)
    end
end)

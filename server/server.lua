local QBCore = exports['qb-core']:GetCoreObject()

local radioFrequencies = {}
local frequencyHistory = {}
local playerMembership = {}
local pendingHistoryLoads = {}
local recentMessageIds = {}
local lastMessageTick = {}

local recentMessageWindowMs = 15000
local sendRateLimitMs = 250

local function trimString(value)
    return tostring(value or ''):match('^%s*(.-)%s*$')
end

local function normalizeFrequency(value)
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

local function isFrequencyInBounds(frequency)
    local num = tonumber(frequency)
    if not num then
        return false
    end

    local minFrequency = tonumber(Config.MinFrequency) or 1.00
    local maxFrequency = tonumber(Config.MaxFrequency) or 999.99
    return num >= minFrequency and num <= maxFrequency
end

local function getTableLength(tbl)
    if type(tbl) ~= 'table' then
        return 0
    end

    local count = 0
    for _ in pairs(tbl) do
        count = count + 1
    end
    return count
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

local function getFrequencyConfig(frequency)
    if type(Config.RestrictedFrequencies) ~= 'table' then
        return nil
    end

    local freqKey = normalizeFrequency(frequency)
    if not freqKey then
        return nil
    end

    local freqNum = tonumber(freqKey) or 0

    for _, restriction in ipairs(Config.RestrictedFrequencies) do
        if restriction.freq then
            local target = normalizeFrequency(restriction.freq)
            if target and target == freqKey then
                return restriction
            end
        elseif restriction.min and restriction.max and freqNum >= restriction.min and freqNum <= restriction.max then
            return restriction
        end
    end

    return nil
end

function HasAccessToFrequency(source, frequency)
    local Player = QBCore.Functions.GetPlayer(source)
    if not Player or not Player.PlayerData then
        return false
    end

    if type(Config.RestrictedFrequencies) ~= 'table' then
        return true
    end

    local restriction = getFrequencyConfig(frequency)
    if not restriction then
        return true
    end

    local allowedJobs = restriction.jobs
    if type(allowedJobs) ~= 'table' or #allowedJobs == 0 then
        return true
    end

    local playerJob = (Player.PlayerData.job and Player.PlayerData.job.name) or 'unknown'
    local playerGrade = (Player.PlayerData.job and Player.PlayerData.job.grade and Player.PlayerData.job.grade.level) or 0

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

local function getPlayerMembershipCount(source)
    local set = playerMembership[source]
    if type(set) ~= 'table' then
        return 0
    end
    return getTableLength(set)
end

local function addMembership(source, frequency)
    if not playerMembership[source] then
        playerMembership[source] = {}
    end
    playerMembership[source][frequency] = true
end

local function removeMembership(source, frequency)
    local set = playerMembership[source]
    if not set then
        return
    end

    set[frequency] = nil
    if next(set) == nil then
        playerMembership[source] = nil
    end
end

local function clearPlayerEphemeralState(source)
    playerMembership[source] = nil
    recentMessageIds[source] = nil
    lastMessageTick[source] = nil
end

local function getPlayerRadioLabel(Player, source)
    local charInfo = Player.PlayerData and Player.PlayerData.charinfo
    if charInfo and charInfo.firstname and charInfo.lastname then
        return ('%s %s'):format(charInfo.firstname, charInfo.lastname)
    end
    return ('Player#%s'):format(source)
end

local function updateFrequencyCount(frequency)
    local count = getTableLength(radioFrequencies[frequency])
    TriggerClientEvent('7_radio:client:updateFrequencyCount', -1, frequency, count)
end

local function removePlayerFromFrequency(source, frequency)
    local players = radioFrequencies[frequency]
    if not players or not players[source] then
        return false
    end

    players[source] = nil
    removeMembership(source, frequency)

    if next(players) == nil then
        radioFrequencies[frequency] = nil
        frequencyHistory[frequency] = nil
        pendingHistoryLoads[frequency] = nil
    end

    updateFrequencyCount(frequency)
    return true
end

local function removePlayerFromAllFrequencies(source)
    local removedAny = false
    for frequency, players in pairs(radioFrequencies) do
        if players[source] then
            players[source] = nil
            removeMembership(source, frequency)
            if next(players) == nil then
                radioFrequencies[frequency] = nil
                frequencyHistory[frequency] = nil
                pendingHistoryLoads[frequency] = nil
            end
            updateFrequencyCount(frequency)
            removedAny = true
        end
    end
    clearPlayerEphemeralState(source)
    return removedAny
end

local function dispatchLoadedHistory(frequency, history, customData)
    local pending = pendingHistoryLoads[frequency]
    if not pending then
        return
    end

    pendingHistoryLoads[frequency] = nil
    frequencyHistory[frequency] = history

    local alreadySent = {}
    for _, playerId in ipairs(pending.waiters or {}) do
        if not alreadySent[playerId] then
            alreadySent[playerId] = true
            TriggerClientEvent('7_radio:client:loadHistory', playerId, frequency, history, customData)
        end
    end
end

local function queueHistoryLoad(source, frequency, customData)
    if frequencyHistory[frequency] then
        TriggerClientEvent('7_radio:client:loadHistory', source, frequency, frequencyHistory[frequency], customData)
        return
    end

    local pending = pendingHistoryLoads[frequency]
    if pending then
        pending.waiters[#pending.waiters + 1] = source
        return
    end

    pendingHistoryLoads[frequency] = {
        waiters = { source }
    }

    if exports and exports.oxmysql then
        local limit = Config.ChatHistoryLimit or 100
        exports.oxmysql:execute('SELECT sender, message, timestamp, citizenid FROM radio_history WHERE frequency = ? ORDER BY id DESC LIMIT ?', {
            frequency,
            limit
        }, function(results)
            local history = {}
            if results and #results > 0 then
                for i = #results, 1, -1 do
                    local row = results[i]
                    history[#history + 1] = {
                        frequency = frequency,
                        sender = row.sender,
                        message = row.message,
                        timestamp = row.timestamp,
                        citizenid = row.citizenid
                    }
                end
            end
            dispatchLoadedHistory(frequency, history, customData)
        end)
        return
    end

    dispatchLoadedHistory(frequency, {}, customData)
end

RegisterNetEvent('7_radio:server:joinFrequency', function(frequency)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then
        return
    end

    local freqKey = normalizeFrequency(frequency)
    if not freqKey then
        TriggerClientEvent('QBCore:Notify', src, 'Invalid frequency', 'error')
        return
    end

    if not isFrequencyInBounds(freqKey) then
        TriggerClientEvent('QBCore:Notify', src, 'Frequency out of range', 'error')
        return
    end

    if not HasAccessToFrequency(src, freqKey) then
        TriggerClientEvent('QBCore:Notify', src, 'You do not have access to this frequency', 'error')
        return
    end

    local players = radioFrequencies[freqKey]
    local alreadyJoined = players and players[src] ~= nil
    if not alreadyJoined and getPlayerMembershipCount(src) >= 2 then
        TriggerClientEvent('QBCore:Notify', src, 'You can only be connected to two frequencies', 'error')
        return
    end

    if not radioFrequencies[freqKey] then
        radioFrequencies[freqKey] = {}
    end

    radioFrequencies[freqKey][src] = {
        name = getPlayerRadioLabel(Player, src),
        job = (Player.PlayerData and Player.PlayerData.job and Player.PlayerData.job.name) or 'unknown',
        citizenid = (Player.PlayerData and Player.PlayerData.citizenid) or nil
    }
    addMembership(src, freqKey)

    updateFrequencyCount(freqKey)

    local freqConfig = getFrequencyConfig(freqKey)
    local customData = {
        label = freqConfig and freqConfig.label or nil,
        color = freqConfig and freqConfig.color or nil,
        macros = freqConfig and freqConfig.macros or nil
    }

    queueHistoryLoad(src, freqKey, customData)
end)


RegisterNetEvent('7_radio:server:leaveFrequency', function(frequency)
    local freqKey = normalizeFrequency(frequency)
    if not freqKey then
        return
    end

    removePlayerFromFrequency(source, freqKey)
end)

RegisterNetEvent('7_radio:server:resetPlayerFrequencies', function()
    removePlayerFromAllFrequencies(source)
end)


RegisterNetEvent('7_radio:server:restoreFrequencies', function(primary, secondary)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then
        return
    end

    removePlayerFromAllFrequencies(src)

    if primary then
        local freqKey = normalizeFrequency(primary)
        if freqKey and isFrequencyInBounds(freqKey) and HasAccessToFrequency(src, freqKey) then
            if not radioFrequencies[freqKey] then
                radioFrequencies[freqKey] = {}
            end
            radioFrequencies[freqKey][src] = {
                name = getPlayerRadioLabel(Player, src),
                job = (Player.PlayerData and Player.PlayerData.job and Player.PlayerData.job.name) or 'unknown',
                citizenid = (Player.PlayerData and Player.PlayerData.citizenid) or nil
            }
            addMembership(src, freqKey)
            updateFrequencyCount(freqKey)

            local freqConfig = getFrequencyConfig(freqKey)
            local customData = {
                label = freqConfig and freqConfig.label or nil,
                color = freqConfig and freqConfig.color or nil,
                macros = freqConfig and freqConfig.macros or nil
            }
            queueHistoryLoad(src, freqKey, customData)
        end
    end

    if secondary and secondary ~= primary then
        local freqKey = normalizeFrequency(secondary)
        if freqKey and isFrequencyInBounds(freqKey) and HasAccessToFrequency(src, freqKey) and getPlayerMembershipCount(src) < 2 then
            if not radioFrequencies[freqKey] then
                radioFrequencies[freqKey] = {}
            end
            radioFrequencies[freqKey][src] = {
                name = getPlayerRadioLabel(Player, src),
                job = (Player.PlayerData and Player.PlayerData.job and Player.PlayerData.job.name) or 'unknown',
                citizenid = (Player.PlayerData and Player.PlayerData.citizenid) or nil
            }
            addMembership(src, freqKey)
            updateFrequencyCount(freqKey)

            local freqConfig = getFrequencyConfig(freqKey)
            local customData = {
                label = freqConfig and freqConfig.label or nil,
                color = freqConfig and freqConfig.color or nil,
                macros = freqConfig and freqConfig.macros or nil
            }
            queueHistoryLoad(src, freqKey, customData)
        end
    end
end)

RegisterNetEvent('7_radio:server:sendMessage', function(frequency, message, clientMessageId)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then
        return
    end

    local now = GetGameTimer()
    local lastTick = lastMessageTick[src] or 0
    if now - lastTick < sendRateLimitMs then
        return
    end
    lastMessageTick[src] = now

    local freqKey = normalizeFrequency(frequency)
    if not freqKey then
        TriggerClientEvent('QBCore:Notify', src, 'Invalid frequency', 'error')
        return
    end

    if not isFrequencyInBounds(freqKey) then
        TriggerClientEvent('QBCore:Notify', src, 'Frequency out of range', 'error')
        return
    end

    local trimmedMessage = trimString(message)
    if trimmedMessage == '' then
        return
    end

    local maxLength = tonumber(Config.MaxMessageLength) or 500
    if #trimmedMessage > maxLength then
        TriggerClientEvent('QBCore:Notify', src, 'Message too long', 'error')
        return
    end

    local messageId = trimString(clientMessageId)
    if messageId ~= '' then
        local bucket = recentMessageIds[src]
        if not bucket then
            bucket = {}
            recentMessageIds[src] = bucket
        end

        for existingId, expiry in pairs(bucket) do
            if expiry <= now then
                bucket[existingId] = nil
            end
        end

        local expiry = bucket[messageId]
        if expiry and expiry > now then
            return
        end

        bucket[messageId] = now + recentMessageWindowMs
    else
        messageId = nil
    end

    local players = radioFrequencies[freqKey]
    if not players or not players[src] then
        TriggerClientEvent('QBCore:Notify', src, 'You are not on this frequency', 'error')
        return
    end

    if not HasAccessToFrequency(src, freqKey) then
        removePlayerFromFrequency(src, freqKey)
        TriggerClientEvent('QBCore:Notify', src, 'You no longer have access to this frequency', 'error')
        return
    end

    local senderName = players[src].name
    local displaySender = senderName

    local freqConfig = getFrequencyConfig(freqKey)
    if freqConfig then
        local prefix = ''
        if freqConfig.showJob and Player.PlayerData.job then
            prefix = Player.PlayerData.job.label or Player.PlayerData.job.name or ''
        end

        if freqConfig.showJobRank and Player.PlayerData.job and Player.PlayerData.job.grade then
            if prefix ~= '' then
                prefix = prefix .. ' - '
            end
            prefix = prefix .. (Player.PlayerData.job.grade.name or Player.PlayerData.job.grade.label or '')
        end

        if prefix ~= '' then
            displaySender = ('[%s] %s'):format(prefix, senderName)
        end
    end

    local toRemove = {}
    local timestamp = os.time() * 1000

    for playerId in pairs(players) do
        local ping = GetPlayerPing(playerId)
        if ping and ping > 0 then
            if HasAccessToFrequency(playerId, freqKey) then
                TriggerClientEvent('7_radio:client:receiveMessage', playerId, freqKey, displaySender, trimmedMessage, src, messageId, timestamp)
            else
                toRemove[#toRemove + 1] = playerId
                TriggerClientEvent('QBCore:Notify', playerId, 'You no longer have access to this frequency', 'error')
            end
        else
            toRemove[#toRemove + 1] = playerId
        end
    end

    for _, playerId in ipairs(toRemove) do
        players[playerId] = nil
        removeMembership(playerId, freqKey)
    end

    if #toRemove > 0 then
        if next(players) == nil then
            radioFrequencies[freqKey] = nil
            frequencyHistory[freqKey] = nil
            pendingHistoryLoads[freqKey] = nil
        end
        updateFrequencyCount(freqKey)
    end

    if not frequencyHistory[freqKey] then
        frequencyHistory[freqKey] = {}
    end

    local history = frequencyHistory[freqKey]
    history[#history + 1] = {
        frequency = freqKey,
        sender = displaySender,
        citizenid = Player.PlayerData.citizenid,
        message = trimmedMessage,
        timestamp = timestamp,
        senderId = src,
        clientMessageId = messageId
    }

    local limit = Config.ChatHistoryLimit or 100
    if #history > limit then
        table.remove(history, 1)
    end

    if exports and exports.oxmysql then
        exports.oxmysql:insert('INSERT INTO radio_history (frequency, sender, citizenid, message, timestamp) VALUES (?, ?, ?, ?, ?)', {
            freqKey,
            displaySender,
            Player.PlayerData.citizenid,
            trimmedMessage,
            timestamp
        }, function() end)
    end
end)

AddEventHandler('playerDropped', function()
    removePlayerFromAllFrequencies(source)
    clearPlayerEphemeralState(source)
end)

QBCore.Commands.Add('radiolist', 'View list of active frequencies (admin)', {}, false, function(source)
    local Player = QBCore.Functions.GetPlayer(source)

    local hasAce = false
    if IsPlayerAceAllowed then
        local ok, res = pcall(function()
            return IsPlayerAceAllowed(source, 'admin')
        end)
        if ok and res then
            hasAce = true
        end
    end

    local hasJobAdmin = Player and Player.PlayerData and Player.PlayerData.job and Player.PlayerData.job.name == 'admin'

    if not hasAce and not hasJobAdmin then
        TriggerClientEvent('QBCore:Notify', source, 'You do not have permission', 'error')
        return
    end

    local total = 0
    for frequency, players in pairs(radioFrequencies) do
        total = total + 1
        TriggerClientEvent('chat:addMessage', source, {
            color = {0, 255, 0},
            multiline = true,
            args = {
                '[RADIO]',
                ('Frequency %s : %s connected'):format(frequency, getTableLength(players))
            }
        })
    end

    if total == 0 then
        TriggerClientEvent('QBCore:Notify', source, 'No active frequency', 'primary')
    end
end, 'admin')

RegisterNetEvent('7_radio:server:saveUserMacro', function(label, value, description)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then
        return
    end

    if not exports or not exports.oxmysql then
        return
    end

    local macroLabel = tostring(label or ''):match('^%s*(.-)%s*$')
    local macroValue = tostring(value or ''):match('^%s*(.-)%s*$')
    local macroDescription = tostring(description or ''):match('^%s*(.-)%s*$')

    if macroLabel == '' or macroValue == '' then
        return
    end

    local identifier = Player.PlayerData.license

    exports.oxmysql:insert('INSERT INTO radio_macros (identifier, label, value, description) VALUES (?, ?, ?, ?)', {
        identifier,
        macroLabel,
        macroValue,
        macroDescription ~= '' and macroDescription or nil
    }, function(id)
        if id then
            TriggerClientEvent('7_radio:client:onMacroSaved', src, id)
        end
    end)
end)

RegisterNetEvent('7_radio:server:deleteUserMacro', function(macroId)
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then
        return
    end

    local id = tonumber(macroId)
    if not id then
        TriggerClientEvent('7_radio:client:onMacroDeleted', src, false, macroId)
        return
    end

    if not exports or not exports.oxmysql then
        TriggerClientEvent('7_radio:client:onMacroDeleted', src, false, id)
        return
    end

    local identifier = Player.PlayerData.license

    exports.oxmysql:execute('DELETE FROM radio_macros WHERE id = ? AND identifier = ?', {
        id,
        identifier
    }, function(affectedRows)
        local affected = tonumber(affectedRows) or tonumber(affectedRows and affectedRows.affectedRows) or 0
        local success = affected > 0
        TriggerClientEvent('7_radio:client:onMacroDeleted', src, success, id)
    end)
end)

RegisterNetEvent('7_radio:server:getUserMacros', function()
    local src = source
    local Player = QBCore.Functions.GetPlayer(src)
    if not Player then
        return
    end

    if not exports or not exports.oxmysql then
        TriggerClientEvent('7_radio:client:receiveUserMacros', src, {})
        return
    end

    local identifier = Player.PlayerData.license

    exports.oxmysql:execute('SELECT id, label, value, description FROM radio_macros WHERE identifier = ? ORDER BY id DESC', {
        identifier
    }, function(results)
        TriggerClientEvent('7_radio:client:receiveUserMacros', src, results or {})
    end)
end)

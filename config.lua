Config = {}

-- Keys
Config.OpenRadioKey = 'F9' -- Key to open radio interface
Config.OpenChatKey = 'F10' -- Key to open radio chat interface
Config.SwitchFrequencyKey = 'TAB' -- Key to switch frequency on radio chat

Config.RadioItem = 'radio' -- Name of the item needed to open the radio / put "none" or false to disable item needed

-- Lock frequency to job
Config.RestrictedFrequencies = {
    -- Format: [frequency] = {jobs}
    ['100.0'] = {'police'},
    ['101.0'] = {'police'},
    ['102.0'] = {'ambulance'},
    ['103.0'] = {'ambulance'},
    ['200.0'] = {'police', 'ambulance'},
}

-- Frequency ranges blocked per job
Config.FrequencyRanges = {
    {
        min = 99.0,
        max = 99.9,
        jobs = {'police'} -- Seuls les jobs dans cette liste peuvent accéder
    },
    {
        min = 88.0,
        max = 88.9,
        jobs = {'ambulance'}
    },
    {
        min = 77.0,
        max = 77.9,
        jobs = {'police', 'ambulance'}
    }
}

-- General config
Config.MaxFrequency = 999.9
Config.MinFrequency = 1.0
Config.MaxMessageLength = 250
Config.ChatHistoryLimit = 100 -- Max Message History

-- Animation
Config.UseAnimation = true
Config.AnimationDict = 'random@arrests'
Config.AnimationName = 'generic_radio_chatter'

-- Sounds
Config.Sounds = {
    enabled = true,
    volume = 0.3, -- Volume global (0.0 à 1.0)
    
    -- Individual sounds (can be changed)
    radioOpen = 'sounds/radio_on.ogg',
    radioClose = 'sounds/radio_off.ogg',
    frequencyChange = 'sounds/frequency_change.ogg',
    messageIn = 'sounds/message_in.ogg',
    messageSent = 'sounds/message_sent.ogg',
    buttonClick = 'sounds/button_click.ogg',
}
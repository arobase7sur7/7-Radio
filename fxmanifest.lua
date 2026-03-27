fx_version 'cerulean'
game 'gta5'

author '7sur7'
description 'Radio RP Text for QBCore'
version '1.1.1'

shared_scripts {
    'config.lua',
    'macros/*.lua'
}

client_scripts {
    'client/client.lua'
}

server_scripts {
    'server/server.lua'
}

ui_page 'nui/index.html'

files {
    'nui/index.html',
    'nui/style.css',
    'nui/script.js',
    'nui/sounds/*.ogg',
    'config.lua',
    'macros/*.lua'
}

lua54 'yes'

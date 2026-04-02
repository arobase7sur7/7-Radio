# 7-Radio (QBCore)

A FiveM radio + text chat resource for QBCore with dual channels, restricted frequencies, macros, history, and modern NUI.

Preview: https://www.youtube.com/watch?v=wEPQeaUvba4

## Features

- Radio UI and radio-chat UI.
- Dual channel support (CH1 + CH2).
- Frequency format with 2 decimals (example: 99.00 to 99.99).
- Restricted frequencies with job and rank rules:
  - Job only: `police`
  - Minimum rank: `police:from2`
  - Exact rank: `ambulance:fixed4`
- Per-frequency style options (`label`, `color`, `showJob`, `showJobRank`).
- Channel color automatically updates when switching to a restricted/private frequency.
- Centered settings modal with persistent per-player UI preferences.
- Macro system:
  - Global macros
  - Frequency/job macros
  - Personal macros (saved in database)
  - Production-ready default macro packs (Police full 10-code set + EMS basics)
- Placeholders in macros/chat:
  - `%location%` and `%waypoint%` -> road/area text and clickable GPS link
  - `%hour%`
  - `%name%` `%surname%`
  - `%job%` `%rank%`
  - `%input%` or `%input:"question"%` (macro-only, asks input before insert)
- Per-channel toggle to mirror incoming radio messages into chat (default chat or configured `poodlechat` channel).
- Optional `poodlechat` relay routing (`radio` / `local`) with automatic fallback to default chat.
- Global move/size mode to place radio, chat, and macro interfaces in one pass.
- Size and text controls use `+` / `-` / reset actions per selected interface.
- Theme overrides by base frequency with optional max range, plus per-override quick color edit in the list.
- In-game clear cache confirmation (no browser prompt) for this resource state only.
- Message history cache + DB persistence (optimized indexes).

## Requirements

- `qb-core`
- `oxmysql`
- Default `chat` resource (for mirrored chat output)
- Optional: `poodlechat` (if you want relay messages routed to a specific chat channel/tab)

## Installation

1. Put the resource in your server resources folder.

```cfg
resources/[scripts]/7_radio
```

2. Ensure it in `server.cfg`:

```cfg
ensure 7_radio
```

3. Database:
- run `AddToDatabase.sql`.

4. Restart the server.

## Commands

### Player

- `/radio` - Open/close radio UI
- `/radiochat` - Open/close radio chat UI

### Admin

- `/radiolist` - List active frequencies

Requires ACE/admin job as configured in server-side checks.

## Keybinds (default)

- `F9` - Open/close radio
- `F10` - Open/close radio chat
- `TAB` - Switch active chat channel

## Configuration

Main config is in `config.lua`.

You can define:
- Min/max frequency
- Message max length
- Chat relay provider and target channel (`local` / `radio`)
- Restriction blocks (single frequency or ranges)
- Macro sets
- Sounds and animation
- Required radio item

Relay example:

```lua
Config.ChatRelay = {
  provider = 'auto',           -- 'auto', 'poodlechat', or 'chat'
  poodleChatResource = 'poodlechat',
  targetChannel = 'radio',     -- 'radio' or 'local' (or any poodlechat channel id)
  fallbackToDefault = true
}
```


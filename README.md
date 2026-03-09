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
- Macro system:
  - Global macros
  - Frequency/job macros
  - Personal macros (saved in database)
  - Production-ready default macro packs (Police full 10-code set + EMS basics)
- Placeholders in macros/chat:
  - `%location%` -> road/area text and clickable GPS link
  - `%hour%`
  - `%name%` `%surname%`
  - `%job%` `%rank%`
  - `%input%` or `%input:"question"%` (macro-only, asks input before insert)
- Toggle button to mirror incoming radio messages into default chat per channel.
- Message history cache + DB persistence (optimized indexes).

## Requirements

- `qb-core`
- `oxmysql`
- Default `chat` resource (for mirrored chat output)

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
- New install: run `AddToDatabase.sql`.
- Existing install update: run `migration.sql` once.

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

## SQL Notes

This resource uses:

- `radio_history`
- `radio_macros`

Legacy `radio_logs` is no longer required by the current code path.

## Configuration

Main config is in `config.lua`.

You can define:
- Min/max frequency
- Message max length
- Restriction blocks (single frequency or ranges)
- Macro sets
- Sounds and animation
- Required radio item


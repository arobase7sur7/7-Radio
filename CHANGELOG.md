# Changelog

- Fixed script name detection issue that could prevent the resource from working.
- Added chat relay toggle button to mirror new radio messages into default in-game chat per channel.
- Added global and personal macro system.
- Added support for 2-decimal frequencies (example: 99.00 to 99.99).
- Added support for job rank rules in restricted frequencies (`from` / `fixed`).
- Added more restricted frequency options: `color`, `label`, `showJob`, `showJobRank`.
- Added placeholders in macros/chat:
  - `%location%` (clickable GPS from road/area text)
  - `%name%` `%surname%`
  - `%job%` `%rank%`
  - `%hour%`
  - `%input%` and `%input:"question"%` (macro-only)
- Updated UI icons to SVG replacements instead of emoji style.
- Updated private frequency visual feedback (color theme per channel/frequency).
- Optimized message history logging path and SQL indexes.
- Added confirmation dialog before deleting a personal macro.
- Added full LSPD 10-code and CODE 1-6 macro set with callsign input prefix.

### Database

- Updated `AddToDatabase.sql` to the current schema used by the resource.
# Radio & Chat Script - QBCore

A **FiveM** radio and chat script based on **QBCore**, featuring radio frequency support, a responsive interface, and notifications. The script also allows admins to list active frequencies.

Preview: https://www.youtube.com/watch?v=wEPQeaUvba4

## :package: Installation

1. Place the script folder in your `resources` directory:

```
resources/[scripts]/7_radio
```

2. Add it to your `server.cfg`:

```cfg
ensure 7_radio
```

3. Add the following table to your database:

```sql
CREATE TABLE IF NOT EXISTS `radio_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `citizenid` varchar(50) DEFAULT NULL,
  `frequency` varchar(10) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `timestamp` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `citizenid` (`citizenid`),
  KEY `frequency` (`frequency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

4. Restart the server or have players reconnect to apply permissions.

## :gear: Configuration

* **Configurable Keys:**  
You can set the radio key directly in `config.lua` (e.g., `Config.OpenRadioKey = 'F9'`) or through in-game settings.

* **Frequencies:**  
Supports up to one decimal (e.g., `101.2`).  
Players can change their active frequency through the interface.

* **Notifications:**  
* If the player does not have the radio open, a notification will alert them.  
* Error and info messages use `QBCore:Notify`.

## :desktop: Interfaces

### Radio

* Walkie-talkie–style design.  
* LCD screen simulating a real radio.  
* Displays frequencies and number of connected players.  
* Responsive and animated for all resolutions.

### Radio Chat

* Modern layout with audio visualizer.  
* Supports both received and own messages.  
* Input bar with character counter.  
* Send and frequency switch buttons.  
* Fully responsive interface for all screens.

## :wrench: Commands

### Player Commands

* **Open/Close Radio:** Key defined in `config.lua` or in settings, or use `/radio`.  
* **Open/Close Radio Chat:** Key defined in `config.lua` or in settings, or use `/radiochat`.

### Admin Commands

* **`/radiolist`** – View active radio frequencies.  
* Requires **ACE permission `group.admin`** or job “Admin”.

## :key: Permissions

* Example of granting admin permission to a player:

```cfg
add_principal identifier.fivem:17046388 group.admin
````

* Check permissions from the server console:

  ```cfg
  get_principal identifier.fivem:17046388
  ```

> :warning: Permission changes require the player to reconnect to take effect.

## :paintbrush: CSS & Responsiveness

* Uses a modern design for both radio and chat.
* Animated open/close transitions.
* Compatible with all screen resolutions.
* Green theme on dark background.
* Animated audio visualizer and light indicators.

## :rocket: Main Features

* Configurable radio frequencies.
* Displays player activity per frequency.
* Dynamic notifications.
* Admin commands to manage and monitor frequencies.
* Responsive, aesthetic interface.
* One-decimal frequency support.
* Configurable item

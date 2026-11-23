# 🚂 Murder Might

Someone on this train is a murderer... and it might be anyone!

## The train

The train has 7 cars:

1. 🚂 **The locomotive** (shovel coal, check the gauges, blow the whistle)
2. **Rooms 1-10**
3. **Rooms 11-20**
4. **Rooms 21-30** (room 25 is the **meeting room**)
5. **Rooms 31-40**
6. **Rooms 41-50**
7. **The caboose** (sort the mail, warm up the stove, check the brakes)

Each room car has a long corridor down one side, with doors into the rooms. Every room except the meeting room has one task in it.

## How to play

One person is secretly the **murderer**. Everyone else is **innocent**. Up to 10 people play: red, orange, yellow, green,
teal, blue, purple, pink, black and white.

### 🙂 Innocents

- You get **5 tasks**, like "Fix the lamp: room 27". They show up in your task list, as yellow dots on the train map,
  and as glowing rings on the floor. Stand by one and **hold E** for 3 seconds.
- When **all 5 tasks are done**, go to **room 25, the meeting room**, press **F** and pick who you think the murderer is.
- **Right?** The innocents win!
- **Wrong?** The person you accused is out, **plus one more random innocent**. Be careful!

### 🔪 The murderer

- **Only the murderer can hold weapons.** Press **Q** to take your weapon out, switch, or put it away, and **click** to attack.
- You start with the **🔪 dagger** (up close).
- After **2 kills** you get the **🔫 shotgun**. It shoots far, but it's LOUD: everyone hears which car the BANG came from.
- After **4 kills** you get the **📡 tracker**: the map shows where everyone is.
- Anyone who sees your weapon out knows it's you, so only take it out when nobody's looking!
- You get 5 **fake tasks** so you can pretend to be innocent.
- Kill every innocent to win.

Bodies stay where they fell. If you get killed, you become a ghost and can float through walls to watch.

## Ways to play

- **🤖 With bots**: pick how many people are on the train (4 to 10), your colour, and whether you want to be the murderer
  (Random, Me!, or Not me). The bots do tasks, find bodies, run from the murderer and accuse people (sometimes the wrong person!).
- **🌐 Online**: one person presses **Make a room** and tells friends the 4-letter code. Everyone picks a colour,
  the host picks how many people are on the train (bots fill the empty spots), and presses **GO!**

## Controls

| | Computer | Phone |
|---|---|---|
| Walk | WASD or arrows | Joystick |
| Look | Mouse (click the game first) | Drag on the right side |
| Task | Hold **E** | Hold ✋ |
| Accuse (in room 25) | **F** | ☝ |
| Weapon out / switch / away | **Q** | 🔪 |
| Attack | Click | 💥 |

## For grown-ups / developers

Plain HTML and JavaScript with three.js r128, no build step. Open `index.html` to play.

- `train.js`: the train layout, walls, rooms, tasks and the paths bots walk on (works in Node too, for testing).
- `game.js`: the 3D drawing, controls, bots, the HUD and online rooms.

Online rooms use the family Firebase Realtime Database (`kvgames`), under `murdermight/rooms/<CODE>`. Only game things are
sent: colours, positions, task ticks, kills and accusations. No names or chat. The host is the referee (it decides kills
and accusations) and runs the bots. **The database rules must include the `murdermight` key** (see `database.rules.json`
in the folder above).

When you change a `.js` file, bump its `?v=` number in `index.html`.

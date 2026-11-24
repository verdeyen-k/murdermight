# 🔪 Murder Might

Someone here is a murderer... and it might be anyone! There are two maps: the train and the mansion.

## 🚂 The train

The train has 7 cars:

1. 🚂 **The locomotive** (shovel coal, check the gauges, blow the whistle)
2. **Rooms 1-10**
3. **Rooms 11-20**
4. **Rooms 21-30** (room 25 is the **meeting room**)
5. **Rooms 31-40**
6. **Rooms 41-50**
7. **The caboose** (sort the mail, warm up the stove, check the brakes)

Each room car has a long corridor down one side, with doors into the rooms. Every room except the meeting room has one task in it.

## 🏰 The mansion

A big house with 2 floors and 3 rooms on each floor:

| Upstairs | Bedroom | Bathroom | **Study** (the meeting room) |
|---|---|---|---|
| **Downstairs** | **Kitchen** | **Dining room** | **Living room** |

A hallway runs along the front of each floor, and the **stairs** are at the end of the hallway (by the living room
downstairs, by the study upstairs). Rooms next to each other have doors between them. Each room (except the study) has 4 tasks,
and each hallway has one. Hiding places: the pantry, the china cabinet, the living room closet, the bedroom wardrobe,
the shower, and a closet at the end of each hallway. People on different floors can't see each other!

## How to play

One person is secretly the **murderer**. Everyone else is **innocent**. Up to 10 people play: red, orange, yellow, green,
teal, blue, purple, pink, black and white.

### 🙂 Innocents

- You get **5 tasks**, like "Fix the lamp: room 27". They show up in your task list, as yellow dots on the train map,
  and as glowing rings on the floor. Stand by one and **hold E** for 3 seconds.
- When **all 5 tasks are done**, go to the **meeting room** (room 25 on the train, the study in the mansion), press **F** and pick who you think the murderer is.
- **Right?** The innocents win!
- **Wrong?** The person you accused is out, **and so are you**. Be careful!

### 🔪 The murderer

- **Only the murderer can hold weapons.** **Click** to attack: your weapon comes out, and goes away again a second later. Press **Q** to switch weapons or hold one out.
- You start with the **🔪 dagger** (up close).
- After **2 kills** you get the **🔫 shotgun**. It shoots far, but it's LOUD: everyone hears which car the BANG came from.
- After **4 kills** you get the **📡 tracker**: the map shows where everyone is.
- Anyone who sees your weapon out knows it's you, so only take it out when nobody's looking!
- You get 5 **fake tasks** so you can pretend to be innocent.
- Kill every innocent to win.

### 🙈 Hiding

On the train, wardrobes (in every odd-numbered room) and lockers (in the locomotive and the caboose) are hiding places. The mansion has its own (see above). Walk up to one and
**click** it (or press **H**) to hide inside, and click again to come out. (The murderer uses **H**, because clicking stabs.) While you're hiding, **nobody can see you** and you **don't show up
on the murderer's tracker**. But if the murderer walks right up to your hiding place and stabs it with the dagger, you're done!
(The shotgun can't hit hiding places.) Only one person fits in each hiding place. Bots hide too when they're running from the murderer.

Bodies stay where they fell. If you get killed, you become a ghost and can float through walls to watch.

## Ways to play

- **🤖 With bots**: pick the map, how many people play (4 to 10), your colour, and whether you want to be the murderer
  (Random, Me!, or Not me). The bots do tasks, find bodies, run from the murderer and accuse people (sometimes the wrong person!).
- **🌐 Online**: one person presses **Make a room** and tells friends the 4-letter code. Everyone picks a colour,
  the host picks the map and how many people play (bots fill the empty spots), and presses **GO!**

## Controls

| | Computer | Phone |
|---|---|---|
| Walk | WASD or arrows | Joystick |
| Look | Mouse (click the game first) | Drag on the right side |
| Task | Hold **E** | Hold ✋ |
| Accuse (in the meeting room) | **F** | ☝ |
| Attack (takes your weapon out) | Click | 💥 |
| Switch weapon / hold it out | **Q** | 🔪 |
| Hide / come out | Click a wardrobe or locker (or **H**) | 🚪 |

## For grown-ups / developers

Plain HTML and JavaScript with three.js r128, no build step. Open `index.html` to play.

- `maps.js`: the two maps: walls, rooms, tasks, hiding places, stairs and the paths bots walk on (works in Node too, for testing).
  Every wall, task and person has a floor number; people only bump into and see things on their own floor.
- `game.js`: the 3D drawing (one group per map), controls, bots, the HUD and online rooms.

Online rooms use the family Firebase Realtime Database (`kvgames`), under `murdermight/rooms/<CODE>`. Only game things are
sent: colours, positions, task ticks, kills and accusations. No names or chat. The host is the referee (it decides kills
and accusations) and runs the bots. **The database rules must include the `murdermight` key** (see `database.rules.json`
in the folder above).

When you change a `.js` file, bump its `?v=` number in `index.html`.

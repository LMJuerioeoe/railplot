# Claude and Railplot

There are two ways to work with Claude on a plan:

- **The chat inside Railplot.** Press **Claude** on the toolbar and ask. This is the quickest way.
- **The Railplot connector,** for the Claude desktop app or Claude Code. Use it to work on plans from a Claude conversation.

Either way, Claude reads your plan and suggests changes as proposals that you accept or reject.

## The chat inside Railplot

Press **Claude** on the toolbar (or Help > Chat with Claude). A panel opens beside the plan.

- **Ask anything about the plan:** "check my plan for problems", "what do I need to buy?", "will a 0-6-0 get round the corners?". Claude reads the plan before it answers.
- **Ask for changes:** "add a three-road fiddle yard after Module 3", "put a crossover between the loops on Module 2". Each change arrives as a card in the chat, and under Claude's proposals in the Details panel. **Show**, **Accept** and **Reject** work the same in both places.
- **Selection:** select something on the plan before you ask, and Claude knows what "this point" or "these boards" means.
- **The controls:** if you've turned on **Let Claude use the controls**, Claude can also set routes, points and lights and run trains. It can never switch track power on or off.

**How it reaches Claude:**

- **Desktop app, offline file, or the page the hub serves:** the chat uses your own Anthropic API key. The first time you open the chat:
  1. Get a key at console.anthropic.com (Settings > API keys).
  2. Paste it in and press **Check**, then pick a model and **Save**. The newest Sonnet is chosen for you, and it's a good choice.

  The key goes only to Anthropic, straight from Railplot, and messages are billed to that Anthropic account. Untick **Remember the key on this computer** if you'd rather paste it each time.
- **Railplot on claude.ai:** the chat uses your Claude account, and no key is needed. The first message asks you to allow it.

Press **Stop** to stop Claude mid-answer, and the page icon to start a new chat.

## The connector

The Railplot connector lets Claude work on your plans with you. Claude can read a plan, check it, and suggest changes such as baseboard modules, yards, track and example layouts. Each suggestion arrives in Railplot as a **proposal**. You look at it on the plan and accept or reject it. Claude never changes your plan by itself.

If you allow it, Claude can also use the layout's controls through the [hub](control/hub.md). That covers routes, points, signals, lights, trains and automations.

The connector is a small program that runs on your computer. It reads only the folders you give it and the hub on your network, and it never connects to the internet.

## What you can ask

- "Open my shed layout and tell me what's wrong with it."
- "Add two 1200 × 600 modules after Module 3 with two tracks, and put an Inglenook on the second one."
- "Close the gap between the loop and the fiddle yard with flexible track."
- "The point by the platform has its motor over a cross member. Suggest a fix."
- "Make me a parts list I can take to the model shop."
- With the controls allowed: "Set the route into the loop and run the goods shuttle."

### Install

#### Claude desktop app (Windows or Mac)

1. Download the bundle for your computer from the Releases page:
   - `railplot-claude-windows.mcpb` for Windows
   - `railplot-claude-mac-apple-silicon.mcpb` or `railplot-claude-mac-intel.mcpb` for a Mac
2. Double-click it. The Claude app asks you to confirm and then shows two settings:
   - **Folders with your layouts.** Claude may read the `.railplot` files in these folders and add proposals to them. It can't touch anything else.
   - **Railplot hub address.** Leave it as `localhost:8080` if the hub runs on the same computer.
3. In a new chat, the Railplot tools appear in the tools menu.

#### By hand

The connector is part of the hub program: `railplot-hub mcp`. Add it to Claude's settings file, `claude_desktop_config.json` (Claude: Settings > Developer > Edit config), using the path to your copy of the hub:

```json
{
  "mcpServers": {
    "railplot": {
      "command": "C:\\Railplot\\railplot-hub-windows-x64.exe",
      "args": ["mcp", "--hub", "localhost:8080", "--folder", "C:\\Users\\you\\Documents\\Railplot"]
    }
  }
}
```

For Claude Code:

```sh
claude mcp add railplot -- /path/to/railplot-hub mcp --folder ~/Documents/Railplot
```

From the source, run `bun run mcp` (or `bun src/mcp/main.ts`) in its place.

| Option | What it does |
| --- | --- |
| `--hub HOST[:PORT]` | The hub to use when it's running (default `localhost:8080`). Use `none` to work only with files. |
| `--folder DIR ...` | The folders whose `.railplot` files Claude may read and add proposals to. You can give several. The default is your home folder. |
| `--file FILE` | A plan to open at the start. |

## Live, or by file

**With the hub.** If the hub is running and Railplot is connected to it (Control > Set up > Railplot hub), Claude works on the live layout. Its proposals appear in every Railplot connected to the hub straight away. If you have Railplot open on a laptop, this is the easiest way.

**With a file.** Without the hub, Claude opens a `.railplot` file in your folders and writes its proposals into that file. If that file is open in the Railplot desktop app, the proposals appear within a few seconds. In a browser, open the file again to see them. Save your work first, so that Claude reads your latest plan.

Claude can also start a new, empty plan file for a layout from scratch. Open it in Railplot to watch the proposals arrive.

## Proposals

Proposals appear in the Details panel under **Claude's proposals**. Each card shows the title, what it adds, changes or removes, and Claude's reason.

- **Show** draws the proposal on the plan and zooms to it. New and changed track and boards appear in blue. Anything it would remove is struck through in red.
- **Accept** applies it as an ordinary edit. Undo takes it back, and the proposal comes back with it.
- **Reject** throws it away. Undo brings it back too.

If you change the plan where a proposal would go before you accept it, its card says so. Accepting then asks before putting Claude's versions in place of yours.

Each proposal starts from the plan as it is now. When Claude wants several steps that build on each other, such as modules, then track positions, then a yard on them, it sends them as one proposal.

## The controls

The controls are off until you turn on **Let Claude use the controls** in Railplot, under Control > Set up > Railplot hub. The setting is saved with the layout, and you can turn it off at any time.

When the setting is on, Claude can do these things through the hub:

- see where every train is, and how the points, signals and lights are set
- set routes, points, signals and lights
- drive and stop trains (the blocks and signals still protect them)
- start and stop automations

Claude can never switch track power on or off, or use the emergency stop. You can stop everything at any time with **Stop all trains**, or from any throttle.

## The tools

| Tool | What it does |
| --- | --- |
| `get_status`, `open_layout`, `list_layout_files`, `create_layout_file` | Which plan is open; open a file or the hub; find plans; start a new one |
| `get_layout`, `list_boards`, `get_track`, `check_layout`, `get_parts_list` | Read the plan: summary, baseboards with their track positions, track pieces and their joins, problems, parts |
| `list_track_systems`, `list_parts`, `list_baseboard_modules`, `list_examples` | The catalogues |
| `propose_add_modules`, `propose_module_tracks`, `propose_add_yard`, `propose_add_track`, `propose_add_flex`, `propose_join_ends`, `propose_lay_guides`, `propose_move`, `propose_remove`, `propose_add_example`, `propose_edit` | One change, as a proposal (or `preview` it without sending) |
| `propose_plan` | Several of those steps as one proposal |
| `list_proposals`, `withdraw_proposal` | Proposals waiting for you |
| `get_control_status`, `set_route`, `set_point`, `set_signal`, `set_light`, `drive_train`, `stop_train`, `run_automation` | The controls, through the hub, when allowed |

## Good to know

- **Your files stay yours.** The connector reads `.railplot` files only in the folders you chose. The only change it makes to a file is adding or withdrawing its own proposals. It never deletes a file or overwrites one.
- **Your network only.** The connector talks to Claude on your computer and to the hub on your network. Like the hub, the controls are for your own Wi-Fi.
- **Not tried in every setup yet.** The connector is tested end to end with the hub and with files, but the `.mcpb` bundles haven't been tried in every version of the Claude app. If one doesn't install, use the by-hand setup and [report it](control/testing.md).

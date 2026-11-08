# ChatGPT and Railplot

Railplot exposes a standard Model Context Protocol (MCP) server. The same server can be used by ChatGPT desktop through a local STDIO process, or by ChatGPT on the web through an OpenAI Secure MCP Tunnel. The connector reuses Railplot's existing MCP tools; there is no separate ChatGPT-specific implementation to keep in sync.

## What ChatGPT can do

The connector can read a layout, inspect baseboards and track, check the plan, calculate parts lists, and prepare proposed changes. Changes to track and baseboards are sent to Railplot as **proposals**. You review each proposal in Railplot and accept or reject it; the connector does not silently apply track-plan edits.

The hub control tools are also available when connected to a live hub and when the layout owner has explicitly enabled the relevant control permission in Railplot. Railplot's hub continues to enforce its safety restrictions: the MCP connector cannot switch track power or invoke the emergency stop.

## ChatGPT desktop: local connection

The ChatGPT desktop app's MCP settings support local STDIO servers. This is the simplest way to use Railplot with a layout stored on the same computer.

1. Download the Railplot hub executable for your operating system from the [Releases](../releases) page, or build it from source (see below).
2. Open ChatGPT desktop **Settings → MCP servers → Add server**.
3. Add a server named `railplot`, choose **STDIO**, and configure:
   - **Command:** the full path to `railplot-hub.exe` on Windows (or `railplot-hub` on Linux/macOS).
   - **Arguments:** `mcp --hub localhost:8080 --folder "C:\\Users\\you\\Documents\\Railplot"`
4. Replace the example folder with the folder or folders containing your `.railplot` files. If the Railplot hub is not running, use `--hub none`.
5. Save the server and restart the MCP connection if ChatGPT prompts you to.

Example Windows command and arguments:

```text
Command:
C:\\Railplot\\railplot-hub.exe

Arguments:
mcp
--hub
localhost:8080
--folder
C:\\Users\\you\\Documents\\Railplot
```

You can add more than one `--folder` argument. The connector only lists and opens layout files inside the folders you allow.

### Running from source

Install [Bun](https://bun.sh), then from the Railplot repository:

```powershell
bun install
bun run mcp -- --hub localhost:8080 --folder "$HOME\\Documents\\Railplot"
```

The `mcp` script runs the same STDIO server used by the packaged hub executable. Do not add shell output or logging to STDOUT in an MCP launch command; STDOUT is reserved for the protocol.

## ChatGPT web: Secure MCP Tunnel

ChatGPT web does not launch a local process on your computer. To use a local Railplot instance without exposing it as a public internet service, connect it through OpenAI's **Secure MCP Tunnel**. The tunnel can launch an STDIO MCP server on your computer, so the existing Railplot MCP command can be reused without opening an inbound port.

This route requires access to OpenAI Platform tunnel settings and the relevant ChatGPT workspace's custom MCP app feature. Availability and write permissions depend on the ChatGPT plan and workspace policy. OpenAI currently documents full read/write MCP support for Business, Enterprise and Edu; Pro connections are limited to read/fetch permissions. Railplot's proposal tools create proposals, so they require a connection that permits those actions. A Free account may not have access to custom MCP apps.

1. In OpenAI Platform, create a Secure MCP Tunnel and obtain its tunnel ID and runtime key. Keep the key private.
2. On the computer running Railplot, download the latest `tunnel-client` release from [OpenAI's tunnel-client repository](https://github.com/openai/tunnel-client). Keep the runtime API key private; do not paste it into ChatGPT or commit it to a file.
3. Initialise a named STDIO profile (replace the tunnel ID and paths with your own):

```powershell
$env:CONTROL_PLANE_API_KEY = "YOUR_RUNTIME_KEY"
tunnel-client init --sample sample_mcp_stdio_local --profile railplot --tunnel-id YOUR_TUNNEL_ID --mcp-command '"C:\\Railplot\\railplot-hub.exe" mcp --hub localhost:8080 --folder "C:\\Users\\you\\Documents\\Railplot"'
tunnel-client doctor --profile railplot --explain
tunnel-client run --profile railplot
```

If the layout is opened from a file rather than the live hub, use `--hub none` in the MCP command. Keep `tunnel-client run` running while discovering and calling tools in ChatGPT. For the exact supported flags and secure key handling, follow the [official Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
4. In ChatGPT web, open **Plugins → Add custom MCP server**, choose **Tunnel**, select the tunnel you created, configure the required authentication, review the permission warning, and create the app.
5. Test with a read-only request such as asking Railplot for the current layout summary before trying a proposal tool.


Use the official [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) and [ChatGPT custom MCP server instructions](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) for the current Platform and ChatGPT screens. Tunnel permissions in Platform and permission to add custom apps in ChatGPT are separate.

**Do not expose the Railplot hub or MCP process directly to the public internet without a suitable authentication and access-control layer.** A Secure MCP Tunnel is preferred for a personal layout because the server remains private and the tunnel makes an outbound connection.

## Scenery planning export

For a printable or hand-marked scenery reference, open the layout in Railplot and choose:

**File → Export scenery planning sheet (PNG)…**

The export is a clean top-down image with the baseboard and track plan, no selection highlights or editor overlays, and a light scale grid. It is intended as a sketching underlay for buildings, roads, platforms, water, hills and other scenery. The existing PNG and true-scale SVG exports remain available separately.

## Building the connector

The MCP server is part of the Railplot hub executable:

```sh
bun install
bun run mcp -- --help
bun scripts/build-hub.ts
```

For all supported desktop platforms, use `bun scripts/build-hub.ts --all`. The resulting executable is in `dist/hub/`.

## Troubleshooting

- **No plan is open:** start the Railplot hub and connect it with `--hub localhost:8080`, or use `open_layout` to open a file.
- **No files are found:** check the `--folder` paths. Only files within the configured folders are visible to the connector.
- **The hub is not reachable:** check that Railplot's hub is running on the same computer and listening on the address supplied after `--hub`.
- **ChatGPT desktop does not list the tools:** verify the executable path and arguments, then restart the MCP server from ChatGPT's MCP settings. Make sure the server writes protocol messages only to STDOUT.
- **ChatGPT web cannot discover the tunnel:** check that the tunnel client is running, its profile is healthy, and the tunnel is associated with the intended ChatGPT workspace. Platform tunnel access does not automatically grant ChatGPT workspace permission.
- **Proposal tools are unavailable:** check the plan/workspace's MCP permission level. Read-only MCP access cannot submit Railplot proposals.

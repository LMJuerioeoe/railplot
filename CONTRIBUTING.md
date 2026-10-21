# Contributing to Railplot

Thanks for helping. The most useful contributions right now are track libraries, bug reports with a `.railplot` file attached, and fixes to the geometry of existing parts.

## Before you start

- Open an issue first for anything bigger than a small fix, so we can agree on the approach.
- Railplot has no runtime dependencies. Please keep it that way unless there is a strong reason.
- Write everything yourself. Don't copy code, artwork, track libraries or text from other track planners. Use the manufacturers' published dimensions for track geometry, and name your source.

## Workflow

```sh
bun install
bun run build && bun test tests && bun run validate-libraries
python tests/e2e/test_flows.py   # needs Playwright for Python
```

Keep `src/model.ts` free of DOM code so it stays easy to test. New editing operations go there, with a unit test.

## Track libraries

See [docs/library-format.md](docs/library-format.md). In the pull request, say which parts you checked against a real piece of track or a planning sheet.

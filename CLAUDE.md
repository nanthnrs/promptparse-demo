# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, browser-only playground for the [`promptparse`](https://github.com/maythiwat/promptparse) npm library (PromptPay / EMVCo QR payloads). Vite + vanilla TypeScript, no framework, no backend. Deployed to Cloudflare Workers as static assets on the user's own Cloudflare account. The wrangler login for that account is kept in a separate config dir, so every wrangler command needs `XDG_CONFIG_HOME=~/.config/wrangler-personal` (the default wrangler login is a different account that is not the user's).

## Commands

- `npm run dev`: Vite dev server
- `npm run build`: `tsc --noEmit` type-check, then `vite build` to `dist/`
- `bun test`: run the tests in `test/` (bun's built-in runner, `bun:test`)
- `bun test -t "withAmount"`: run a single test by name
- `XDG_CONFIG_HOME=~/.config/wrangler-personal npm run deploy`: build, then `wrangler deploy` to the user's account

There is no linter or formatter configured.

## Architecture

- `src/logic.ts` holds the pure, DOM-free logic and is the only part under test:
  - `detect()`: works out which template a payload is
  - `crcInfo()`: CRC check (Tag 63 or 91)
  - `withAmount()`: rewrites the amount and recomputes the CRC
  - `decodeTag81()`: decodes the TrueMoney message
  
  Keep new non-UI logic here so it stays testable.
- `src/main.ts` holds all the UI, built from HTML strings with `innerHTML`, with no components and no state library. It has two tabs:
  - **Generate**: a `templates` array. Each entry defines its form `fields`, a `run()` that calls `promptparse/generate`, and a `code()` that renders the sample snippet. To add a template, add an entry here.
  - **Inspect**: `inspect()` re-renders the whole result panel on each input. BOT barcodes (payloads starting with `|`) take a separate path through `parseBarcode()`.
- Cross-highlighting between payload segments and table rows uses `data-tag` attributes and one global `mouseover` listener. The `h0`–`h5` classes cycle the per-tag colour tokens defined in `src/style.css`.
- The library's version is injected at build time as `__LIB_VERSION__` (see `vite.config.ts`), because `promptparse` does not export its `package.json`.

## Gotchas

- `promptparse` validators are lenient (`trueMoneySlipVerify` and `bcelOneProof` use `&&` where `||` is meant, so they accept almost anything). `detect()` therefore picks a candidate from the tags that are present (91/51, 33, 30, 29) before it calls a validator. Don't swap this for "try every validator".
- TrueMoney QRs are AnyID e-wallet QRs (sub-tag `29.03` starting with `14000`). `detect()` relabels them as `trueMoney`.
- `withAmount()` must produce byte-identical output to the library's generators. The library puts Tag 54 *after* Tag 58, not in numeric order, and the tests rely on this.
- Payloads in the textarea and in `data-load` attributes show `\r` as a literal `\\r` (see `visible()`). `inspect()` turns it back into a real `\r`.

## Conventions

- Theme: colour tokens live on `:root`. Dark values are defined twice, under `prefers-color-scheme: dark` (guarded by `:not([data-theme='light'])`) and under `[data-theme='dark']`. Change both together. The inline script in `index.html` applies the saved theme before first paint, and `setupTheme()` in `main.ts` cycles through system, light and dark.
- UI copy is Thai, with technical terms (payload, CRC, tag, biller ID) and the EMVCo tag names kept in English.

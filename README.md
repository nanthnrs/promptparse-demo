# promptparse playground (unofficial)

A browser-only playground for the [`promptparse`](https://github.com/maythiwat/promptparse) library by Maythiwat Chomchuen. It works with PromptPay, TrueMoney and EMVCo QR payloads. The UI is in Thai.

- **Generate**: payment QRs (PromptPay AnyID, Bill Payment, TrueMoney) and BOT barcodes. Slip Verify QRs are also available, for testing slip-verification flows.
- **Inspect & edit**: paste a payload or scan a QR image to see every tag. It checks the CRC, recognises the template, and lets you change the amount, which recomputes the CRC.

Everything runs in the browser. Payloads are never sent anywhere. Fonts are loaded from Google Fonts.

## Development

```sh
bun install
npm run dev      # dev server
bun test         # tests
npm run build    # type-check + build to dist/
```

The site is deployed as static assets on Cloudflare Workers (`wrangler.jsonc`).

## Disclaimer

- This is an **unofficial** project. It is not affiliated with or endorsed by the author of promptparse, PromptPay, TrueMoney, the Bank of Thailand or BCEL. All names and trademarks belong to their respective owners.
- It is for **testing and development only**. It comes with no warranty of correctness. Check any QR before using it to receive real payments.
- Slip Verify QRs only hold a bank code and a transaction reference. They are for testing your own verification integration, not for creating payment slips.

## Third-party software

Bundled libraries (promptparse, qrcode, dijkstrajs, jsQR) and their licenses are listed in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt).

# Lockify Backend

A small Node.js backend providing payment order creation and verification for the Lockify app. This project exposes a lightweight Express server and also includes Netlify serverless functions under `netlify/functions/` for related flows.

**Status:** Minimal production-ready payment helper (Cashfree integration) — use with correct credentials and validate in a sandbox before going live.

--

## Repository structure

- `server.js` — primary Express server exposing endpoints used by the app.
- `netlify/functions/` — Netlify serverless functions (createOrder.js, success.js, verifyPayment.js).
- `package.json` — project metadata and `dev` script.
- `netlify.toml` — Netlify configuration.

## Features

- Create payment orders (Cashfree API).
- Verify payment status for orders.
- Small set of endpoints intended for mobile/web clients.

## Prerequisites

- Node.js (v18+ recommended; `node --watch` and `--env-file` are used in `npm` scripts).
- `pnpm` or `npm`/`yarn` to install dependencies. This repo contains a `pnpm-lock.yaml` so `pnpm` is preferred but not required.
- A Cashfree account (API key, API secret, and base URL — sandbox or production).

## Environment variables

Create a `.env` file in the project root with the following values (example):

CF_API_KEY=your_cashfree_api_key
CF_API_SECRET=your_cashfree_api_secret
CF_BASE_URL=https://test.cashfree.com/api (or your Cashfree base URL)
PORT=3000

Note: Netlify functions that use the same Cashfree calls will need the same env vars configured in Netlify dashboard (or via `netlify dev` env settings).

## Install

Using pnpm (recommended):

```bash
pnpm install
```

Or using npm:

```bash
npm install
```

## Run (development)

The project provides a single script in `package.json`:

```bash
npm run dev
```

This runs `node --env-file .env --watch server.js` (watch mode and loads `.env`). If your Node version doesn't support `--env-file`, ensure you load envs via another method (e.g., `dotenv`) or use `cross-env`.

To run Netlify functions locally (if you want to test them):

1. Install Netlify CLI: `npm i -g netlify-cli` (or `pnpm add -g netlify-cli`).
2. Run `netlify dev` in the project root — it will pick up `netlify/functions` and the `netlify.toml` config.

## API Endpoints (from `server.js`)

- POST /payments
  - Creates an order using Cashfree API and returns:
    ```json
    {
      "payment_session_id": "<payment_session_id>",
      "order_id": "<order_id>"
    }
    ```
  - The server currently uses placeholder customer details and a hard-coded amount (see `server.js`); update payload generation before production.

- POST /verifyPayment
  - Body: `{ "order_id": "<order_id>" }`
  - Returns Cashfree order details for the given `order_id`.

Netlify functions in `netlify/functions/` may provide similar or extra routes — inspect those files for specifics.

## Notes & TODOs

- Replace placeholder values (customer id, amount, currency) with real values from the client request.
- Add robust error handling and logging.
- Add request validation (e.g., `Joi` or similar).
- Add a secure mechanism for storing API keys (secrets manager or Netlify environment variables).
- Add unit/integration tests.

## Troubleshooting

- If you see `ECONNREFUSED` to Cashfree endpoints, check `CF_BASE_URL` and network connectivity.
- If `--env-file` isn't recognized, run the server with env vars exported manually or add `dotenv` usage in `server.js`.

## Contributing

- Open issues for bugs or feature requests.
- Submit PRs with clear descriptions; keep changes small and focused.

## License

MIT-style (add a proper license file if needed)

## Contact

For questions about this repo, open an issue or contact the maintainers.

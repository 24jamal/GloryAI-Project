AlchemistAI

AlchemistAI is a full-stack AI content-creation application. Authenticated users can create articles and blog titles, generate images, remove image backgrounds or objects, review PDF resumes, browse public image creations, and purchase a Premium subscription.

The repository contains two independently runnable and deployable applications:

| Application | Directory | Purpose |
| --- | --- | --- |
| Web client | `client/` | React single-page application (SPA) built with Vite and Tailwind CSS |
| API server | `server/` | Express API for authentication, AI providers, storage, creations, and subscriptions |

## Contents

- [Technology](#technology)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Run locally](#run-locally)
- [Application workflows](#application-workflows)
- [Routes and API](#routes-and-api)
- [Database](#database)
- [Deploy to Vercel](#deploy-to-vercel)
- [Verification and troubleshooting](#verification-and-troubleshooting)
- [Security and operational notes](#security-and-operational-notes)

## Technology

### Client

- React 19 and React Router
- Vite 8
- Tailwind CSS 4
- Clerk React for sign-in and session tokens
- Axios for API requests
- Razorpay Checkout for subscriptions
- `react-markdown` for rendering generated text
- Lucide icons and React Hot Toast notifications

### Server

- Node.js with Express 5
- Clerk Express middleware and Clerk user metadata
- Neon serverless PostgreSQL driver
- Gemini, through its OpenAI-compatible API, for text generation
- Clipdrop for text-to-image generation
- Cloudinary for image storage and transformations
- Razorpay Subscriptions and webhooks
- Multer and `pdf-parse` for uploaded images and PDF resumes
- `express-rate-limit` for AI-endpoint throttling

## Architecture

```text
Browser
  |
  | React SPA + Clerk session
  v
Vite client (client/)
  |  Authorization: Bearer <Clerk session token>
  |  VITE_BASE_URL + /api/...
  v
Express API (server/)
  |-- Clerk: validates token; stores usage and subscription entitlement
  |-- Neon Postgres: creations, publication state, likes
  |-- Gemini: articles, titles, resume feedback
  |-- Clipdrop -> Cloudinary: generated images
  |-- Cloudinary: background removal and object removal
  `-- Razorpay: subscription checkout, verification, signed webhooks
```

The client and API are separate processes. The client never receives database credentials, AI-provider secrets, Cloudinary secrets, or the Razorpay key secret. It only receives the Razorpay public key required by Checkout.

### Request lifecycle

1. A user signs in with Clerk in the client.
2. A protected page calls `getToken()` and sends the Clerk session token in the `Authorization` header.
3. Clerk middleware validates the token. The custom `auth` middleware loads the Clerk user and determines whether the user is on the free or Premium plan.
4. The relevant controller invokes the AI or image provider, optionally saves the result to Cloudinary, and records a creation in PostgreSQL.
5. The API returns `{ success, content }` (or `{ success: false, message }`), and the client presents the result or a toast notification.

## Prerequisites

- Node.js 20 or later and npm
- A Clerk application
- A Neon PostgreSQL database
- A Google Gemini API key and compatible model name
- A Cloudinary account
- A Clipdrop API key (image generation)
- A Razorpay account and a recurring monthly plan (subscriptions)

Use current LTS Node.js for both projects. Each application has its own `package.json` and must be installed separately.

## Configuration

Environment files are local-only. Do not commit them, share them, or put real secret values in an example file.

### API environment — `server/.env`

Create `server/.env` with the following variables:

```dotenv
# Runtime
PORT=3000

# Clerk (server-side secret)
CLERK_SECRET_KEY=sk_test_or_live_...

# Neon PostgreSQL
DATABASE_URL=postgresql://...

# Gemini via the OpenAI-compatible endpoint used in server/controllers/aiController.js
GEMINI_API_KEY=...
GEMINI_MODEL=your-gemini-model-name

# Cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Clipdrop
CLIPDROP_API_KEY=...

# Razorpay — keep the secret key server-side only
RAZORPAY_KEY_ID=rzp_test_or_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_MONTHLY_PLAN_ID=plan_...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_SUBSCRIPTION_TOTAL_COUNT=120
```

`RAZORPAY_SUBSCRIPTION_TOTAL_COUNT` defaults to `120` if omitted. It is the number of monthly billing cycles requested when a subscription is created.

### Client environment — `client/.env`

Create `client/.env` for local development:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_or_live_...
VITE_BASE_URL=http://localhost:3000
```

Only variables prefixed with `VITE_` are available in Vite browser code. Therefore, **never** put a secret in the client environment file.

For production, set the same values in the Vercel frontend project's environment variables. `VITE_BASE_URL` must be the public HTTPS URL of the separately deployed API, without a trailing slash.

## Run locally

Open two terminals from the repository root.

### 1. Start the API

```bash
cd server
npm install
npm run server
```

`npm run server` starts Nodemon, so the server restarts after source changes. The API listens on `http://localhost:3000` unless `PORT` is set. To run without automatic restarts, use:

```bash
npm start
```

Confirm the API is available:

```bash
curl http://localhost:3000/
```

Expected response:

```text
Server is live
```

### 2. Start the client

```bash
cd client
npm install
npm run dev
```

Vite prints the local browser URL, normally `http://localhost:5173`. Open that URL and sign in through Clerk.

### 3. Build and preview the client

```bash
cd client
npm run build
npm run preview
```

`npm run build` writes production files to `client/dist/`. `npm run lint` runs the configured ESLint checks.

## Application workflows

### Authentication and authorization

- `/` is the public landing page.
- `/ai/*` renders a Clerk sign-in component when the visitor has no Clerk user.
- Protected API routes require a valid `Authorization: Bearer <Clerk token>` header.
- The server reads Clerk private metadata to decide whether the user is `free` or `premium`.
- The user-facing plan label comes from Clerk public metadata (`plan`), which the server updates after subscription verification or a Razorpay webhook.

### Free and Premium access

| Capability | Free | Premium |
| --- | --- | --- |
| Article generation | Up to 10 saved generations | Available |
| Blog-title generation | Shares the same 10-generation counter | Available |
| Image generation | Not available | Available |
| Background removal | Not available | Available |
| Object removal | Not available | Available |
| Resume review | Not available | Available |

The current free limit is stored as `privateMetadata.free_usage` in Clerk. The server increments it after a successful article or blog-title creation. All AI routes are also rate-limited to 30 requests per 15-minute window.

### Create text content

1. The user opens **Write Article** or **Blog Articles**.
2. The client constructs a prompt from the selected options and sends it to the API with a Clerk token.
3. The server checks the user plan and free-usage limit.
4. Gemini generates the response.
5. The server saves the prompt, content, and creation type in `creations`.
6. The client renders the Markdown result; the Dashboard later lists it.

Article output is limited to 100–4,100 tokens. Blog titles use the model name currently hard-coded in the controller and a 200-token maximum.

### Create and edit images

- **Generate Images**: Premium users submit a description and style. The API asks Clipdrop to generate a PNG, uploads it to Cloudinary, and saves the Cloudinary URL as an `image` creation. The user can choose whether to publish it to the community.
- **Remove Background**: Premium users upload an image. Cloudinary uploads it and applies its background-removal transformation.
- **Remove Object**: Premium users upload an image and a single object description. Cloudinary generates a URL with its generative object-removal transformation.

### Review a resume

1. A Premium user uploads a PDF under 5 MB.
2. Multer accepts the `resume` file and `pdf-parse` extracts its text.
3. Gemini returns constructive feedback.
4. The result is saved as a `resume-review` creation and displayed as Markdown.

### Community images and likes

- Only creations whose `publish` value is `true` are returned by the community endpoint.
- The client displays their image URLs and current like count.
- Tapping the heart adds or removes the authenticated user ID in the creation's `likes` text array.

### Premium subscription

```text
User clicks Subscribe
  -> client loads Razorpay Checkout
  -> POST /api/subscriptions/create
  -> API creates/reuses Razorpay subscription and saves it in Clerk private metadata
  -> Razorpay Checkout completes
  -> client POSTs Razorpay payment response to /api/subscriptions/verify
  -> API verifies HMAC signature and subscription ownership
  -> API saves Premium entitlement in Clerk metadata
  -> user metadata reloads in the browser

Razorpay webhook
  -> POST /api/razorpay/webhook (raw body)
  -> API verifies webhook signature, refetches subscription, and synchronizes Clerk metadata
```

The webhook is important: it keeps entitlement data current when Razorpay changes subscription state asynchronously. Configure Razorpay to deliver subscription events to:

```text
https://YOUR_API_DOMAIN/api/razorpay/webhook
```

Use the same secret in Razorpay and `RAZORPAY_WEBHOOK_SECRET`.

## Routes and API

### Browser routes

| Route | Screen | Access |
| --- | --- | --- |
| `/` | Landing page | Public |
| `/ai` | Dashboard and saved creations | Clerk user required |
| `/ai/write-article` | Article writer | Clerk user required |
| `/ai/blog-titles` | Blog-title generator | Clerk user required |
| `/ai/generate-images` | Image generator | Clerk user required; Premium API access |
| `/ai/remove-background` | Background removal | Clerk user required; Premium API access |
| `/ai/remove-object` | Object removal | Clerk user required; Premium API access |
| `/ai/review-resume` | PDF resume reviewer | Clerk user required; Premium API access |
| `/ai/community` | Published image gallery | Clerk user required |
| `/ai/plan` | Subscription checkout | Clerk user required |

### API routes

All routes below, except the health check and Razorpay webhook, require a Clerk bearer token. Requests return JSON with a `success` field.

| Method | Endpoint | Request body / form fields | Purpose |
| --- | --- | --- | --- |
| `GET` | `/` | — | Health response: `Server is live` |
| `POST` | `/api/ai/generate-article` | `{ prompt, length }` | Generate and save an article |
| `POST` | `/api/ai/generate-blog-title` | `{ prompt }` | Generate and save blog-title suggestions |
| `POST` | `/api/ai/generate-image` | `{ prompt, publish? }` | Generate, upload, and save an image |
| `POST` | `/api/ai/remove-image-background` | multipart field `image` | Remove an uploaded image's background |
| `POST` | `/api/ai/remove-image-object` | multipart fields `image`, `object` | Remove the requested object from an image |
| `POST` | `/api/ai/resume-review` | multipart field `resume` | Extract and review an uploaded PDF |
| `GET` | `/api/user/get-user-creations` | — | Get the signed-in user's saved creations |
| `GET` | `/api/user/get-published-creations` | — | Get all published creations |
| `POST` | `/api/user/toggle-like-creation` | `{ id }` | Toggle the signed-in user's like |
| `POST` | `/api/subscriptions/create` | `{}` | Create or reuse a Razorpay monthly subscription |
| `POST` | `/api/subscriptions/verify` | Razorpay Checkout response | Verify payment signature and update entitlement |
| `POST` | `/api/razorpay/webhook` | Razorpay raw JSON body | Verify and synchronize Razorpay events |

## Database

The API expects this Neon PostgreSQL table:

```sql
CREATE TABLE creations (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  publish BOOLEAN DEFAULT FALSE,
  likes TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

`content` contains either Markdown/text (articles, titles, resume feedback) or a Cloudinary image URL. `type` is currently one of `article`, `blog-title`, `image`, or `resume-review`.

Clerk carries user-specific operational metadata rather than the database:

| Metadata | Visibility | Meaning |
| --- | --- | --- |
| `free_usage` | Private | Number of free text generations used |
| `razorpaySubscriptionId` | Private | Razorpay subscription owned by the user |
| `razorpaySubscriptionStatus` | Private | Latest Razorpay status |
| `razorpaySubscriptionCurrentEnd` | Private | Latest subscription end timestamp |
| `razorpayPlanId` | Private | Razorpay plan ID |
| `plan` | Public | UI-only value: `free` or `premium` |

## Deploy to Vercel

Deploy the client and server as **two separate Vercel projects** from the same repository.

### Frontend project

| Vercel setting | Value |
| --- | --- |
| Root Directory | `client` |
| Framework | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Set `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_BASE_URL` in the frontend project's Production environment variables, then redeploy.

`client/vercel.json` rewrites every path to `/`. This is required for React Router routes such as `/ai/write-article` to work when opened directly or refreshed.

### API project

| Vercel setting | Value |
| --- | --- |
| Root Directory | `server` |
| Framework | Other |
| Entry point | `server.js` (configured in `server/vercel.json`) |

Set every server environment variable listed above in the API project's Production environment. Do not set server secrets in the frontend project.

`server/vercel.json` directs incoming requests to `server.js`. After deployment, visit the API root URL and verify it returns `Server is live` before setting the client's `VITE_BASE_URL`.

### Deployment checklist

1. Commit the Vercel configuration files: `client/vercel.json` and `server/vercel.json`.
2. Deploy the API and add its production environment variables.
3. Verify `https://YOUR_API_DOMAIN/` responds with `Server is live`.
4. Configure the Razorpay webhook URL and secret.
5. Deploy the client with its Clerk public key and the API URL.
6. In Clerk, allow the frontend production domain and ensure the Clerk keys belong to the correct instance.
7. Open the exact current Production URL shown in Vercel.

## Verification and troubleshooting

### Useful commands

```bash
# Client checks
cd client
npm run lint
npm run build

# API start
cd ../server
npm start
```

There is no automated test suite in the repository at present. Verify the core flows manually after configuring external providers:

1. Sign in and open the dashboard.
2. Generate an article or a blog title and confirm it appears in Dashboard.
3. Sign in as a non-Premium user and confirm Premium-only tools are rejected.
4. Complete a test Razorpay checkout and verify the displayed plan changes to Premium.
5. Send a signed Razorpay test webhook and confirm the user's Clerk metadata updates.
6. Generate and publish an image; confirm it appears in Community and likes toggle.

### Vercel `404: NOT_FOUND`

That response is generated by Vercel before React starts. It is not specific to the laptop or browser opening the URL. Check the following:

1. Open the Production deployment URL shown in the Vercel dashboard; avoid an old/deleted project alias.
2. Confirm the frontend Vercel project uses `client` as its root directory.
3. Commit and push `client/vercel.json`; it contains the SPA rewrite rule.
4. Confirm that the deployment is successful and assigned to the intended `*.vercel.app` domain.
5. For direct `/ai/...` URLs, redeploy after adding the SPA rewrite configuration.

### Client loads but API calls fail

- Confirm `VITE_BASE_URL` points to the deployed API, not `localhost`.
- Add the matching client origin to a restrictive CORS configuration before production use.
- Confirm the client and server use the same Clerk instance: the publishable key and secret key must match.
- Verify the API's environment variables were added in Vercel and redeploy after changing `VITE_*` values.

### Payments do not activate Premium

- Verify the Razorpay monthly plan ID matches the account mode (test or live).
- Verify the checkout key ID and API key secret belong to the same Razorpay account/mode.
- Confirm Razorpay can reach the deployed HTTPS webhook endpoint.
- Confirm `RAZORPAY_WEBHOOK_SECRET` exactly matches the secret configured for that webhook.

## Security and operational notes

- Rotate any credential that has appeared in a file, terminal log, screenshot, or commit history. The existing server environment example must contain placeholders only; never real live credentials.
- Keep `CLERK_SECRET_KEY`, database URLs, Cloudinary secrets, Gemini keys, Clipdrop keys, Razorpay key secrets, and webhook secrets on the server only.
- The current server uses unrestricted `cors()`. Before public production use, restrict it to the known frontend origin(s).
- The AI rate limiter is configured for 30 requests per 15 minutes on `/api/ai`. Consider durable, shared rate-limit storage if running across multiple serverless instances.
- Upload validation is minimal in the current code. Add server-side file-type and size limits for image uploads; the resume endpoint currently applies a 5 MB size check after receiving the file.
- Current controllers return some failures as JSON with `success: false` rather than a non-2xx status. Clients should always inspect `success` and display `message`.
- Use HTTPS deployment URLs for the frontend, API, Clerk redirect configuration, and Razorpay webhook.

## Repository structure

```text
.
├── client/
│   ├── src/
│   │   ├── components/        # Landing, navigation, plan, and creation UI
│   │   ├── pages/             # Dashboard and tool screens
│   │   ├── assets/            # Branding and static image assets
│   │   ├── App.jsx            # Browser route tree and Axios base URL
│   │   └── main.jsx           # React and Clerk providers
│   ├── vite.config.js
│   └── vercel.json            # SPA fallback rewrite
├── server/
│   ├── configs/               # Neon, Cloudinary, and Multer setup
│   ├── controllers/           # AI, user creation, and subscription logic
│   ├── middelwares/           # Clerk authentication and entitlement logic
│   ├── routes/                # Express route registration
│   ├── server.js              # Express application entry point
│   ├── notes.txt              # `creations` schema
│   └── vercel.json            # Server deployment routing
└── README.md
```

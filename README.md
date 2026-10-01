# Email Decision Lab: JEV + OpenAI

Enhanced fork of [Harsha Moraliyage’s JEV email demo](https://github.com/harsha89/jev-demo).
The original JEV explorer and illustrative examples remain available.

## What this fork adds

- **Provider comparison** within Try an email and Run on dataset: JEV, OpenAI Responses, or both.
- Separate, memory-only provider keys in comparison mode. Requests go through the app server to fixed provider endpoints. No shared server-key fallback in this mode.
- The same email, categories and editable score rubric for both providers; each receives the first 4,000 body characters.
- Matched spam/ham accuracy, precision, recall, F1, false positives and false negatives, plus failure counts and p50/p95 latency.
- Per-email results, spam disagreement filtering, reported token counts, JSON provenance exports and CSV exports.
- Strict input/output validation, bounded request size, timeouts, cancellation and sanitised upstream errors.
- Bundled Inter and JetBrains Mono fonts: builds no longer need to fetch Google Fonts.

## Run

Requires Node 22 or later.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Provider comparison is the default view.
1. Select JEV + OpenAI, or a single provider.
2. Enter your TypeSafe and/or OpenAI API key in **Provider setup**.
3. Choose an OpenAI model supporting Responses and Structured Outputs. The initial value is `gpt-4.1-mini`; availability depends on your account.
4. Paste an email and classify it, or select Run on dataset to compare a seeded sample.
5. Change the optional rubric under Settings. The original JEV explorer has its own key setting.

Comparison keys are not persisted to browser storage, logs or exports. They are lost on reload or leaving the comparison component (for example, opening Example). The existing original JEV explorer still has its explicit “Remember in this browser” option. Email contents are transmitted to the selected providers. `store: false` is sent to OpenAI; this is not a claim of zero provider retention. JSON/CSV exports include email subjects and results, so review them before sharing.

## OpenAI Decisions API status

**This fork implements OpenAI Responses with Structured Outputs, not OpenAI Decisions API.**
The community article is not a verified endpoint/schema specification. No invented Decisions endpoint or third-party `decisionapi.net` proxy is used. Add a separate provider adapter only when official documentation and account access can be verified.

Official references:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-4.1-mini

## Interpreting comparisons

- Paired metrics use only emails for which **both** providers succeeded. Coverage and failure counts remain visible. Single-provider runs show outputs/latency but do not populate paired metrics.
- JEV is classified as spam at `p_spam >= 0.5`; OpenAI returns a discrete spam/ham label.
- JEV probabilities are provider-reported; this demo does not establish calibration. OpenAI probabilities/confidence remain `null` and display as unavailable. Do not manufacture ROC/AUC or probability distributions from those labels.
- JEV’s rubric score is fractional; OpenAI selects an integer rubric level. They are not interchangeable probability distributions.
- Enron-Spam labels support spam evaluation only. Category and urgency accuracy require separately annotated data.
- p50/p95 are nearest-rank latencies for successful requests, measured on the server around the provider request and parsing. They exclude browser-to-server time.
- Token totals are reported usage for successfully parsed results, not a billing estimate. Failed or cancelled calls may still incur charges.
- Comparisons process one email at a time and call the selected providers concurrently. Stop cancels in-flight browser/server requests; it cannot guarantee the provider stops billing. No automatic paid retries. Runs stop on input/auth/model-access/quota errors.
- JSON includes seed, rubric, requested/resolved models, truncation limit, prompt version and results. CSV neutralises formula-like subjects/errors. Neither export includes API keys or email bodies.
- Synthetic examples remain labelled illustrative; never use their displayed numbers as evidence of provider performance.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests cover response validation, refusals/incomplete output, probability semantics, fair paired metrics, CSV escaping, provider payloads and sanitised errors. They mock providers; live provider quality and billing must be checked with your own credentials.

## Implementation

- `lib/evaluation.ts`: provider-neutral result types, validation, paired metrics, exports.
- `lib/providers/classify.ts`: fixed-endpoint JEV and OpenAI adapters.
- `app/api/evaluate/route.ts`: bounded, non-caching API route using caller-provided keys.
- `components/ComparisonWorkbench.tsx`: single-email and dataset comparison UI.
- `app/api/classify/route.ts`: original JEV explorer route, retained for compatibility.

Deploy using the existing Netlify configuration. Comparison mode does not require provider secrets in deployment environment variables. Visitors supply their own keys. Do not enable a public shared-key fallback.

---

## Original upstream documentation

# JEV email classification demo

A showcase of **JEV**, TypeSafe AI's System One decision model, on the public
[Enron-Spam](https://huggingface.co/datasets/SetFit/enron_spam) dataset. Each email gets **one JEV call** that asks
all three JEV question types at once:

| Question | JEV type | Returns |
|---|---|---|
| Is this email spam? | **Noul** | probability 0–1 (scored against the dataset's spam labels) |
| Which category? (marketing, finance, sales, customer support, other) | **Choice** | category, confidence, probability per option |
| How urgent is it? (5-level rubric, editable) | **Score** | fractional score + probability per level |

The web app has three views:

- **Try an email**: write or generate an email and see JEV's three answers, plus the exact request and response, question by question.
- **Run on dataset**: classify a balanced sample of Enron-Spam emails and explore accuracy, categories and urgency.
- **Example (no key needed)**: a saved run for visitors without an API key.

## Project layout

```
app/                 Next.js App Router (page, layout, theme, API routes)
  api/classify/      server proxy to JEV (key never logged; returns a request/response trace)
  api/sample/        seeded balanced sample from data/enron_spam_test.jsonl
  api/example/       serves data/example-run.json (saving a new one is local-only)
components/          UI: answer cards, request/response inspector, charts, results view, score editor
lib/                 JEV questions/config, metrics, example email generator
data/                Enron-Spam test split + the Example tab's saved run
python/              stand-alone Python script + HTML report (same questions as the app)
netlify.toml         Netlify build settings
```

## Run locally

```
npm install
npm run dev        # http://localhost:3000
```

Add your TypeSafe key in **Settings** (gear icon). It goes only to the app's own server route, which forwards it to
`api.typesafe.ai`. Locally you can instead put `TYPESAFE_API_KEY=...` in `.env.local`.

### Replacing the example data

`data/example-run.json` ships with **illustrative** placeholder data (clearly labelled in the app, not JEV output).
To replace it with a real run: run locally with your key, open **Run on dataset**, run it, then click **Save as example**.
Commit the updated `data/example-run.json` and redeploy. The Example tab then shows "Recorded JEV run" with the date.

## Deploy to Netlify

1. Push this repository to GitHub.
2. In Netlify: **Add new site → Import an existing project → GitHub** and pick the repo.
   Netlify reads `netlify.toml` (build `npm run build`, Node 22) and deploys with its Next.js runtime.
   No base directory is needed: the app is at the repository root.
3. Deploy. No environment variables are required: visitors enter their own key, or use the Example tab.

**Do not set `TYPESAFE_API_KEY` on a public site** unless you also set `ALLOW_SERVER_KEY=true` on purpose:
with both set, every visitor would be using your key.

## Python script

```
cd python
pip install httpx
set TYPESAFE_API_KEY=your_key                        # Windows (export ... on macOS/Linux)
python jev_spam_demo.py -n 50                        # 50 spam + 50 ham: metrics, CSV and an HTML report
python jev_spam_demo.py --report results.csv         # rebuild the HTML report without calling JEV
```

## References

- TypeSafe docs: https://docs.typesafe.ai (question types: `/primitives/noul`, `/primitives/choice`, `/primitives/score`)
- Dataset: Metsis, Androutsopoulos & Paliouras (2006), *Spam Filtering with Naive Bayes – Which Naive Bayes?*, via Hugging Face `SetFit/enron_spam`

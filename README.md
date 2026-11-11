# Understand

Understand a big, vibecoded project well enough to explain it: where its data comes from, what happens to it, where it ends up, with the key code as evidence and real data runs as proof.

```bash
npm install
npm start                      # builds the UI if needed, serves http://localhost:4800, opens the browser
npm start -- ~/Projects/my-app # same, with a project already analysed
```

On the home page you can drop a folder, open a local path, or try the demo in `examples/listings-pipeline`. The demo is a scrape → clean → summarize → ingest pipeline with an Express API and a vanilla JS frontend, and it has two planted bugs for Understand to find.

## What you get

Open a project and you land on **How it works**:

1. **One-paragraph summary** you can say out loud. For example: *"listings-pipeline scrapes example.com, then cleans, summarizes and computes the data. It saves the results to data/listings.json, serves them through 6 API endpoints and shows them on a web page."*
2. **A simple workflow** of at most five steps: **Collect → Process → Store → Serve → Show**. Each box names only the two or three things that matter.
3. **Each step explained in plain English**, built from the project's own docstrings and comments, with the data fields it handles and one or two lines of code as evidence. "Walk through the code" opens the full path if someone asks.
4. **Prove it works**: one click runs the pipeline on safe input, feeding each step's real output into the next (e.g. 1,083 characters → 7 listings → 6 after removing a duplicate → 3 city summaries). Steps that write or send data are skipped. "Check" hits the running API's read-only endpoints and shows what they return. Results show up on the workflow boxes.
5. **Talking points** you can copy, including what the proof runs showed, plus **Worth knowing** caveats (broken calls, hardcoded secrets, undocumented env vars).

Two more pages back that up:

| Page | What it's for |
| --- | --- |
| **Try a step** | Run any single function on input you choose. The result gets a table, a column profile and warnings (empty columns, numbers stored as text, HTML left over from scraping, duplicates). Pipe it into the next function. |
| **Watch it live** | A recording proxy between your frontend (or scripts) and your running backend, so you can watch real requests and check each response's data. |

The low-level views (stack & setup, issues, every data operation, the full code map, the import graph) are still there, collapsed under **Details** in the sidebar.

### Testing a pipeline step by step

1. **Test bench** → pick the first step (e.g. `load_sample()`) → **Run**.
2. Check the result's warnings and table.
3. **Pipe into…** (or a suggested next step) → the next function gets the *full* previous output as its argument. pandas DataFrames come back as DataFrames.
4. Repeat until the step where the data goes wrong.

Functions run in a separate process from the project folder. Python uses the project's `.venv`/`venv` if present, otherwise `python3`. JS/TS runs through `tsx`, with CSS and image imports stubbed out. The project's `.env` files are loaded (values never reach the UI). **The code is real**: database writes, emails and API calls actually happen, and importing a module runs its top-level code.

### Watching live traffic

1. Start your app as usual (say the backend is on `:3000`).
2. **Live tap** → backend URL `http://localhost:3000` → **Start tap** (listens on `:4999`).
3. Send traffic through `:4999`. Open it in the browser if the backend serves the frontend; otherwise point the frontend's API base URL or dev proxy at it, or set the project's `*_API_URL` env var for scripts.
4. Open **Flow**: routes show hit counts and the trace panel shows the latest real response for each route.

## What it understands

- **JS / TS** (Babel AST): Express, Fastify, Koa/Hono-style routers with mounted prefixes, NestJS, Next.js (pages + app router), SvelteKit and Nuxt server routes, hand-rolled routers (`route('GET', '/x', h)`), route tables (`{ method, pattern: /regex/, handle }`). Also `fetch`/axios/jQuery/XHR calls, and URLs passed through your own API wrappers (`apiGet('/courses')` → `` fetch(`/api${path}`) ``). Vue/Svelte/Astro script blocks and HTML pages are included.
- **Python** (`ast`): Flask (blueprints), FastAPI (routers), Django `urls.py`, Flask-RESTful. Also requests/httpx/aiohttp/urllib, BeautifulSoup/Selenium/Playwright/Scrapy, pandas (I/O and transforms), SQL drivers, SQLAlchemy/Django ORM, pymongo, and LLM SDKs. Jupyter notebooks are converted to Python.
- **Java** (structural parse): Spring controllers and mappings, injected fields, Spring Data repositories, RestTemplate/WebClient, JdbcTemplate, mail, STOMP/Kafka, `@Scheduled`, Jsoup.
- **Stack**: package.json, requirements/pyproject/Pipfile, Gradle/Maven, Docker/Compose, Spring `application.*`, deploy configs, browser-extension manifests.

Calls are matched to routes even when a server or dev proxy strips a leading `/api`. URLs whose base is only known at runtime are marked "unresolved" rather than broken.

## Commands

```bash
npm run dev                    # API server with --watch + Vite hot reload on :5173
npm run analyze -- <folder>    # headless summary (add --json for the full model)
npm test                       # analyzer, matcher and profiler tests (uses the demo project)
```

## Safety

The server listens on `127.0.0.1` only. It rejects requests addressed to any other host (blocking DNS rebinding) and requires an `X-Understand` header on every state-changing call, so other websites open in your browser can't trigger code execution through it. Authorization and cookie headers are masked in the tap, and `.env` values are hidden in the file viewer.

## Limits

This is static analysis plus heuristics, so treat findings as leads. It won't follow URLs or routes built from runtime data, dependency-injection magic beyond Spring fields, or method calls on objects returned from factories. Java and components are tested through their HTTP routes (Live tap) rather than run directly. Uploaded folders don't include `node_modules` or virtualenvs, so open a local path when you want to run code with its dependencies.

## Layout

```
server/
  analyze/   walk, js.js / python.js (+ py_extract.py) / java.js extractors, resolve.js (imports + call graph),
             routes.js (matching), flow.js, health.js, stack.js, trace.js, index.js (orchestrator)
  run/       runner + harness_py.py / harness-js.mjs
  tap/       recording reverse proxy
  index.js   HTTP API (localhost only)
shared/profile.js   data profiler used by server and UI
web/src/     React UI (views/, panels/, components/)
examples/listings-pipeline/   demo project
```

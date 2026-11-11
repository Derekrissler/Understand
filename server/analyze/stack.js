// Stack analysis: manifests, technologies, how to run each part, ports, env vars.
import path from 'node:path'
import { CODE_LANGS } from './walk.js'

const P = path.posix

// name -> [label, category]
const C = {
  fe: 'Frontend framework', ui: 'UI & styling', be: 'Backend framework', db: 'Database & ORM', scrape: 'Scraping & browser automation',
  http: 'HTTP client', data: 'Data & analysis', ml: 'Machine learning', ai: 'AI / LLM', auth: 'Auth & security', test: 'Testing',
  build: 'Build & tooling', rt: 'Realtime & messaging', pay: 'Payments', mail: 'Email', cloud: 'Cloud & infra', valid: 'Validation',
  state: 'State & data fetching', jobs: 'Jobs & queues', cli: 'CLI & utilities', mobile: 'Mobile & desktop',
}
const KNOWN = {
  // JS frontend
  react: ['React', C.fe], 'react-dom': null, next: ['Next.js', C.fe], vue: ['Vue', C.fe], nuxt: ['Nuxt', C.fe], svelte: ['Svelte', C.fe], '@sveltejs/kit': ['SvelteKit', C.fe],
  '@angular/core': ['Angular', C.fe], 'solid-js': ['Solid', C.fe], preact: ['Preact', C.fe], astro: ['Astro', C.fe], jquery: ['jQuery', C.fe], 'react-router-dom': ['React Router', C.fe], 'react-router': ['React Router', C.fe], '@remix-run/react': ['Remix', C.fe], gatsby: ['Gatsby', C.fe], alpinejs: ['Alpine.js', C.fe], htmx: ['htmx', C.fe], 'htmx.org': ['htmx', C.fe],
  tailwindcss: ['Tailwind CSS', C.ui], '@mui/material': ['Material UI', C.ui], 'styled-components': ['styled-components', C.ui], '@emotion/react': ['Emotion', C.ui], bootstrap: ['Bootstrap', C.ui], 'react-bootstrap': ['React Bootstrap', C.ui], '@chakra-ui/react': ['Chakra UI', C.ui], antd: ['Ant Design', C.ui], '@radix-ui/react-dialog': ['Radix UI', C.ui], 'lucide-react': ['Lucide icons', C.ui], 'framer-motion': ['Framer Motion', C.ui], sass: ['Sass', C.ui], 'chart.js': ['Chart.js', C.ui], recharts: ['Recharts', C.ui], d3: ['D3', C.ui], three: ['three.js', C.ui], '@xyflow/react': ['React Flow', C.ui], leaflet: ['Leaflet', C.ui], 'shadcn-ui': ['shadcn/ui', C.ui],
  '@tanstack/react-query': ['TanStack Query', C.state], 'react-query': ['React Query', C.state], swr: ['SWR', C.state], redux: ['Redux', C.state], '@reduxjs/toolkit': ['Redux Toolkit', C.state], zustand: ['Zustand', C.state], jotai: ['Jotai', C.state], recoil: ['Recoil', C.state], mobx: ['MobX', C.state], pinia: ['Pinia', C.state], '@trpc/server': ['tRPC', C.be], '@trpc/client': ['tRPC', C.state], '@apollo/client': ['Apollo Client', C.state], graphql: ['GraphQL', C.be],
  // JS backend
  express: ['Express', C.be], fastify: ['Fastify', C.be], koa: ['Koa', C.be], hono: ['Hono', C.be], '@nestjs/core': ['NestJS', C.be], 'socket.io': ['Socket.IO', C.rt], 'socket.io-client': ['Socket.IO client', C.rt], ws: ['ws (WebSockets)', C.rt], elysia: ['Elysia', C.be], '@hapi/hapi': ['hapi', C.be], 'apollo-server': ['Apollo Server', C.be], '@apollo/server': ['Apollo Server', C.be], cors: ['CORS middleware', C.be], helmet: ['Helmet', C.auth], 'body-parser': null, morgan: null, dotenv: ['dotenv', C.cli], multer: ['Multer uploads', C.be], 'cookie-parser': null, 'express-session': ['express-session', C.auth], 'http-proxy-middleware': null, 'node-cron': ['node-cron', C.jobs], cron: ['cron', C.jobs], bull: ['Bull queues', C.jobs], bullmq: ['BullMQ', C.jobs], agenda: ['Agenda', C.jobs], electron: ['Electron', C.mobile], 'react-native': ['React Native', C.mobile], expo: ['Expo', C.mobile], '@tauri-apps/api': ['Tauri', C.mobile],
  pg: ['PostgreSQL (pg)', C.db], postgres: ['PostgreSQL (postgres.js)', C.db], mysql: ['MySQL', C.db], mysql2: ['MySQL', C.db], 'better-sqlite3': ['SQLite', C.db], sqlite3: ['SQLite', C.db], mongoose: ['MongoDB (Mongoose)', C.db], mongodb: ['MongoDB', C.db], '@prisma/client': ['Prisma', C.db], prisma: ['Prisma', C.db], knex: ['Knex', C.db], sequelize: ['Sequelize', C.db], typeorm: ['TypeORM', C.db], 'drizzle-orm': ['Drizzle', C.db], '@supabase/supabase-js': ['Supabase', C.db], firebase: ['Firebase', C.db], 'firebase-admin': ['Firebase Admin', C.db], redis: ['Redis', C.db], ioredis: ['Redis', C.db], '@upstash/redis': ['Upstash Redis', C.db], lowdb: ['lowdb', C.db], '@vercel/postgres': ['Vercel Postgres', C.db], '@neondatabase/serverless': ['Neon Postgres', C.db], convex: ['Convex', C.db], '@libsql/client': ['libSQL / Turso', C.db],
  puppeteer: ['Puppeteer', C.scrape], 'puppeteer-core': ['Puppeteer', C.scrape], 'puppeteer-extra': ['Puppeteer Extra', C.scrape], playwright: ['Playwright', C.scrape], cheerio: ['Cheerio', C.scrape], jsdom: ['jsdom', C.scrape], 'selenium-webdriver': ['Selenium', C.scrape], crawlee: ['Crawlee', C.scrape], 'node-html-parser': ['node-html-parser', C.scrape],
  axios: ['Axios', C.http], 'node-fetch': ['node-fetch', C.http], got: ['Got', C.http], ky: ['Ky', C.http], superagent: ['SuperAgent', C.http], undici: ['undici', C.http], ofetch: ['ofetch', C.http],
  openai: ['OpenAI SDK', C.ai], '@anthropic-ai/sdk': ['Anthropic SDK', C.ai], '@google/generative-ai': ['Gemini SDK', C.ai], '@google/genai': ['Gemini SDK', C.ai], ai: ['Vercel AI SDK', C.ai], langchain: ['LangChain', C.ai], '@langchain/core': ['LangChain', C.ai], 'groq-sdk': ['Groq', C.ai], ollama: ['Ollama', C.ai], replicate: ['Replicate', C.ai], '@pinecone-database/pinecone': ['Pinecone', C.ai],
  jsonwebtoken: ['JWT', C.auth], bcrypt: ['bcrypt', C.auth], bcryptjs: ['bcrypt', C.auth], passport: ['Passport', C.auth], 'next-auth': ['NextAuth', C.auth], '@auth/core': ['Auth.js', C.auth], '@clerk/nextjs': ['Clerk', C.auth], '@clerk/clerk-react': ['Clerk', C.auth], argon2: ['argon2', C.auth], 'lucia': ['Lucia', C.auth],
  stripe: ['Stripe', C.pay], '@stripe/stripe-js': ['Stripe.js', C.pay], nodemailer: ['Nodemailer', C.mail], resend: ['Resend', C.mail], '@sendgrid/mail': ['SendGrid', C.mail],
  zod: ['Zod', C.valid], yup: ['Yup', C.valid], joi: ['Joi', C.valid], 'class-validator': ['class-validator', C.valid],
  vite: ['Vite', C.build], webpack: ['webpack', C.build], typescript: ['TypeScript', C.build], esbuild: ['esbuild', C.build], parcel: ['Parcel', C.build], turbo: ['Turborepo', C.build], nodemon: ['nodemon', C.build], tsx: ['tsx', C.build], 'ts-node': ['ts-node', C.build], eslint: ['ESLint', C.build], prettier: ['Prettier', C.build], concurrently: ['concurrently', C.build],
  jest: ['Jest', C.test], vitest: ['Vitest', C.test], mocha: ['Mocha', C.test], cypress: ['Cypress', C.test], '@playwright/test': ['Playwright Test', C.test], '@testing-library/react': ['Testing Library', C.test], supertest: ['SuperTest', C.test],
  '@aws-sdk/client-s3': ['AWS S3', C.cloud], 'aws-sdk': ['AWS SDK', C.cloud], '@vercel/analytics': ['Vercel Analytics', C.cloud], 'cloudinary': ['Cloudinary', C.cloud], '@google-cloud/storage': ['Google Cloud Storage', C.cloud],
  'date-fns': null, dayjs: null, moment: null, lodash: null, uuid: null, clsx: null, 'class-variance-authority': null, 'tailwind-merge': null, chalk: null, commander: ['Commander CLI', C.cli], yargs: ['yargs CLI', C.cli], 'csv-parse': ['csv-parse', C.data], papaparse: ['Papa Parse', C.data], xlsx: ['SheetJS', C.data], 'danfojs': ['Danfo.js', C.data],
  // Python
  flask: ['Flask', C.be], fastapi: ['FastAPI', C.be], django: ['Django', C.be], djangorestframework: ['Django REST', C.be], starlette: ['Starlette', C.be], uvicorn: ['Uvicorn', C.be], gunicorn: ['Gunicorn', C.be], 'flask-cors': null, 'flask-socketio': ['Flask-SocketIO', C.rt], 'python-socketio': ['python-socketio', C.rt], aiohttp: ['aiohttp', C.http], tornado: ['Tornado', C.be], streamlit: ['Streamlit', C.fe], gradio: ['Gradio', C.fe], dash: ['Dash', C.fe], 'flask-restful': ['Flask-RESTful', C.be], 'flask-login': ['Flask-Login', C.auth], 'flask-jwt-extended': ['Flask-JWT', C.auth], pydantic: ['Pydantic', C.valid],
  requests: ['Requests', C.http], httpx: ['HTTPX', C.http], urllib3: ['urllib3', C.http], 'requests-html': ['requests-html', C.scrape], cloudscraper: ['cloudscraper', C.scrape],
  beautifulsoup4: ['BeautifulSoup', C.scrape], bs4: ['BeautifulSoup', C.scrape], lxml: ['lxml', C.scrape], scrapy: ['Scrapy', C.scrape], selenium: ['Selenium', C.scrape], 'undetected-chromedriver': ['undetected-chromedriver', C.scrape], parsel: ['parsel', C.scrape], selectolax: ['selectolax', C.scrape], 'playwright-python': ['Playwright', C.scrape], pyppeteer: ['Pyppeteer', C.scrape], 'webdriver-manager': null,
  pandas: ['pandas', C.data], numpy: ['NumPy', C.data], polars: ['Polars', C.data], scipy: ['SciPy', C.data], matplotlib: ['Matplotlib', C.data], seaborn: ['seaborn', C.data], plotly: ['Plotly', C.data], openpyxl: ['openpyxl', C.data], duckdb: ['DuckDB', C.db], pyarrow: ['PyArrow', C.data], jupyter: ['Jupyter', C.data], notebook: ['Jupyter', C.data], ipykernel: ['Jupyter', C.data],
  'scikit-learn': ['scikit-learn', C.ml], sklearn: ['scikit-learn', C.ml], torch: ['PyTorch', C.ml], tensorflow: ['TensorFlow', C.ml], keras: ['Keras', C.ml], xgboost: ['XGBoost', C.ml], lightgbm: ['LightGBM', C.ml], transformers: ['Hugging Face Transformers', C.ml], 'sentence-transformers': ['sentence-transformers', C.ml], opencv: ['OpenCV', C.ml], 'opencv-python': ['OpenCV', C.ml],
  'python-dotenv': ['python-dotenv', C.cli], click: ['Click CLI', C.cli], typer: ['Typer CLI', C.cli], rich: null, tqdm: null, schedule: ['schedule', C.jobs], apscheduler: ['APScheduler', C.jobs], celery: ['Celery', C.jobs], rq: ['RQ', C.jobs],
  sqlalchemy: ['SQLAlchemy', C.db], 'flask-sqlalchemy': ['Flask-SQLAlchemy', C.db], sqlmodel: ['SQLModel', C.db], psycopg2: ['PostgreSQL (psycopg2)', C.db], 'psycopg2-binary': ['PostgreSQL (psycopg2)', C.db], psycopg: ['PostgreSQL (psycopg)', C.db], asyncpg: ['PostgreSQL (asyncpg)', C.db], pymysql: ['MySQL', C.db], pymongo: ['MongoDB', C.db], motor: ['MongoDB (motor)', C.db], 'redis-py': ['Redis', C.db], supabase: ['Supabase', C.db], 'firebase-admin-py': ['Firebase', C.db], peewee: ['Peewee', C.db], alembic: ['Alembic migrations', C.db],
  anthropic: ['Anthropic SDK', C.ai], 'google-generativeai': ['Gemini SDK', C.ai], 'google-genai': ['Gemini SDK', C.ai], 'langchain-openai': ['LangChain', C.ai], litellm: ['LiteLLM', C.ai], 'llama-index': ['LlamaIndex', C.ai], chromadb: ['Chroma', C.ai], tiktoken: null,
  pytest: ['pytest', C.test], unittest: null, 'pyjwt': ['PyJWT', C.auth], 'passlib': ['passlib', C.auth], boto3: ['AWS (boto3)', C.cloud], 'google-cloud-storage': ['Google Cloud Storage', C.cloud], 'sendgrid': ['SendGrid', C.mail], yagmail: ['yagmail', C.mail], twilio: ['Twilio', C.rt],
  // Java / JVM (artifactId)
  'spring-boot-starter-web': ['Spring Web (MVC)', C.be], 'spring-boot-starter-webflux': ['Spring WebFlux', C.be], 'spring-boot-starter-data-jpa': ['Spring Data JPA', C.db], 'spring-boot-starter-data-mongodb': ['Spring Data MongoDB', C.db], 'spring-boot-starter-data-redis': ['Spring Data Redis', C.db], 'spring-boot-starter-security': ['Spring Security', C.auth], 'spring-boot-starter-websocket': ['Spring WebSocket', C.rt], 'spring-boot-starter-mail': ['Spring Mail', C.mail], 'spring-boot-starter-validation': ['Bean Validation', C.valid], 'spring-boot-starter-thymeleaf': ['Thymeleaf', C.fe], 'spring-boot-starter-test': ['Spring Boot Test', C.test], 'spring-boot-starter-actuator': ['Actuator', C.cloud], 'spring-boot-starter-oauth2-client': ['OAuth2 client', C.auth], 'spring-kafka': ['Kafka', C.rt], 'spring-boot-starter-amqp': ['RabbitMQ', C.rt], 'spring-boot-devtools': null,
  postgresql: ['PostgreSQL driver', C.db], 'mysql-connector-j': ['MySQL driver', C.db], 'mysql-connector-java': ['MySQL driver', C.db], h2: ['H2 database', C.db], 'sqlite-jdbc': ['SQLite', C.db], 'flyway-core': ['Flyway migrations', C.db], 'liquibase-core': ['Liquibase', C.db], lombok: ['Lombok', C.build], jsoup: ['Jsoup', C.scrape], 'jjwt-api': ['JJWT', C.auth], 'jjwt': ['JJWT', C.auth], 'stripe-java': ['Stripe', C.pay], 'junit-jupiter': ['JUnit 5', C.test], junit: ['JUnit', C.test], 'mockito-core': ['Mockito', C.test], 'jackson-databind': null, gson: null, okhttp: ['OkHttp', C.http], 'org.springframework.boot': ['Spring Boot', C.be],
}
const PY_IMPORT_NAME = { beautifulsoup4: 'bs4', 'python-dotenv': 'dotenv', 'scikit-learn': 'sklearn', pillow: 'PIL', pyyaml: 'yaml', 'opencv-python': 'cv2', 'psycopg2-binary': 'psycopg2', 'google-generativeai': 'google', 'google-genai': 'google', 'undetected-chromedriver': 'undetected_chromedriver', 'webdriver-manager': 'webdriver_manager', 'flask-cors': 'flask_cors', 'flask-sqlalchemy': 'flask_sqlalchemy', 'flask-socketio': 'flask_socketio', 'flask-login': 'flask_login', 'flask-restful': 'flask_restful', 'flask-jwt-extended': 'flask_jwt_extended', 'python-socketio': 'socketio', pyjwt: 'jwt', 'firebase-admin': 'firebase_admin', 'requests-html': 'requests_html', 'sentence-transformers': 'sentence_transformers', 'llama-index': 'llama_index', 'langchain-openai': 'langchain_openai', 'python-multipart': 'multipart', uvicorn: 'uvicorn', gunicorn: null, pytest: null, jupyter: null, notebook: null, ipykernel: null, 'playwright': 'playwright', 'pydantic-settings': 'pydantic_settings', 'python-dateutil': 'dateutil', 'beautifulsoup': 'bs4', lxml: 'lxml', openpyxl: null, pyarrow: null, alembic: null }

function parseRequirements(text) {
  return text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter((l) => l && !l.startsWith('-')).map((l) => {
    const m = l.match(/^([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\s*([=<>!~]=?.*)?$/)
    return m ? { name: m[1].toLowerCase(), version: (m[3] || '').trim() } : null
  }).filter(Boolean)
}

function parsePyproject(text) {
  const deps = []
  const arr = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m)
  if (arr) for (const m of arr[1].matchAll(/["']([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\s*([^"']*)["']/g)) deps.push({ name: m[1].toLowerCase(), version: m[3].trim() })
  const poetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/)
  if (poetry) for (const m of poetry[1].matchAll(/^\s*([A-Za-z0-9_.\-]+)\s*=\s*["{]?([^\n"}]*)/gm)) if (m[1] !== 'python') deps.push({ name: m[1].toLowerCase(), version: m[2].trim() })
  return deps
}

function parseGradle(text) {
  const deps = []
  for (const m of text.matchAll(/\b(implementation|api|compileOnly|runtimeOnly|testImplementation|annotationProcessor|developmentOnly)\s*\(?\s*['"]([\w.\-]+):([\w.\-]+)(?::([\w.\-]+))?['"]/g)) deps.push({ name: m[3], group: m[2], version: m[4] || '', scope: m[1] })
  for (const m of text.matchAll(/id\s*\(?\s*['"]([\w.\-]+)['"]\s*\)?\s*version\s*['"]([\w.\-]+)['"]/g)) deps.push({ name: m[1], version: m[2], plugin: true })
  const jv = text.match(/(?:languageVersion\s*=\s*JavaLanguageVersion\.of\(|sourceCompatibility\s*=\s*['"]?(?:JavaVersion\.VERSION_)?)(\d+)/)
  return { deps, java: jv?.[1] }
}

function parsePom(text) {
  const deps = []
  for (const m of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const a = m[1].match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]
    const g = m[1].match(/<groupId>([^<]+)<\/groupId>/)?.[1]
    const v = m[1].match(/<version>([^<]+)<\/version>/)?.[1]
    if (a) deps.push({ name: a, group: g, version: v || '' })
  }
  const parent = text.match(/<parent>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>/)
  if (parent && /spring-boot/.test(parent[1])) deps.push({ name: 'org.springframework.boot', version: parent[2] })
  return { deps, java: text.match(/<java\.version>(\d+)/)?.[1] }
}

const envKeys = (text) => text.split('\n').map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1]).filter(Boolean)

export function analyzeStack({ files, texts, fileFacts, fileRoles }) {
  const manifests = []
  const techs = new Map()
  const addTech = (key, evidence, version) => {
    const k = KNOWN[key]
    if (k === null) return
    const [label, cat] = k || [key, 'Other libraries']
    const id = label
    if (!techs.has(id)) techs.set(id, { label, category: cat, versions: new Set(), evidence: new Set(), known: !!k, packages: new Set() })
    const t = techs.get(id)
    if (version) t.versions.add(String(version).replace(/^[\^~>=<\s]+/, ''))
    t.evidence.add(evidence)
    t.packages.add(key)
  }
  const parts = []
  const unusedDeps = []
  const ports = []
  let contextPath = ''

  // package usage from source files
  const usedPkgs = new Map() // pkg -> count
  for (const [, facts] of fileFacts) for (const p of facts.pkgs || []) usedPkgs.set(p, (usedPkgs.get(p) || 0) + 1)

  for (const f of files) {
    const base = P.basename(f.path)
    const dir = P.dirname(f.path) === '.' ? '' : P.dirname(f.path)
    const text = texts.get(f.path)
    if (text == null) continue
    if (base === 'package.json' && !f.path.includes('node_modules')) {
      let pj
      try { pj = JSON.parse(text) } catch { continue }
      const deps = pj.dependencies || {}
      const dev = pj.devDependencies || {}
      manifests.push({ path: f.path, kind: 'npm', name: pj.name, deps: Object.keys(deps).length, devDeps: Object.keys(dev).length })
      for (const [n, v] of Object.entries(deps)) addTech(n, f.path, v)
      for (const [n, v] of Object.entries(dev)) if (KNOWN[n]) addTech(n, f.path, v)
      const scripts = pj.scripts || {}
      const all = { ...deps, ...dev }
      const role = all.react || all.vue || all.svelte || all.next || all['@angular/core'] || all.vite ? (all.express || all.fastify || all['@nestjs/core'] || all.next ? 'full-stack' : 'frontend') : all.express || all.fastify || all.koa || all['@nestjs/core'] || all.hono ? 'backend' : 'node'
      parts.push({
        dir: dir || '.', kind: 'node', name: pj.name || dir || 'root', role,
        run: Object.entries(scripts).filter(([k]) => /^(dev|start|serve|build|test|preview)$|:dev$|^dev:/.test(k)).map(([k, v]) => ({ cmd: `npm run ${k}`, does: v })),
        scripts,
      })
      // declared but never imported
      const configText = files.filter((x) => x.path.startsWith(dir) && /config|rc/.test(x.path)).map((x) => texts.get(x.path) || '').join('\n')
      for (const n of Object.keys(deps)) {
        if (n.startsWith('@types/') || usedPkgs.has(n) || KNOWN[n] === null) continue
        if (configText.includes(n) || Object.values(scripts).some((s) => s.includes(n))) continue
        if (/^(react-dom|typescript|tailwindcss|postcss|autoprefixer|@tailwindcss\/|eslint|prettier|nodemon|vite|@vitejs\/)/.test(n)) continue
        unusedDeps.push({ name: n, manifest: f.path })
      }
      for (const s of Object.values(scripts)) {
        const pm = s.match(/(?:--port[ =]|PORT=|-p )(\d{2,5})/)
        if (pm) ports.push({ port: Number(pm[1]), source: `${f.path} scripts`, kind: 'dev' })
      }
      if (all.vite && !ports.some((p) => p.port === 5173)) ports.push({ port: 5173, source: 'Vite default', kind: 'frontend', guess: true })
      if (all.next) ports.push({ port: 3000, source: 'Next.js default', kind: 'full-stack', guess: true })
    } else if (/^requirements.*\.txt$/.test(base) || base === 'pyproject.toml' || base === 'Pipfile' || base === 'environment.yml') {
      const deps = base === 'pyproject.toml' ? parsePyproject(text) : base === 'Pipfile' ? parsePyproject('[tool.poetry.dependencies]\n' + (text.match(/\[packages\]([\s\S]*?)(\n\[|$)/)?.[1] || '')) : base === 'environment.yml' ? text.split('\n').map((l) => l.match(/^\s*-\s*([A-Za-z0-9_.\-]+)/)?.[1]).filter(Boolean).map((name) => ({ name: name.toLowerCase(), version: '' })) : parseRequirements(text)
      manifests.push({ path: f.path, kind: 'python', deps: deps.length })
      for (const d of deps) addTech(d.name, f.path, d.version)
      for (const d of deps) {
        const mod = d.name in PY_IMPORT_NAME ? PY_IMPORT_NAME[d.name] : d.name.replace(/-/g, '_')
        if (mod === null || usedPkgs.has(mod) || usedPkgs.has(d.name)) continue
        unusedDeps.push({ name: d.name, manifest: f.path })
      }
      if (!parts.some((p) => p.dir === (dir || '.') && p.kind === 'python')) parts.push({ dir: dir || '.', kind: 'python', name: dir || 'python', role: 'python', run: [{ cmd: `pip install -r ${base === 'pyproject.toml' ? '.' : base}`, does: 'install dependencies' }] })
    } else if (base === 'build.gradle' || base === 'build.gradle.kts' || base === 'pom.xml') {
      const { deps, java } = base === 'pom.xml' ? parsePom(text) : parseGradle(text)
      manifests.push({ path: f.path, kind: base === 'pom.xml' ? 'maven' : 'gradle', deps: deps.length, java })
      for (const d of deps) addTech(d.name, f.path, d.version)
      if (java) addTech('java', f.path, java)
      parts.push({ dir: dir || '.', kind: 'jvm', name: dir || 'java', role: 'backend', run: base === 'pom.xml' ? [{ cmd: './mvnw spring-boot:run', does: 'run the app' }] : [{ cmd: './gradlew bootRun', does: 'run the app' }, { cmd: './gradlew test', does: 'run tests' }] })
    } else if (base === 'go.mod') {
      manifests.push({ path: f.path, kind: 'go' })
      addTech('go', f.path)
    } else if (base === 'Cargo.toml') {
      manifests.push({ path: f.path, kind: 'cargo' })
    } else if (/^(docker-compose|compose)\.ya?ml$/.test(base)) {
      manifests.push({ path: f.path, kind: 'docker-compose' })
      for (const m of text.matchAll(/^\s*image:\s*["']?([\w./-]+)/gm)) {
        const img = m[1].split('/').pop()
        const known = { postgres: 'PostgreSQL', mysql: 'MySQL', mongo: 'MongoDB', redis: 'Redis', rabbitmq: 'RabbitMQ', elasticsearch: 'Elasticsearch', nginx: 'nginx', minio: 'MinIO' }[img.split(':')[0]]
        if (known) { techs.set(known, techs.get(known) || { label: known, category: C.db, versions: new Set(), evidence: new Set(), known: true, packages: new Set() }); techs.get(known).evidence.add(f.path) }
      }
      for (const m of text.matchAll(/["']?(\d{2,5}):(\d{2,5})["']?/g)) ports.push({ port: Number(m[1]), source: f.path, kind: 'docker' })
      parts.push({ dir: dir || '.', kind: 'docker', name: 'docker compose', role: 'infra', run: [{ cmd: 'docker compose up', does: 'start all services' }] })
    } else if (/^Dockerfile/.test(base)) {
      manifests.push({ path: f.path, kind: 'docker' })
      addTech('docker', f.path)
      const ex = text.match(/^\s*EXPOSE\s+(\d+)/m)
      if (ex) ports.push({ port: Number(ex[1]), source: f.path, kind: 'docker' })
    } else if (/^application(-\w+)?\.(properties|ya?ml)$/.test(base)) {
      const port = text.match(/server\.port\s*[=:]\s*(\d+)/)?.[1] || text.match(/^server:\s*\n(?:\s+.*\n)*?\s+port:\s*(\d+)/m)?.[1]
      if (port) ports.push({ port: Number(port), source: f.path, kind: 'backend' })
      const ctx = text.match(/server\.servlet\.context-path\s*[=:]\s*(\S+)/)?.[1] || text.match(/context-path:\s*(\S+)/)?.[1]
      if (ctx) contextPath = ctx.replace(/["']/g, '')
      if (/spring\.datasource\.url\s*[=:]\s*jdbc:(\w+)/.test(text) || /url:\s*jdbc:(\w+)/.test(text)) {
        const eng = (text.match(/jdbc:(\w+)/) || [])[1]
        if (eng) addTech({ postgresql: 'postgresql', mysql: 'mysql-connector-j', h2: 'h2', sqlite: 'sqlite-jdbc' }[eng] || eng, f.path)
      }
    } else if (/^(vercel\.json|netlify\.toml|fly\.toml|render\.yaml|Procfile|railway\.json|app\.yaml|firebase\.json|wrangler\.toml)$/.test(base)) {
      manifests.push({ path: f.path, kind: 'deploy' })
      addTech(base.replace(/\..*$/, '').replace(/^Procfile$/, 'heroku'), f.path)
    } else if (/^vite\.config/.test(base)) {
      const pm = text.match(/port\s*:\s*(\d{2,5})/)
      if (pm) ports.push({ port: Number(pm[1]), source: f.path, kind: 'frontend' })
    } else if (f.path.startsWith('.github/workflows/')) {
      manifests.push({ path: f.path, kind: 'ci' })
      addTech('github-actions', f.path)
    } else if (base === 'manifest.json' && /"manifest_version"/.test(text)) {
      manifests.push({ path: f.path, kind: 'browser-extension' })
      techs.set('Browser extension', { label: 'Browser extension', category: C.fe, versions: new Set([text.match(/"manifest_version"\s*:\s*(\d)/)?.[1] ? 'MV' + text.match(/"manifest_version"\s*:\s*(\d)/)[1] : '']), evidence: new Set([f.path]), known: true, packages: new Set() })
      parts.push({ dir: dir || '.', kind: 'extension', name: 'browser extension', role: 'frontend', run: [{ cmd: 'chrome://extensions → Load unpacked', does: `load ${dir || '.'}` }] })
    }
  }
  const OTHER_LABELS = { java: ['Java', C.be], docker: ['Docker', C.cloud], go: ['Go', C.be], vercel: ['Vercel', C.cloud], netlify: ['Netlify', C.cloud], fly: ['Fly.io', C.cloud], render: ['Render', C.cloud], heroku: ['Heroku', C.cloud], railway: ['Railway', C.cloud], firebase: ['Firebase Hosting', C.cloud], wrangler: ['Cloudflare Workers', C.cloud], 'github-actions': ['GitHub Actions CI', C.build], app: ['Google App Engine', C.cloud] }
  for (const [k, v] of Object.entries(OTHER_LABELS)) {
    if (techs.has(k)) {
      const t = techs.get(k)
      techs.delete(k)
      techs.set(v[0], { ...t, label: v[0], category: v[1], known: true })
    }
  }

  // imports with no manifest (common in vibecoded Python scripts)
  for (const [p, n] of usedPkgs) {
    const label = KNOWN[p] ?? KNOWN[Object.keys(PY_IMPORT_NAME).find((k) => PY_IMPORT_NAME[k] === p)]
    if (label && ![...techs.values()].some((t) => t.label === label[0])) {
      techs.set(label[0], { label: label[0], category: label[1], versions: new Set(), evidence: new Set([`imported in ${n} file(s), not declared in a manifest`]), known: true, packages: new Set([p]), undeclared: true })
    }
  }

  // Python entry scripts per part
  for (const [file, facts] of fileFacts) {
    if (facts.lang === 'python' && facts.functions.some((fn) => fn.qual === '<main>') && fileRoles.get(file) !== 'test') {
      const dir = P.dirname(file) === '.' ? '.' : P.dirname(file)
      let part = parts.find((p) => p.kind === 'python' && (dir === p.dir || dir.startsWith(p.dir + '/') || p.dir === '.'))
      if (!part) { part = { dir, kind: 'python', name: dir === '.' ? 'python' : dir, role: 'scripts', run: [] }; parts.push(part) }
      part.run.push({ cmd: `python ${file}`, does: facts.functions.find((fn) => fn.qual === '<main>') ? 'runs its __main__ block' : '' })
    }
    for (const p of facts.ports || []) ports.push({ port: p.port, source: `${file}:${p.line}`, kind: 'backend' })
  }

  // languages
  const langs = new Map()
  const otherLangs = new Map()
  for (const f of files) {
    if (!f.lang || f.binary) continue
    const bucket = CODE_LANGS.has(f.lang) ? langs : otherLangs
    const cur = bucket.get(f.lang) || { lang: f.lang, files: 0, loc: 0 }
    cur.files++
    cur.loc += f.loc || 0
    bucket.set(f.lang, cur)
  }

  // env vars: names only, values are never read into the model
  const envUse = new Map()
  for (const [file, facts] of fileFacts) for (const e of facts.env || []) {
    if (!envUse.has(e.name)) envUse.set(e.name, { name: e.name, uses: [], property: !!e.property })
    const u = envUse.get(e.name)
    if (u.uses.length < 12) u.uses.push({ file, line: e.line })
  }
  const documented = new Set()
  const definedIn = new Map()
  for (const f of files) {
    const base = P.basename(f.path)
    if (!/^\.env/.test(base) && !/^(application.*\.(properties|ya?ml)|README.*|docker-compose.*)$/i.test(base)) continue
    const text = texts.get(f.path) || ''
    if (/^\.env/.test(base)) {
      for (const k of envKeys(text)) {
        documented.add(k)
        if (!definedIn.has(k)) definedIn.set(k, [])
        definedIn.get(k).push(f.path)
      }
    } else for (const k of envUse.keys()) if (text.includes(k)) documented.add(k)
  }
  const env = [...envUse.values()].map((e) => ({ ...e, documented: documented.has(e.name), definedIn: definedIn.get(e.name) || [] })).sort((a, b) => a.name.localeCompare(b.name))

  const portSeen = new Set()
  const uniquePorts = ports.filter((p) => (portSeen.has(p.port) ? false : portSeen.add(p.port)))

  const techList = [...techs.values()].map((t) => ({ label: t.label, category: t.category, versions: [...t.versions].filter(Boolean), evidence: [...t.evidence].slice(0, 4), known: t.known, undeclared: !!t.undeclared, packages: [...t.packages] }))
  const ORDER = Object.values(C)
  techList.sort((a, b) => (ORDER.indexOf(a.category) === -1 ? 99 : ORDER.indexOf(a.category)) - (ORDER.indexOf(b.category) === -1 ? 99 : ORDER.indexOf(b.category)) || a.label.localeCompare(b.label))

  return {
    languages: [...langs.values()].sort((a, b) => b.loc - a.loc),
    otherFiles: [...otherLangs.values()].sort((a, b) => b.loc - a.loc),
    technologies: techList,
    manifests,
    parts: parts.sort((a, b) => a.dir.localeCompare(b.dir)),
    unusedDeps,
    ports: uniquePorts,
    env,
    contextPath,
  }
}

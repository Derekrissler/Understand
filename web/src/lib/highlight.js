// Syntax highlighting with Shiki (JS regex engine, so no WASM). Tokens are cached per file.
import { createHighlighter } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const THEME = 'github-dark-default'
const MAP = {
  javascript: 'javascript', typescript: 'typescript', python: 'python', notebook: 'python', java: 'java', kotlin: 'kotlin',
  html: 'html', css: 'css', scss: 'scss', less: 'less', json: 'json', yaml: 'yaml', toml: 'toml', xml: 'xml', markdown: 'markdown',
  vue: 'vue', svelte: 'svelte', astro: 'astro', sql: 'sql', shell: 'shellscript', powershell: 'powershell', batch: 'bat',
  go: 'go', rust: 'rust', ruby: 'ruby', php: 'php', csharp: 'csharp', swift: 'swift', c: 'c', cpp: 'cpp', dart: 'dart',
  dotenv: 'dotenv', properties: 'properties', docker: 'docker', gradle: 'groovy', groovy: 'groovy', scala: 'scala', lua: 'lua', r: 'r',
}

let hl
const cache = new Map()

export function shikiLang(lang, path = '') {
  if (/\.tsx$/.test(path)) return 'tsx'
  if (/\.jsx$/.test(path)) return 'jsx'
  return MAP[lang] || 'text'
}

/** Returns an array of lines; each line is an array of { content, color, fontStyle }. */
export async function tokenize(key, code, lang) {
  if (cache.has(key)) return cache.get(key)
  const job = (async () => {
    if (lang === 'text' || code.length > 1_500_000) return code.split('\n').map((l) => [{ content: l }])
    hl ||= createHighlighter({ themes: [THEME], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) })
    const h = await hl
    let use = lang
    if (!h.getLoadedLanguages().includes(use)) {
      try {
        await h.loadLanguage(use)
      } catch {
        use = 'text'
      }
    }
    if (use === 'text') return code.split('\n').map((l) => [{ content: l }])
    try {
      return h.codeToTokens(code, { lang: use, theme: THEME }).tokens
    } catch {
      return code.split('\n').map((l) => [{ content: l }])
    }
  })()
  cache.set(key, job)
  return job
}

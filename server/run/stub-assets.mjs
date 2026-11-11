// Node loader hooks: let frontend modules that import CSS, images or fonts load under Node
// by turning those imports into empty modules. Registered by register-stubs.mjs.
const ASSET = /\.(css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg|md|txt|html)(\?.*)?$/i

export async function resolve(specifier, context, next) {
  if (ASSET.test(specifier)) return { url: 'understand-stub:' + specifier, shortCircuit: true }
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.startsWith('understand-stub:')) {
    const name = url.slice('understand-stub:'.length)
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(name)}; export const __stub = true;` }
  }
  return next(url, context)
}

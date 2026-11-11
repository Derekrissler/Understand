#!/usr/bin/env python3
"""Structural fact extractor for Python files, used by Understand.

stdin:  JSON list of {"path": "<project-relative path>", "code": "<source>"}
stdout: JSON object {path: facts}

Only raw facts are emitted (imports, functions, calls with literal arguments,
assignments, decorators); classification into routes / operations happens in
server/analyze/python.js so all the rules live in one place.
Compatible with Python 3.8+.
"""
import ast
import json
import re
import sys


def text(n, depth=0):
    if n is None or depth > 10:
        return '?'
    if isinstance(n, ast.Name):
        return n.id
    if isinstance(n, ast.Attribute):
        return text(n.value, depth + 1) + '.' + n.attr
    if isinstance(n, ast.Call):
        return text(n.func, depth + 1) + '()'
    if isinstance(n, ast.Subscript):
        sl = n.slice
        if hasattr(ast, 'Index') and isinstance(sl, getattr(ast, 'Index')):  # py<3.9
            sl = sl.value
        if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
            return text(n.value, depth + 1) + '[' + repr(sl.value) + ']'
        return text(n.value, depth + 1) + '[]'
    if isinstance(n, ast.Constant):
        return repr(n.value)[:60]
    if isinstance(n, ast.Await):
        return text(n.value, depth + 1)
    try:
        return ast.unparse(n)[:80]
    except Exception:
        return '?'


def strval(n, consts, depth=0):
    """Best-effort string value; unknown parts become ${expr} placeholders."""
    if n is None or depth > 6:
        return None
    if isinstance(n, ast.Constant) and isinstance(n.value, str):
        return n.value
    if isinstance(n, ast.JoinedStr):
        out = ''
        for v in n.values:
            if isinstance(v, ast.Constant):
                out += str(v.value)
            elif isinstance(v, ast.FormattedValue):
                inner = strval(v.value, consts, depth + 1)
                out += inner if inner is not None else '${' + text(v.value) + '}'
        return out
    if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Add, ast.Div)):
        left = strval(n.left, consts, depth + 1)
        right = strval(n.right, consts, depth + 1)
        if left is None and right is None:
            return None
        left = left if left is not None else '${' + text(n.left) + '}'
        right = right if right is not None else '${' + text(n.right) + '}'
        return left + ('/' if isinstance(n.op, ast.Div) else '') + right
    if isinstance(n, ast.BinOp) and isinstance(n.op, ast.Mod):
        base = strval(n.left, consts, depth + 1)
        if base is not None:
            return re.sub(r'%[sdrif]', '${…}', base)
    if isinstance(n, ast.Name) and n.id in consts:
        return consts[n.id]
    if isinstance(n, ast.Attribute):
        t = text(n)
        if t in consts:
            return consts[t]
    if isinstance(n, ast.Call):
        fn = text(n.func)
        if fn.endswith('.format') and isinstance(n.func, ast.Attribute):
            base = strval(n.func.value, consts, depth + 1)
            if base is not None:
                return re.sub(r'\{[^}]*\}', '${…}', base)
        if fn in ('os.path.join', 'path.join', 'join', 'Path', 'pathlib.Path', 'os.path.abspath', 'str'):
            parts = [strval(a, consts, depth + 1) for a in n.args]
            if any(p is not None for p in parts):
                return '/'.join(p if p is not None else '${' + text(a) + '}' for p, a in zip(parts, n.args))
        if fn in ('os.getenv', 'os.environ.get') and len(n.args) > 1:
            return strval(n.args[1], consts, depth + 1)
    if isinstance(n, ast.IfExp):
        a = strval(n.body, consts, depth + 1)
        return a if a is not None else strval(n.orelse, consts, depth + 1)
    if isinstance(n, ast.BoolOp) and isinstance(n.op, ast.Or):
        for v in reversed(n.values):
            s = strval(v, consts, depth + 1)
            if s is not None:
                return s
    return None


def arginfo(a, consts):
    info = {'t': text(a)[:120]}
    s = strval(a, consts)
    if s is not None:
        info['s'] = s[:2000]
    if isinstance(a, ast.Constant) and isinstance(a.value, (int, float)) and not isinstance(a.value, bool):
        info['n'] = a.value
    if isinstance(a, (ast.List, ast.Tuple, ast.Set)):
        vals = [strval(e, consts) for e in a.elts]
        if vals and all(v is not None for v in vals):
            info['l'] = vals[:20]
    if isinstance(a, ast.Call) and a.args:
        inner = strval(a.args[0], consts)
        if inner is not None:
            info['inner'] = inner[:300]
    if isinstance(a, ast.Dict):
        keys = {}
        for k, v in zip(a.keys, a.values):
            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                sv = strval(v, consts)
                keys[k.value] = sv if sv is not None else '${' + text(v) + '}'
        info['d'] = keys
    return info


def params_of(args):
    out = []
    pos = list(getattr(args, 'posonlyargs', [])) + list(args.args)
    defaults = [None] * (len(pos) - len(args.defaults)) + list(args.defaults)
    for a, d in zip(pos, defaults):
        p = {'name': a.arg}
        if a.annotation is not None:
            p['type'] = text(a.annotation)
        if d is not None:
            p['default'] = text(d)
        out.append(p)
    if args.vararg:
        out.append({'name': args.vararg.arg, 'rest': True})
    for a, d in zip(args.kwonlyargs, args.kw_defaults):
        p = {'name': a.arg, 'kwonly': True}
        if a.annotation is not None:
            p['type'] = text(a.annotation)
        if d is not None:
            p['default'] = text(d)
        out.append(p)
    if args.kwarg:
        out.append({'name': args.kwarg.arg, 'kwargs': True})
    return out


def first_doc_line(node):
    try:
        d = ast.get_docstring(node)
    except Exception:
        return None
    if not d:
        return None
    para = d.strip().split('\n\n')[0]
    return ' '.join(para.split())[:240]


class Extractor(ast.NodeVisitor):
    def __init__(self, total_lines):
        self.consts = {}
        self.param_consts = [{}]
        self.fn = ['<module>']
        self.cls = []
        self.depth = 0
        self.facts = {
            'imports': [], 'calls': [], 'assigns': [], 'env': [], 'classes': [], 'consts': {}, 'fields': {},
            'functions': [{'name': '<module>', 'qual': '<module>', 'line': 1, 'endLine': total_lines, 'kind': 'module', 'params': []}],
        }

    def cc(self):
        """Constants visible here: module-level strings plus parameter defaults."""
        top = self.param_consts[-1]
        if not top:
            return self.consts
        merged = dict(self.consts)
        merged.update(top)
        return merged

    # ---- imports ----
    def visit_Import(self, n):
        for a in n.names:
            self.facts['imports'].append({'module': a.name, 'alias': a.asname, 'level': 0, 'names': None, 'line': n.lineno})

    def visit_ImportFrom(self, n):
        self.facts['imports'].append({
            'module': n.module or '', 'level': n.level or 0, 'line': n.lineno,
            'names': [{'name': a.name, 'alias': a.asname} for a in n.names],
        })

    # ---- definitions ----
    def deco(self, d):
        call = d if isinstance(d, ast.Call) else None
        target = d.func if call else d
        info = {'text': text(target), 'line': d.lineno}
        if call:
            info['args'] = [arginfo(a, self.consts) for a in call.args[:4]]
            info['kw'] = {k.arg: arginfo(k.value, self.consts) for k in call.keywords[:12] if k.arg}
        return info

    def visit_FunctionDef(self, n):
        self.func(n, False)

    def visit_AsyncFunctionDef(self, n):
        self.func(n, True)

    def func(self, n, is_async):
        record = self.depth == 0
        if record:
            qual = '.'.join(self.cls + [n.name]) if self.cls else n.name
            start = min([d.lineno for d in n.decorator_list] + [n.lineno])
            self.facts['functions'].append({
                'name': n.name, 'qual': qual, 'line': start, 'defLine': n.lineno, 'endLine': n.end_lineno,
                'kind': 'method' if self.cls else 'function', 'className': self.cls[-1] if self.cls else None,
                'params': params_of(n.args), 'decorators': [self.deco(d) for d in n.decorator_list],
                'async': is_async, 'doc': first_doc_line(n),
            })
            self.fn.append(qual)
        defaults = {}
        pos = list(getattr(n.args, 'posonlyargs', [])) + list(n.args.args)
        for a, d in zip(pos[len(pos) - len(n.args.defaults):], n.args.defaults):
            s = strval(d, self.cc())
            if s is not None:
                defaults[a.arg] = s
        for a, d in zip(n.args.kwonlyargs, n.args.kw_defaults):
            if d is not None:
                s = strval(d, self.cc())
                if s is not None:
                    defaults[a.arg] = s
        self.param_consts.append(dict(self.param_consts[-1], **defaults) if self.depth else defaults)
        self.depth += 1
        for st in n.body:
            self.visit(st)
        self.depth -= 1
        self.param_consts.pop()
        if record:
            self.fn.pop()

    def visit_ClassDef(self, n):
        if self.depth == 0 and not self.cls:
            self.facts['classes'].append({
                'name': n.name, 'line': n.lineno, 'endLine': n.end_lineno,
                'bases': [text(b) for b in n.bases], 'decorators': [self.deco(d) for d in n.decorator_list],
                'doc': first_doc_line(n),
            })
        if self.depth == 0:
            self.cls.append(n.name)
            for st in n.body:
                self.visit(st)
            self.cls.pop()
        else:
            for st in n.body:
                self.visit(st)

    def visit_If(self, n):
        t = n.test
        is_main = (
            self.depth == 0 and not self.cls and isinstance(t, ast.Compare)
            and isinstance(t.left, ast.Name) and t.left.id == '__name__'
            and len(t.comparators) == 1 and isinstance(t.comparators[0], ast.Constant)
            and t.comparators[0].value == '__main__'
        )
        if is_main:
            self.facts['functions'].append({
                'name': '__main__', 'qual': '<main>', 'line': n.lineno, 'endLine': n.end_lineno,
                'kind': 'main', 'params': [],
            })
            self.fn.append('<main>')
            for st in n.body:
                self.visit(st)
            self.fn.pop()
            for st in n.orelse:
                self.visit(st)
        else:
            self.generic_visit(n)

    # ---- calls & assignments ----
    def visit_Call(self, n):
        self.facts['calls'].append({
            'fn': self.fn[-1], 'text': text(n.func), 'line': n.lineno, 'nargs': len(n.args),
            'args': [arginfo(a, self.cc()) for a in n.args[:4]],
            'kw': {k.arg: arginfo(k.value, self.cc()) for k in n.keywords[:12] if k.arg},
        })
        fn = text(n.func)
        if fn in ('os.getenv', 'os.environ.get', 'getenv', 'config', 'env', 'environ.get') and n.args:
            s = strval(n.args[0], {})
            if s:
                self.facts['env'].append({'name': s, 'line': n.lineno})
        self.generic_visit(n)

    def add_fields(self, keys):
        if len(keys) < 1:
            return
        cur = self.facts['fields'].setdefault(self.fn[-1], [])
        for k in keys:
            if k not in cur and len(cur) < 30 and len(k) <= 40:
                cur.append(k)

    def visit_Dict(self, n):
        # record-shaped dict literals ({"title": ..., "price": ...}) tell us what a step produces
        if self.fn[-1] != '<module>' or self.depth == 0:
            keys = [k.value for k in n.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)]
            if len(keys) >= 2 and not set(keys) <= {'Content-Type', 'User-Agent', 'Authorization', 'Accept', 'headers', 'timeout', 'params'}:
                self.add_fields(keys)
        self.generic_visit(n)

    def visit_Subscript(self, n):
        if text(n.value) in ('os.environ', 'environ'):
            sl = n.slice
            if hasattr(ast, 'Index') and isinstance(sl, getattr(ast, 'Index')):
                sl = sl.value
            if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
                self.facts['env'].append({'name': sl.value, 'line': n.lineno})
        self.generic_visit(n)

    def record_assign(self, targets, value, line):
        tnames = [text(t) for t in targets]
        if isinstance(value, ast.Await):
            value = value.value
        if isinstance(value, ast.Call):
            self.facts['assigns'].append({
                'fn': self.fn[-1], 'cls': self.cls[-1] if self.cls else None, 'targets': tnames,
                'call': text(value.func), 'line': line,
                'args': [arginfo(a, self.cc()) for a in value.args[:3]],
                'kw': {k.arg: arginfo(k.value, self.cc()) for k in value.keywords[:12] if k.arg},
            })
        if self.depth >= 1:
            # strings built inside a function (url = BASE.format(...)) and attributes (p.output = ...)
            s = strval(value, self.cc())
            if s is not None:
                for t in targets:
                    if isinstance(t, ast.Name):
                        self.param_consts[-1][t.id] = s
                    elif isinstance(t, ast.Attribute):
                        self.consts[text(t)] = s
            return
        if self.depth == 0 and not self.cls:
            s = strval(value, self.consts)
            for t in targets:
                if isinstance(t, ast.Name):
                    if s is not None:
                        self.consts[t.id] = s
                        self.facts['consts'][t.id] = s[:500]
                    elif isinstance(value, ast.Constant) and isinstance(value.value, (int, float)):
                        self.facts['consts'][t.id] = value.value
        elif self.cls and self.depth == 0:
            s = strval(value, self.consts)
            for t in targets:
                if isinstance(t, ast.Name) and s is not None:
                    self.consts[self.cls[-1] + '.' + t.id] = s

    def visit_Assign(self, n):
        self.record_assign(n.targets, n.value, n.lineno)
        # df["price_num"] = ... adds a column
        for t in n.targets:
            if isinstance(t, ast.Subscript) and isinstance(t.ctx, ast.Store):
                sl = t.slice
                if hasattr(ast, 'Index') and isinstance(sl, getattr(ast, 'Index')):
                    sl = sl.value
                if isinstance(sl, ast.Constant) and isinstance(sl.value, str) and self.fn[-1] != '<module>':
                    self.add_fields([sl.value])
        self.generic_visit(n)

    def visit_AnnAssign(self, n):
        if n.value is not None:
            self.record_assign([n.target], n.value, n.lineno)
        self.generic_visit(n)

    def visit_With(self, n):
        for item in n.items:
            if item.optional_vars is not None and isinstance(item.context_expr, ast.Call):
                self.record_assign([item.optional_vars], item.context_expr, n.lineno)
        self.generic_visit(n)

    visit_AsyncWith = visit_With


DEF_RE = re.compile(r'^(\s*)(async\s+)?def\s+(\w+)\s*\(', re.M)


def fallback(code):
    """Regex fallback when the file does not parse (e.g. newer syntax than this interpreter)."""
    fns = [{'name': '<module>', 'qual': '<module>', 'line': 1, 'endLine': code.count('\n') + 1, 'kind': 'module', 'params': []}]
    for m in DEF_RE.finditer(code):
        if m.group(1) == '':
            line = code.count('\n', 0, m.start()) + 1
            fns.append({'name': m.group(3), 'qual': m.group(3), 'line': line, 'endLine': line, 'kind': 'function', 'params': []})
    imports = []
    for m in re.finditer(r'^(?:from\s+([\w.]+)\s+import\s+([\w, ]+)|import\s+([\w.]+))', code, re.M):
        line = code.count('\n', 0, m.start()) + 1
        if m.group(1):
            imports.append({'module': m.group(1), 'level': 0, 'names': [{'name': x.strip(), 'alias': None} for x in m.group(2).split(',') if x.strip()], 'line': line})
        else:
            imports.append({'module': m.group(3), 'alias': None, 'level': 0, 'names': None, 'line': line})
    return {'imports': imports, 'functions': fns, 'calls': [], 'assigns': [], 'env': [], 'classes': [], 'consts': {}}


def extract(code):
    total = code.count('\n') + 1
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        facts = fallback(code)
        facts['error'] = 'SyntaxError line %s: %s' % (e.lineno, e.msg)
        return facts
    x = Extractor(total)
    x.visit(tree)
    return x.facts


def main():
    items = json.load(sys.stdin)
    out = {}
    for it in items:
        try:
            out[it['path']] = extract(it['code'])
        except RecursionError:
            out[it['path']] = fallback(it['code'])
            out[it['path']]['error'] = 'file too deeply nested to parse'
        except Exception as e:  # never let one file sink the batch
            out[it['path']] = fallback(it['code'])
            out[it['path']]['error'] = repr(e)[:200]
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    sys.setrecursionlimit(5000)
    main()

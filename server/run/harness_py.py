"""Understand's Python harness: import a project module, call one function, record the result.

Usage: python harness_py.py job.json
The job names the file, the function (qualified name), JSON arguments and where to
write the result. Everything the function prints goes to stdout as usual.
"""
import asyncio
import datetime
import decimal
import enum
import importlib
import importlib.util
import inspect
import itertools
import json
import math
import os
import runpy
import sys
import time
import traceback
import uuid

MAX_ITEMS = 50000


def ser(v, depth=0, seen=None):
    if seen is None:
        seen = set()
    if depth > 40:
        return '[too deep]'
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):
        return v if abs(v) < 2 ** 53 else str(v)
    if isinstance(v, float):
        if math.isnan(v):
            return None
        if math.isinf(v):
            return 'Infinity' if v > 0 else '-Infinity'
        return v
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (uuid.UUID,)) or type(v).__name__ in ('PosixPath', 'WindowsPath', 'PurePosixPath'):
        return str(v)
    if isinstance(v, enum.Enum):
        return ser(v.value, depth + 1, seen)
    if isinstance(v, (bytes, bytearray)):
        return {'__type': 'Bytes', 'length': len(v), 'preview': bytes(v[:400]).decode('utf-8', 'replace')}
    oid = id(v)
    if oid in seen:
        return '[circular]'
    tname = type(v).__name__
    mod = type(v).__module__ or ''
    # pandas / numpy
    if mod.startswith('pandas') and tname == 'DataFrame':
        df = v.head(MAX_ITEMS)
        records = [{str(k): ser(x, depth + 2, seen) for k, x in row.items()} for row in df.to_dict('records')]
        return {'__type': 'DataFrame', 'shape': list(v.shape), 'columns': [str(c) for c in v.columns],
                'dtypes': {str(c): str(t) for c, t in v.dtypes.items()}, 'records': records}
    if mod.startswith('pandas') and tname == 'Series':
        return {'__type': 'Series', 'name': ser(v.name), 'length': len(v), 'dtype': str(v.dtype),
                'records': [{'index': ser(i, depth + 2, seen), 'value': ser(x, depth + 2, seen)} for i, x in itertools.islice(v.items(), MAX_ITEMS)]}
    if mod.startswith('polars') and tname == 'DataFrame':
        return {'__type': 'DataFrame', 'shape': list(v.shape), 'columns': list(v.columns),
                'records': [{k: ser(x, depth + 2, seen) for k, x in r.items()} for r in v.head(MAX_ITEMS).to_dicts()]}
    if mod.startswith('numpy'):
        if hasattr(v, 'tolist'):
            return ser(v.tolist(), depth + 1, seen)
    if tname in ('Tag', 'BeautifulSoup') and mod.startswith('bs4'):
        html = str(v)
        return {'__type': 'HTML', 'tag': getattr(v, 'name', None), 'text': v.get_text(' ', strip=True)[:3000], 'html': html[:3000], 'length': len(html)}
    if tname == 'ResultSet' and mod.startswith('bs4'):
        return [ser(x, depth + 1, seen) for x in list(v)[:2000]]
    if tname == 'Response' and hasattr(v, 'status_code'):
        body = None
        try:
            body = v.json()
        except Exception:
            body = getattr(v, 'text', '')[:20000]
        return {'__type': 'Response', 'status': v.status_code, 'url': str(getattr(v, 'url', '')), 'headers': dict(getattr(v, 'headers', {}) or {}), 'body': ser(body, depth + 1, seen)}
    seen.add(oid)
    try:
        if isinstance(v, dict):
            return {str(k): ser(x, depth + 1, seen) for k, x in itertools.islice(v.items(), MAX_ITEMS)}
        if isinstance(v, (list, tuple, set, frozenset)):
            items = list(itertools.islice(iter(v), MAX_ITEMS + 1))
            out = [ser(x, depth + 1, seen) for x in items[:MAX_ITEMS]]
            if len(items) > MAX_ITEMS:
                out.append({'__truncated': 'items', 'shown': MAX_ITEMS})
            return out
        if hasattr(v, 'model_dump'):
            return ser(v.model_dump(), depth + 1, seen)
        if hasattr(v, '_asdict'):
            return ser(v._asdict(), depth + 1, seen)
        if hasattr(v, '__dataclass_fields__'):
            import dataclasses
            return ser(dataclasses.asdict(v), depth + 1, seen)
        if inspect.isfunction(v) or inspect.ismethod(v) or inspect.isclass(v):
            return '[%s %s]' % ('class' if inspect.isclass(v) else 'function', getattr(v, '__qualname__', '?'))
        if hasattr(v, '__dict__') and vars(v):
            d = {k: ser(x, depth + 1, seen) for k, x in vars(v).items() if not k.startswith('_')}
            d['__class'] = tname
            return d
        return repr(v)[:2000]
    finally:
        seen.discard(oid)


def revive(v, depth=0):
    """Turn a DataFrame we sent to the browser back into a DataFrame when piping steps together."""
    if depth > 6:
        return v
    if isinstance(v, dict):
        if v.get('__type') == 'DataFrame' and isinstance(v.get('records'), list):
            try:
                import pandas as pd
                return pd.DataFrame(v['records'], columns=v.get('columns') or None)
            except ImportError:
                return v['records']
        if v.get('__type') == 'Series' and isinstance(v.get('records'), list):
            try:
                import pandas as pd
                return pd.Series([r.get('value') for r in v['records']], index=[r.get('index') for r in v['records']], name=v.get('name'))
            except ImportError:
                return [r.get('value') for r in v['records']]
        return {k: revive(x, depth + 1) for k, x in v.items()}
    if isinstance(v, list):
        return [revive(x, depth + 1) for x in v]
    return v


def load_module(file, root):
    d = os.path.dirname(file)
    base = os.path.splitext(os.path.basename(file))[0]
    has_init = os.path.exists(os.path.join(d, '__init__.py'))
    names = []
    rel = os.path.relpath(os.path.splitext(file)[0], root)
    dotted = rel.replace(os.sep, '.')
    if has_init and all(p.isidentifier() for p in dotted.split('.')):
        names.append(dotted)
    if base.isidentifier():
        names.append(base)
    for name in names:
        try:
            mod = importlib.import_module(name)
            if os.path.abspath(getattr(mod, '__file__', '') or '') == os.path.abspath(file):
                return mod
        except ModuleNotFoundError as e:
            if e.name and (e.name == name or name.startswith(e.name + '.')):
                continue
            raise
    spec = importlib.util.spec_from_file_location('_understand_target', file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules['_understand_target'] = mod
    spec.loader.exec_module(mod)
    return mod


def resolve(mod, qual):
    parts = qual.split('.')
    if len(parts) == 1:
        return getattr(mod, parts[0])
    owner = getattr(mod, parts[0])
    for p in parts[1:-1]:
        owner = getattr(owner, p)
    name = parts[-1]
    if inspect.isclass(owner):
        raw = inspect.getattr_static(owner, name)
        if isinstance(raw, (staticmethod, classmethod)):
            return getattr(owner, name)
        try:
            instance = owner()
        except TypeError as e:
            raise TypeError('%s.%s is an instance method and %s() needs constructor arguments (%s). '
                            'Run a function that creates the object instead.' % (owner.__name__, name, owner.__name__, e))
        return getattr(instance, name)
    return getattr(owner, name)


async def drain_async_gen(agen, limit=10000):
    out = []
    async for x in agen:
        out.append(x)
        if len(out) >= limit:
            break
    return out


def main():
    with open(sys.argv[1], encoding='utf-8') as f:
        job = json.load(f)
    root = os.path.abspath(job['root'])
    file = os.path.abspath(job['file'])
    d = os.path.dirname(file)
    chain = []
    while True:
        chain.append(d)
        if d == root or os.path.dirname(d) == d or not d.startswith(root):
            break
        d = os.path.dirname(d)
    for p in reversed(chain):
        if p not in sys.path:
            sys.path.insert(0, p)
    os.chdir(job.get('cwd') or root)
    result = {}
    t0 = time.perf_counter()
    try:
        if job['mode'] == 'script':
            sys.argv = [file] + list(job.get('argv') or [])
            runpy.run_path(file, run_name='__main__')
            value = None
        else:
            mod = load_module(file, root)
            target = resolve(mod, job['qual'])
            args = [revive(a) for a in job.get('args') or []]
            kwargs = {k: revive(v) for k, v in (job.get('kwargs') or {}).items()}
            t0 = time.perf_counter()
            value = target(*args, **kwargs)
            if inspect.iscoroutine(value):
                value = asyncio.run(value)
            elif inspect.isasyncgen(value):
                value = asyncio.run(drain_async_gen(value))
            elif inspect.isgenerator(value) or type(value).__name__ in ('map', 'filter', 'zip'):
                value = list(itertools.islice(value, MAX_ITEMS))
        result = {'ok': True, 'value': ser(value), 'type': type(value).__name__ if value is not None else 'None'}
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        result = {'ok': code == 0, 'value': None, 'type': 'None', 'exitCode': code}
    except BaseException as e:  # noqa: BLE001 - report everything back to the UI
        result = {'ok': False, 'error': {'type': type(e).__name__, 'message': str(e), 'traceback': traceback.format_exc()}}
    result['durationMs'] = (time.perf_counter() - t0) * 1000
    result['python'] = sys.version.split()[0]
    sys.stdout.flush()
    with open(job['out'], 'w', encoding='utf-8') as f:
        json.dump(result, f, default=lambda o: repr(o)[:500])


if __name__ == '__main__':
    main()

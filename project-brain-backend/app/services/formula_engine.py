"""Formula engine — safe expression evaluator for the Matrix platform (spec §5.3).

No eval()/exec(): a small recursive-descent parser over a fixed grammar.

Used for three layers, all pure configuration:
  · derived record fields   (e.g. applicable_completion, delay_days)
  · formula measures        (e.g. exp_fy / be * 100  → budget utilisation %)
  · calculated report rows  (cell('ongoing','cost') - cell('newproj','cost'))

Grammar
  expr    := or
  or      := and ( OR and )*
  and     := not ( AND not )*
  not     := NOT not | cmp
  cmp     := add ( (= | == | != | < | <= | > | >=) add )?
  add     := mul ( (+ | -) mul )*
  mul     := unary ( (* | /) unary )*
  unary   := - unary | primary
  primary := NUMBER | STRING | null | true | false | IDENT
           | IDENT '(' args ')' | '(' expr ')'

Functions: coalesce, if, min, max, abs, round, days_between, cell (injected).
Null semantics: arithmetic with null → null; comparisons with null → false
(except = / != which compare against null literally); coalesce picks the
first non-null; if(null, a, b) → b. Division by zero → null (guarded, spec-safe).
Identifiers resolve from the caller-supplied context (record fields, measure
values, period tokens). Unknown identifier or function → FormulaError.
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any, Callable, Optional


class FormulaError(ValueError):
    pass


_TOKEN_RE = re.compile(r"""
    \s*(?:
      (?P<num>\d+(?:\.\d+)?)
    | (?P<str>'[^']*'|"[^"]*")
    | (?P<op><=|>=|==|!=|=|<|>|\+|-|\*|/|\(|\)|,)
    | (?P<ident>[A-Za-z_][A-Za-z0-9_]*)
    )""", re.VERBOSE)


def _tokenize(src: str) -> list[tuple[str, str]]:
    out, pos = [], 0
    while pos < len(src):
        m = _TOKEN_RE.match(src, pos)
        if not m or m.end() == pos:
            rest = src[pos:].strip()
            if not rest:
                break
            raise FormulaError(f"Unexpected character at: '{rest[:20]}'")
        pos = m.end()
        if m.group("num") is not None:
            out.append(("num", m.group("num")))
        elif m.group("str") is not None:
            out.append(("str", m.group("str")[1:-1]))
        elif m.group("op") is not None:
            out.append(("op", m.group("op")))
        else:
            ident = m.group("ident")
            low = ident.lower()
            if low in ("and", "or", "not", "null", "true", "false"):
                out.append(("kw", low))
            else:
                out.append(("ident", ident))
    out.append(("eof", ""))
    return out


def _coerce_date(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return v
    return v


class _Parser:
    """Parses to a closure tree — parse once, evaluate per record cheaply."""

    def __init__(self, tokens: list[tuple[str, str]], functions: set[str]):
        self.toks = tokens
        self.i = 0
        self.functions = functions

    def peek(self):
        return self.toks[self.i]

    def eat(self, kind: str, val: Optional[str] = None):
        k, v = self.toks[self.i]
        if k != kind or (val is not None and v != val):
            raise FormulaError(f"Expected {val or kind}, got '{v or k}'")
        self.i += 1
        return v

    # each rule returns fn(ctx) -> value
    def parse(self) -> Callable[[dict], Any]:
        node = self.expr()
        if self.peek()[0] != "eof":
            raise FormulaError(f"Unexpected trailing input: '{self.peek()[1]}'")
        return node

    def expr(self):
        return self.or_()

    def or_(self):
        left = self.and_()
        while self.peek() == ("kw", "or"):
            self.eat("kw", "or")
            right = self.and_()
            left = (lambda l, r: lambda c: bool(l(c)) or bool(r(c)))(left, right)
        return left

    def and_(self):
        left = self.not_()
        while self.peek() == ("kw", "and"):
            self.eat("kw", "and")
            right = self.not_()
            left = (lambda l, r: lambda c: bool(l(c)) and bool(r(c)))(left, right)
        return left

    def not_(self):
        if self.peek() == ("kw", "not"):
            self.eat("kw", "not")
            inner = self.not_()
            return lambda c: not bool(inner(c))
        return self.cmp()

    def cmp(self):
        left = self.add()
        k, v = self.peek()
        if k == "op" and v in ("=", "==", "!=", "<", "<=", ">", ">="):
            self.eat("op", v)
            right = self.add()

            def do(l, r, op):
                def run(c):
                    a, b = l(c), r(c)
                    if op in ("=", "=="):
                        return _coerce_date(a) == _coerce_date(b)
                    if op == "!=":
                        return _coerce_date(a) != _coerce_date(b)
                    if a is None or b is None:
                        return False
                    a, b = _coerce_date(a), _coerce_date(b)
                    if op == "<":
                        return a < b
                    if op == "<=":
                        return a <= b
                    if op == ">":
                        return a > b
                    return a >= b
                return run
            return do(left, right, v)
        return left

    def add(self):
        left = self.mul()
        while self.peek()[0] == "op" and self.peek()[1] in ("+", "-"):
            op = self.eat("op")
            right = self.mul()

            def do(l, r, op):
                def run(c):
                    a, b = l(c), r(c)
                    if a is None or b is None:
                        return None
                    return a + b if op == "+" else a - b
                return run
            left = do(left, right, op)
        return left

    def mul(self):
        left = self.unary()
        while self.peek()[0] == "op" and self.peek()[1] in ("*", "/"):
            op = self.eat("op")
            right = self.unary()

            def do(l, r, op):
                def run(c):
                    a, b = l(c), r(c)
                    if a is None or b is None:
                        return None
                    if op == "*":
                        return a * b
                    return None if b == 0 else a / b  # guarded denominator
                return run
            left = do(left, right, op)
        return left

    def unary(self):
        if self.peek() == ("op", "-"):
            self.eat("op", "-")
            inner = self.unary()
            return lambda c: (None if inner(c) is None else -inner(c))
        return self.primary()

    def primary(self):
        k, v = self.peek()
        if k == "num":
            self.eat("num")
            num = float(v)
            return lambda c: num
        if k == "str":
            self.eat("str")
            s = v
            return lambda c: s
        if k == "kw" and v in ("null", "true", "false"):
            self.eat("kw")
            lit = {"null": None, "true": True, "false": False}[v]
            return lambda c: lit
        if k == "op" and v == "(":
            self.eat("op", "(")
            inner = self.expr()
            self.eat("op", ")")
            return inner
        if k == "ident":
            name = self.eat("ident")
            if self.peek() == ("op", "("):
                self.eat("op", "(")
                args = []
                if self.peek() != ("op", ")"):
                    args.append(self.expr())
                    while self.peek() == ("op", ","):
                        self.eat("op", ",")
                        args.append(self.expr())
                self.eat("op", ")")
                if name.lower() not in self.functions:
                    raise FormulaError(f"Unknown function '{name}'")
                return self._call(name.lower(), args)

            def lookup(c, name=name):
                if name not in c:
                    raise FormulaError(f"Unknown identifier '{name}'")
                return c[name]
            return lookup
        raise FormulaError(f"Unexpected token '{v or k}'")

    def _call(self, name: str, args: list):
        def run(c):
            if name == "coalesce":
                for a in args:
                    v = a(c)
                    if v is not None:
                        return v
                return None
            if name == "if":
                if len(args) != 3:
                    raise FormulaError("if() takes exactly 3 arguments")
                return args[1](c) if bool(args[0](c)) else args[2](c)
            vals = [a(c) for a in args]
            if name == "days_between":
                d1, d2 = _coerce_date(vals[0]), _coerce_date(vals[1])
                if d1 is None or d2 is None:
                    return None
                return float((d2 - d1).days)
            if name == "min":
                nn = [v for v in vals if v is not None]
                return min(nn) if nn else None
            if name == "max":
                nn = [v for v in vals if v is not None]
                return max(nn) if nn else None
            if name == "abs":
                return None if vals[0] is None else abs(vals[0])
            if name == "round":
                if vals[0] is None:
                    return None
                nd = int(vals[1]) if len(vals) > 1 and vals[1] is not None else 0
                return round(vals[0], nd)
            if name == "cell":
                fn = c.get("__cell__")
                if fn is None:
                    raise FormulaError("cell() not available in this context")
                return fn(str(vals[0]), str(vals[1]))
            raise FormulaError(f"Unknown function '{name}'")
        return run


_BASE_FUNCTIONS = {"coalesce", "if", "min", "max", "abs", "round",
                   "days_between", "cell"}
_cache: dict[str, Callable[[dict], Any]] = {}


def compile_formula(src: str) -> Callable[[dict], Any]:
    """Parse once (cached); returns fn(context) -> value. Raises FormulaError."""
    if not isinstance(src, str) or not src.strip():
        raise FormulaError("Empty formula")
    fn = _cache.get(src)
    if fn is None:
        fn = _Parser(_tokenize(src), _BASE_FUNCTIONS).parse()
        _cache[src] = fn
    return fn


def evaluate(src: str, context: dict) -> Any:
    return compile_formula(src)(context)


def validate_formula(src: str, sample_context: dict) -> Optional[str]:
    """Spec §5.3 — validate before saving. Returns error message or None."""
    try:
        evaluate(src, sample_context)
        return None
    except FormulaError as e:
        return str(e)
    except Exception as e:  # arithmetic on wrong types etc.
        return f"Evaluation error: {e}"


def identifiers(src: str) -> set[str]:
    """Bare identifiers referenced by a formula (excludes function calls)."""
    toks = _tokenize(src)
    out = set()
    for i, (k, v) in enumerate(toks):
        if k == "ident" and not (i + 1 < len(toks) and toks[i + 1] == ("op", "(")):
            out.add(v)
    return out


def median(values: list[float]) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0

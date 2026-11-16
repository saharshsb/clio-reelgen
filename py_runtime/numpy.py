"""Lightweight pure-Python NumPy compatibility layer for Manim scene scripts."""
import math
import random as _random

pi = math.pi
e = math.e
inf = float("inf")
nan = float("nan")


class ndarray(list):
    """1D/ND numeric vector/array supporting elementwise arithmetic."""

    def __init__(self, data):
        if isinstance(data, ndarray):
            super().__init__(list(data))
        elif isinstance(data, (list, tuple)):
            converted = []
            for item in data:
                if isinstance(item, (list, tuple, ndarray)):
                    converted.append(ndarray(item))
                else:
                    converted.append(float(item))
            super().__init__(converted)
        else:
            super().__init__([float(data)])

    def copy(self):
        return ndarray([x.copy() if isinstance(x, ndarray) else x for x in self])

    def tolist(self):
        return [x.tolist() if isinstance(x, ndarray) else x for x in self]

    @property
    def shape(self):
        if len(self) == 0:
            return (0,)
        if isinstance(self[0], ndarray):
            return (len(self),) + self[0].shape
        return (len(self),)

    def _binop(self, other, op):
        if isinstance(other, (list, tuple, ndarray)):
            other_arr = other if isinstance(other, ndarray) else ndarray(other)
            if len(self) != len(other_arr):
                raise ValueError(f"Shape mismatch: {len(self)} vs {len(other_arr)}")
            return ndarray([op(a, b) for a, b in zip(self, other_arr)])
        return ndarray([op(a, other) for a in self])

    def _rbinop(self, other, op):
        if isinstance(other, (list, tuple, ndarray)):
            other_arr = other if isinstance(other, ndarray) else ndarray(other)
            return ndarray([op(a, b) for a, b in zip(other_arr, self)])
        return ndarray([op(other, a) for a in self])

    def __add__(self, other):
        return self._binop(other, lambda a, b: a + b)

    def __radd__(self, other):
        return self._rbinop(other, lambda a, b: a + b)

    def __sub__(self, other):
        return self._binop(other, lambda a, b: a - b)

    def __rsub__(self, other):
        return self._rbinop(other, lambda a, b: a - b)

    def __mul__(self, other):
        return self._binop(other, lambda a, b: a * b)

    def __rmul__(self, other):
        return self._rbinop(other, lambda a, b: a * b)

    def __truediv__(self, other):
        return self._binop(other, lambda a, b: a / b)

    def __rtruediv__(self, other):
        return self._rbinop(other, lambda a, b: a / b)

    def __pow__(self, other):
        return self._binop(other, lambda a, b: a ** b)

    def __neg__(self):
        return ndarray([-a for a in self])

    def __pos__(self):
        return self.copy()


def array(obj, dtype=None):
    return ndarray(obj)


def asarray(obj, dtype=None):
    return obj if isinstance(obj, ndarray) else ndarray(obj)


def zeros(shape):
    if isinstance(shape, int):
        return ndarray([0.0] * shape)
    if len(shape) == 1:
        return ndarray([0.0] * shape[0])
    return ndarray([zeros(shape[1:]) for _ in range(shape[0])])


def ones(shape):
    if isinstance(shape, int):
        return ndarray([1.0] * shape)
    if len(shape) == 1:
        return ndarray([1.0] * shape[0])
    return ndarray([ones(shape[1:]) for _ in range(shape[0])])


def linspace(start, stop, num=50):
    num = int(num)
    if num <= 0:
        return ndarray([])
    if num == 1:
        return ndarray([float(start)])
    step = (stop - start) / (num - 1)
    return ndarray([start + i * step for i in range(num)])


def arange(start, stop=None, step=1):
    if stop is None:
        stop = start
        start = 0
    vals = []
    cur = float(start)
    if step > 0:
        while cur < stop - 1e-12:
            vals.append(cur)
            cur += step
    elif step < 0:
        while cur > stop + 1e-12:
            vals.append(cur)
            cur += step
    return ndarray(vals)


def _apply_unary(x, fn):
    if isinstance(x, (list, tuple, ndarray)):
        return ndarray([_apply_unary(v, fn) for v in x])
    return fn(float(x))


def sin(x):
    return _apply_unary(x, math.sin)


def cos(x):
    return _apply_unary(x, math.cos)


def tan(x):
    return _apply_unary(x, math.tan)


def arcsin(x):
    return _apply_unary(x, math.asin)


def arccos(x):
    return _apply_unary(x, math.acos)


def arctan(x):
    return _apply_unary(x, math.atan)


def arctan2(y, x):
    if isinstance(y, (list, tuple, ndarray)):
        return ndarray([arctan2(a, b) for a, b in zip(y, x)])
    return math.atan2(y, x)


def sqrt(x):
    return _apply_unary(x, math.sqrt)


def exp(x):
    return _apply_unary(x, math.exp)


def log(x):
    return _apply_unary(x, math.log)


def log10(x):
    return _apply_unary(x, math.log10)


def abs(x):  # noqa: A001
    return _apply_unary(x, builtins_abs)


builtins_abs = __builtins__["abs"] if isinstance(__builtins__, dict) else getattr(__builtins__, "abs")


def floor(x):
    return _apply_unary(x, math.floor)


def ceil(x):
    return _apply_unary(x, math.ceil)


def round(x, decimals=0):  # noqa: A001
    return _apply_unary(x, lambda v: builtins_round(v, decimals))


builtins_round = __builtins__["round"] if isinstance(__builtins__, dict) else getattr(__builtins__, "round")


def deg2rad(x):
    return _apply_unary(x, math.radians)


def rad2deg(x):
    return _apply_unary(x, math.degrees)


def clip(x, a_min, a_max):
    return _apply_unary(x, lambda v: max(a_min, min(a_max, v)))


def interp(x, xp, fp):
    if isinstance(x, (list, tuple, ndarray)):
        return ndarray([interp(v, xp, fp) for v in x])
    if x <= xp[0]:
        return float(fp[0])
    if x >= xp[-1]:
        return float(fp[-1])
    for i in range(len(xp) - 1):
        if xp[i] <= x <= xp[i + 1]:
            t = (x - xp[i]) / max(1e-12, xp[i + 1] - xp[i])
            return float(fp[i] + t * (fp[i + 1] - fp[i]))
    return float(fp[-1])


def dot(a, b):
    a_arr = asarray(a)
    b_arr = asarray(b)
    return sum(x * y for x, y in zip(a_arr, b_arr))


def cross(a, b):
    a_arr = asarray(a)
    b_arr = asarray(b)
    return ndarray([
        a_arr[1] * b_arr[2] - a_arr[2] * b_arr[1],
        a_arr[2] * b_arr[0] - a_arr[0] * b_arr[2],
        a_arr[0] * b_arr[1] - a_arr[1] * b_arr[0],
    ])


def sum_arr(a):
    return sum(a)


class _Linalg:
    @staticmethod
    def norm(x):
        arr = asarray(x)
        return math.sqrt(sum(v * v for v in arr))


linalg = _Linalg()


class _Random:
    @staticmethod
    def seed(s):
        _random.seed(s)

    @staticmethod
    def uniform(low=0.0, high=1.0, size=None):
        if size is None:
            return _random.uniform(low, high)
        return ndarray([_random.uniform(low, high) for _ in range(size)])

    @staticmethod
    def normal(loc=0.0, scale=1.0, size=None):
        if size is None:
            return _random.gauss(loc, scale)
        return ndarray([_random.gauss(loc, scale) for _ in range(size)])


random = _Random()

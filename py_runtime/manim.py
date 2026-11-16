"""Manim Community v0.18+ compatible Python Scene Runtime & Timeline Serializer."""
from __future__ import annotations

import copy
import math
import re
from typing import Any, Callable, Iterable, Optional, Sequence
import numpy as np

# ---------------------------------------------------------------------------
# Constants & Vectors
# ---------------------------------------------------------------------------
PI = math.pi
TAU = 2 * math.pi
DEGREES = PI / 180.0
RADIANS = 1.0

ORIGIN = np.array([0.0, 0.0, 0.0])
UP = np.array([0.0, 1.0, 0.0])
DOWN = np.array([0.0, -1.0, 0.0])
LEFT = np.array([-1.0, 0.0, 0.0])
RIGHT = np.array([1.0, 0.0, 0.0])
IN = np.array([0.0, 0.0, -1.0])
OUT = np.array([0.0, 0.0, 1.0])
UL = np.array([-1.0, 1.0, 0.0])
UR = np.array([1.0, 1.0, 0.0])
DL = np.array([-1.0, -1.0, 0.0])
DR = np.array([1.0, -1.0, 0.0])

SMALL_BUFF = 0.1
MED_SMALL_BUFF = 0.25
MED_LARGE_BUFF = 0.5
LARGE_BUFF = 1.0
DEFAULT_MOBJECT_TO_EDGE_BUFFER = 0.5
DEFAULT_MOBJECT_TO_MOBJECT_BUFFER = 0.25

BOLD = "BOLD"
NORMAL = "NORMAL"
ITALIC = "ITALIC"

# ---------------------------------------------------------------------------
# Color Palette (Manim v0.18 standard hex colors)
# ---------------------------------------------------------------------------
WHITE = "#FFFFFF"
BLACK = "#000000"
GRAY_A = "#DDDDDD"
GRAY_B = "#BBBBBB"
GRAY_C = "#888888"
GRAY_D = "#444444"
GRAY_E = "#222222"
GRAY = GRAY_C
GREY = GRAY_C
LIGHT_GRAY = GRAY_A
LIGHT_GREY = GRAY_A
DARK_GRAY = GRAY_D
DARK_GREY = GRAY_D
DARKER_GRAY = GRAY_E
DARKER_GREY = GRAY_E
GREY_BROWN = "#736357"
DARK_BROWN = "#8B4513"
LIGHT_BROWN = "#CD853F"
BLUE_A = "#C7E9F1"
BLUE_B = "#9CDCEB"
BLUE_C = "#58C4DD"
BLUE_D = "#29ABCA"
BLUE_E = "#236B8E"
BLUE = BLUE_C
PURE_BLUE = "#0000FF"
DARK_BLUE = "#236B8E"
TEAL_A = "#ACEAD7"
TEAL_B = "#76DDC0"
TEAL_C = "#5CD0B3"
TEAL_D = "#55C1A7"
TEAL_E = "#49A88F"
TEAL = TEAL_C
GREEN_A = "#C9E2AE"
GREEN_B = "#A6CF8C"
GREEN_C = "#83C167"
GREEN_D = "#77B05D"
GREEN_E = "#699C52"
GREEN = GREEN_C
PURE_GREEN = "#00FF00"
YELLOW_A = "#FFF1B6"
YELLOW_B = "#FFEA94"
YELLOW_C = "#FFFF00"
YELLOW_D = "#F4D345"
YELLOW_E = "#E8C11C"
YELLOW = YELLOW_C
GOLD_A = "#F7C797"
GOLD_B = "#F9B775"
GOLD_C = "#F0AC5F"
GOLD_D = "#E1A158"
GOLD_E = "#C78D46"
GOLD = GOLD_C
RED_A = "#F7A1A3"
RED_B = "#FF8080"
RED_C = "#FC6255"
RED_D = "#E65A4C"
RED_E = "#CF5044"
RED = RED_C
PURE_RED = "#FF0000"
MAROON_A = "#ECABC1"
MAROON_B = "#EC92AB"
MAROON_C = "#C55F73"
MAROON_D = "#A24D61"
MAROON_E = "#94424F"
MAROON = MAROON_C
PURPLE_A = "#CAA3E8"
PURPLE_B = "#B189C6"
PURPLE_C = "#9A72AC"
PURPLE_D = "#715582"
PURPLE_E = "#644172"
PURPLE = PURPLE_C
PINK = "#D147BD"
LIGHT_PINK = "#DC75CD"
ORANGE = "#FF862F"
CYAN = "#38BDF8"
SLATE = "#94A3B8"


class ManimColor(str):
    def __new__(cls, value: str):
        return super().__new__(cls, _normalize_color(value))


def _normalize_color(c: Any) -> str:
    if c is None:
        return WHITE
    if isinstance(c, str):
        s = c.strip()
        if s.startswith("#"):
            if len(s) == 4:
                return f"#{s[1]*2}{s[2]*2}{s[3]*2}".upper()
            return s.upper()
        named = globals().get(s.upper())
        if isinstance(named, str) and named.startswith("#"):
            return named
        return s
    return WHITE


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = _normalize_color(hex_color).lstrip("#")
    if len(h) != 6:
        return (255, 255, 255)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _rgb_to_hex(r: float, g: float, b: float) -> str:
    ri = max(0, min(255, int(round(r))))
    gi = max(0, min(255, int(round(g))))
    bi = max(0, min(255, int(round(b))))
    return f"#{ri:02X}{gi:02X}{bi:02X}"


def interpolate_color(color1: str, color2: str, alpha: float) -> str:
    r1, g1, b1 = _hex_to_rgb(color1)
    r2, g2, b2 = _hex_to_rgb(color2)
    t = max(0.0, min(1.0, float(alpha)))
    return _rgb_to_hex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)


def color_gradient(reference_colors: Sequence[str], length_of_output: int) -> list[str]:
    if length_of_output <= 0:
        return []
    if len(reference_colors) == 1 or length_of_output == 1:
        return [_normalize_color(reference_colors[0])] * length_of_output
    out = []
    for i in range(length_of_output):
        u = i / (length_of_output - 1) * (len(reference_colors) - 1)
        idx = min(int(math.floor(u)), len(reference_colors) - 2)
        frac = u - idx
        out.append(interpolate_color(reference_colors[idx], reference_colors[idx + 1], frac))
    return out


# ---------------------------------------------------------------------------
# Global Config
# ---------------------------------------------------------------------------
class _Config:
    pixel_width: int = 1080
    pixel_height: int = 1920
    frame_width: float = 8.0
    frame_height: float = 14.22
    background_color: str = "#0F172A"
    frame_rate: int = 60


config = _Config()


# ---------------------------------------------------------------------------
# Rate Functions
# ---------------------------------------------------------------------------
def linear(t: float) -> float:
    return max(0.0, min(1.0, float(t)))


def smooth(t: float, inflection: float = 10.0) -> float:
    t = linear(t)
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0
    # Classic smoothstep / sigmoid blend matching Manim smooth
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def rush_into(t: float, inflection: float = 10.0) -> float:
    t = linear(t)
    return 2.0 * smooth(0.5 * t, inflection)


def rush_from(t: float, inflection: float = 10.0) -> float:
    t = linear(t)
    return 2.0 * smooth(0.5 * (t + 1.0), inflection) - 1.0


def double_smooth(t: float) -> float:
    t = linear(t)
    if t < 0.5:
        return 0.5 * smooth(2.0 * t)
    return 0.5 * (1.0 + smooth(2.0 * t - 1.0))


def there_and_back(t: float, inflection: float = 10.0) -> float:
    t = linear(t)
    new_t = 2.0 * t if t < 0.5 else 2.0 * (1.0 - t)
    return smooth(new_t, inflection)


def there_and_back_with_pause(t: float, pause_ratio: float = 1.0 / 3.0) -> float:
    t = linear(t)
    a = 1.0 / pause_ratio
    if t < 0.5 - pause_ratio / 2:
        return smooth(a * t)
    if t < 0.5 + pause_ratio / 2:
        return 1.0
    return smooth(a * (1.0 - t))


def not_quite_there(func=smooth, proportion: float = 0.7):
    return lambda t: proportion * func(t)


def wiggle(t: float, wiggles: float = 2) -> float:
    return there_and_back(t) * math.sin(wiggles * PI * t)


def running_start(t: float, pull_factor: float = -0.5) -> float:
    t = linear(t)
    return (1.0 - t) * t * (pull_factor * (1.0 - t) + t) + t * t * (3.0 - 2.0 * t)


def lingering(t: float) -> float:
    t = linear(t)
    return 1.0 - (1.0 - t) ** 3


def exponential_decay(t: float, half_life: float = 0.1) -> float:
    return 1.0 - math.exp(-t / max(1e-6, half_life))


# ---------------------------------------------------------------------------
# Coordinate / Geometry helpers
# ---------------------------------------------------------------------------
def _to_vec3(p: Any) -> list[float]:
    if isinstance(p, np.ndarray):
        lst = p.tolist()
    elif isinstance(p, (list, tuple)):
        lst = list(p)
    else:
        return [float(p), 0.0, 0.0]
    if len(lst) == 2:
        return [float(lst[0]), float(lst[1]), 0.0]
    if len(lst) >= 3:
        return [float(lst[0]), float(lst[1]), float(lst[2])]
    return [0.0, 0.0, 0.0]


def _dist2d(a: Sequence[float], b: Sequence[float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _clean_tex(tex: str) -> str:
    """Convert common LaTeX math strings into crisp readable Unicode."""
    s = tex.strip()
    replacements = [
        (r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"(\1)/(\2)"),
        (r"\\sqrt\{([^{}]+)\}", r"√(\1)"),
        (r"\\text\{([^{}]+)\}", r"\1"),
        (r"\\textbf\{([^{}]+)\}", r"\1"),
        (r"\\mathrm\{([^{}]+)\}", r"\1"),
        (r"\\mathbf\{([^{}]+)\}", r"\1"),
    ]
    for pat, rep in replacements:
        s = re.sub(pat, rep, s)
    tokens = {
        r"\pi": "π", r"\tau": "τ", r"\theta": "θ", r"\alpha": "α",
        r"\beta": "β", r"\gamma": "γ", r"\delta": "δ", r"\Delta": "Δ",
        r"\lambda": "λ", r"\mu": "μ", r"\sigma": "σ", r"\Sigma": "Σ",
        r"\omega": "ω", r"\Omega": "Ω", r"\phi": "φ", r"\infty": "∞",
        r"\sum": "∑", r"\int": "∫", r"\prod": "∏", r"\partial": "∂",
        r"\approx": "≈", r"\neq": "≠", r"\leq": "≤", r"\geq": "≥",
        r"\times": "×", r"\cdot": "·", r"\pm": "±", r"\div": "÷",
        r"\rightarrow": "→", r"\leftarrow": "←", r"\Rightarrow": "⇒",
        r"\leftrightarrow": "↔", r"\degree": "°", r"^\circ": "°",
        r"\circ": "°", r"\in": "∈", r"\forall": "∀", r"\exists": "∃",
        r"\quad": "  ", r"\,": " ", r"\;": " ", r"\:": " ",
        "^2": "²", "^3": "³", "^n": "ⁿ", "^-1": "⁻¹",
    }
    for k, v in tokens.items():
        s = s.replace(k, v)
    s = s.replace("{", "").replace("}", "").replace("$", "")
    return s.strip()


# ---------------------------------------------------------------------------
# Animate Proxy
# ---------------------------------------------------------------------------
class _AnimateProxy:
    def __init__(self, mobject: "Mobject"):
        self._mobject = mobject
        self._ops: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, name: str):
        def method(*args, **kwargs):
            self._ops.append((name, args, kwargs))
            return self
        return method


# ---------------------------------------------------------------------------
# Base Mobject & VGroup
# ---------------------------------------------------------------------------
_NEXT_ID = 1


def _gen_id() -> int:
    global _NEXT_ID
    _NEXT_ID += 1
    return _NEXT_ID


class Mobject:
    def __init__(self, color: str = WHITE, **kwargs):
        self._id = _gen_id()
        self.submobjects: list[Mobject] = []
        self.color = _normalize_color(color)
        self.stroke_color = self.color
        self.fill_color = self.color
        self.stroke_width = float(kwargs.get("stroke_width", 4.0))
        self.stroke_opacity = float(kwargs.get("stroke_opacity", 1.0))
        self.fill_opacity = float(kwargs.get("fill_opacity", 0.0))
        self.opacity = float(kwargs.get("opacity", 1.0))
        self.z_index = float(kwargs.get("z_index", 0.0))
        self.updaters: list[Callable] = []
        # Paths are list of polylines, each polyline is list of [x, y, z]
        self.paths: list[list[list[float]]] = []
        self.closed = False
        self.dashed = False
        self.dash_length = 0.12
        self.arrow_tip_end = False
        self.arrow_tip_start = False
        self.tip_length = 0.22
        self.glow = False
        # Optional text payload
        self.is_text = False
        self.text_str = ""
        self.font_size = 36.0
        self.font = "Noto Sans"
        self.weight = "NORMAL"
        self._text_pos = [0.0, 0.0, 0.0]
        self._text_angle = 0.0
        self._text_scale = 1.0
        self._text_box_w = 0.0
        self._text_box_h = 0.0

    @property
    def animate(self) -> _AnimateProxy:
        return _AnimateProxy(self)

    def add(self, *mobjects: "Mobject") -> "Mobject":
        for m in mobjects:
            if m is not None and m not in self.submobjects:
                self.submobjects.append(m)
        return self

    def remove(self, *mobjects: "Mobject") -> "Mobject":
        for m in mobjects:
            if m in self.submobjects:
                self.submobjects.remove(m)
        return self

    def __len__(self) -> int:
        return len(self.submobjects)

    def __getitem__(self, idx):
        return self.submobjects[idx]

    def __iter__(self):
        return iter(self.submobjects)

    def copy(self) -> "Mobject":
        c = copy.deepcopy(self)
        c._id = _gen_id()
        return c

    def _all_points(self) -> list[list[float]]:
        pts: list[list[float]] = []
        if self.is_text:
            cx, cy, cz = self._text_pos
            hw = self._text_box_w * self._text_scale / 2.0
            hh = self._text_box_h * self._text_scale / 2.0
            pts.extend([
                [cx - hw, cy - hh, cz],
                [cx + hw, cy - hh, cz],
                [cx + hw, cy + hh, cz],
                [cx - hw, cy + hh, cz],
            ])
        for path in self.paths:
            pts.extend(path)
        for sub in self.submobjects:
            pts.extend(sub._all_points())
        return pts

    def get_bounding_box(self) -> tuple[float, float, float, float]:
        pts = self._all_points()
        if not pts:
            return (0.0, 0.0, 0.0, 0.0)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return (min(xs), max(xs), min(ys), max(ys))

    @property
    def width(self) -> float:
        x0, x1, _, _ = self.get_bounding_box()
        return max(0.0, x1 - x0)

    @property
    def height(self) -> float:
        _, _, y0, y1 = self.get_bounding_box()
        return max(0.0, y1 - y0)

    def get_width(self) -> float:
        return self.width

    def get_height(self) -> float:
        return self.height

    def get_center(self) -> np.ndarray:
        x0, x1, y0, y1 = self.get_bounding_box()
        return np.array([(x0 + x1) / 2.0, (y0 + y1) / 2.0, 0.0])

    def get_left(self) -> np.ndarray:
        x0, _, y0, y1 = self.get_bounding_box()
        return np.array([x0, (y0 + y1) / 2.0, 0.0])

    def get_right(self) -> np.ndarray:
        _, x1, y0, y1 = self.get_bounding_box()
        return np.array([x1, (y0 + y1) / 2.0, 0.0])

    def get_top(self) -> np.ndarray:
        x0, x1, _, y1 = self.get_bounding_box()
        return np.array([(x0 + x1) / 2.0, y1, 0.0])

    def get_bottom(self) -> np.ndarray:
        x0, x1, y0, _ = self.get_bounding_box()
        return np.array([(x0 + x1) / 2.0, y0, 0.0])

    def get_edge_center(self, direction: Any) -> np.ndarray:
        d = _to_vec3(direction)
        x0, x1, y0, y1 = self.get_bounding_box()
        cx = (x0 + x1) / 2.0
        cy = (y0 + y1) / 2.0
        if d[0] < -0.5:
            cx = x0
        elif d[0] > 0.5:
            cx = x1
        if d[1] < -0.5:
            cy = y0
        elif d[1] > 0.5:
            cy = y1
        return np.array([cx, cy, 0.0])

    def get_corner(self, direction: Any) -> np.ndarray:
        return self.get_edge_center(direction)

    def get_start(self) -> np.ndarray:
        if self.paths and self.paths[0]:
            return np.array(self.paths[0][0])
        return self.get_center()

    def get_end(self) -> np.ndarray:
        if self.paths and self.paths[-1]:
            return np.array(self.paths[-1][-1])
        return self.get_center()

    def shift(self, *vectors: Any) -> "Mobject":
        dx = dy = dz = 0.0
        for v in vectors:
            vec = _to_vec3(v)
            dx += vec[0]
            dy += vec[1]
            dz += vec[2]
        if self.is_text:
            self._text_pos[0] += dx
            self._text_pos[1] += dy
            self._text_pos[2] += dz
        for path in self.paths:
            for p in path:
                p[0] += dx
                p[1] += dy
                p[2] += dz
        for sub in self.submobjects:
            sub.shift([dx, dy, dz])
        return self

    def move_to(self, point_or_mobject: Any, aligned_edge=ORIGIN) -> "Mobject":
        target = point_or_mobject.get_center() if isinstance(point_or_mobject, Mobject) else _to_vec3(point_or_mobject)
        cur = self.get_center() if _to_vec3(aligned_edge) == [0.0, 0.0, 0.0] else self.get_edge_center(aligned_edge)
        return self.shift([target[0] - cur[0], target[1] - cur[1], 0.0])

    def next_to(self, mobject_or_point: Any, direction=RIGHT, buff: float = DEFAULT_MOBJECT_TO_MOBJECT_BUFFER, aligned_edge=ORIGIN) -> "Mobject":
        d = _to_vec3(direction)
        norm = math.hypot(d[0], d[1])
        if norm > 1e-9:
            d = [d[0] / norm, d[1] / norm, 0.0]
        if isinstance(mobject_or_point, Mobject):
            anchor = mobject_or_point.get_edge_center(direction)
        else:
            anchor = _to_vec3(mobject_or_point)
        own_edge = self.get_edge_center([-d[0], -d[1], 0.0])
        cur_center = self.get_center()
        offset_x = own_edge[0] - cur_center[0]
        offset_y = own_edge[1] - cur_center[1]
        target_cx = anchor[0] + d[0] * buff - offset_x
        target_cy = anchor[1] + d[1] * buff - offset_y
        if abs(d[0]) > 0.5 and abs(d[1]) < 0.2:
            target_cy = anchor[1]
        elif abs(d[1]) > 0.5 and abs(d[0]) < 0.2:
            target_cx = anchor[0]
        return self.shift([target_cx - cur_center[0], target_cy - cur_center[1], 0.0])

    def align_to(self, mobject_or_point: Any, direction=ORIGIN) -> "Mobject":
        d = _to_vec3(direction)
        target = mobject_or_point.get_edge_center(d) if isinstance(mobject_or_point, Mobject) else _to_vec3(mobject_or_point)
        own = self.get_edge_center(d)
        dx = (target[0] - own[0]) if abs(d[0]) > 0.1 else 0.0
        dy = (target[1] - own[1]) if abs(d[1]) > 0.1 else 0.0
        return self.shift([dx, dy, 0.0])

    def to_edge(self, edge=LEFT, buff: float = DEFAULT_MOBJECT_TO_EDGE_BUFFER) -> "Mobject":
        d = _to_vec3(edge)
        half_w = config.frame_width / 2.0
        half_h = config.frame_height / 2.0
        own = self.get_edge_center(d)
        dx = dy = 0.0
        if d[0] < -0.5:
            dx = (-half_w + buff) - own[0]
        elif d[0] > 0.5:
            dx = (half_w - buff) - own[0]
        if d[1] < -0.5:
            dy = (-half_h + buff) - own[1]
        elif d[1] > 0.5:
            dy = (half_h - buff) - own[1]
        return self.shift([dx, dy, 0.0])

    def to_corner(self, corner=DL, buff: float = DEFAULT_MOBJECT_TO_EDGE_BUFFER) -> "Mobject":
        return self.to_edge(corner, buff=buff)

    def scale(self, scale_factor: float, about_point: Any = None) -> "Mobject":
        s = float(scale_factor)
        origin = _to_vec3(about_point) if about_point is not None else self.get_center().tolist()
        self._scale_about(s, s, origin)
        return self

    def _scale_about(self, sx: float, sy: float, origin: list[float]):
        ox, oy, _ = origin
        if self.is_text:
            self._text_pos[0] = ox + (self._text_pos[0] - ox) * sx
            self._text_pos[1] = oy + (self._text_pos[1] - oy) * sy
            self._text_scale *= (abs(sx) + abs(sy)) / 2.0
        for path in self.paths:
            for p in path:
                p[0] = ox + (p[0] - ox) * sx
                p[1] = oy + (p[1] - oy) * sy
        for sub in self.submobjects:
            sub._scale_about(sx, sy, origin)

    def stretch(self, factor: float, dim: int, about_point: Any = None) -> "Mobject":
        origin = _to_vec3(about_point) if about_point is not None else self.get_center().tolist()
        sx = factor if dim == 0 else 1.0
        sy = factor if dim == 1 else 1.0
        self._scale_about(sx, sy, origin)
        return self

    def scale_to_fit_width(self, width: float) -> "Mobject":
        w = self.width
        if w <= 1e-6:
            raise ValueError("Cannot call scale_to_fit_width on an empty or zero-width Mobject/VGroup.")
        return self.scale(float(width) / w)

    def scale_to_fit_height(self, height: float) -> "Mobject":
        h = self.height
        if h <= 1e-6:
            raise ValueError("Cannot call scale_to_fit_height on an empty or zero-height Mobject/VGroup.")
        return self.scale(float(height) / h)

    def rotate(self, angle: float, axis=OUT, about_point: Any = None) -> "Mobject":
        origin = _to_vec3(about_point) if about_point is not None else self.get_center().tolist()
        self._rotate_about(float(angle), origin)
        return self

    def _rotate_about(self, angle: float, origin: list[float]):
        ox, oy, _ = origin
        ca = math.cos(angle)
        sa = math.sin(angle)
        if self.is_text:
            dx = self._text_pos[0] - ox
            dy = self._text_pos[1] - oy
            self._text_pos[0] = ox + dx * ca - dy * sa
            self._text_pos[1] = oy + dx * sa + dy * ca
            self._text_angle += angle
        for path in self.paths:
            for p in path:
                dx = p[0] - ox
                dy = p[1] - oy
                p[0] = ox + dx * ca - dy * sa
                p[1] = oy + dx * sa + dy * ca
        for sub in self.submobjects:
            sub._rotate_about(angle, origin)

    def flip(self, axis=UP, about_point: Any = None) -> "Mobject":
        origin = _to_vec3(about_point) if about_point is not None else self.get_center().tolist()
        ax = _to_vec3(axis)
        if abs(ax[1]) > abs(ax[0]):
            self._scale_about(-1.0, 1.0, origin)
        else:
            self._scale_about(1.0, -1.0, origin)
        return self

    def arrange(self, direction=RIGHT, buff: float = DEFAULT_MOBJECT_TO_MOBJECT_BUFFER, center: bool = True) -> "Mobject":
        if len(self.submobjects) <= 1:
            return self
        prev = self.submobjects[0]
        for m in self.submobjects[1:]:
            m.next_to(prev, direction, buff=buff)
            prev = m
        if center:
            self.move_to(ORIGIN)
        return self

    def arrange_in_grid(self, rows: int = None, cols: int = None, buff: float = 0.25) -> "Mobject":
        n = len(self.submobjects)
        if n == 0:
            return self
        if cols is None and rows is None:
            cols = max(1, int(math.ceil(math.sqrt(n))))
        elif cols is None:
            cols = max(1, int(math.ceil(n / rows)))
        rows = max(1, int(math.ceil(n / cols)))
        max_w = max((m.width for m in self.submobjects), default=1.0)
        max_h = max((m.height for m in self.submobjects), default=1.0)
        for idx, m in enumerate(self.submobjects):
            r = idx // cols
            c = idx % cols
            x = (c - (cols - 1) / 2.0) * (max_w + buff)
            y = ((rows - 1) / 2.0 - r) * (max_h + buff)
            m.move_to([x, y, 0.0])
        return self

    def set_color(self, color: str, family: bool = True) -> "Mobject":
        nc = _normalize_color(color)
        self.color = nc
        self.stroke_color = nc
        self.fill_color = nc
        if family:
            for sub in self.submobjects:
                sub.set_color(nc, family=True)
        return self

    def set_fill(self, color: str = None, opacity: float = None, family: bool = True) -> "Mobject":
        if color is not None:
            self.fill_color = _normalize_color(color)
        if opacity is not None:
            self.fill_opacity = float(opacity)
        if family:
            for sub in self.submobjects:
                sub.set_fill(color, opacity, family=True)
        return self

    def set_stroke(self, color: str = None, width: float = None, opacity: float = None, family: bool = True) -> "Mobject":
        if color is not None:
            self.stroke_color = _normalize_color(color)
        if width is not None:
            self.stroke_width = float(width)
        if opacity is not None:
            self.stroke_opacity = float(opacity)
        if family:
            for sub in self.submobjects:
                sub.set_stroke(color, width, opacity, family=True)
        return self

    def set_opacity(self, opacity: float, family: bool = True) -> "Mobject":
        self.opacity = float(opacity)
        if family:
            for sub in self.submobjects:
                sub.set_opacity(opacity, family=True)
        return self

    def set_z_index(self, z_index_value: float, family: bool = True) -> "Mobject":
        self.z_index = float(z_index_value)
        if family:
            for sub in self.submobjects:
                sub.set_z_index(z_index_value, family=True)
        return self

    def add_updater(self, func: Callable) -> "Mobject":
        self.updaters.append(func)
        return self

    def remove_updater(self, func: Callable) -> "Mobject":
        if func in self.updaters:
            self.updaters.remove(func)
        return self

    def clear_updaters(self) -> "Mobject":
        self.updaters.clear()
        return self

    def update(self, dt: float = 0.0):
        for fn in list(self.updaters):
            try:
                fn(self, dt)
            except TypeError:
                fn(self)
        for sub in self.submobjects:
            sub.update(dt)

    def become(self, other: "Mobject") -> "Mobject":
        self.paths = copy.deepcopy(other.paths)
        self.submobjects = copy.deepcopy(other.submobjects)
        self.color = other.color
        self.stroke_color = other.stroke_color
        self.fill_color = other.fill_color
        self.stroke_width = other.stroke_width
        self.stroke_opacity = other.stroke_opacity
        self.fill_opacity = other.fill_opacity
        self.opacity = other.opacity
        self.closed = other.closed
        self.dashed = other.dashed
        self.is_text = other.is_text
        self.text_str = other.text_str
        self.font_size = other.font_size
        self.font = other.font
        self.weight = other.weight
        self._text_pos = list(other._text_pos)
        self._text_angle = other._text_angle
        self._text_scale = other._text_scale
        self._text_box_w = other._text_box_w
        self._text_box_h = other._text_box_h
        return self


class VMobject(Mobject):
    def set_points_as_corners(self, points: Iterable[Any]) -> "VMobject":
        pts = [_to_vec3(p) for p in points]
        self.paths = [pts] if pts else []
        return self

    def set_points_smoothly(self, points: Iterable[Any]) -> "VMobject":
        return self.set_points_as_corners(points)

    def add_points_as_corners(self, points: Iterable[Any]) -> "VMobject":
        pts = [_to_vec3(p) for p in points]
        if not self.paths:
            self.paths = [pts]
        else:
            self.paths[-1].extend(pts)
        return self


class VGroup(VMobject):
    def __init__(self, *vmobjects: Mobject, **kwargs):
        super().__init__(**kwargs)
        for m in vmobjects:
            if m is not None:
                self.add(m)


class Group(Mobject):
    def __init__(self, *mobjects: Mobject, **kwargs):
        super().__init__(**kwargs)
        for m in mobjects:
            if m is not None:
                self.add(m)


# ---------------------------------------------------------------------------
# Geometric Primitives
# ---------------------------------------------------------------------------
class Dot(VMobject):
    def __init__(self, point=ORIGIN, radius: float = 0.08, color: str = WHITE, fill_opacity: float = 1.0, stroke_width: float = 0.0, **kwargs):
        super().__init__(color=color, fill_opacity=fill_opacity, stroke_width=stroke_width, **kwargs)
        p = _to_vec3(point)
        n = 24
        pts = [[p[0] + radius * math.cos(2 * PI * i / n), p[1] + radius * math.sin(2 * PI * i / n), p[2]] for i in range(n)]
        self.paths = [pts]
        self.closed = True


class SmallDot(Dot):
    def __init__(self, point=ORIGIN, radius: float = 0.04, **kwargs):
        super().__init__(point=point, radius=radius, **kwargs)


class Circle(VMobject):
    def __init__(self, radius: float = 1.0, color: str = RED, fill_opacity: float = 0.0, stroke_width: float = 4.0, **kwargs):
        super().__init__(color=color, fill_opacity=fill_opacity, stroke_width=stroke_width, **kwargs)
        n = 64
        pts = [[radius * math.cos(2 * PI * i / n), radius * math.sin(2 * PI * i / n), 0.0] for i in range(n)]
        self.paths = [pts]
        self.closed = True


class Ellipse(VMobject):
    def __init__(self, width: float = 2.0, height: float = 1.0, color: str = WHITE, **kwargs):
        super().__init__(color=color, **kwargs)
        n = 64
        rx, ry = width / 2.0, height / 2.0
        pts = [[rx * math.cos(2 * PI * i / n), ry * math.sin(2 * PI * i / n), 0.0] for i in range(n)]
        self.paths = [pts]
        self.closed = True


class Arc(VMobject):
    def __init__(self, radius: float = 1.0, start_angle: float = 0.0, angle: float = TAU / 4, arc_center=ORIGIN, num_components: int = 40, color: str = WHITE, **kwargs):
        super().__init__(color=color, **kwargs)
        c = _to_vec3(arc_center)
        pts = [
            [
                c[0] + radius * math.cos(start_angle + angle * i / num_components),
                c[1] + radius * math.sin(start_angle + angle * i / num_components),
                0.0,
            ]
            for i in range(num_components + 1)
        ]
        self.paths = [pts]
        self.closed = False


class ArcBetweenPoints(VMobject):
    def __init__(self, start=LEFT, end=RIGHT, angle: float = TAU / 4, radius: float = None, color: str = WHITE, **kwargs):
        super().__init__(color=color, **kwargs)
        p0 = _to_vec3(start)
        p1 = _to_vec3(end)
        self.paths = [_arc_between_points_pts(p0, p1, angle)]
        self.closed = False


def _arc_between_points_pts(p0: list[float], p1: list[float], angle: float, n: int = 40) -> list[list[float]]:
    if abs(angle) < 1e-5:
        return [
            [p0[0] + (p1[0] - p0[0]) * i / n, p0[1] + (p1[1] - p0[1]) * i / n, 0.0]
            for i in range(n + 1)
        ]
    mx = (p0[0] + p1[0]) / 2.0
    my = (p0[1] + p1[1]) / 2.0
    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    chord = math.hypot(dx, dy)
    if chord < 1e-6:
        return [list(p0), list(p1)]
    # Quadratic Bezier approximation with clean circular sagitta feel
    sagitta = (chord / 2.0) * math.tan(angle / 4.0) * 1.45
    nx, ny = -dy / chord, dx / chord
    cx = mx + nx * sagitta * 2.0
    cy = my + ny * sagitta * 2.0
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1.0 - t
        pts.append([
            u * u * p0[0] + 2 * u * t * cx + t * t * p1[0],
            u * u * p0[1] + 2 * u * t * cy + t * t * p1[1],
            0.0,
        ])
    return pts


class Sector(VMobject):
    def __init__(self, outer_radius: float = 1.0, inner_radius: float = 0.0, start_angle: float = 0.0, angle: float = TAU / 4, arc_center=ORIGIN, color: str = WHITE, fill_opacity: float = 0.8, **kwargs):
        super().__init__(color=color, fill_opacity=fill_opacity, **kwargs)
        c = _to_vec3(arc_center)
        n = 36
        outer = [[c[0] + outer_radius * math.cos(start_angle + angle * i / n), c[1] + outer_radius * math.sin(start_angle + angle * i / n), 0.0] for i in range(n + 1)]
        if inner_radius <= 1e-5:
            pts = [c] + outer
        else:
            inner = [[c[0] + inner_radius * math.cos(start_angle + angle * (n - i) / n), c[1] + inner_radius * math.sin(start_angle + angle * (n - i) / n), 0.0] for i in range(n + 1)]
            pts = outer + inner
        self.paths = [pts]
        self.closed = True


class Annulus(VMobject):
    def __init__(self, inner_radius: float = 1.0, outer_radius: float = 2.0, color: str = WHITE, fill_opacity: float = 0.3, **kwargs):
        super().__init__(color=color, fill_opacity=fill_opacity, **kwargs)
        n = 48
        outer = [[outer_radius * math.cos(2 * PI * i / n), outer_radius * math.sin(2 * PI * i / n), 0.0] for i in range(n)]
        inner = [[inner_radius * math.cos(2 * PI * i / n), inner_radius * math.sin(2 * PI * i / n), 0.0] for i in range(n)]
        self.paths = [outer, inner]
        self.closed = True


class Line(VMobject):
    def __init__(self, start=LEFT, end=RIGHT, buff: float = 0.0, color: str = WHITE, stroke_width: float = 4.0, **kwargs):
        super().__init__(color=color, stroke_width=stroke_width, **kwargs)
        p0 = _to_vec3(start.get_center() if isinstance(start, Mobject) else start)
        p1 = _to_vec3(end.get_center() if isinstance(end, Mobject) else end)
        if buff > 0:
            dx, dy = p1[0] - p0[0], p1[1] - p0[1]
            d = math.hypot(dx, dy)
            if d > 2 * buff:
                ux, uy = dx / d, dy / d
                p0 = [p0[0] + ux * buff, p0[1] + uy * buff, 0.0]
                p1 = [p1[0] - ux * buff, p1[1] - uy * buff, 0.0]
        self.paths = [[p0, p1]]
        self.closed = False

    def get_length(self) -> float:
        return _dist2d(self.get_start(), self.get_end())

    def put_start_and_end_on(self, start, end):
        self.paths = [[_to_vec3(start), _to_vec3(end)]]
        return self


class DashedLine(Line):
    def __init__(self, start=LEFT, end=RIGHT, dash_length: float = 0.12, dashed_ratio: float = 0.5, **kwargs):
        super().__init__(start=start, end=end, **kwargs)
        self.dashed = True
        self.dash_length = float(dash_length)


class Arrow(Line):
    def __init__(self, start=LEFT, end=RIGHT, buff: float = 0.25, tip_length: float = 0.22, **kwargs):
        super().__init__(start=start, end=end, buff=buff, **kwargs)
        self.arrow_tip_end = True
        self.tip_length = float(tip_length)


class DoubleArrow(Arrow):
    def __init__(self, start=LEFT, end=RIGHT, buff: float = 0.25, **kwargs):
        super().__init__(start=start, end=end, buff=buff, **kwargs)
        self.arrow_tip_start = True
        self.arrow_tip_end = True


class Vector(Arrow):
    def __init__(self, direction=RIGHT, buff: float = 0.0, **kwargs):
        super().__init__(start=ORIGIN, end=direction, buff=buff, **kwargs)


class CurvedArrow(ArcBetweenPoints):
    def __init__(self, start_point=LEFT, end_point=RIGHT, angle: float = PI / 4, **kwargs):
        super().__init__(start=start_point, end=end_point, angle=angle, **kwargs)
        self.arrow_tip_end = True


class CurvedDoubleArrow(CurvedArrow):
    def __init__(self, start_point=LEFT, end_point=RIGHT, angle: float = PI / 4, **kwargs):
        super().__init__(start_point=start_point, end_point=end_point, angle=angle, **kwargs)
        self.arrow_tip_start = True


class Rectangle(VMobject):
    def __init__(self, width: float = 4.0, height: float = 2.0, color: str = WHITE, **kwargs):
        super().__init__(color=color, **kwargs)
        hw, hh = width / 2.0, height / 2.0
        self.paths = [[[-hw, -hh, 0.0], [hw, -hh, 0.0], [hw, hh, 0.0], [-hw, hh, 0.0]]]
        self.closed = True


class Square(Rectangle):
    def __init__(self, side_length: float = 2.0, **kwargs):
        super().__init__(width=side_length, height=side_length, **kwargs)


class RoundedRectangle(VMobject):
    def __init__(self, width: float = 4.0, height: float = 2.0, corner_radius: float = 0.35, color: str = WHITE, **kwargs):
        super().__init__(color=color, **kwargs)
        hw, hh = width / 2.0, height / 2.0
        r = min(abs(corner_radius), hw * 0.9, hh * 0.9)
        if r <= 1e-4:
            self.paths = [[[-hw, -hh, 0.0], [hw, -hh, 0.0], [hw, hh, 0.0], [-hw, hh, 0.0]]]
        else:
            pts = []
            corners = [
                (hw - r, -hh + r, -PI / 2, 0.0),
                (hw - r, hh - r, 0.0, PI / 2),
                (-hw + r, hh - r, PI / 2, PI),
                (-hw + r, -hh + r, PI, 3 * PI / 2),
            ]
            steps = 8
            for cx, cy, a0, a1 in corners:
                for i in range(steps + 1):
                    ang = a0 + (a1 - a0) * i / steps
                    pts.append([cx + r * math.cos(ang), cy + r * math.sin(ang), 0.0])
            self.paths = [pts]
        self.closed = True


class SurroundingRectangle(RoundedRectangle):
    def __init__(self, mobject: Mobject, buff: float = SMALL_BUFF, corner_radius: float = 0.1, color: str = YELLOW, **kwargs):
        w = max(0.2, mobject.width + 2 * buff)
        h = max(0.2, mobject.height + 2 * buff)
        super().__init__(width=w, height=h, corner_radius=corner_radius, color=color, **kwargs)
        self.move_to(mobject.get_center())


class BackgroundRectangle(SurroundingRectangle):
    def __init__(self, mobject: Mobject, color: str = BLACK, fill_opacity: float = 0.75, stroke_width: float = 0.0, buff: float = 0.05, **kwargs):
        super().__init__(mobject, buff=buff, corner_radius=0.08, color=color, fill_opacity=fill_opacity, stroke_width=stroke_width, **kwargs)


class Polygon(VMobject):
    def __init__(self, *vertices: Any, color: str = WHITE, **kwargs):
        super().__init__(color=color, **kwargs)
        pts = [_to_vec3(v) for v in vertices]
        self.paths = [pts] if pts else []
        self.closed = True


class RegularPolygon(Polygon):
    def __init__(self, n: int = 6, radius: float = 1.0, start_angle: float = 0.0, **kwargs):
        verts = [[radius * math.cos(start_angle + 2 * PI * i / n), radius * math.sin(start_angle + 2 * PI * i / n), 0.0] for i in range(n)]
        super().__init__(*verts, **kwargs)


class Triangle(RegularPolygon):
    def __init__(self, radius: float = 1.0, **kwargs):
        super().__init__(n=3, radius=radius, start_angle=PI / 2, **kwargs)


class Star(Polygon):
    def __init__(self, n: int = 5, outer_radius: float = 1.0, inner_radius: float = None, start_angle: float = PI / 2, **kwargs):
        if inner_radius is None:
            inner_radius = outer_radius * 0.42
        verts = []
        for i in range(2 * n):
            r = outer_radius if i % 2 == 0 else inner_radius
            ang = start_angle + PI * i / n
            verts.append([r * math.cos(ang), r * math.sin(ang), 0.0])
        super().__init__(*verts, **kwargs)


class Brace(VMobject):
    def __init__(self, mobject: Mobject, direction=DOWN, buff: float = 0.2, color: str = WHITE, **kwargs):
        super().__init__(color=color, stroke_width=kwargs.pop("stroke_width", 3.0), **kwargs)
        d = _to_vec3(direction)
        x0, x1, y0, y1 = mobject.get_bounding_box()
        if abs(d[1]) >= abs(d[0]):
            y = (y0 - buff) if d[1] <= 0 else (y1 + buff)
            sgn = -1.0 if d[1] <= 0 else 1.0
            xm = (x0 + x1) / 2.0
            h = 0.18 * sgn
            self.paths = [[[x0, y - h, 0.0], [x0, y, 0.0], [xm - 0.12, y, 0.0], [xm, y + h, 0.0], [xm + 0.12, y, 0.0], [x1, y, 0.0], [x1, y - h, 0.0]]]
        else:
            x = (x0 - buff) if d[0] <= 0 else (x1 + buff)
            sgn = -1.0 if d[0] <= 0 else 1.0
            ym = (y0 + y1) / 2.0
            w = 0.18 * sgn
            self.paths = [[[x - w, y0, 0.0], [x, y0, 0.0], [x, ym - 0.12, 0.0], [x + w, ym, 0.0], [x, ym + 0.12, 0.0], [x, y1, 0.0], [x - w, y1, 0.0]]]


class BraceBetweenPoints(VMobject):
    def __init__(self, point_1, point_2, direction=DOWN, **kwargs):
        p1, p2 = _to_vec3(point_1), _to_vec3(point_2)
        dummy = Line(p1, p2)
        b = Brace(dummy, direction=direction, **kwargs)
        super().__init__(**kwargs)
        self.paths = b.paths


class Cross(VGroup):
    def __init__(self, mobject: Mobject = None, stroke_color: str = RED, stroke_width: float = 6.0, scale_factor: float = 1.0, **kwargs):
        super().__init__(**kwargs)
        w = (mobject.width if mobject else 1.0) * scale_factor
        h = (mobject.height if mobject else 1.0) * scale_factor
        c = mobject.get_center() if mobject else ORIGIN
        hw, hh = max(0.2, w / 2.0), max(0.2, h / 2.0)
        l1 = Line([c[0] - hw, c[1] - hh, 0], [c[0] + hw, c[1] + hh, 0], color=stroke_color, stroke_width=stroke_width)
        l2 = Line([c[0] - hw, c[1] + hh, 0], [c[0] + hw, c[1] - hh, 0], color=stroke_color, stroke_width=stroke_width)
        self.add(l1, l2)


class FunctionGraph(VMobject):
    def __init__(self, function: Callable[[float], float], x_range: Sequence[float] = (-4, 4, 0.05), color: str = YELLOW, **kwargs):
        super().__init__(color=color, **kwargs)
        xmin, xmax = float(x_range[0]), float(x_range[1])
        step = float(x_range[2]) if len(x_range) > 2 else (xmax - xmin) / 120.0
        n = max(16, int(abs(xmax - xmin) / max(1e-4, step)))
        pts = []
        for i in range(n + 1):
            x = xmin + (xmax - xmin) * i / n
            y = float(function(x))
            if math.isfinite(y):
                pts.append([x, y, 0.0])
        self.paths = [pts] if pts else []


class ParametricFunction(VMobject):
    def __init__(self, function: Callable[[float], Any], t_range: Sequence[float] = (0, 1, 0.01), color: str = WHITE, **kwargs):
        super().__init__(color=color, **kwargs)
        tmin, tmax = float(t_range[0]), float(t_range[1])
        step = float(t_range[2]) if len(t_range) > 2 else (tmax - tmin) / 100.0
        n = max(16, int(abs(tmax - tmin) / max(1e-4, step)))
        pts = [_to_vec3(function(tmin + (tmax - tmin) * i / n)) for i in range(n + 1)]
        self.paths = [pts]


# ---------------------------------------------------------------------------
# Text, Math & Numbers
# ---------------------------------------------------------------------------
class Text(VMobject):
    def __init__(
        self,
        text: str,
        font_size: float = 48.0,
        color: str = WHITE,
        font: str = "Noto Sans",
        weight: str = "NORMAL",
        line_spacing: float = 1.2,
        **kwargs,
    ):
        super().__init__(color=color, fill_opacity=1.0, stroke_width=0.0, **kwargs)
        self.is_text = True
        self.text_str = str(text)
        self.font_size = float(font_size)
        self.font = font or "Noto Sans"
        self.weight = str(weight).upper()
        # Approximate Manim world-unit box dimensions for layout math (next_to, scale_to_fit_width)
        lines = self.text_str.splitlines() or [""]
        max_chars = max((len(ln) for ln in lines), default=1)
        char_w = (self.font_size / 48.0) * 0.25
        line_h = (self.font_size / 48.0) * 0.42 * line_spacing
        self._text_box_w = max(0.15, max_chars * char_w)
        self._text_box_h = max(0.25, len(lines) * line_h)


class Paragraph(Text):
    def __init__(self, *text: str, alignment: str = "center", **kwargs):
        super().__init__("\n".join(text), **kwargs)


class MarkupText(Text):
    def __init__(self, text: str, **kwargs):
        clean = re.sub(r"<[^>]+>", "", str(text))
        super().__init__(clean, **kwargs)


class Title(Text):
    def __init__(self, *text_parts: str, font_size: float = 52.0, **kwargs):
        super().__init__(" ".join(text_parts), font_size=font_size, weight="BOLD", **kwargs)
        self.move_to([0.0, 5.2, 0.0])


class Tex(Text):
    def __init__(self, *tex_strings: str, font_size: float = 44.0, **kwargs):
        cleaned = " ".join(_clean_tex(t) for t in tex_strings)
        super().__init__(cleaned, font_size=font_size, **kwargs)


class MathTex(Tex):
    pass


class DecimalNumber(Text):
    def __init__(self, number: float = 0.0, num_decimal_places: int = 2, include_sign: bool = False, unit: str = None, font_size: float = 48.0, color: str = WHITE, **kwargs):
        self.number = float(number)
        self.num_decimal_places = int(num_decimal_places)
        self.include_sign = include_sign
        self.unit = unit
        super().__init__(self._format_num(), font_size=font_size, color=color, **kwargs)

    def _format_num(self) -> str:
        fmt = f"{{:{'+' if self.include_sign else ''}.{self.num_decimal_places}f}}"
        txt = fmt.format(self.number)
        if self.unit:
            txt += f" {self.unit}"
        return txt

    def get_value(self) -> float:
        return self.number

    def set_value(self, number: float) -> "DecimalNumber":
        self.number = float(number)
        self.text_str = self._format_num()
        char_w = (self.font_size / 48.0) * 0.25
        self._text_box_w = max(0.2, len(self.text_str) * char_w)
        return self


class Integer(DecimalNumber):
    def __init__(self, number: int = 0, **kwargs):
        kwargs.setdefault("num_decimal_places", 0)
        super().__init__(number=int(round(number)), **kwargs)


# ---------------------------------------------------------------------------
# Coordinate Systems & Charts
# ---------------------------------------------------------------------------
class NumberLine(VGroup):
    def __init__(
        self,
        x_range: Sequence[float] = (-5, 5, 1),
        length: float = 6.0,
        include_numbers: bool = False,
        include_ticks: bool = True,
        color: str = WHITE,
        font_size: float = 24.0,
        **kwargs,
    ):
        super().__init__(color=color, **kwargs)
        self.x_min = float(x_range[0])
        self.x_max = float(x_range[1])
        self.x_step = float(x_range[2]) if len(x_range) > 2 else 1.0
        self.length = float(length if length is not None else 6.0)
        self.main_line = Line([-self.length / 2, 0, 0], [self.length / 2, 0, 0], color=color, stroke_width=3.5)
        self.add(self.main_line)
        span = max(1e-6, self.x_max - self.x_min)
        if include_ticks and self.x_step > 0:
            val = self.x_min
            count = 0
            while val <= self.x_max + 1e-6 and count < 40:
                px = -self.length / 2 + ((val - self.x_min) / span) * self.length
                tick = Line([px, -0.1, 0], [px, 0.1, 0], color=color, stroke_width=2.5)
                self.add(tick)
                if include_numbers:
                    lbl_txt = str(int(round(val))) if abs(val - round(val)) < 1e-6 else f"{val:.1f}"
                    lbl = Text(lbl_txt, font_size=font_size, color=color).move_to([px, -0.35, 0])
                    self.add(lbl)
                val += self.x_step
                count += 1

    def n2p(self, number: float) -> np.ndarray:
        span = max(1e-6, self.x_max - self.x_min)
        frac = (float(number) - self.x_min) / span
        p0 = self.main_line.get_start()
        p1 = self.main_line.get_end()
        return p0 + (p1 - p0) * frac

    def number_to_point(self, number: float) -> np.ndarray:
        return self.n2p(number)


class Axes(VGroup):
    def __init__(
        self,
        x_range: Sequence[float] = (-5, 5, 1),
        y_range: Sequence[float] = (-3, 3, 1),
        x_length: float = 6.0,
        y_length: float = 4.0,
        axis_config: dict = None,
        x_axis_config: dict = None,
        y_axis_config: dict = None,
        tips: bool = True,
        **kwargs,
    ):
        # Strictly reject ManimGL/invalid `width` / `height` kwargs so Debugger Agent catches them!
        if "width" in kwargs or "height" in kwargs:
            raise TypeError("Axes.__init__() got unexpected keyword argument 'width' or 'height'; use 'x_length' and 'y_length'.")
        super().__init__(**kwargs)
        self.x_range = [float(x_range[0]), float(x_range[1]), float(x_range[2]) if len(x_range) > 2 else 1.0]
        self.y_range = [float(y_range[0]), float(y_range[1]), float(y_range[2]) if len(y_range) > 2 else 1.0]
        self.x_length = float(x_length)
        self.y_length = float(y_length)
        ac = axis_config or {}
        color = _normalize_color(ac.get("color", SLATE))
        include_numbers = ac.get("include_numbers", False)
        font_size = float(ac.get("font_size", 20.0))

        # Determine origin in local coords
        x0, x1, xs = self.x_range
        y0, y1, ys = self.y_range
        x_zero_frac = (0.0 - x0) / max(1e-6, x1 - x0) if (x0 <= 0 <= x1) else 0.0
        y_zero_frac = (0.0 - y0) / max(1e-6, y1 - y0) if (y0 <= 0 <= y1) else 0.0
        ox = -self.x_length / 2.0 + x_zero_frac * self.x_length
        oy = -self.y_length / 2.0 + y_zero_frac * self.y_length

        line_cls = Arrow if tips else Line
        x_kw = {"buff": 0.0, "tip_length": 0.18} if tips else {}
        y_kw = {"buff": 0.0, "tip_length": 0.18} if tips else {}

        self.x_axis = line_cls([-self.x_length / 2.0, oy, 0], [self.x_length / 2.0, oy, 0], color=color, stroke_width=3.0, **x_kw)
        self.y_axis = line_cls([ox, -self.y_length / 2.0, 0], [ox, self.y_length / 2.0, 0], color=color, stroke_width=3.0, **y_kw)
        self.add(self.x_axis, self.y_axis)

        # Reference corner for coordinate transforms even if Axes is shifted/scaled later
        self._origin_anchor = Dot([ox, oy, 0], radius=0.001, fill_opacity=0.0, stroke_opacity=0.0)
        self._x_end_anchor = Dot([self.x_length / 2.0, oy, 0], radius=0.001, fill_opacity=0.0, stroke_opacity=0.0)
        self._x_start_anchor = Dot([-self.x_length / 2.0, oy, 0], radius=0.001, fill_opacity=0.0, stroke_opacity=0.0)
        self._y_end_anchor = Dot([ox, self.y_length / 2.0, 0], radius=0.001, fill_opacity=0.0, stroke_opacity=0.0)
        self._y_start_anchor = Dot([ox, -self.y_length / 2.0, 0], radius=0.001, fill_opacity=0.0, stroke_opacity=0.0)
        self.add(self._origin_anchor, self._x_end_anchor, self._x_start_anchor, self._y_end_anchor, self._y_start_anchor)

        if include_numbers:
            vx = x0
            cnt = 0
            while vx <= x1 + 1e-6 and cnt < 20:
                if abs(vx) > 1e-6 or not (y0 <= 0 <= y1):
                    pt = self.c2p(vx, y0 if not (y0 <= 0 <= y1) else 0)
                    lbl = Text(str(int(round(vx))) if abs(vx - round(vx)) < 1e-5 else f"{vx:.1f}", font_size=font_size, color=color)
                    lbl.move_to([pt[0], pt[1] - 0.25, 0])
                    self.add(lbl)
                vx += xs
                cnt += 1

    def c2p(self, *coords) -> np.ndarray:
        if len(coords) == 1 and isinstance(coords[0], (list, tuple, np.ndarray)):
            x, y = float(coords[0][0]), float(coords[0][1])
        else:
            x, y = float(coords[0]), float(coords[1])
        x0, x1, _ = self.x_range
        y0, y1, _ = self.y_range
        fx = (x - x0) / max(1e-6, x1 - x0)
        fy = (y - y0) / max(1e-6, y1 - y0)
        xs = self._x_start_anchor.get_center()
        xe = self._x_end_anchor.get_center()
        ys = self._y_start_anchor.get_center()
        ye = self._y_end_anchor.get_center()
        px = xs[0] + fx * (xe[0] - xs[0])
        py = ys[1] + fy * (ye[1] - ys[1])
        return np.array([px, py, 0.0])

    def coords_to_point(self, *coords) -> np.ndarray:
        return self.c2p(*coords)

    def i2gp(self, x: float, graph: Mobject) -> np.ndarray:
        return self.input_to_graph_point(x, graph)

    def input_to_graph_point(self, x: float, graph: Mobject) -> np.ndarray:
        if hasattr(graph, "_func"):
            return self.c2p(x, graph._func(x))
        return self.c2p(x, 0.0)

    def plot(self, function: Callable[[float], float], x_range: Sequence[float] = None, color: str = CYAN, stroke_width: float = 4.5, **kwargs) -> VMobject:
        xr = x_range if x_range is not None else self.x_range[:2]
        xmin, xmax = float(xr[0]), float(xr[1])
        n = 120
        pts = []
        for i in range(n + 1):
            xv = xmin + (xmax - xmin) * i / n
            yv = float(function(xv))
            if math.isfinite(yv):
                pts.append(self.c2p(xv, yv).tolist())
        curve = VMobject(color=color, stroke_width=stroke_width, **kwargs)
        curve.paths = [pts]
        curve._func = function
        return curve

    def get_axis_labels(self, x_label="x", y_label="y") -> VGroup:
        xl = Text(str(x_label), font_size=24, color=WHITE) if isinstance(x_label, str) else x_label
        yl = Text(str(y_label), font_size=24, color=WHITE) if isinstance(y_label, str) else y_label
        xl.next_to(self._x_end_anchor, DOWN + LEFT * 0.2, buff=0.2)
        yl.next_to(self._y_end_anchor, UP * 0.2 + RIGHT * 0.2, buff=0.2)
        return VGroup(xl, yl)

    def get_graph_label(self, graph: Mobject, label="f(x)", x_val: float = None, direction=UR, buff: float = 0.2, color: str = None) -> Mobject:
        lbl = Text(str(label), font_size=24, color=color or graph.color) if isinstance(label, str) else label
        xv = x_val if x_val is not None else self.x_range[1] * 0.7
        pt = self.input_to_graph_point(xv, graph)
        lbl.next_to(pt, direction, buff=buff)
        return lbl

    def get_area(self, graph: Mobject, x_range: Sequence[float] = None, color: str = BLUE, opacity: float = 0.35, **kwargs) -> VMobject:
        xr = x_range if x_range is not None else self.x_range[:2]
        xmin, xmax = float(xr[0]), float(xr[1])
        n = 60
        pts = [self.c2p(xmin, 0).tolist()]
        fn = getattr(graph, "_func", lambda v: 0.0)
        for i in range(n + 1):
            xv = xmin + (xmax - xmin) * i / n
            pts.append(self.c2p(xv, float(fn(xv))).tolist())
        pts.append(self.c2p(xmax, 0).tolist())
        area = VMobject(color=color, fill_opacity=opacity, stroke_width=0.0, **kwargs)
        area.paths = [pts]
        area.closed = True
        return area


class NumberPlane(Axes):
    def __init__(self, x_range=(-4, 4, 1), y_range=(-4, 4, 1), x_length: float = 6.0, y_length: float = 5.0, background_line_style=None, **kwargs):
        super().__init__(x_range=x_range, y_range=y_range, x_length=x_length, y_length=y_length, tips=False, **kwargs)
        grid_color = _normalize_color((background_line_style or {}).get("stroke_color", "#334155"))
        grid_op = float((background_line_style or {}).get("stroke_opacity", 0.45))
        x0, x1, xs = self.x_range
        y0, y1, ys = self.y_range
        vx = x0
        c = 0
        while vx <= x1 + 1e-6 and c < 30:
            gl = Line(self.c2p(vx, y0), self.c2p(vx, y1), color=grid_color, stroke_width=1.2, stroke_opacity=grid_op)
            self.submobjects.insert(0, gl)
            vx += xs
            c += 1
        vy = y0
        c = 0
        while vy <= y1 + 1e-6 and c < 30:
            gl = Line(self.c2p(x0, vy), self.c2p(x1, vy), color=grid_color, stroke_width=1.2, stroke_opacity=grid_op)
            self.submobjects.insert(0, gl)
            vy += ys
            c += 1


class BarChart(VGroup):
    def __init__(
        self,
        values: Sequence[float],
        bar_names: Sequence[str] = None,
        y_range: Sequence[float] = None,
        x_length: float = 5.6,
        y_length: float = 3.8,
        bar_colors: Sequence[str] = None,
        bar_width: float = 0.55,
        bar_fill_opacity: float = 0.85,
        **kwargs,
    ):
        super().__init__(**kwargs)
        vals = [float(v) for v in values]
        ymax = float(y_range[1]) if y_range else max(vals + [1.0]) * 1.15
        ymin = float(y_range[0]) if y_range else 0.0
        axes = Axes(x_range=[0, len(vals), 1], y_range=[ymin, ymax, (ymax - ymin) / 4.0], x_length=x_length, y_length=y_length, tips=False)
        self.add(axes)
        palette = list(bar_colors) if bar_colors else [CYAN, "#F43F5E", "#F59E0B", "#10B981", "#A855F7"]
        self.bars = VGroup()
        slot_w = x_length / max(1, len(vals))
        bw = min(bar_width, slot_w * 0.7)
        for i, v in enumerate(vals):
            col = palette[i % len(palette)]
            frac = max(0.02, (v - ymin) / max(1e-6, ymax - ymin))
            bh = frac * y_length
            cx = -x_length / 2.0 + (i + 0.5) * slot_w
            cy = -y_length / 2.0 + bh / 2.0
            rect = Rectangle(width=bw, height=bh, color=col, fill_opacity=bar_fill_opacity, stroke_width=2.0).move_to([cx, cy, 0])
            self.bars.add(rect)
            if bar_names and i < len(bar_names):
                lbl = Text(str(bar_names[i]), font_size=22, color=WHITE).move_to([cx, -y_length / 2.0 - 0.35, 0])
                self.add(lbl)
        self.add(self.bars)


class Table(VGroup):
    def __init__(self, table: Sequence[Sequence[str]], row_labels=None, col_labels=None, **kwargs):
        super().__init__(**kwargs)
        rows = len(table)
        cols = max((len(r) for r in table), default=1)
        cell_w, cell_h = 1.6, 0.7
        for r_idx, row in enumerate(table):
            for c_idx, cell in enumerate(row):
                x = (c_idx - (cols - 1) / 2.0) * cell_w
                y = ((rows - 1) / 2.0 - r_idx) * cell_h
                box = Rectangle(width=cell_w, height=cell_h, color=SLATE, stroke_width=1.5).move_to([x, y, 0])
                txt = Text(str(cell), font_size=22, color=WHITE).move_to([x, y, 0])
                self.add(box, txt)


# ---------------------------------------------------------------------------
# Reactive ValueTracker & always_redraw
# ---------------------------------------------------------------------------
class ValueTracker(Mobject):
    def __init__(self, value: float = 0.0, **kwargs):
        super().__init__(**kwargs)
        self._value = float(value)

    def get_value(self) -> float:
        return self._value

    def set_value(self, value: float) -> "ValueTracker":
        self._value = float(value)
        return self

    def increment_value(self, d_value: float) -> "ValueTracker":
        self._value += float(d_value)
        return self


def always_redraw(func: Callable[[], Mobject]) -> Mobject:
    initial = func()
    def _updater(mob: Mobject, dt: float = 0.0):
        fresh = func()
        mob.become(fresh)
    initial.add_updater(_updater)
    return initial


# ---------------------------------------------------------------------------
# Animations
# ---------------------------------------------------------------------------
class Animation:
    def __init__(self, mobject: Mobject, run_time: float = 1.0, rate_func: Callable = smooth, remover: bool = False, **kwargs):
        self.mobject = mobject
        self.run_time = float(run_time)
        self.rate_func = rate_func or smooth
        self.remover = remover
        self.start_state: Optional[Mobject] = None
        self.end_state: Optional[Mobject] = None

    def begin(self, scene_mobjects: list[Mobject]):
        self.start_state = self.mobject.copy()
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)

    def interpolate(self, alpha: float):
        pass

    def finish(self, scene_mobjects: list[Mobject]):
        if self.remover and self.mobject in scene_mobjects:
            scene_mobjects.remove(self.mobject)


class Wait(Animation):
    def __init__(self, run_time: float = 1.0, **kwargs):
        super().__init__(Mobject(), run_time=run_time, rate_func=linear, **kwargs)

    def begin(self, scene_mobjects: list[Mobject]):
        pass

    def finish(self, scene_mobjects: list[Mobject]):
        pass


class _AnimateProxyAnimation(Animation):
    def __init__(self, proxy: _AnimateProxy, run_time: float = 1.0, rate_func: Callable = smooth):
        super().__init__(proxy._mobject, run_time=run_time, rate_func=rate_func)
        self.proxy = proxy

    def begin(self, scene_mobjects: list[Mobject]):
        super().begin(scene_mobjects)
        target = self.mobject.copy()
        for name, args, kwargs in self.proxy._ops:
            getattr(target, name)(*args, **kwargs)
        self.end_state = target

    def interpolate(self, alpha: float):
        t = self.rate_func(alpha)
        if isinstance(self.mobject, ValueTracker) and isinstance(self.start_state, ValueTracker) and isinstance(self.end_state, ValueTracker):
            self.mobject.set_value(self.start_state._value + (self.end_state._value - self.start_state._value) * t)
            return
        _lerp_mobject(self.mobject, self.start_state, self.end_state, t)

    def finish(self, scene_mobjects: list[Mobject]):
        if isinstance(self.mobject, ValueTracker) and isinstance(self.end_state, ValueTracker):
            self.mobject.set_value(self.end_state._value)
        elif self.end_state is not None:
            self.mobject.become(self.end_state)


class FadeIn(Animation):
    def __init__(self, mobject: Mobject, shift=ORIGIN, scale: float = 1.0, **kwargs):
        super().__init__(mobject, **kwargs)
        self.shift_vec = _to_vec3(shift)
        self.start_scale = float(scale)

    def begin(self, scene_mobjects: list[Mobject]):
        self.end_state = self.mobject.copy()
        self.start_state = self.mobject.copy()
        self.start_state.shift([-self.shift_vec[0], -self.shift_vec[1], 0.0])
        if self.start_scale != 1.0:
            self.start_state.scale(self.start_scale)
        self.start_state.set_opacity(0.0)
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)
        self.mobject.become(self.start_state)

    def interpolate(self, alpha: float):
        _lerp_mobject(self.mobject, self.start_state, self.end_state, self.rate_func(alpha))

    def finish(self, scene_mobjects: list[Mobject]):
        self.mobject.become(self.end_state)


class FadeOut(Animation):
    def __init__(self, mobject: Mobject, shift=ORIGIN, scale: float = 1.0, **kwargs):
        super().__init__(mobject, remover=True, **kwargs)
        self.shift_vec = _to_vec3(shift)
        self.end_scale = float(scale)

    def begin(self, scene_mobjects: list[Mobject]):
        self.start_state = self.mobject.copy()
        self.end_state = self.mobject.copy()
        self.end_state.shift(self.shift_vec)
        if self.end_scale != 1.0:
            self.end_state.scale(self.end_scale)
        self.end_state.set_opacity(0.0)
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)

    def interpolate(self, alpha: float):
        _lerp_mobject(self.mobject, self.start_state, self.end_state, self.rate_func(alpha))


class GrowFromCenter(Animation):
    def __init__(self, mobject: Mobject, point_color=None, **kwargs):
        super().__init__(mobject, **kwargs)

    def begin(self, scene_mobjects: list[Mobject]):
        self.end_state = self.mobject.copy()
        self.start_state = self.mobject.copy()
        self.start_state.scale(0.01)
        self.start_state.set_opacity(0.0)
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)
        self.mobject.become(self.start_state)

    def interpolate(self, alpha: float):
        _lerp_mobject(self.mobject, self.start_state, self.end_state, self.rate_func(alpha))

    def finish(self, scene_mobjects: list[Mobject]):
        self.mobject.become(self.end_state)


class GrowFromPoint(GrowFromCenter):
    def __init__(self, mobject: Mobject, point=ORIGIN, **kwargs):
        super().__init__(mobject, **kwargs)
        self.point = _to_vec3(point)

    def begin(self, scene_mobjects: list[Mobject]):
        self.end_state = self.mobject.copy()
        self.start_state = self.mobject.copy()
        self.start_state.scale(0.01, about_point=self.point)
        self.start_state.set_opacity(0.0)
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)
        self.mobject.become(self.start_state)


class GrowFromEdge(GrowFromPoint):
    def __init__(self, mobject: Mobject, edge=DOWN, **kwargs):
        super().__init__(mobject, point=mobject.get_edge_center(edge), **kwargs)


class GrowArrow(GrowFromPoint):
    def __init__(self, arrow: Mobject, **kwargs):
        super().__init__(arrow, point=arrow.get_start(), **kwargs)


class SpinInFromNothing(GrowFromCenter):
    def interpolate(self, alpha: float):
        t = self.rate_func(alpha)
        _lerp_mobject(self.mobject, self.start_state, self.end_state, t)
        self.mobject.rotate((1.0 - t) * PI)


class Create(Animation):
    def begin(self, scene_mobjects: list[Mobject]):
        self.end_state = self.mobject.copy()
        self.start_state = self.mobject.copy()
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)
        self.interpolate(0.0)

    def interpolate(self, alpha: float):
        t = self.rate_func(alpha)
        _partial_reveal(self.mobject, self.end_state, t)

    def finish(self, scene_mobjects: list[Mobject]):
        self.mobject.become(self.end_state)


class Uncreate(Create):
    def __init__(self, mobject: Mobject, **kwargs):
        super().__init__(mobject, remover=True, **kwargs)

    def interpolate(self, alpha: float):
        t = 1.0 - self.rate_func(alpha)
        _partial_reveal(self.mobject, self.end_state, t)


class Write(Create):
    pass


class Unwrite(Uncreate):
    pass


class DrawBorderThenFill(Create):
    pass


class Transform(Animation):
    def __init__(self, mobject: Mobject, target_mobject: Mobject, **kwargs):
        super().__init__(mobject, **kwargs)
        self.target_mobject = target_mobject

    def begin(self, scene_mobjects: list[Mobject]):
        self.start_state = self.mobject.copy()
        self.end_state = self.target_mobject.copy()
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)

    def interpolate(self, alpha: float):
        _lerp_mobject(self.mobject, self.start_state, self.end_state, self.rate_func(alpha))

    def finish(self, scene_mobjects: list[Mobject]):
        self.mobject.become(self.end_state)


class ReplacementTransform(Transform):
    def finish(self, scene_mobjects: list[Mobject]):
        if self.mobject in scene_mobjects:
            idx = scene_mobjects.index(self.mobject)
            self.target_mobject.become(self.end_state)
            scene_mobjects[idx] = self.target_mobject


class TransformMatchingShapes(ReplacementTransform):
    pass


class TransformMatchingTex(ReplacementTransform):
    pass


class FadeTransform(ReplacementTransform):
    pass


class Indicate(Animation):
    def __init__(self, mobject: Mobject, scale_factor: float = 1.2, color: str = YELLOW, **kwargs):
        super().__init__(mobject, rate_func=there_and_back, **kwargs)
        self.scale_factor = float(scale_factor)
        self.ind_color = _normalize_color(color)

    def begin(self, scene_mobjects: list[Mobject]):
        self.start_state = self.mobject.copy()
        self.end_state = self.mobject.copy()
        self.end_state.scale(self.scale_factor)
        self.end_state.set_color(self.ind_color)
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)

    def interpolate(self, alpha: float):
        _lerp_mobject(self.mobject, self.start_state, self.end_state, self.rate_func(alpha))

    def finish(self, scene_mobjects: list[Mobject]):
        self.mobject.become(self.start_state)


class Circumscribe(Animation):
    def __init__(self, mobject: Mobject, color: str = YELLOW, buff: float = 0.15, **kwargs):
        super().__init__(mobject, **kwargs)
        self.box = SurroundingRectangle(mobject, color=color, buff=buff, stroke_width=4.0)

    def begin(self, scene_mobjects: list[Mobject]):
        self.start_state = self.box.copy()
        if self.box not in scene_mobjects:
            scene_mobjects.append(self.box)

    def interpolate(self, alpha: float):
        t = self.rate_func(alpha)
        if t < 0.5:
            _partial_reveal(self.box, self.start_state, t * 2.0)
        else:
            self.box.become(self.start_state)
            self.box.set_opacity(max(0.0, 1.0 - (t - 0.5) * 2.0))

    def finish(self, scene_mobjects: list[Mobject]):
        if self.box in scene_mobjects:
            scene_mobjects.remove(self.box)


class Flash(Indicate):
    pass


class Wiggle(Indicate):
    def __init__(self, mobject: Mobject, scale_value: float = 1.1, rotation_angle: float = 0.05 * TAU, **kwargs):
        super().__init__(mobject, scale_factor=scale_value, **kwargs)
        self.rotation_angle = float(rotation_angle)

    def interpolate(self, alpha: float):
        super().interpolate(alpha)
        self.mobject.rotate(math.sin(4 * PI * alpha) * self.rotation_angle)


class ShowPassingFlash(Circumscribe):
    pass


class ApplyWave(Indicate):
    pass


class Rotate(Animation):
    def __init__(self, mobject: Mobject, angle: float = PI, axis=OUT, about_point=None, **kwargs):
        super().__init__(mobject, **kwargs)
        self.angle = float(angle)
        self.about_point = about_point

    def begin(self, scene_mobjects: list[Mobject]):
        self.start_state = self.mobject.copy()
        self.origin = _to_vec3(self.about_point) if self.about_point is not None else self.mobject.get_center().tolist()
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)

    def interpolate(self, alpha: float):
        t = self.rate_func(alpha)
        self.mobject.become(self.start_state)
        self.mobject.rotate(self.angle * t, about_point=self.origin)

    def finish(self, scene_mobjects: list[Mobject]):
        self.mobject.become(self.start_state)
        self.mobject.rotate(self.angle, about_point=self.origin)


class MoveAlongPath(Animation):
    def __init__(self, mobject: Mobject, path: Mobject, **kwargs):
        super().__init__(mobject, **kwargs)
        self.path_mob = path

    def begin(self, scene_mobjects: list[Mobject]):
        self.start_state = self.mobject.copy()
        pts = self.path_mob.paths[0] if self.path_mob.paths else [self.mobject.get_center().tolist()]
        self.pts = pts
        if self.mobject not in scene_mobjects:
            scene_mobjects.append(self.mobject)

    def interpolate(self, alpha: float):
        t = self.rate_func(alpha)
        if len(self.pts) < 2:
            return
        idx_f = t * (len(self.pts) - 1)
        i0 = min(int(math.floor(idx_f)), len(self.pts) - 2)
        frac = idx_f - i0
        p0, p1 = self.pts[i0], self.pts[i0 + 1]
        pos = [p0[0] + (p1[0] - p0[0]) * frac, p0[1] + (p1[1] - p0[1]) * frac, 0.0]
        self.mobject.move_to(pos)


class AnimationGroup(Animation):
    def __init__(self, *animations: Animation, lag_ratio: float = 0.0, run_time: float = None, **kwargs):
        self.animations = [_coerce_anim(a) for a in animations]
        self.lag_ratio = float(lag_ratio)
        if run_time is None:
            max_rt = max((a.run_time for a in self.animations), default=1.0)
            rt = max_rt * (1.0 + self.lag_ratio * max(0, len(self.animations) - 1) * 0.5)
        else:
            rt = float(run_time)
        super().__init__(Mobject(), run_time=rt, rate_func=linear, **kwargs)

    def begin(self, scene_mobjects: list[Mobject]):
        for a in self.animations:
            a.begin(scene_mobjects)

    def interpolate(self, alpha: float):
        n = len(self.animations)
        if n == 0:
            return
        if self.lag_ratio <= 1e-6 or n == 1:
            for a in self.animations:
                a.interpolate(alpha)
            return
        span = 1.0 / (1.0 + self.lag_ratio * (n - 1))
        for i, a in enumerate(self.animations):
            start = i * self.lag_ratio * span
            local_a = max(0.0, min(1.0, (alpha - start) / max(1e-6, span)))
            a.interpolate(local_a)

    def finish(self, scene_mobjects: list[Mobject]):
        for a in self.animations:
            a.finish(scene_mobjects)


class LaggedStart(AnimationGroup):
    def __init__(self, *animations: Animation, lag_ratio: float = 0.05, **kwargs):
        super().__init__(*animations, lag_ratio=lag_ratio, **kwargs)


class LaggedStartMap(LaggedStart):
    def __init__(self, AnimationClass, mobject: Mobject, lag_ratio: float = 0.05, **kwargs):
        subs = mobject.submobjects if mobject.submobjects else [mobject]
        anims = [AnimationClass(s, **kwargs) for s in subs]
        super().__init__(*anims, lag_ratio=lag_ratio)


class Succession(AnimationGroup):
    def __init__(self, *animations: Animation, **kwargs):
        anims = [_coerce_anim(a) for a in animations]
        total_rt = sum(a.run_time for a in anims) or 1.0
        super().__init__(*anims, lag_ratio=1.0, run_time=total_rt, **kwargs)


def _coerce_anim(item: Any) -> Animation:
    if isinstance(item, _AnimateProxy):
        return _AnimateProxyAnimation(item)
    return item


# ---------------------------------------------------------------------------
# Interpolation & Partial Reveal Helpers
# ---------------------------------------------------------------------------
def _partial_reveal(target: Mobject, full: Mobject, t: float):
    t = max(0.0, min(1.0, float(t)))
    target.become(full)
    if t >= 0.999:
        return
    if t <= 0.001:
        target.set_opacity(0.0)
        return
    if full.is_text:
        target.set_opacity(t)
        return
    # Reveal paths proportionally and fade fill in second half
    new_paths = []
    for path in full.paths:
        if len(path) < 2:
            new_paths.append(copy.deepcopy(path))
            continue
        k = max(2, int(math.ceil(t * len(path))))
        new_paths.append(copy.deepcopy(path[:k]))
    target.paths = new_paths
    target.fill_opacity = full.fill_opacity * max(0.0, (t - 0.4) / 0.6)
    target.stroke_opacity = full.stroke_opacity * min(1.0, t * 2.5)
    for ts, fs in zip(target.submobjects, full.submobjects):
        _partial_reveal(ts, fs, t)


def _lerp_mobject(target: Mobject, a: Mobject, b: Mobject, t: float):
    t = max(0.0, min(1.0, float(t)))
    target.opacity = a.opacity + (b.opacity - a.opacity) * t
    target.fill_opacity = a.fill_opacity + (b.fill_opacity - a.fill_opacity) * t
    target.stroke_opacity = a.stroke_opacity + (b.stroke_opacity - a.stroke_opacity) * t
    target.stroke_width = a.stroke_width + (b.stroke_width - a.stroke_width) * t
    target.stroke_color = interpolate_color(a.stroke_color, b.stroke_color, t)
    target.fill_color = interpolate_color(a.fill_color, b.fill_color, t)
    target.color = target.stroke_color

    if a.is_text and b.is_text:
        target._text_pos = [a._text_pos[i] + (b._text_pos[i] - a._text_pos[i]) * t for i in range(3)]
        target._text_angle = a._text_angle + (b._text_angle - a._text_angle) * t
        target._text_scale = a._text_scale + (b._text_scale - a._text_scale) * t
        if t > 0.5:
            target.text_str = b.text_str
    elif len(a.paths) == len(b.paths):
        lerped_paths = []
        for pa, pb in zip(a.paths, b.paths):
            if len(pa) == len(pb):
                lerped_paths.append([
                    [pa[i][0] + (pb[i][0] - pa[i][0]) * t, pa[i][1] + (pb[i][1] - pa[i][1]) * t, 0.0]
                    for i in range(len(pa))
                ])
            else:
                lerped_paths.append(copy.deepcopy(pa if t < 0.5 else pb))
        target.paths = lerped_paths
    else:
        # Cross-shape transform: smooth morph via bounding-box center & opacity blend
        if t < 0.5:
            target.become(a)
            target.opacity = a.opacity * (1.0 - t * 2.0)
        else:
            target.become(b)
            target.opacity = b.opacity * ((t - 0.5) * 2.0)

    if len(a.submobjects) == len(b.submobjects):
        for st, sa, sb in zip(target.submobjects, a.submobjects, b.submobjects):
            _lerp_mobject(st, sa, sb, t)


# ---------------------------------------------------------------------------
# Camera & Scene Execution
# ---------------------------------------------------------------------------
class _Camera:
    def __init__(self):
        self.background_color = config.background_color


def _flatten_draw_items(mob: Mobject, parent_opacity: float = 1.0) -> list[dict]:
    items: list[dict] = []
    eff_op = max(0.0, min(1.0, mob.opacity * parent_opacity))
    if eff_op <= 0.005:
        return items

    if mob.is_text and mob.text_str:
        items.append({
            "kind": "text",
            "z": mob.z_index,
            "text": mob.text_str,
            "x": mob._text_pos[0],
            "y": mob._text_pos[1],
            "font_size": mob.font_size * mob._text_scale,
            "font": mob.font,
            "weight": mob.weight,
            "color": mob.fill_color or mob.color,
            "opacity": eff_op * max(mob.fill_opacity, 0.0),
            "angle": mob._text_angle,
        })

    if mob.paths and (mob.fill_opacity > 0.005 or (mob.stroke_width > 0 and mob.stroke_opacity > 0.005)):
        items.append({
            "kind": "path",
            "z": mob.z_index,
            "paths": [[[round(p[0], 4), round(p[1], 4)] for p in path] for path in mob.paths if len(path) >= 2],
            "closed": mob.closed,
            "dashed": mob.dashed,
            "dash_length": mob.dash_length,
            "stroke_color": mob.stroke_color,
            "stroke_width": mob.stroke_width,
            "stroke_opacity": eff_op * mob.stroke_opacity,
            "fill_color": mob.fill_color,
            "fill_opacity": eff_op * mob.fill_opacity,
            "arrow_tip_end": mob.arrow_tip_end,
            "arrow_tip_start": mob.arrow_tip_start,
            "tip_length": mob.tip_length,
        })

    for sub in mob.submobjects:
        items.extend(_flatten_draw_items(sub, eff_op))
    return items


class Scene:
    def __init__(self):
        self.camera = _Camera()
        self.mobjects: list[Mobject] = []
        self._frames: list[list[dict]] = []
        self._fps: int = 15
        self._accum_time: float = 0.0
        self._total_duration: float = 0.0
        self._is_rendering: bool = False

    def construct(self):
        pass

    def add(self, *mobjects: Mobject):
        for m in mobjects:
            if m is not None and m not in self.mobjects:
                self.mobjects.append(m)
        return self

    def remove(self, *mobjects: Mobject):
        for m in mobjects:
            if m in self.mobjects:
                self.mobjects.remove(m)
        return self

    def clear(self):
        self.mobjects.clear()
        return self

    def _snapshot(self, dt: float):
        for m in self.mobjects:
            m.update(dt)
        items: list[dict] = []
        for m in self.mobjects:
            items.extend(_flatten_draw_items(m))
        items.sort(key=lambda it: it["z"])
        self._frames.append(items)

    def play(self, *animations: Any, run_time: float = None, rate_func: Callable = None, **kwargs):
        anims = [_coerce_anim(a) for a in animations]
        if run_time is not None:
            rt = float(run_time)
            for a in anims:
                a.run_time = rt
        else:
            rt = max((a.run_time for a in anims), default=1.0)
        if rate_func is not None:
            for a in anims:
                a.rate_func = rate_func
        if rt <= 0:
            raise ValueError(f"self.play() run_time must be positive, got {rt}")

        self._total_duration += rt
        if not self._is_rendering:
            return

        dt = 1.0 / self._fps
        for a in anims:
            a.begin(self.mobjects)
        start_f = len(self._frames)
        self._accum_time += rt
        end_f = max(start_f + 1, int(round(self._accum_time * self._fps)))
        n_frames = end_f - start_f
        for i in range(n_frames):
            alpha = (i + 1) / n_frames if n_frames > 1 else 1.0
            for a in anims:
                a.interpolate(alpha)
            self._snapshot(dt)
        for a in anims:
            a.finish(self.mobjects)

    def wait(self, duration: float = 1.0):
        d = float(duration)
        if d <= 0:
            raise ValueError(f"self.wait() duration must be > 0, got {d}")
        self._total_duration += d
        if not self._is_rendering:
            return

        dt = 1.0 / self._fps
        start_f = len(self._frames)
        self._accum_time += d
        end_f = max(start_f + 1, int(round(self._accum_time * self._fps)))
        for _ in range(end_f - start_f):
            self._snapshot(dt)

    def _compile_frames(self, fps: int) -> dict:
        self.mobjects = []
        self._frames = []
        self._fps = int(fps)
        self._accum_time = 0.0
        self._total_duration = 0.0
        self._is_rendering = True
        try:
            self.construct()
        finally:
            self._is_rendering = False

        if not self._frames:
            self._snapshot(1.0 / self._fps)

        return {
            "fps": self._fps,
            "total_duration": round(self._total_duration, 4),
            "frame_width": float(config.frame_width),
            "frame_height": float(config.frame_height),
            "background_color": _normalize_color(self.camera.background_color),
            "frames": self._frames,
        }

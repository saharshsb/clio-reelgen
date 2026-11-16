"""Executes a Manim Scene Python file and serializes its frame timeline to JSON."""
import argparse
import importlib.util
import json
import os
import sys
import traceback
from pathlib import Path

# Ensure py_runtime is first on sys.path so `from manim import *` and `import numpy as np` resolve
RUNTIME_DIR = str(Path(__file__).resolve().parent)
if RUNTIME_DIR not in sys.path:
    sys.path.insert(0, RUNTIME_DIR)

import manim  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Compile a Manim Scene script into a render timeline JSON.")
    parser.add_argument("script_path", help="Path to scene_XX.py")
    parser.add_argument("scene_class", nargs="?", default="GeneratedScene", help="Scene class name")
    parser.add_argument("--fps", type=int, default=15, help="Target frame rate")
    parser.add_argument("--out", required=True, help="Output timeline JSON path")
    args = parser.parse_args()

    script_path = Path(args.script_path).resolve()
    if not script_path.exists():
        print(f"FileNotFoundError: Scene script not found: {script_path}", file=sys.stderr)
        sys.exit(1)

    try:
        spec = importlib.util.spec_from_file_location("generated_scene_module", str(script_path))
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not load spec from {script_path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        scene_cls = getattr(module, args.scene_class, None)
        if scene_cls is None:
            # Fallback: find any Scene subclass
            for attr_name in dir(module):
                obj = getattr(module, attr_name)
                if isinstance(obj, type) and issubclass(obj, manim.Scene) and obj is not manim.Scene:
                    scene_cls = obj
                    break
        if scene_cls is None:
            raise AttributeError(f"Class '{args.scene_class}' not found in {script_path.name}")

        scene = scene_cls()
        timeline = scene._compile_frames(fps=args.fps)

        if timeline["total_duration"] <= 0:
            raise ValueError("Scene produced 0.0 seconds of animation. Make sure self.play() or self.wait() is called.")

        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(timeline), encoding="utf-8")
        print(json.dumps({
            "status": "ok",
            "fps": timeline["fps"],
            "frame_count": len(timeline["frames"]),
            "total_duration": timeline["total_duration"],
        }))
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

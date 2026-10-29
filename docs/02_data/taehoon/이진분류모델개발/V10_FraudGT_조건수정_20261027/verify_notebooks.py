"""Verify the current notebook layout in isolated fresh kernels."""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("verify_lesson_notebooks.py")), run_name="__main__")

"""Generate the current short-cell lesson notebooks."""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("make_lesson_notebooks.py")), run_name="__main__")

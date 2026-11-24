"""Use the examples repository's test reporter for this standalone package."""
from pathlib import Path
from runpy import run_path

run_path(str(Path(__file__).resolve().parents[3] / "tools" / "test_report.py"), run_name="__main__")

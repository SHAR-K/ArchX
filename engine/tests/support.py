from __future__ import annotations

import shutil
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from uuid import uuid4


@contextmanager
def isolated_work_directory() -> Iterator[Path]:
    root = Path(__file__).resolve().parents[1] / ".test-work"
    path = root / uuid4().hex
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path)


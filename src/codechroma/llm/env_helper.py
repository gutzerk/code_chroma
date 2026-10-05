"""Tiny shell-launched helper; deliberately imports no application modules."""

import json
import os
import sys


def print_environment(marker: str) -> None:
    print(marker + json.dumps(dict(os.environ), ensure_ascii=True) + marker, flush=True)


if __name__ == "__main__":
    print_environment(sys.argv[1])

"""Rebuild UTCI fixtures from the pinned, separately downloaded ECMWF source.

Usage: python3 tests/reference/regenerate-fixtures.py /path/to/thermofeel.py
No numpy installation required. Only the two audited mathematical functions are
compiled; imports and the rest of the downloaded module are not executed.
The expected source SHA256 is recorded in utci-source-provenance.json.
"""
import ast
import hashlib
import json
import math
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
source = Path(sys.argv[1]).read_text()
provenance = json.loads((here / "utci-source-provenance.json").read_text())
source_hash = hashlib.sha256(source.encode()).hexdigest()
if source_hash != provenance["independentSourceSha256"]:
    raise SystemExit("Reference source SHA256 differs from the audited snapshot.")

names = {"calculate_saturation_vapour_pressure", "calculate_utci_polynomial"}
functions = []
for node in ast.parse(source).body:
    if isinstance(node, ast.FunctionDef) and node.name in names:
        node.decorator_list = []
        node.returns = None
        for argument in node.args.args:
            argument.annotation = None
        functions.append(node)
if len(functions) != 2:
    raise SystemExit("Expected reference functions missing.")


class ScalarMath:
    log = staticmethod(math.log)
    exp = staticmethod(math.exp)
    power = staticmethod(pow)
    subtract = staticmethod(lambda a, b: a - b)


namespace = {"np": ScalarMath}
module = ast.Module(body=functions)
if hasattr(module, "type_ignores") or sys.version_info >= (3, 8):
    module.type_ignores = []
exec(compile(module, "<audited ECMWF mathematical functions>", "exec"), namespace)
fixtures = []
for ta in [-50, -30, -10, 0, 10, 20, 25, 30, 35, 40, 50]:
    for delta in [-30, 0, 15, 40, 70]:
        for wind in [0.5, 1, 5, 17]:
            for rh in [0, 25, 50, 100]:
                vapour = namespace["calculate_saturation_vapour_pressure"](ta + 273.15) * rh / 1000
                if vapour > 5:
                    continue
                value = namespace["calculate_utci_polynomial"](ta, ta + delta, wind, vapour)
                fixtures.append({"ta": ta, "tmrt": ta + delta, "wind": wind, "rh": rh, "value": value})
result = {
    "source": "ECMWF thermofeel calculate_utci_polynomial and calculate_saturation_vapour_pressure",
    "sourceSha256": source_hash,
    "units": {"inputs": "ta/tmrt Celsius, wind at10m m/s, rh percent", "value": "Celsius"},
    "fixtures": fixtures,
}
(here / "utci-ecmwf-fixtures.json").write_text(json.dumps(result, separators=(",", ":")) + "\n")
print("Generated", len(fixtures), "ECMWF reference fixtures.")

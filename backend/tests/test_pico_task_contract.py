"""The backend's exact wire actions must pass the real frontend parser.

This is a cross-language boundary check, not a copy of either validator. It uses
the installed frontend TypeScript compiler; backend-only installs may skip it.
"""
import json
from pathlib import Path
import shutil
import subprocess

import pytest
from pydantic import ValidationError

from app.modules.pico.registry import UI_ADAPTER


def test_new_actions_have_identical_backend_wire_and_frontend_contract():
    frontend = Path(__file__).resolve().parents[2] / "frontend"
    if not shutil.which("node") or not (frontend / "node_modules/typescript").exists():
        pytest.skip("requires the installed frontend Node/TypeScript dependencies")
    raw_actions = [
        *[{"type": "set_factory_filter", "status": status} for status in ("all", "healthy", "degraded", "fault", "offline")],
        {"type": "set_factory_filter", "status": "all", "q": ""},
        {"type": "set_factory_filter", "status": "all", "q": "泵" * 80},
        {"type": "set_factory_filter", "status": "all", "q": None},
        {"type": "set_factory_filter", "status": "all", "q": "x" * 81},
        {"type": "set_factory_filter", "status": "all", "q": "bad\nquery"},
        {"type": "set_factory_filter", "status": "invented"},
        {"type": "set_factory_filter", "status": "healthy", "javascript": "bad"},
        {"type": "select_factory_device", "device_id": "motor-001"},
        {"type": "select_factory_device", "device_id": "1" + "x" * 63},
        {"type": "select_factory_device", "device_id": "x" * 65},
        {"type": "select_factory_device", "device_id": "../admin/users"},
        {"type": "select_factory_device", "device_id": "motor-001", "url": "https://evil"},
        *[{"type": "navigate", "route_id": name, "params": {}} for name in ("user_management", "record_management", "device_directory")],
    ]
    examples = []
    for index, action in enumerate(raw_actions):
        action = {"action_id": f"contract-{index}", **action}
        try:
            normalized = UI_ADAPTER.validate_python(action).model_dump(exclude_none=True)
            examples.append({"wire": normalized, "accepted": True})
        except ValidationError:
            examples.append({"wire": action, "accepted": False})
    script = r'''
import fs from 'node:fs';
import ts from 'typescript';
const code = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`;
const catalogue = code(fs.readFileSync('src/features/about/research.ts', 'utf8'));
const source = fs.readFileSync('src/features/pico/core/uiActions.ts', 'utf8').replace("'../../about/research'", JSON.stringify(catalogue));
const {parsePicoUiAction, picoUiActionPath} = await import(code(source));
const examples = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(examples.map(item => ({accepted:!!parsePicoUiAction(item.wire), path:item.accepted && item.wire.type === 'navigate' ? picoUiActionPath(item.wire) : null}))));
'''
    result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=frontend, input=json.dumps(examples), capture_output=True, text=True, timeout=15, check=True)
    actual = json.loads(result.stdout)
    assert [row["accepted"] for row in actual] == [row["accepted"] for row in examples]
    assert [row["path"] for row in actual[-3:]] == ["/admin/users", "/admin/records", "/manage/devices"]

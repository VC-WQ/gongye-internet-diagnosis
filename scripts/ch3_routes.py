"""核准第三章：模块/接口清单、Agent 结构、状态机、降级路径。"""
import io
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(r"D:\企业云系统\工业互联网系统")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

os.environ.setdefault("DEEPSEEK_MOCK", "true")
out = []


def w(s=""):
    out.append(str(s))


# ---------- 1. 路由清单 ----------
try:
    from app.main import app  # type: ignore
except Exception as e:  # noqa: BLE001
    w("IMPORT FAIL: %r" % (e,))
    app = None

if app is not None:
    rows = []
    for r in app.routes:
        methods = sorted(getattr(r, "methods", None) or [])
        methods = [m for m in methods if m not in ("HEAD", "OPTIONS")]
        path = getattr(r, "path", "")
        name = getattr(r, "name", "")
        if not path.startswith("/api"):
            continue
        rows.append((path, ",".join(methods), name))
    w("=== 接口总数（/api 前缀）: %d ===" % len(rows))

    # 按前缀归组
    groups = {}
    for path, m, name in rows:
        parts = [p for p in path.split("/") if p]
        # /api/v1/xxx/...
        key = "/".join(parts[:3]) if len(parts) >= 3 else "/".join(parts)
        groups.setdefault(key, []).append((path, m))
    w("\n=== 按二级前缀分组 ===")
    for k in sorted(groups):
        w("  %-34s %d 个" % (k, len(groups[k])))
    w("  分组数: %d" % len(groups))

    # 完整清单
    w("\n=== 完整接口清单 ===")
    for path, m, name in sorted(rows):
        w("  %-7s %s" % (m, path))

# ---------- 2. multi_agent 结构 ----------
w("\n\n=== multi_agent: graph.py ===")
g = ROOT / "backend" / "app" / "modules" / "multi_agent" / "graph.py"
t = g.read_text(encoding="utf-8")
for m in re.finditer(r'^\s*(?:graph\.add_node|graph\.add_edge|graph\.set_entry_point|graph\.add_conditional_edges)\s*\(?(.*)$', t, re.M):
    w("  " + m.group(1).strip())
w("--- 节点/边关键字计数 ---")
w("  add_node: %d, add_edge: %d, conditional_edges: %d" % (
    t.count("add_node"), t.count("add_edge"), t.count("add_conditional_edges")))
w("  USE_LANGGRAPH/LANGGRAPH 相关: %s" % re.findall(r'.*LANGGRAPH.*', t))

w("\n=== multi_agent: agents.py 类与角色 ===")
a = ROOT / "backend" / "app" / "modules" / "multi_agent" / "agents.py"
ta = a.read_text(encoding="utf-8")
for m in re.finditer(r'^class\s+(\w+)\(([^)]*)\):', ta, re.M):
    w("  %s(%s)" % (m.group(1), m.group(2)))
w("--- ROLE/name 定义 ---")
for m in re.finditer(r'(?:ROLE|role|name)\s*=\s*["\']([^"\']+)["\']', ta):
    w("  " + m.group(1))

w("\n=== multi_agent: schemas.py ===")
s = ROOT / "backend" / "app" / "modules" / "multi_agent" / "schemas.py"
ts = s.read_text(encoding="utf-8")
w("  行数 %d" % (ts.count("\n") + 1))
for m in re.finditer(r'^class\s+(\w+)\(', ts, re.M):
    w("  class " + m.group(1))

# ---------- 3. 状态机 ----------
w("\n=== command_loop: state_machine.py ===")
sm = ROOT / "backend" / "app" / "modules" / "command_loop" / "state_machine.py"
tsm = sm.read_text(encoding="utf-8")
w("  状态枚举: %s" % re.findall(r'^\s*(\w+)\s*=\s*["\']([^"\']+)["\']', tsm, re.M)[:20])
m = re.search(r'TRANSITIONS[^=]*=\s*\{(.*?)\n\}', tsm, re.S)
if m:
    w("  TRANSITIONS: %s" % m.group(1).strip()[:900])

# ---------- 4. 降级路径 ----------
w("\n=== 降级路径关键字 ===")
for f in ("cnn_classifier.py", "pinn_residual.py"):
    p = ROOT / "backend" / "app" / "modules" / "anomaly_detect" / f
    t2 = p.read_text(encoding="utf-8")
    hits = re.findall(r'.*(?:TORCH_AVAILABLE|except ImportError|HAS_TORCH|_TORCH|import torch).*', t2)
    w("  %s: %s" % (f, hits[:6]))

# ---------- 5. 模拟器 ----------
w("\n=== simulators ===")
for p in sorted((ROOT / "simulators").glob("*.py")):
    w("  %s  %d 行" % (p.name, p.read_text(encoding="utf-8").count("\n") + 1))

# ---------- 6. 前端页面 ----------
w("\n=== frontend 页面 ===")
appts = ROOT / "frontend" / "src" / "App.tsx"
if appts.exists():
    tat = appts.read_text(encoding="utf-8")
    w("  路由 path: %s" % re.findall(r'path=["\']([^"\']+)["\']', tat))
    w("  页面数(import pages): %d" % len(set(re.findall(r'from ["\']\./pages/(\w+)', tat))))

(ROOT / "scripts" / "ch3_routes.txt").write_text("\n".join(out), encoding="utf-8")
print("done")
